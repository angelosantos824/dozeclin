begin;

create or replace function dozeclin.document_professional_title_label(p_value text)
returns text
language sql
immutable
as $$
  select case nullif(trim(coalesce(p_value, '')), '')
    when 'psychoanalysis' then 'Psicanalista'
    when 'psychology' then 'Psicologo(a)'
    when 'dentistry' then 'Medico(a) Dentista'
    when 'nutrition' then 'Nutricionista'
    when 'physiotherapy' then 'Fisioterapeuta'
    when 'pediatrics' then 'Pediatra'
    when 'psychiatry' then 'Psiquiatra'
    when 'multidisciplinary' then 'Profissional de Saude'
    when 'general' then 'Profissional de Saude'
    when 'other' then 'Profissional'
    else nullif(trim(coalesce(p_value, '')), '')
  end;
$$;

create or replace function dozeclin.document_patient_snapshot(p_patient dozeclin.patients)
returns jsonb
language sql
stable
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'patient_id', p_patient.id,
    'full_name', p_patient.full_name,
    'initials', dozeclin.patient_initials(p_patient.full_name),
    'identification_number', p_patient.document,
    'address', nullif(trim(concat_ws(', ',
      p_patient.address,
      p_patient.postal_code,
      p_patient.city
    )), ''),
    'timezone', p_patient.timezone
  ));
$$;

create or replace function dozeclin.document_professional_snapshot(p_profile dozeclin.profiles)
returns jsonb
language sql
stable
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'profile_id', p_profile.id,
    'full_name', p_profile.full_name,
    'specialty_code', p_profile.specialty,
    'display_title', coalesce(
      nullif(trim(coalesce(p_profile.display_title, '')), ''),
      dozeclin.document_professional_title_label(p_profile.specialty)
    ),
    'professional_registration', p_profile.professional_registration,
    'professional_registration_body', p_profile.professional_registration_body,
    'email', coalesce(p_profile.professional_email, p_profile.email),
    'phone', coalesce(p_profile.professional_phone, p_profile.phone)
  ));
$$;

create or replace function dozeclin.document_clinic_snapshot(p_clinic dozeclin.clinics)
returns jsonb
language sql
stable
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'clinic_id', p_clinic.id,
    'name', coalesce(p_clinic.name, p_clinic.legal_name),
    'legal_name', p_clinic.legal_name,
    'tax_number', p_clinic.document,
    'email', p_clinic.email,
    'phone', p_clinic.phone,
    'address', nullif(trim(concat_ws(', ',
      p_clinic.address,
      p_clinic.postal_code,
      p_clinic.city,
      p_clinic.country
    )), ''),
    'city', p_clinic.city,
    'country', p_clinic.country,
    'timezone', p_clinic.timezone
  ));
$$;

create or replace function dozeclin.create_document_from_appointment(
  p_appointment_id uuid,
  p_document_type dozeclin.clinical_document_type,
  p_template_code text,
  p_visibility dozeclin.document_visibility,
  p_release_to_patient boolean default false
)
returns dozeclin.clinical_documents
language plpgsql
security definer
set search_path = dozeclin, auth
as $$
declare
  current_profile dozeclin.profiles;
  target_appointment dozeclin.appointments;
  target_patient dozeclin.patients;
  target_professional dozeclin.profiles;
  target_template dozeclin.document_templates;
  sequence_data jsonb;
  saved_document dozeclin.clinical_documents;
begin
  current_profile := dozeclin.current_profile();
  if current_profile.id is null then
    raise exception 'Perfil autenticado ativo nao encontrado.';
  end if;

  select *
  into target_appointment
  from dozeclin.appointments
  where id = p_appointment_id;
  if not found then
    raise exception 'Agendamento nao encontrado.';
  end if;
  if target_appointment.clinic_id <> current_profile.clinic_id then
    raise exception 'Agendamento de outra clinica.';
  end if;
  if p_document_type in ('attendance_certificate', 'clinical_progress')
    and target_appointment.status <> 'completed' then
    raise exception 'Documento exige agendamento concluido.';
  end if;

  select *
  into target_patient
  from dozeclin.patients
  where id = target_appointment.patient_id
    and clinic_id = current_profile.clinic_id;
  if not found then
    raise exception 'Paciente nao encontrado.';
  end if;

  select *
  into target_professional
  from dozeclin.profiles
  where id = target_appointment.professional_id
    and clinic_id = current_profile.clinic_id;
  if not found then
    raise exception 'Profissional nao encontrado.';
  end if;

  if not dozeclin.can_manage_documents(current_profile.clinic_id) then
    raise exception 'Sem permissao para criar documento.';
  end if;

  select *
  into target_template
  from dozeclin.document_templates t
  where t.template_code = p_template_code
    and t.document_type = p_document_type
    and t.status = 'active'
    and (t.clinic_id = current_profile.clinic_id or t.clinic_id is null)
  order by t.clinic_id nulls last, t.template_version desc
  limit 1;
  if not found then
    raise exception 'Template documental ativo nao encontrado.';
  end if;

  sequence_data := dozeclin.next_clinical_document_number(current_profile.clinic_id, p_document_type, now());

  insert into dozeclin.clinical_documents (
    clinic_id,
    patient_id,
    appointment_id,
    professional_id,
    document_type,
    document_number,
    document_year,
    document_sequence,
    document_prefix,
    title,
    visibility,
    content_snapshot,
    patient_access_enabled,
    patient_access_enabled_at,
    template_code,
    template_name,
    template_version,
    created_by
  )
  values (
    current_profile.clinic_id,
    target_patient.id,
    target_appointment.id,
    target_professional.id,
    p_document_type,
    sequence_data->>'document_number',
    (sequence_data->>'document_year')::integer,
    (sequence_data->>'document_sequence')::integer,
    sequence_data->>'document_prefix',
    target_template.template_name,
    p_visibility,
    jsonb_strip_nulls(jsonb_build_object(
      'appointment_id', target_appointment.id,
      'scheduled_start', target_appointment.scheduled_start,
      'scheduled_end', target_appointment.scheduled_end,
      'timezone', coalesce(target_appointment.clinic_timezone, target_patient.timezone, 'Europe/Lisbon'),
      'modality', target_appointment.modality,
      'expected_duration', target_appointment.expected_duration,
      'notes', null
    )),
    case when p_visibility = 'patient' and coalesce(p_release_to_patient, false) then true else false end,
    case when p_visibility = 'patient' and coalesce(p_release_to_patient, false) then now() else null end,
    target_template.template_code,
    target_template.template_name,
    target_template.template_version,
    current_profile.id
  )
  returning * into saved_document;

  perform dozeclin.audit_document_event(
    saved_document.clinic_id,
    saved_document.id,
    'created',
    jsonb_build_object(
      'source', 'appointment',
      'appointment_id', target_appointment.id,
      'patient_id', target_patient.id,
      'professional_id', target_professional.id
    )
  );

  return saved_document;
end;
$$;

create or replace function dozeclin.issue_clinical_document(p_document_id uuid)
returns dozeclin.clinical_documents
language plpgsql
security definer
set search_path = dozeclin, auth
as $$
declare
  current_profile dozeclin.profiles;
  target_document dozeclin.clinical_documents;
  target_clinic dozeclin.clinics;
  target_patient dozeclin.patients;
  target_professional dozeclin.profiles;
  issued_document dozeclin.clinical_documents;
  final_hash text;
begin
  current_profile := dozeclin.current_profile();
  if current_profile.id is null then raise exception 'Perfil autenticado ativo nao encontrado.'; end if;

  select d.* into target_document
  from dozeclin.clinical_documents d
  where d.id = p_document_id
  for update;
  if not found then raise exception 'Documento nao encontrado.'; end if;

  if not dozeclin.can_manage_documents(target_document.clinic_id) then
    raise exception 'Sem permissao para emitir documento.';
  end if;
  if target_document.status <> 'draft' then
    raise exception 'Apenas rascunhos podem ser emitidos.';
  end if;

  select * into target_clinic from dozeclin.clinics where id = target_document.clinic_id;
  select * into target_patient from dozeclin.patients where id = target_document.patient_id;
  select * into target_professional from dozeclin.profiles where id = target_document.professional_id;

  set local dozeclin.document_rpc = 'on';

  update dozeclin.clinical_documents as d
  set status = 'issued',
      issued_at = now(),
      issued_by = current_profile.id,
      clinic_snapshot = dozeclin.document_clinic_snapshot(target_clinic),
      professional_snapshot = dozeclin.document_professional_snapshot(target_professional),
      patient_snapshot = dozeclin.document_patient_snapshot(target_patient)
  where d.id = target_document.id
  returning d.* into issued_document;

  final_hash := dozeclin.build_clinical_document_hash(issued_document);

  update dozeclin.clinical_documents as d
  set document_hash = final_hash
  where d.id = issued_document.id
  returning d.* into issued_document;

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
    issued_document.clinic_id,
    issued_document.id,
    issued_document.current_version,
    issued_document.template_code,
    issued_document.template_name,
    issued_document.template_version,
    issued_document.content_snapshot,
    issued_document.clinic_snapshot,
    issued_document.professional_snapshot,
    issued_document.patient_snapshot,
    issued_document.signature_snapshot,
    issued_document.institutional_snapshot,
    issued_document.document_hash,
    'Emissao do documento',
    current_profile.id
  )
  on conflict (document_id, version_number) do nothing;

  perform dozeclin.audit_document_event(issued_document.clinic_id, issued_document.id, 'issued', '{}'::jsonb);
  return issued_document;
end;
$$;

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
  signed_document dozeclin.clinical_documents;
  next_signature_snapshot jsonb;
  final_hash text;
begin
  current_profile := dozeclin.current_profile();
  if current_profile.id is null then
    raise exception 'Perfil autenticado ativo nao encontrado.';
  end if;

  select d.* into target_document
  from dozeclin.clinical_documents d
  where d.id = p_document_id
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

  next_signature_snapshot := jsonb_strip_nulls(jsonb_build_object(
    'signature_id', target_signature.id,
    'signer_profile_id', current_profile.id,
    'signer_name', current_profile.full_name,
    'professional_name', current_profile.full_name,
    'specialty_code', current_profile.specialty,
    'display_title', coalesce(
      nullif(trim(coalesce(current_profile.display_title, '')), ''),
      dozeclin.document_professional_title_label(current_profile.specialty)
    ),
    'professional_registration', current_profile.professional_registration,
    'professional_registration_body', current_profile.professional_registration_body,
    'signed_at', now(),
    'signature_type', target_signature.signature_type,
    'file_hash', target_signature.file_hash,
    'storage_path', target_signature.storage_path,
    'document_hash_before_signature', target_document.document_hash,
    'template_version', target_document.template_version
  ));

  set local dozeclin.document_rpc = 'on';

  update dozeclin.clinical_documents as d
  set signature_status = 'signed',
      current_version = d.current_version + 1,
      signed_at = now(),
      signed_by = current_profile.id,
      signature_id = target_signature.id,
      signature_snapshot = next_signature_snapshot
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

revoke execute on function dozeclin.document_professional_title_label(text) from public, anon;
revoke execute on function dozeclin.document_patient_snapshot(dozeclin.patients) from public, anon;
revoke execute on function dozeclin.document_professional_snapshot(dozeclin.profiles) from public, anon;
revoke execute on function dozeclin.document_clinic_snapshot(dozeclin.clinics) from public, anon;

revoke execute on function dozeclin.create_document_from_appointment(uuid, dozeclin.clinical_document_type, text, dozeclin.document_visibility, boolean) from public, anon;
revoke execute on function dozeclin.issue_clinical_document(uuid) from public, anon;
revoke execute on function dozeclin.sign_clinical_document(uuid, uuid) from public, anon;

grant execute on function dozeclin.create_document_from_appointment(uuid, dozeclin.clinical_document_type, text, dozeclin.document_visibility, boolean) to authenticated;
grant execute on function dozeclin.issue_clinical_document(uuid) to authenticated;
grant execute on function dozeclin.sign_clinical_document(uuid, uuid) to authenticated;

commit;
