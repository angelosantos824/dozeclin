begin;

alter table dozeclin.clinic_settings
  add column if not exists legal_name text,
  add column if not exists tax_identifier text,
  add column if not exists tax_regime text not null default 'normal',
  add column if not exists vat_rate numeric(5, 2) not null default 0,
  add column if not exists vat_exemption_reason text,
  add column if not exists fiscal_address text,
  add column if not exists fiscal_postal_code text,
  add column if not exists fiscal_city text,
  add column if not exists fiscal_country text,
  add column if not exists receipt_footer text,
  add column if not exists receipt_logo_url text,
  add column if not exists internal_receipt_prefix text,
  add column if not exists fiscal_document_mode text not null default 'internal_only';

alter table dozeclin.financial_receipts
  add column if not exists document_type text not null default 'internal_payment_receipt',
  add column if not exists document_template_version text not null default 'internal_payment_receipt_v1',
  add column if not exists document_status text not null default 'issued',
  add column if not exists issuer_snapshot jsonb,
  add column if not exists professional_snapshot jsonb,
  add column if not exists patient_snapshot jsonb,
  add column if not exists service_snapshot jsonb,
  add column if not exists payment_snapshot jsonb,
  add column if not exists tax_snapshot jsonb,
  add column if not exists pdf_storage_path text,
  add column if not exists pdf_generated_at timestamptz,
  add column if not exists pdf_hash text,
  add column if not exists external_fiscal_reference text,
  add column if not exists external_fiscal_document_type text,
  add column if not exists external_fiscal_document_number text,
  add column if not exists external_fiscal_atcud text,
  add column if not exists external_fiscal_url text,
  add column if not exists external_fiscal_issued_at timestamptz,
  add column if not exists external_fiscal_system text;

do $$
begin
  alter table dozeclin.clinic_settings
    add constraint clinic_settings_tax_regime_check
    check (tax_regime in ('normal', 'exempt_article_9', 'exempt_article_53', 'other'));
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table dozeclin.clinic_settings
    add constraint clinic_settings_fiscal_document_mode_check
    check (fiscal_document_mode in ('internal_only', 'external_reference', 'fiscal_integration'));
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table dozeclin.financial_receipts
    add constraint financial_receipts_document_type_check
    check (document_type = 'internal_payment_receipt');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table dozeclin.financial_receipts
    add constraint financial_receipts_document_template_version_check
    check (document_template_version = 'internal_payment_receipt_v1');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table dozeclin.financial_receipts
    add constraint financial_receipts_document_status_check
    check (document_status in ('issued', 'pdf_generated', 'cancelled'));
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table dozeclin.financial_receipts
    add constraint financial_receipts_external_document_type_check
    check (
      external_fiscal_document_type is null
      or external_fiscal_document_type in ('invoice', 'receipt', 'invoice_receipt')
    );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table dozeclin.financial_receipts
    add constraint financial_receipts_pdf_complete_check
    check (
      (pdf_storage_path is null and pdf_generated_at is null and pdf_hash is null)
      or (pdf_storage_path is not null and pdf_generated_at is not null and pdf_hash is not null)
    );
exception
  when duplicate_object then null;
end $$;

create index if not exists idx_dozeclin_financial_receipts_pdf_path
on dozeclin.financial_receipts(pdf_storage_path)
where pdf_storage_path is not null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('financial-documents', 'financial-documents', false, 5242880, array['application/pdf'])
on conflict (id) do update
set public = false,
    file_size_limit = 5242880,
    allowed_mime_types = array['application/pdf'];

drop policy if exists "financial_documents_no_direct_access" on storage.objects;
create policy "financial_documents_no_direct_access" on storage.objects
for select using (
  bucket_id = 'financial-documents'
  and false
);

create or replace function dozeclin.protect_financial_receipt_integrity()
returns trigger
language plpgsql
security definer
set search_path = dozeclin, auth
as $$
begin
  if old.clinic_id is distinct from new.clinic_id
    or old.payment_id is distinct from new.payment_id
    or old.charge_id is distinct from new.charge_id
    or old.patient_id is distinct from new.patient_id
    or old.receipt_number is distinct from new.receipt_number
    or old.currency is distinct from new.currency
    or old.amount is distinct from new.amount
    or old.issued_at is distinct from new.issued_at
    or old.issued_by is distinct from new.issued_by
    or old.document_type is distinct from new.document_type
    or old.document_template_version is distinct from new.document_template_version then
    raise exception 'Campos estruturais do recibo financeiro sao imutaveis.';
  end if;

  if old.pdf_storage_path is not null
    and (
      old.issuer_snapshot is distinct from new.issuer_snapshot
      or old.professional_snapshot is distinct from new.professional_snapshot
      or old.patient_snapshot is distinct from new.patient_snapshot
      or old.service_snapshot is distinct from new.service_snapshot
      or old.payment_snapshot is distinct from new.payment_snapshot
      or old.tax_snapshot is distinct from new.tax_snapshot
      or old.pdf_storage_path is distinct from new.pdf_storage_path
      or old.pdf_generated_at is distinct from new.pdf_generated_at
      or old.pdf_hash is distinct from new.pdf_hash
    ) then
    raise exception 'PDF e snapshots emitidos sao imutaveis.';
  end if;

  if old.status = 'issued'
    and (
      old.status is distinct from new.status
      or old.cancelled_at is distinct from new.cancelled_at
      or old.cancelled_by is distinct from new.cancelled_by
      or old.cancellation_reason is distinct from new.cancellation_reason
    ) then
    raise exception 'Recibo emitido nao pode ser editado livremente.';
  end if;

  if coalesce(current_setting('dozeclin.financial_rpc', true), '') <> 'on'
    and (
      old.status is distinct from new.status
      or old.document_status is distinct from new.document_status
      or old.issuer_snapshot is distinct from new.issuer_snapshot
      or old.professional_snapshot is distinct from new.professional_snapshot
      or old.patient_snapshot is distinct from new.patient_snapshot
      or old.service_snapshot is distinct from new.service_snapshot
      or old.payment_snapshot is distinct from new.payment_snapshot
      or old.tax_snapshot is distinct from new.tax_snapshot
      or old.pdf_storage_path is distinct from new.pdf_storage_path
      or old.pdf_generated_at is distinct from new.pdf_generated_at
      or old.pdf_hash is distinct from new.pdf_hash
      or old.external_fiscal_reference is distinct from new.external_fiscal_reference
      or old.external_fiscal_document_type is distinct from new.external_fiscal_document_type
      or old.external_fiscal_document_number is distinct from new.external_fiscal_document_number
      or old.external_fiscal_atcud is distinct from new.external_fiscal_atcud
      or old.external_fiscal_url is distinct from new.external_fiscal_url
      or old.external_fiscal_issued_at is distinct from new.external_fiscal_issued_at
      or old.external_fiscal_system is distinct from new.external_fiscal_system
      or old.cancelled_at is distinct from new.cancelled_at
      or old.cancelled_by is distinct from new.cancelled_by
      or old.cancellation_reason is distinct from new.cancellation_reason
    ) then
    raise exception 'Recibo financeiro deve ser alterado por RPC.';
  end if;

  return new;
end;
$$;

create or replace function dozeclin.finalize_financial_receipt_pdf(
  p_receipt_id uuid,
  p_document_template_version text,
  p_issuer_snapshot jsonb,
  p_professional_snapshot jsonb,
  p_patient_snapshot jsonb,
  p_service_snapshot jsonb,
  p_payment_snapshot jsonb,
  p_tax_snapshot jsonb,
  p_pdf_storage_path text,
  p_pdf_hash text
)
returns dozeclin.financial_receipts
language plpgsql
security definer
set search_path = dozeclin, auth
as $$
declare
  target_receipt dozeclin.financial_receipts;
  saved dozeclin.financial_receipts;
begin
  select *
  into target_receipt
  from dozeclin.financial_receipts
  where id = p_receipt_id
  for update;

  if not found then
    raise exception 'Recibo nao encontrado.';
  end if;

  if target_receipt.status <> 'issued' then
    raise exception 'Apenas recibos emitidos podem gerar PDF.';
  end if;

  if nullif(trim(coalesce(p_document_template_version, '')), '') is null then
    raise exception 'Versao do modelo obrigatoria.';
  end if;

  if p_document_template_version <> 'internal_payment_receipt_v1' then
    raise exception 'Versao do modelo nao suportada.';
  end if;

  if target_receipt.document_template_version <> p_document_template_version then
    raise exception 'Versao do modelo do recibo nao pode ser alterada.';
  end if;

  if target_receipt.pdf_storage_path is not null or target_receipt.pdf_hash is not null then
    if target_receipt.pdf_storage_path = p_pdf_storage_path and target_receipt.pdf_hash = p_pdf_hash then
      return target_receipt;
    end if;

    raise exception 'PDF do recibo ja foi gerado e nao pode ser substituido.';
  end if;

  if target_receipt.issuer_snapshot is not null
    or target_receipt.professional_snapshot is not null
    or target_receipt.patient_snapshot is not null
    or target_receipt.service_snapshot is not null
    or target_receipt.payment_snapshot is not null
    or target_receipt.tax_snapshot is not null then
    raise exception 'Snapshots do recibo ja existem e nao podem ser substituidos.';
  end if;

  if nullif(trim(coalesce(p_pdf_storage_path, '')), '') is null then
    raise exception 'Caminho do PDF obrigatorio.';
  end if;

  if nullif(trim(coalesce(p_pdf_hash, '')), '') is null then
    raise exception 'Hash do PDF obrigatorio.';
  end if;

  set local dozeclin.financial_rpc = 'on';

  update dozeclin.financial_receipts
  set issuer_snapshot = p_issuer_snapshot,
      document_template_version = p_document_template_version,
      professional_snapshot = p_professional_snapshot,
      patient_snapshot = p_patient_snapshot,
      service_snapshot = p_service_snapshot,
      payment_snapshot = p_payment_snapshot,
      tax_snapshot = p_tax_snapshot,
      pdf_storage_path = p_pdf_storage_path,
      pdf_hash = p_pdf_hash,
      pdf_generated_at = now(),
      document_status = 'pdf_generated'
  where id = target_receipt.id
  returning * into saved;

  insert into dozeclin.audit_logs (clinic_id, user_id, action, entity, entity_id, new_data)
  values (
    saved.clinic_id,
    auth.uid(),
    'financial.receipt_pdf_generated',
    'financial_receipts',
    saved.id,
    jsonb_build_object(
      'receipt_number', saved.receipt_number,
      'document_template_version', saved.document_template_version,
      'payment_id', saved.payment_id,
      'charge_id', saved.charge_id,
      'pdf_hash', saved.pdf_hash
    )
  );

  return saved;
end;
$$;

revoke execute on function dozeclin.finalize_financial_receipt_pdf(
  uuid,
  text,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  text,
  text
) from public, anon, authenticated;

revoke execute on function dozeclin.protect_financial_receipt_integrity() from public, anon, authenticated;

grant execute on function dozeclin.finalize_financial_receipt_pdf(
  uuid,
  text,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  text,
  text
) to service_role;

grant all privileges on storage.objects to service_role;
grant all privileges on storage.buckets to service_role;

grant select (
  document_template_version,
  document_status,
  pdf_storage_path,
  pdf_generated_at,
  pdf_hash,
  external_fiscal_reference,
  external_fiscal_document_type,
  external_fiscal_document_number,
  external_fiscal_atcud
) on dozeclin.financial_receipts to authenticated;

create or replace function dozeclin.get_patient_portal_context()
returns jsonb
language plpgsql
security definer
set search_path = dozeclin, auth
stable
as $$
declare
  current_patient uuid;
  payload jsonb;
begin
  current_patient := dozeclin.current_patient_id();

  if current_patient is null then
    raise exception 'Portal do paciente nao encontrado ou indisponivel.';
  end if;

  select jsonb_build_object(
    'patient', to_jsonb(p),
    'portal', to_jsonb(pp),
    'onboarding', to_jsonb(po),
    'anamnesis', to_jsonb(af),
    'next_appointment', to_jsonb(na),
    'appointments', coalesce(appointments.rows, '[]'::jsonb),
    'financial', jsonb_build_object(
      'open_charges', coalesce(open_charges.rows, '[]'::jsonb),
      'payments', coalesce(payments.rows, '[]'::jsonb),
      'receipts', coalesce(receipts.rows, '[]'::jsonb)
    )
  )
  into payload
  from dozeclin.patients p
  join dozeclin.patient_portals pp on pp.patient_id = p.id
  join dozeclin.patient_onboarding po on po.patient_id = p.id
  left join lateral (
    select *
    from dozeclin.anamnesis_forms af
    where af.patient_id = p.id
    order by af.created_at desc
    limit 1
  ) af on true
  left join lateral (
    select a.*, pr.full_name as professional_name, pr.specialty as professional_specialty
    from dozeclin.appointments a
    left join dozeclin.profiles pr on pr.id = a.professional_id
    where a.patient_id = p.id
      and a.status in ('scheduled', 'confirmed', 'checked_in', 'in_progress')
      and a.scheduled_end >= now()
    order by a.scheduled_start asc
    limit 1
  ) na on true
  left join lateral (
    select jsonb_agg(to_jsonb(row_data) order by row_data.scheduled_start desc) as rows
    from (
      select a.*, pr.full_name as professional_name, pr.specialty as professional_specialty
      from dozeclin.appointments a
      left join dozeclin.profiles pr on pr.id = a.professional_id
      where a.patient_id = p.id
      order by a.scheduled_start desc
      limit 20
    ) row_data
  ) appointments on true
  left join lateral (
    select jsonb_agg(to_jsonb(row_data) order by row_data.due_date nulls last, row_data.created_at desc) as rows
    from (
      select fc.id,
             fc.description,
             case
               when fc.status = 'pending' and fc.due_date is not null and fc.due_date < current_date
                 then 'overdue'
               else fc.status::text
             end as status,
             fc.currency,
             fc.final_amount,
             fc.paid_amount,
             fc.remaining_amount,
             fc.due_date,
             fc.created_at
      from dozeclin.financial_charges fc
      where fc.patient_id = p.id
        and fc.status in ('pending', 'partially_paid', 'overdue')
    ) row_data
  ) open_charges on true
  left join lateral (
    select jsonb_agg(to_jsonb(row_data) order by row_data.payment_date desc) as rows
    from (
      select fp.id,
             fp.amount,
             fp.currency,
             fp.payment_method,
             fp.payment_status,
             fp.payment_date
      from dozeclin.financial_payments fp
      where fp.patient_id = p.id
        and fp.payment_status = 'confirmed'
      order by fp.payment_date desc
      limit 10
    ) row_data
  ) payments on true
  left join lateral (
    select jsonb_agg(to_jsonb(row_data) order by row_data.issued_at desc) as rows
    from (
      select fr.id,
             fr.payment_id,
             fr.receipt_number,
             fr.document_template_version,
             fr.currency,
             fr.amount,
             fr.issued_at,
             fr.status,
             fr.document_status,
             fr.pdf_storage_path,
             fr.pdf_generated_at,
             fr.pdf_hash,
             fr.external_fiscal_reference,
             fr.external_fiscal_document_type,
             fr.external_fiscal_document_number,
             fr.external_fiscal_atcud
      from dozeclin.financial_receipts fr
      where fr.patient_id = p.id
        and fr.status = 'issued'
      order by fr.issued_at desc
      limit 10
    ) row_data
  ) receipts on true
  where p.id = current_patient;

  return payload;
end;
$$;

commit;
