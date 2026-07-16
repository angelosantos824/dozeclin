begin;

create or replace function dozeclin.sign_clinical_document(
  p_document_id uuid,
  p_signature_id uuid
)
returns dozeclin.clinical_documents
language plpgsql
security definer
set search_path = dozeclin, auth
as $$
declare
  current_profile dozeclin.profiles;
  target_document dozeclin.clinical_documents;
  target_signature dozeclin.professional_signatures;
  target_patient dozeclin.patients;
  target_clinic dozeclin.clinics;
  signed_document dozeclin.clinical_documents;
  next_signature_snapshot jsonb;
  final_hash text;
begin
  current_profile := dozeclin.current_profile();
  if current_profile.id is null then
    raise exception 'Perfil autenticado ativo nao encontrado.';
  end if;

  select * into target_document
  from dozeclin.clinical_documents
  where id = p_document_id
  for update;
  if not found then raise exception 'Documento nao encontrado.'; end if;

  if target_document.clinic_id <> current_profile.clinic_id then
    raise exception 'Documento de outra clinica.';
  end if;
  if current_profile.role not in ('clinic_admin', 'supervisor', 'professional') then
    raise exception 'Sem permissao para assinar documento.';
  end if;
  if target_document.status <> 'issued' then
    raise exception 'Apenas documentos emitidos podem ser assinados.';
  end if;
  if target_document.signature_status <> 'unsigned' then
    raise exception 'Documento ja assinado ou revogado.';
  end if;

  select * into target_signature
  from dozeclin.professional_signatures
  where id = p_signature_id
  for update;
  if not found then raise exception 'Assinatura nao encontrada.'; end if;

  if target_signature.clinic_id <> target_document.clinic_id
    or target_signature.owner_type <> 'professional'
    or target_signature.profile_id <> current_profile.id
    or target_signature.is_active is not true
    or target_signature.revoked_at is not null then
    raise exception 'Assinatura invalida para este documento.';
  end if;

  select * into target_patient from dozeclin.patients where id = target_document.patient_id;
  select * into target_clinic from dozeclin.clinics where id = target_document.clinic_id;

  next_signature_snapshot := jsonb_build_object(
    'signature_id', target_signature.id,
    'signature_type', target_signature.signature_type,
    'file_hash', target_signature.file_hash,
    'professional_profile_id', current_profile.id,
    'professional_name', current_profile.full_name,
    'display_title', coalesce(current_profile.display_title, current_profile.specialty),
    'specialty', current_profile.specialty,
    'professional_registration', current_profile.professional_registration,
    'professional_registration_body', current_profile.professional_registration_body,
    'signed_at', now(),
    'document_hash_before_signature', target_document.document_hash,
    'template_version', target_document.template_version
  );

  set local dozeclin.document_rpc = 'on';

  update dozeclin.clinical_documents as d
  set signature_status = 'signed',
      current_version = d.current_version + 1,
      signed_at = now(),
      signed_by = current_profile.id,
      signature_id = target_signature.id,
      signature_snapshot = next_signature_snapshot,
      professional_snapshot = coalesce(d.professional_snapshot, jsonb_build_object(
        'profile_id', current_profile.id,
        'full_name', current_profile.full_name,
        'display_title', coalesce(current_profile.display_title, current_profile.specialty),
        'specialty', current_profile.specialty,
        'professional_registration', current_profile.professional_registration,
        'professional_registration_body', current_profile.professional_registration_body,
        'signature_hash', target_signature.file_hash
      )),
      patient_snapshot = coalesce(d.patient_snapshot, jsonb_build_object(
        'patient_id', target_patient.id,
        'initials', dozeclin.patient_initials(target_patient.full_name)
      ))
  where d.id = target_document.id
  returning d.* into signed_document;

  final_hash := dozeclin.build_clinical_document_hash(signed_document);

  update dozeclin.clinical_documents as d
  set document_hash = final_hash
  where d.id = signed_document.id
  returning d.* into signed_document;

  insert into dozeclin.document_versions (
    clinic_id,
    document_id,
    version_number,
    template_code,
    template_name,
    template_version,
    content_snapshot,
    clinic_snapshot,
    professional_snapshot,
    patient_snapshot,
    signature_snapshot,
    institutional_snapshot,
    document_hash,
    change_reason,
    created_by
  )
  values (
    signed_document.clinic_id,
    signed_document.id,
    signed_document.current_version,
    signed_document.template_code,
    signed_document.template_name,
    signed_document.template_version,
    signed_document.content_snapshot,
    signed_document.clinic_snapshot,
    signed_document.professional_snapshot,
    signed_document.patient_snapshot,
    signed_document.signature_snapshot,
    signed_document.institutional_snapshot,
    signed_document.document_hash,
    'Assinatura visual aplicada',
    current_profile.id
  )
  on conflict (document_id, version_number) do nothing;

  perform dozeclin.audit_document_event(
    signed_document.clinic_id,
    signed_document.id,
    'signed',
    jsonb_build_object('signature_type', target_signature.signature_type, 'document_hash_partial', left(signed_document.document_hash, 12))
  );

  insert into dozeclin.audit_logs (clinic_id, user_id, action, entity, entity_id, new_data)
  values (
    signed_document.clinic_id,
    auth.uid(),
    'documents.signed',
    'clinical_documents',
    signed_document.id,
    jsonb_build_object('document_number', signed_document.document_number, 'hash_partial', left(signed_document.document_hash, 12))
  );

  return signed_document;
end;
$$;

revoke execute on function dozeclin.sign_clinical_document(uuid, uuid) from public, anon;
grant execute on function dozeclin.sign_clinical_document(uuid, uuid) to authenticated;

commit;
