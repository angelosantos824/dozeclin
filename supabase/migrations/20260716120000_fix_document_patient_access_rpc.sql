begin;

create or replace function dozeclin.set_document_patient_access(
  p_document_id uuid,
  p_enabled boolean
)
returns dozeclin.clinical_documents
language plpgsql
security definer
set search_path = dozeclin, auth
as $$
declare
  current_profile dozeclin.profiles;
  target_document dozeclin.clinical_documents;
  updated_document dozeclin.clinical_documents;
  target_clinic dozeclin.clinics;
  desired_enabled boolean := coalesce(p_enabled, false);
  next_event dozeclin.document_event_type;
begin
  current_profile := dozeclin.current_profile();
  if current_profile.id is null then
    raise exception 'Perfil autenticado ativo nao encontrado.';
  end if;

  select d.*
  into target_document
  from dozeclin.clinical_documents d
  where d.id = p_document_id
  for update;
  if not found then
    raise exception 'Documento nao encontrado.';
  end if;

  if target_document.clinic_id <> current_profile.clinic_id then
    raise exception 'Documento de outra clinica.';
  end if;

  select c.*
  into target_clinic
  from dozeclin.clinics c
  where c.id = target_document.clinic_id;
  if not found or target_clinic.status not in ('trial', 'active') then
    raise exception 'Clinica indisponivel para portal do paciente.';
  end if;

  if not dozeclin.can_manage_documents(target_document.clinic_id) then
    raise exception 'Sem permissao para liberar documento.';
  end if;
  if target_document.status <> 'issued' then
    raise exception 'Apenas documentos emitidos podem ser liberados ao paciente.';
  end if;
  if target_document.patient_id is null then
    raise exception 'Documento sem paciente associado nao pode ser liberado ao paciente.';
  end if;
  if target_document.visibility not in ('patient', 'public_validation_only') then
    raise exception 'Documento nao esta configurado para visibilidade do paciente.';
  end if;
  if target_document.document_type = 'clinical_progress' then
    raise exception 'Tipo documental interno nao pode ser liberado ao paciente.';
  end if;

  if target_document.patient_access_enabled is not distinct from desired_enabled then
    return target_document;
  end if;

  perform set_config(
    'dozeclin.document_rpc',
    'on',
    true
  );

  update dozeclin.clinical_documents as d
  set patient_access_enabled = desired_enabled,
      patient_access_enabled_at = case
        when desired_enabled then coalesce(d.patient_access_enabled_at, now())
        else null
      end,
      visibility = case
        when desired_enabled then 'patient'::dozeclin.document_visibility
        else d.visibility
      end
  where d.id = target_document.id
  returning d.* into updated_document;

  next_event := case when updated_document.patient_access_enabled then 'patient_access_enabled'::dozeclin.document_event_type else 'patient_access_disabled'::dozeclin.document_event_type end;
  perform dozeclin.audit_document_event(updated_document.clinic_id, updated_document.id, next_event, '{}'::jsonb);

  insert into dozeclin.audit_logs (clinic_id, user_id, action, entity, entity_id, new_data)
  values (
    updated_document.clinic_id,
    auth.uid(),
    case when updated_document.patient_access_enabled then 'documents.patient_access_enabled' else 'documents.patient_access_disabled' end,
    'clinical_documents',
    updated_document.id,
    jsonb_build_object('document_number', updated_document.document_number)
  );

  return updated_document;
end;
$$;

revoke execute on function dozeclin.set_document_patient_access(uuid, boolean) from public, anon;
grant execute on function dozeclin.set_document_patient_access(uuid, boolean) to authenticated;

commit;
