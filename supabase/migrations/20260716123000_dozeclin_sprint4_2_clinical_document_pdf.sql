begin;

create or replace function dozeclin.finalize_clinical_document_pdf(
  p_document_id uuid,
  p_pdf_storage_path text,
  p_pdf_hash text,
  p_document_template_version text
)
returns dozeclin.clinical_documents
language plpgsql
security definer
set search_path = dozeclin, auth
as $$
declare
  target_document dozeclin.clinical_documents;
  saved_document dozeclin.clinical_documents;
begin
  select d.*
  into target_document
  from dozeclin.clinical_documents d
  where d.id = p_document_id
  for update;

  if not found then
    raise exception 'Documento nao encontrado.';
  end if;
  if target_document.status <> 'issued' then
    raise exception 'Apenas documentos emitidos podem gerar PDF.';
  end if;
  if target_document.signature_status <> 'signed' then
    raise exception 'Apenas documentos assinados podem gerar PDF.';
  end if;
  if target_document.document_hash is null or length(target_document.document_hash) <> 64 then
    raise exception 'Documento precisa possuir hash definitivo.';
  end if;
  if p_document_template_version <> 'clinical_document_v1' then
    raise exception 'Versao do modelo clinico nao suportada.';
  end if;
  if nullif(trim(coalesce(p_pdf_storage_path, '')), '') is null then
    raise exception 'Caminho do PDF obrigatorio.';
  end if;
  if nullif(trim(coalesce(p_pdf_hash, '')), '') is null or length(p_pdf_hash) <> 64 then
    raise exception 'Hash do PDF obrigatorio.';
  end if;

  if target_document.current_pdf_path is not null
    or target_document.current_pdf_hash is not null
    or target_document.current_pdf_generated_at is not null then
    if target_document.current_pdf_path = p_pdf_storage_path
      and target_document.current_pdf_hash = p_pdf_hash
      and target_document.current_pdf_template_version = p_document_template_version then
      return target_document;
    end if;

    raise exception 'PDF definitivo do documento ja foi gerado e nao pode ser substituido.';
  end if;

  perform set_config('dozeclin.document_rpc', 'on', true);

  update dozeclin.clinical_documents as d
  set current_pdf_path = p_pdf_storage_path,
      current_pdf_hash = p_pdf_hash,
      current_pdf_generated_at = now(),
      current_pdf_template_version = p_document_template_version
  where d.id = target_document.id
  returning d.* into saved_document;

  perform dozeclin.audit_document_event(
    saved_document.clinic_id,
    saved_document.id,
    'pdf_generated',
    jsonb_build_object(
      'document_number', saved_document.document_number,
      'pdf_hash', saved_document.current_pdf_hash,
      'document_template_version', saved_document.current_pdf_template_version
    )
  );

  insert into dozeclin.audit_logs (clinic_id, user_id, action, entity, entity_id, new_data)
  values (
    saved_document.clinic_id,
    auth.uid(),
    'documents.pdf_generated',
    'clinical_documents',
    saved_document.id,
    jsonb_build_object(
      'document_number', saved_document.document_number,
      'pdf_hash', saved_document.current_pdf_hash,
      'document_template_version', saved_document.current_pdf_template_version
    )
  );

  return saved_document;
end;
$$;

revoke execute on function dozeclin.finalize_clinical_document_pdf(uuid, text, text, text) from public, anon, authenticated;
grant execute on function dozeclin.finalize_clinical_document_pdf(uuid, text, text, text) to service_role;

commit;
