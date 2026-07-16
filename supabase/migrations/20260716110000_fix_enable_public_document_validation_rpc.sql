begin;

create or replace function dozeclin.enable_public_document_validation(p_document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = dozeclin, auth
as $$
declare
  current_profile dozeclin.profiles;
  target_document dozeclin.clinical_documents;
  updated_document dozeclin.clinical_documents;
  target_clinic dozeclin.clinics;
  raw_token text;
  token_hash text;
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
    raise exception 'Clinica indisponivel para validacao publica.';
  end if;

  if current_profile.role not in ('clinic_admin', 'supervisor', 'professional') then
    raise exception 'Sem permissao para validar documento.';
  end if;
  if target_document.status <> 'issued' then
    raise exception 'Documento precisa estar emitido.';
  end if;
  if target_document.signature_status <> 'signed' then
    raise exception 'Documento precisa estar assinado.';
  end if;
  if target_document.document_hash is null or length(target_document.document_hash) <> 64 then
    raise exception 'Documento precisa possuir hash valido.';
  end if;
  if target_document.document_number is null
    or target_document.current_version is null
    or target_document.current_version < 1 then
    raise exception 'Documento precisa possuir numero e versao validos.';
  end if;

  if target_document.public_validation_enabled is true
    and target_document.validation_token_hash is not null then
    return jsonb_build_object(
      'document_id', target_document.id,
      'token', null,
      'validation_url', null,
      'already_enabled', true
    );
  end if;

  raw_token := replace(encode(gen_random_bytes(32), 'base64'), '/', '_');
  raw_token := replace(replace(raw_token, '+', '-'), '=', '');
  token_hash := dozeclin.hash_public_token(raw_token);

  perform set_config(
    'dozeclin.document_rpc',
    'on',
    true
  );

  update dozeclin.clinical_documents as d
  set validation_token_hash = coalesce(
        d.validation_token_hash,
        token_hash
      ),
      public_validation_enabled = true,
      public_validation_created_at = coalesce(
        d.public_validation_created_at,
        now()
      )
  where d.id = target_document.id
  returning d.* into updated_document;

  if target_document.public_validation_enabled is not true then
    perform dozeclin.audit_document_event(updated_document.clinic_id, updated_document.id, 'public_validation_enabled', '{}'::jsonb);

    insert into dozeclin.audit_logs (clinic_id, user_id, action, entity, entity_id, new_data)
    values (
      updated_document.clinic_id,
      auth.uid(),
      'documents.public_validation_enabled',
      'clinical_documents',
      updated_document.id,
      jsonb_build_object('document_number', updated_document.document_number)
    );
  end if;

  return jsonb_build_object(
    'document_id', updated_document.id,
    'token', case when updated_document.validation_token_hash = token_hash then raw_token else null end,
    'validation_url', case when updated_document.validation_token_hash = token_hash then '/app/verificar-documento.html?token=' || raw_token else null end,
    'already_enabled', false
  );
end;
$$;

revoke execute on function dozeclin.enable_public_document_validation(uuid) from public, anon;
grant execute on function dozeclin.enable_public_document_validation(uuid) to authenticated;

commit;
