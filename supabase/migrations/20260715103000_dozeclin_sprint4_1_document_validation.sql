begin;

create extension if not exists pgcrypto;

do $$
begin
  create type dozeclin.professional_signature_type as enum (
    'drawn',
    'image',
    'stamp',
    'seal',
    'clinic_signature',
    'clinic_stamp',
    'clinic_seal',
    'clinic_logo'
  );
exception when duplicate_object then null;
end $$;

do $$
begin
  create type dozeclin.signature_owner_type as enum ('professional', 'clinic');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type dozeclin.clinical_document_type as enum (
    'attendance_certificate',
    'follow_up_certificate',
    'service_certificate',
    'clinical_report',
    'clinical_progress',
    'referral',
    'treatment_plan',
    'consent',
    'custom'
  );
exception when duplicate_object then null;
end $$;

do $$
begin
  create type dozeclin.document_signature_status as enum ('unsigned', 'signed', 'revoked');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type dozeclin.document_status as enum ('draft', 'issued', 'revoked', 'cancelled', 'archived');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type dozeclin.document_visibility as enum ('internal', 'patient', 'public_validation_only');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type dozeclin.document_template_status as enum ('draft', 'active', 'retired');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type dozeclin.document_event_type as enum (
    'created',
    'edited',
    'issued',
    'signed',
    'pdf_generated',
    'viewed',
    'downloaded',
    'shared',
    'patient_access_enabled',
    'patient_access_disabled',
    'public_validation_enabled',
    'public_validation_checked',
    'revoked',
    'cancelled',
    'archived',
    'share_link_accessed'
  );
exception when duplicate_object then null;
end $$;

alter table dozeclin.profiles
  add column if not exists display_title text,
  add column if not exists professional_registration_body text,
  add column if not exists professional_tax_identifier text,
  add column if not exists professional_email text,
  add column if not exists professional_phone text,
  add column if not exists professional_city text,
  add column if not exists professional_country text;

create table if not exists dozeclin.professional_signatures (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references dozeclin.clinics(id) on delete restrict,
  owner_type dozeclin.signature_owner_type not null default 'professional',
  profile_id uuid references dozeclin.profiles(id) on delete restrict,
  signature_type dozeclin.professional_signature_type not null,
  display_name text not null,
  storage_path text not null unique,
  file_hash text not null,
  mime_type text not null,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references dozeclin.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references dozeclin.profiles(id) on delete set null,
  revocation_reason text,
  constraint professional_signatures_owner_check check (
    (owner_type = 'professional' and profile_id is not null and signature_type in ('drawn', 'image', 'stamp', 'seal'))
    or (owner_type = 'clinic' and profile_id is null and signature_type in ('clinic_signature', 'clinic_stamp', 'clinic_seal', 'clinic_logo'))
  ),
  constraint professional_signatures_mime_check check (mime_type in ('image/png', 'image/webp', 'image/svg+xml')),
  constraint professional_signatures_hash_check check (length(file_hash) >= 32),
  constraint professional_signatures_revocation_check check (
    (revoked_at is null and revoked_by is null)
    or (revoked_at is not null and revoked_by is not null and nullif(trim(coalesce(revocation_reason, '')), '') is not null)
  )
);

create unique index if not exists idx_dozeclin_professional_signatures_default
on dozeclin.professional_signatures(clinic_id, owner_type, coalesce(profile_id, '00000000-0000-0000-0000-000000000000'::uuid), signature_type)
where is_default and is_active and revoked_at is null;

create index if not exists idx_dozeclin_professional_signatures_profile
on dozeclin.professional_signatures(clinic_id, owner_type, profile_id, signature_type, is_active);

create table if not exists dozeclin.clinical_document_sequences (
  clinic_id uuid not null references dozeclin.clinics(id) on delete restrict,
  document_prefix text not null,
  document_year integer not null,
  last_number integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (clinic_id, document_prefix, document_year),
  constraint clinical_document_sequences_prefix_check check (document_prefix ~ '^[A-Z]{3}$'),
  constraint clinical_document_sequences_year_check check (document_year between 2020 and 2200)
);

create table if not exists dozeclin.document_templates (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid references dozeclin.clinics(id) on delete restrict,
  product_code text not null default 'dozeclin',
  template_code text not null,
  template_name text not null,
  template_version text not null,
  document_type dozeclin.clinical_document_type not null,
  status dozeclin.document_template_status not null default 'active',
  schema_definition jsonb not null default '{}'::jsonb,
  renderer_key text not null default 'clinical_document',
  required_patient_fields text[] not null default array['initials'],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint document_templates_version_check check (template_version ~ '^v[0-9]+$'),
  constraint document_templates_scope_unique unique (clinic_id, template_code, template_version)
);

create unique index if not exists idx_dozeclin_document_templates_global_unique
on dozeclin.document_templates(product_code, template_code, template_version)
where clinic_id is null;

insert into dozeclin.document_templates (
  clinic_id,
  product_code,
  template_code,
  template_name,
  template_version,
  document_type,
  status,
  renderer_key,
  required_patient_fields
)
values
  (null, 'dozeclin', 'ATTENDANCE_CERTIFICATE', 'Declaracao de comparecimento', 'v1', 'attendance_certificate', 'active', 'attendance_certificate_v1', array['initials']),
  (null, 'dozeclin', 'FOLLOW_UP_CERTIFICATE', 'Declaracao de acompanhamento', 'v1', 'follow_up_certificate', 'active', 'follow_up_certificate_v1', array['initials']),
  (null, 'dozeclin', 'SERVICE_CERTIFICATE', 'Declaracao de atendimento', 'v1', 'service_certificate', 'active', 'service_certificate_v1', array['initials']),
  (null, 'dozeclin', 'CLINICAL_REPORT', 'Relatorio clinico', 'v1', 'clinical_report', 'active', 'clinical_report_v1', array['initials']),
  (null, 'dozeclin', 'CLINICAL_PROGRESS', 'Evolucao clinica', 'v1', 'clinical_progress', 'active', 'clinical_progress_v1', array['initials']),
  (null, 'dozeclin', 'REFERRAL', 'Encaminhamento', 'v1', 'referral', 'active', 'referral_v1', array['initials']),
  (null, 'dozeclin', 'TREATMENT_PLAN', 'Plano terapeutico', 'v1', 'treatment_plan', 'active', 'treatment_plan_v1', array['initials']),
  (null, 'dozeclin', 'CONSENT', 'Consentimento', 'v1', 'consent', 'active', 'consent_v1', array['initials']),
  (null, 'dozeclin', 'CUSTOM', 'Documento personalizado', 'v1', 'custom', 'active', 'custom_v1', array['initials'])
on conflict (product_code, template_code, template_version) where clinic_id is null do nothing;

create table if not exists dozeclin.clinical_documents (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references dozeclin.clinics(id) on delete restrict,
  patient_id uuid not null references dozeclin.patients(id) on delete restrict,
  appointment_id uuid references dozeclin.appointments(id) on delete restrict,
  professional_id uuid references dozeclin.profiles(id) on delete restrict,
  source_medical_record_id uuid references dozeclin.medical_records(id) on delete restrict,
  document_type dozeclin.clinical_document_type not null,
  document_number text not null,
  document_year integer not null,
  document_sequence integer not null,
  document_prefix text not null,
  title text not null,
  custom_title text,
  custom_template_code text,
  status dozeclin.document_status not null default 'draft',
  signature_status dozeclin.document_signature_status not null default 'unsigned',
  visibility dozeclin.document_visibility not null default 'internal',
  content_snapshot jsonb not null default '{}'::jsonb,
  clinic_snapshot jsonb,
  professional_snapshot jsonb,
  patient_snapshot jsonb,
  issued_at timestamptz,
  issued_by uuid references dozeclin.profiles(id) on delete restrict,
  signed_at timestamptz,
  signed_by uuid references dozeclin.profiles(id) on delete restrict,
  signature_id uuid references dozeclin.professional_signatures(id) on delete restrict,
  institutional_signature_id uuid references dozeclin.professional_signatures(id) on delete restrict,
  signature_snapshot jsonb,
  institutional_snapshot jsonb,
  validation_token_hash text unique,
  public_validation_enabled boolean not null default false,
  public_validation_created_at timestamptz,
  patient_access_enabled boolean not null default false,
  patient_access_enabled_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references dozeclin.profiles(id) on delete restrict,
  revocation_reason text,
  archived_at timestamptz,
  archived_by uuid references dozeclin.profiles(id) on delete restrict,
  archived_previous_status dozeclin.document_status,
  current_version integer not null default 1,
  document_hash text,
  current_pdf_path text,
  current_pdf_hash text,
  current_pdf_generated_at timestamptz,
  current_pdf_template_version text,
  template_code text not null,
  template_name text not null,
  template_version text not null default 'v1',
  replaced_document_id uuid references dozeclin.clinical_documents(id) on delete restrict,
  replacement_document_id uuid references dozeclin.clinical_documents(id) on delete restrict,
  replacement_reason text,
  created_by uuid references dozeclin.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clinical_documents_number_unique unique (clinic_id, document_number),
  constraint clinical_documents_sequence_unique unique (clinic_id, document_prefix, document_year, document_sequence),
  constraint clinical_documents_number_format_check check (document_number = document_prefix || '-' || document_year::text || '-' || lpad(document_sequence::text, 6, '0')),
  constraint clinical_documents_prefix_check check (document_prefix in ('DEC', 'REL', 'ENC', 'EVO', 'PLA', 'CON', 'DOC')),
  constraint clinical_documents_custom_check check (
    document_type <> 'custom'
    or (nullif(trim(coalesce(custom_title, '')), '') is not null and nullif(trim(coalesce(custom_template_code, '')), '') is not null)
  ),
  constraint clinical_documents_hash_check check (document_hash is null or length(document_hash) >= 32),
  constraint clinical_documents_pdf_check check (
    (current_pdf_path is null and current_pdf_hash is null and current_pdf_generated_at is null)
    or (current_pdf_path is not null and current_pdf_hash is not null and current_pdf_generated_at is not null and current_pdf_template_version is not null)
  ),
  constraint clinical_documents_revocation_check check (
    status <> 'revoked'
    or (revoked_at is not null and revoked_by is not null and nullif(trim(coalesce(revocation_reason, '')), '') is not null)
  ),
  constraint clinical_documents_archive_check check (
    status <> 'archived'
    or (archived_at is not null and archived_by is not null and archived_previous_status in ('issued', 'revoked', 'cancelled'))
  )
);

create index if not exists idx_dozeclin_clinical_documents_patient
on dozeclin.clinical_documents(clinic_id, patient_id, issued_at desc);

create index if not exists idx_dozeclin_clinical_documents_status
on dozeclin.clinical_documents(clinic_id, status, signature_status);

create table if not exists dozeclin.document_versions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references dozeclin.clinics(id) on delete restrict,
  document_id uuid not null references dozeclin.clinical_documents(id) on delete restrict,
  version_number integer not null,
  template_code text not null,
  template_name text not null,
  template_version text not null,
  content_snapshot jsonb not null,
  clinic_snapshot jsonb,
  professional_snapshot jsonb,
  patient_snapshot jsonb,
  signature_snapshot jsonb,
  institutional_snapshot jsonb,
  document_hash text not null,
  change_reason text,
  created_by uuid references dozeclin.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint document_versions_version_unique unique (document_id, version_number),
  constraint document_versions_hash_unique unique (document_id, document_hash),
  constraint document_versions_version_positive check (version_number > 0),
  constraint document_versions_hash_check check (length(document_hash) >= 32)
);

create index if not exists idx_dozeclin_document_versions_clinic
on dozeclin.document_versions(clinic_id, document_id, version_number desc);

create table if not exists dozeclin.document_events (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references dozeclin.clinics(id) on delete restrict,
  document_id uuid not null references dozeclin.clinical_documents(id) on delete restrict,
  event_type dozeclin.document_event_type not null,
  actor_profile_id uuid references dozeclin.profiles(id) on delete set null,
  actor_auth_user_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_dozeclin_document_events_document
on dozeclin.document_events(clinic_id, document_id, created_at desc);

create table if not exists dozeclin.document_public_links (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references dozeclin.clinics(id) on delete restrict,
  document_id uuid not null references dozeclin.clinical_documents(id) on delete restrict,
  token_hash text not null unique,
  expires_at timestamptz not null,
  max_views integer,
  view_count integer not null default 0,
  allow_download boolean not null default false,
  created_by uuid references dozeclin.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references dozeclin.profiles(id) on delete set null,
  revocation_reason text,
  constraint document_public_links_views_check check (max_views is null or max_views > 0),
  constraint document_public_links_expiry_check check (expires_at > created_at),
  constraint document_public_links_revocation_check check (
    revoked_at is null
    or (revoked_by is not null and nullif(trim(coalesce(revocation_reason, '')), '') is not null)
  )
);

create index if not exists idx_dozeclin_document_public_links_document
on dozeclin.document_public_links(clinic_id, document_id, expires_at desc);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('professional-signatures', 'professional-signatures', false, 2097152, array['image/png', 'image/webp', 'image/svg+xml']),
  ('clinical-documents', 'clinical-documents', false, 10485760, array['application/pdf']),
  ('document-assets', 'document-assets', false, 5242880, array['image/png', 'image/webp', 'image/svg+xml'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "professional_signatures_no_direct_read" on storage.objects;
create policy "professional_signatures_no_direct_read" on storage.objects
for select using (bucket_id = 'professional-signatures' and false);

drop policy if exists "clinical_documents_no_direct_read" on storage.objects;
create policy "clinical_documents_no_direct_read" on storage.objects
for select using (bucket_id = 'clinical-documents' and false);

drop policy if exists "document_assets_no_direct_read" on storage.objects;
create policy "document_assets_no_direct_read" on storage.objects
for select using (bucket_id = 'document-assets' and false);

create or replace function dozeclin.sha256_jsonb(p_payload jsonb)
returns text
language sql
immutable
as $$
  select encode(digest(convert_to(p_payload::text, 'UTF8'), 'sha256'), 'hex');
$$;

create or replace function dozeclin.hash_public_token(p_token text)
returns text
language sql
immutable
as $$
  select encode(digest(convert_to(coalesce(p_token, ''), 'UTF8'), 'sha256'), 'hex');
$$;

create or replace function dozeclin.patient_initials(p_name text)
returns text
language plpgsql
immutable
as $$
declare
  parts text[];
  first_part text;
  last_part text;
begin
  parts := regexp_split_to_array(trim(coalesce(p_name, '')), '\s+');
  if array_length(parts, 1) is null then
    return '-';
  end if;
  first_part := upper(left(parts[1], 1));
  last_part := upper(left(parts[array_length(parts, 1)], 1));
  if array_length(parts, 1) = 1 then
    return first_part || '.';
  end if;
  return first_part || '. ' || last_part || '.';
end;
$$;

create or replace function dozeclin.current_profile()
returns dozeclin.profiles
language sql
security definer
set search_path = dozeclin, auth
stable
as $$
  select p.*
  from dozeclin.profiles p
  where p.auth_user_id = auth.uid()
    and p.status = 'active'
  limit 1;
$$;

create or replace function dozeclin.can_manage_documents(target_clinic_id uuid)
returns boolean
language sql
security definer
set search_path = dozeclin, auth
stable
as $$
  select exists (
    select 1
    from dozeclin.profiles p
    where p.auth_user_id = auth.uid()
      and p.status = 'active'
      and p.clinic_id = target_clinic_id
      and p.role in ('clinic_admin', 'supervisor', 'professional')
  );
$$;

create or replace function dozeclin.can_share_documents(target_clinic_id uuid)
returns boolean
language sql
security definer
set search_path = dozeclin, auth
stable
as $$
  select exists (
    select 1
    from dozeclin.profiles p
    where p.auth_user_id = auth.uid()
      and p.status = 'active'
      and p.clinic_id = target_clinic_id
      and p.role in ('clinic_admin', 'supervisor', 'professional', 'reception')
  );
$$;

create or replace function dozeclin.audit_document_event(
  p_clinic_id uuid,
  p_document_id uuid,
  p_event_type dozeclin.document_event_type,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = dozeclin, auth
as $$
declare
  actor_profile uuid := dozeclin.current_active_profile_id();
begin
  insert into dozeclin.document_events (
    clinic_id,
    document_id,
    event_type,
    actor_profile_id,
    actor_auth_user_id,
    metadata
  )
  values (
    p_clinic_id,
    p_document_id,
    p_event_type,
    actor_profile,
    auth.uid(),
    coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

create or replace function dozeclin.document_prefix_for_type(p_document_type dozeclin.clinical_document_type)
returns text
language sql
immutable
as $$
  select case p_document_type
    when 'attendance_certificate' then 'DEC'
    when 'follow_up_certificate' then 'DEC'
    when 'service_certificate' then 'DEC'
    when 'clinical_report' then 'REL'
    when 'clinical_progress' then 'EVO'
    when 'referral' then 'ENC'
    when 'treatment_plan' then 'PLA'
    when 'consent' then 'CON'
    else 'DOC'
  end;
$$;

create or replace function dozeclin.next_clinical_document_number(
  p_clinic_id uuid,
  p_document_type dozeclin.clinical_document_type,
  p_issued_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = dozeclin
as $$
declare
  target_prefix text := dozeclin.document_prefix_for_type(p_document_type);
  target_year integer := extract(year from coalesce(p_issued_at, now()))::integer;
  next_number integer;
begin
  insert into dozeclin.clinical_document_sequences (clinic_id, document_prefix, document_year, last_number)
  values (p_clinic_id, target_prefix, target_year, 0)
  on conflict (clinic_id, document_prefix, document_year) do nothing;

  update dozeclin.clinical_document_sequences
  set last_number = last_number + 1,
      updated_at = now()
  where clinic_id = p_clinic_id
    and document_prefix = target_prefix
    and document_year = target_year
  returning last_number into next_number;

  return jsonb_build_object(
    'document_prefix', target_prefix,
    'document_year', target_year,
    'document_sequence', next_number,
    'document_number', target_prefix || '-' || target_year::text || '-' || lpad(next_number::text, 6, '0')
  );
end;
$$;

create or replace function dozeclin.build_clinical_document_hash(p_document dozeclin.clinical_documents)
returns text
language sql
stable
as $$
  select dozeclin.sha256_jsonb(jsonb_build_object(
    'document_id', p_document.id,
    'clinic_id', p_document.clinic_id,
    'patient_id', p_document.patient_id,
    'document_type', p_document.document_type,
    'document_number', p_document.document_number,
    'document_version', p_document.current_version,
    'template_code', p_document.template_code,
    'template_version', p_document.template_version,
    'content_snapshot', p_document.content_snapshot,
    'clinic_snapshot', p_document.clinic_snapshot,
    'professional_snapshot', p_document.professional_snapshot,
    'patient_snapshot', p_document.patient_snapshot,
    'signature_snapshot', p_document.signature_snapshot,
    'institutional_snapshot', p_document.institutional_snapshot,
    'issued_at', p_document.issued_at,
    'signed_at', p_document.signed_at
  ));
$$;

create or replace function dozeclin.protect_professional_signature()
returns trigger
language plpgsql
security definer
set search_path = dozeclin, auth
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Assinaturas nao podem ser apagadas fisicamente.';
  end if;

  if tg_op = 'INSERT' then
    if new.owner_type = 'professional' and not exists (
      select 1 from dozeclin.profiles p
      where p.id = new.profile_id
        and p.clinic_id = new.clinic_id
        and p.status = 'active'
        and p.role in ('clinic_admin', 'supervisor', 'professional')
    ) then
      raise exception 'Perfil profissional invalido para a assinatura.';
    end if;
    if new.owner_type = 'clinic' and dozeclin.current_profile_role() not in ('clinic_admin', 'supervisor') then
      raise exception 'Sem permissao para gerir assinatura institucional.';
    end if;
    new.created_by := coalesce(new.created_by, dozeclin.current_active_profile_id());
  end if;

  if tg_op = 'UPDATE' then
    if old.clinic_id is distinct from new.clinic_id
      or old.owner_type is distinct from new.owner_type
      or old.profile_id is distinct from new.profile_id
      or old.signature_type is distinct from new.signature_type
      or old.file_hash is distinct from new.file_hash
      or old.mime_type is distinct from new.mime_type then
      raise exception 'Campos estruturais da assinatura sao imutaveis.';
    end if;

    if old.storage_path is distinct from new.storage_path and exists (
      select 1
      from dozeclin.clinical_documents d
      where (d.signature_id = old.id or d.institutional_signature_id = old.id)
        and d.signature_status in ('signed', 'revoked')
    ) then
      raise exception 'Arquivo de assinatura utilizada nao pode ser substituido.';
    end if;

    if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
      raise exception 'Assinatura revogada nao pode ser reativada.';
    end if;

    if new.revoked_at is not null then
      new.is_active := false;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists protect_professional_signature_before_write on dozeclin.professional_signatures;
create trigger protect_professional_signature_before_write
before insert or update on dozeclin.professional_signatures
for each row execute function dozeclin.protect_professional_signature();

drop trigger if exists block_professional_signature_delete on dozeclin.professional_signatures;
create trigger block_professional_signature_delete
before delete on dozeclin.professional_signatures
for each row execute function dozeclin.protect_professional_signature();

create or replace function dozeclin.protect_clinical_document()
returns trigger
language plpgsql
security definer
set search_path = dozeclin, auth
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Documentos clinicos nao podem ser apagados fisicamente.';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, dozeclin.current_active_profile_id());
  end if;

  if tg_op = 'UPDATE' then
    if old.clinic_id is distinct from new.clinic_id
      or old.patient_id is distinct from new.patient_id
      or old.appointment_id is distinct from new.appointment_id
      or old.document_number is distinct from new.document_number
      or old.document_sequence is distinct from new.document_sequence
      or old.document_year is distinct from new.document_year
      or old.document_prefix is distinct from new.document_prefix
      or old.created_by is distinct from new.created_by
      or old.created_at is distinct from new.created_at
      or old.template_code is distinct from new.template_code
      or old.template_version is distinct from new.template_version then
      raise exception 'Campos estruturais do documento nao podem ser alterados.';
    end if;

    if old.status = 'revoked' and new.status not in ('revoked', 'archived') then
      raise exception 'Documento revogado nao pode ser reativado.';
    end if;
    if old.status = 'cancelled' and new.status not in ('cancelled', 'archived') then
      raise exception 'Documento cancelado nao pode ser reativado.';
    end if;
    if old.status = 'archived' and new.status <> 'archived' then
      raise exception 'Documento arquivado nao pode ser alterado diretamente.';
    end if;

    if old.status = 'issued'
      and coalesce(current_setting('dozeclin.document_rpc', true), '') <> 'on'
      and (
        old.content_snapshot is distinct from new.content_snapshot
        or old.visibility is distinct from new.visibility
        or old.clinic_snapshot is distinct from new.clinic_snapshot
        or old.professional_snapshot is distinct from new.professional_snapshot
        or old.patient_snapshot is distinct from new.patient_snapshot
        or old.signature_snapshot is distinct from new.signature_snapshot
        or old.institutional_snapshot is distinct from new.institutional_snapshot
        or old.signature_id is distinct from new.signature_id
        or old.institutional_signature_id is distinct from new.institutional_signature_id
        or old.signed_at is distinct from new.signed_at
        or old.signed_by is distinct from new.signed_by
        or old.document_hash is distinct from new.document_hash
        or old.current_pdf_path is distinct from new.current_pdf_path
        or old.current_pdf_hash is distinct from new.current_pdf_hash
        or old.current_pdf_generated_at is distinct from new.current_pdf_generated_at
        or old.current_pdf_template_version is distinct from new.current_pdf_template_version
      ) then
      raise exception 'Documento emitido nao pode ser editado diretamente.';
    end if;

    if old.signature_status = 'signed'
      and coalesce(current_setting('dozeclin.document_rpc', true), '') <> 'on' then
      raise exception 'Documento assinado nao pode ser alterado diretamente.';
    end if;

    if old.signature_status = 'signed' and new.signature_status = 'unsigned' then
      raise exception 'Documento assinado nao pode voltar a nao assinado.';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists protect_clinical_document_before_write on dozeclin.clinical_documents;
create trigger protect_clinical_document_before_write
before insert or update on dozeclin.clinical_documents
for each row execute function dozeclin.protect_clinical_document();

drop trigger if exists block_clinical_document_delete on dozeclin.clinical_documents;
create trigger block_clinical_document_delete
before delete on dozeclin.clinical_documents
for each row execute function dozeclin.protect_clinical_document();

create or replace function dozeclin.block_document_version_delete()
returns trigger
language plpgsql
security definer
set search_path = dozeclin
as $$
begin
  raise exception 'Versoes documentais nao podem ser apagadas.';
end;
$$;

drop trigger if exists block_document_version_delete on dozeclin.document_versions;
create trigger block_document_version_delete
before delete on dozeclin.document_versions
for each row execute function dozeclin.block_document_version_delete();

create or replace function dozeclin.create_document_from_appointment(
  p_appointment_id uuid,
  p_patient_id uuid,
  p_professional_id uuid,
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
  if current_profile.id is null then raise exception 'Perfil autenticado ativo nao encontrado.'; end if;

  if p_appointment_id is not null then
    select * into target_appointment
    from dozeclin.appointments
    where id = p_appointment_id;
    if not found then raise exception 'Appointment nao encontrado.'; end if;

    if target_appointment.clinic_id <> current_profile.clinic_id then
      raise exception 'Appointment de outra clinica.';
    end if;
  elsif p_document_type in ('attendance_certificate', 'clinical_progress') then
    raise exception 'Este tipo documental exige Appointment concluido.';
  end if;

  if not dozeclin.can_manage_documents(current_profile.clinic_id) then
    raise exception 'Sem permissao para criar documento.';
  end if;
  if p_document_type in ('attendance_certificate', 'clinical_progress') and target_appointment.status <> 'completed' then
    raise exception 'Este tipo documental exige Appointment concluido.';
  end if;

  select * into target_patient
  from dozeclin.patients
  where id = coalesce(target_appointment.patient_id, p_patient_id)
    and clinic_id = current_profile.clinic_id
    and status <> 'archived';
  if not found then raise exception 'Paciente invalido para documento.'; end if;

  select * into target_professional
  from dozeclin.profiles
  where id = coalesce(target_appointment.professional_id, p_professional_id)
    and clinic_id = current_profile.clinic_id
    and status = 'active'
    and role in ('professional', 'supervisor', 'clinic_admin');
  if not found then raise exception 'Profissional invalido para documento.'; end if;

  select *
  into target_template
  from dozeclin.document_templates t
  where t.template_code = p_template_code
    and t.document_type = p_document_type
    and t.status = 'active'
    and (t.clinic_id = current_profile.clinic_id or t.clinic_id is null)
  order by t.clinic_id nulls last, t.template_version desc
  limit 1;
  if not found then raise exception 'Template documental ativo nao encontrado.'; end if;

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
    jsonb_build_object(
      'appointment_id', target_appointment.id,
      'scheduled_start', target_appointment.scheduled_start,
      'scheduled_end', target_appointment.scheduled_end,
      'modality', target_appointment.modality,
      'expected_duration', target_appointment.expected_duration,
      'notes', null
    ),
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
      'source', case when target_appointment.id is null then 'manual' else 'appointment' end,
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

  select * into target_document
  from dozeclin.clinical_documents
  where id = p_document_id
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

  update dozeclin.clinical_documents
  set status = 'issued',
      issued_at = now(),
      issued_by = current_profile.id,
      clinic_snapshot = coalesce(clinic_snapshot, jsonb_build_object(
        'clinic_id', target_clinic.id,
        'legal_name', target_clinic.legal_name,
        'trade_name', target_clinic.name,
        'tax_identifier', target_clinic.document,
        'city', target_clinic.city,
        'country', target_clinic.country,
        'contact_email', target_clinic.email
      )),
      professional_snapshot = coalesce(professional_snapshot, jsonb_build_object(
        'profile_id', target_professional.id,
        'full_name', target_professional.full_name,
        'display_title', coalesce(target_professional.display_title, target_professional.specialty),
        'specialty', target_professional.specialty,
        'professional_registration', target_professional.professional_registration,
        'professional_registration_body', target_professional.professional_registration_body,
        'signature_hash', null
      )),
      patient_snapshot = coalesce(patient_snapshot, jsonb_build_object(
        'patient_id', target_patient.id,
        'initials', dozeclin.patient_initials(target_patient.full_name)
      ))
  where id = target_document.id
  returning * into issued_document;

  final_hash := dozeclin.build_clinical_document_hash(issued_document);

  update dozeclin.clinical_documents
  set document_hash = final_hash
  where id = issued_document.id
  returning * into issued_document;

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
    'Emissao documental',
    current_profile.id
  )
  on conflict (document_id, version_number) do nothing;

  perform dozeclin.audit_document_event(issued_document.clinic_id, issued_document.id, 'issued', jsonb_build_object('hash_partial', left(issued_document.document_hash, 12)));

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
  target_patient dozeclin.patients;
  target_clinic dozeclin.clinics;
  signed_document dozeclin.clinical_documents;
  signature_snapshot jsonb;
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

  signature_snapshot := jsonb_build_object(
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

  update dozeclin.clinical_documents
  set signature_status = 'signed',
      current_version = current_version + 1,
      signed_at = now(),
      signed_by = current_profile.id,
      signature_id = target_signature.id,
      signature_snapshot = signature_snapshot,
      professional_snapshot = coalesce(professional_snapshot, jsonb_build_object(
        'profile_id', current_profile.id,
        'full_name', current_profile.full_name,
        'display_title', coalesce(current_profile.display_title, current_profile.specialty),
        'specialty', current_profile.specialty,
        'professional_registration', current_profile.professional_registration,
        'professional_registration_body', current_profile.professional_registration_body,
        'signature_hash', target_signature.file_hash
      )),
      patient_snapshot = coalesce(patient_snapshot, jsonb_build_object(
        'patient_id', target_patient.id,
        'initials', dozeclin.patient_initials(target_patient.full_name)
      ))
  where id = target_document.id
  returning * into signed_document;

  final_hash := dozeclin.build_clinical_document_hash(signed_document);

  update dozeclin.clinical_documents
  set document_hash = final_hash
  where id = signed_document.id
  returning * into signed_document;

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

create or replace function dozeclin.enable_public_document_validation(p_document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = dozeclin, auth
as $$
declare
  current_profile dozeclin.profiles;
  target_document dozeclin.clinical_documents;
  raw_token text;
  token_hash text;
begin
  current_profile := dozeclin.current_profile();
  if current_profile.id is null then raise exception 'Perfil autenticado ativo nao encontrado.'; end if;

  select * into target_document
  from dozeclin.clinical_documents
  where id = p_document_id
  for update;
  if not found then raise exception 'Documento nao encontrado.'; end if;
  if not dozeclin.can_manage_documents(target_document.clinic_id) then
    raise exception 'Sem permissao para validar documento.';
  end if;
  if target_document.status not in ('issued', 'revoked', 'cancelled', 'archived') then
    raise exception 'Documento precisa estar emitido.';
  end if;

  raw_token := replace(encode(gen_random_bytes(32), 'base64'), '/', '_');
  raw_token := replace(replace(raw_token, '+', '-'), '=', '');
  token_hash := dozeclin.hash_public_token(raw_token);

  update dozeclin.clinical_documents
  set validation_token_hash = coalesce(validation_token_hash, token_hash),
      public_validation_enabled = true,
      public_validation_created_at = coalesce(public_validation_created_at, now())
  where id = target_document.id
  returning * into target_document;

  perform dozeclin.audit_document_event(target_document.clinic_id, target_document.id, 'public_validation_enabled', '{}'::jsonb);

  insert into dozeclin.audit_logs (clinic_id, user_id, action, entity, entity_id, new_data)
  values (
    target_document.clinic_id,
    auth.uid(),
    'documents.public_validation_enabled',
    'clinical_documents',
    target_document.id,
    jsonb_build_object('document_number', target_document.document_number)
  );

  return jsonb_build_object(
    'document_id', target_document.id,
    'token', case when target_document.validation_token_hash = token_hash then raw_token else null end,
    'validation_url', case when target_document.validation_token_hash = token_hash then '/app/verificar-documento.html?token=' || raw_token else null end
  );
end;
$$;

create or replace function dozeclin.verify_public_document(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = dozeclin, auth
as $$
declare
  target_document dozeclin.clinical_documents;
  clinic_name text;
  patient_name text;
  computed_hash text;
  is_valid boolean := false;
begin
  if length(coalesce(p_token, '')) < 32 then
    return jsonb_build_object('state', 'invalid', 'valid', false);
  end if;

  select d.*
  into target_document
  from dozeclin.clinical_documents d
  where d.validation_token_hash = dozeclin.hash_public_token(p_token)
    and d.public_validation_enabled = true
  limit 1;

  if not found then
    return jsonb_build_object('state', 'invalid', 'valid', false);
  end if;

  computed_hash := dozeclin.build_clinical_document_hash(target_document);
  is_valid := target_document.document_hash is not null
    and computed_hash = target_document.document_hash
    and target_document.status not in ('cancelled');

  select c.name into clinic_name from dozeclin.clinics c where c.id = target_document.clinic_id;
  select p.full_name into patient_name from dozeclin.patients p where p.id = target_document.patient_id;

  perform dozeclin.audit_document_event(
    target_document.clinic_id,
    target_document.id,
    'public_validation_checked',
    jsonb_build_object(
      'valid', is_valid,
      'result', case
        when target_document.status = 'revoked' then 'revoked'
        when target_document.status = 'cancelled' then 'cancelled'
        when is_valid then 'valid'
        else 'invalid'
      end,
      'access_channel', 'public_validation'
    )
  );

  return jsonb_build_object(
    'state', case
      when target_document.status = 'revoked' then 'revoked'
      when target_document.status = 'cancelled' then 'cancelled'
      when is_valid then 'valid'
      else 'invalid'
    end,
    'valid', is_valid and target_document.status not in ('revoked', 'cancelled'),
    'document_type', target_document.document_type,
    'document_number', target_document.document_number,
    'issued_at', target_document.issued_at,
    'clinic_name', clinic_name,
    'professional_name', target_document.professional_snapshot->>'full_name',
    'professional_title', target_document.professional_snapshot->>'display_title',
    'patient_initials', coalesce(target_document.patient_snapshot->>'initials', dozeclin.patient_initials(patient_name)),
    'version', target_document.current_version,
    'hash_partial', left(coalesce(target_document.document_hash, ''), 16),
    'status', target_document.status,
    'revoked_at', target_document.revoked_at
  );
end;
$$;

create or replace function dozeclin.revoke_clinical_document(
  p_document_id uuid,
  p_reason text
)
returns dozeclin.clinical_documents
language plpgsql
security definer
set search_path = dozeclin, auth
as $$
declare
  current_profile dozeclin.profiles;
  target_document dozeclin.clinical_documents;
begin
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'Motivo da revogacao obrigatorio.';
  end if;

  current_profile := dozeclin.current_profile();
  if current_profile.id is null then raise exception 'Perfil autenticado ativo nao encontrado.'; end if;

  select * into target_document
  from dozeclin.clinical_documents
  where id = p_document_id
  for update;
  if not found then raise exception 'Documento nao encontrado.'; end if;

  if target_document.clinic_id <> current_profile.clinic_id
    or current_profile.role not in ('clinic_admin', 'supervisor', 'professional') then
    raise exception 'Sem permissao para revogar documento.';
  end if;
  if target_document.status not in ('issued') then
    raise exception 'Apenas documentos emitidos podem ser revogados.';
  end if;

  set local dozeclin.document_rpc = 'on';

  update dozeclin.clinical_documents
  set status = 'revoked',
      revoked_at = now(),
      revoked_by = current_profile.id,
      revocation_reason = trim(p_reason)
  where id = target_document.id
  returning * into target_document;

  perform dozeclin.audit_document_event(
    target_document.clinic_id,
    target_document.id,
    'revoked',
    jsonb_build_object('reason', left(trim(p_reason), 180))
  );

  insert into dozeclin.audit_logs (clinic_id, user_id, action, entity, entity_id, new_data)
  values (
    target_document.clinic_id,
    auth.uid(),
    'documents.revoked',
    'clinical_documents',
    target_document.id,
    jsonb_build_object('document_number', target_document.document_number, 'reason', left(trim(p_reason), 180))
  );

  return target_document;
end;
$$;

create or replace function dozeclin.archive_clinical_document(p_document_id uuid)
returns dozeclin.clinical_documents
language plpgsql
security definer
set search_path = dozeclin, auth
as $$
declare
  current_profile dozeclin.profiles;
  target_document dozeclin.clinical_documents;
begin
  current_profile := dozeclin.current_profile();
  if current_profile.id is null then raise exception 'Perfil autenticado ativo nao encontrado.'; end if;

  select * into target_document
  from dozeclin.clinical_documents
  where id = p_document_id
  for update;
  if not found then raise exception 'Documento nao encontrado.'; end if;

  if target_document.clinic_id <> current_profile.clinic_id
    or current_profile.role not in ('clinic_admin', 'supervisor', 'professional') then
    raise exception 'Sem permissao para arquivar documento.';
  end if;
  if target_document.status not in ('issued', 'revoked', 'cancelled') then
    raise exception 'Apenas documentos emitidos, revogados ou cancelados podem ser arquivados.';
  end if;

  set local dozeclin.document_rpc = 'on';

  update dozeclin.clinical_documents
  set status = 'archived',
      archived_at = now(),
      archived_by = current_profile.id,
      archived_previous_status = target_document.status
  where id = target_document.id
  returning * into target_document;

  perform dozeclin.audit_document_event(target_document.clinic_id, target_document.id, 'archived', jsonb_build_object('previous_status', target_document.archived_previous_status));

  insert into dozeclin.audit_logs (clinic_id, user_id, action, entity, entity_id, new_data)
  values (
    target_document.clinic_id,
    auth.uid(),
    'documents.archived',
    'clinical_documents',
    target_document.id,
    jsonb_build_object('document_number', target_document.document_number, 'previous_status', target_document.archived_previous_status)
  );

  return target_document;
end;
$$;

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
  next_event dozeclin.document_event_type;
begin
  current_profile := dozeclin.current_profile();
  if current_profile.id is null then raise exception 'Perfil autenticado ativo nao encontrado.'; end if;

  select * into target_document
  from dozeclin.clinical_documents
  where id = p_document_id
  for update;
  if not found then raise exception 'Documento nao encontrado.'; end if;

  if not dozeclin.can_manage_documents(target_document.clinic_id) then
    raise exception 'Sem permissao para liberar documento.';
  end if;
  if target_document.status <> 'issued' then
    raise exception 'Apenas documentos emitidos podem ser liberados ao paciente.';
  end if;
  if target_document.visibility <> 'patient' then
    raise exception 'Documento nao esta configurado para visibilidade do paciente.';
  end if;
  if target_document.document_type = 'clinical_progress' then
    raise exception 'Tipo documental interno nao pode ser liberado ao paciente.';
  end if;

  update dozeclin.clinical_documents
  set patient_access_enabled = coalesce(p_enabled, false),
      patient_access_enabled_at = case when coalesce(p_enabled, false) then now() else null end
  where id = target_document.id
  returning * into target_document;

  next_event := case when target_document.patient_access_enabled then 'patient_access_enabled'::dozeclin.document_event_type else 'patient_access_disabled'::dozeclin.document_event_type end;
  perform dozeclin.audit_document_event(target_document.clinic_id, target_document.id, next_event, '{}'::jsonb);

  insert into dozeclin.audit_logs (clinic_id, user_id, action, entity, entity_id, new_data)
  values (
    target_document.clinic_id,
    auth.uid(),
    case when target_document.patient_access_enabled then 'documents.patient_access_enabled' else 'documents.patient_access_disabled' end,
    'clinical_documents',
    target_document.id,
    jsonb_build_object('document_number', target_document.document_number)
  );

  return target_document;
end;
$$;

create or replace function dozeclin.create_document_share_link(
  p_document_id uuid,
  p_expiration text,
  p_allow_download boolean default false,
  p_max_views integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = dozeclin, auth
as $$
declare
  current_profile dozeclin.profiles;
  target_document dozeclin.clinical_documents;
  raw_token text;
  link_id uuid;
  expires timestamptz;
begin
  current_profile := dozeclin.current_profile();
  if current_profile.id is null then raise exception 'Perfil autenticado ativo nao encontrado.'; end if;

  select * into target_document
  from dozeclin.clinical_documents
  where id = p_document_id;
  if not found then raise exception 'Documento nao encontrado.'; end if;
  if not dozeclin.can_share_documents(target_document.clinic_id) then
    raise exception 'Sem permissao para compartilhar documento.';
  end if;
  if target_document.status <> 'issued' then
    raise exception 'Documento indisponivel para compartilhamento.';
  end if;
  if target_document.visibility = 'internal' then
    raise exception 'Documento interno nao pode gerar link publico de conteudo.';
  end if;
  if target_document.current_pdf_path is null then
    raise exception 'Documento ainda nao possui PDF emitido.';
  end if;

  expires := case p_expiration
    when '24_hours' then now() + interval '24 hours'
    when '72_hours' then now() + interval '72 hours'
    when '7_days' then now() + interval '7 days'
    else null
  end;
  if expires is null then raise exception 'Expiracao invalida.'; end if;

  raw_token := replace(encode(gen_random_bytes(32), 'base64'), '/', '_');
  raw_token := replace(replace(raw_token, '+', '-'), '=', '');

  insert into dozeclin.document_public_links (
    clinic_id,
    document_id,
    token_hash,
    expires_at,
    max_views,
    allow_download,
    created_by
  )
  values (
    target_document.clinic_id,
    target_document.id,
    dozeclin.hash_public_token(raw_token),
    expires,
    p_max_views,
    coalesce(p_allow_download, false),
    current_profile.id
  )
  returning id into link_id;

  perform dozeclin.audit_document_event(target_document.clinic_id, target_document.id, 'shared', jsonb_build_object('expires_at', expires, 'allow_download', coalesce(p_allow_download, false)));

  insert into dozeclin.audit_logs (clinic_id, user_id, action, entity, entity_id, new_data)
  values (
    target_document.clinic_id,
    auth.uid(),
    'documents.share_link_created',
    'clinical_documents',
    target_document.id,
    jsonb_build_object('link_id', link_id, 'expires_at', expires, 'allow_download', coalesce(p_allow_download, false))
  );

  return jsonb_build_object(
    'id', link_id,
    'token', raw_token,
    'url', '/app/documento-compartilhado.html?token=' || raw_token,
    'expires_at', expires,
    'allow_download', coalesce(p_allow_download, false)
  );
end;
$$;

create or replace function dozeclin.consume_document_share_link(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = dozeclin, auth
as $$
declare
  target_link dozeclin.document_public_links;
  target_document dozeclin.clinical_documents;
begin
  select *
  into target_link
  from dozeclin.document_public_links
  where token_hash = dozeclin.hash_public_token(p_token)
  for update;

  if not found
    or target_link.revoked_at is not null
    or target_link.expires_at <= now()
    or (target_link.max_views is not null and target_link.view_count >= target_link.max_views) then
    return jsonb_build_object('state', 'invalid');
  end if;

  select * into target_document
  from dozeclin.clinical_documents
  where id = target_link.document_id;

  if target_document.status <> 'issued'
    or target_document.visibility = 'internal'
    or target_document.current_pdf_path is null then
    return jsonb_build_object('state', 'invalid');
  end if;

  update dozeclin.document_public_links
  set view_count = view_count + 1
  where id = target_link.id
  returning * into target_link;

  perform dozeclin.audit_document_event(
    target_document.clinic_id,
    target_document.id,
    'share_link_accessed',
    jsonb_build_object('access_channel', 'shared_link', 'result', 'valid')
  );

  return jsonb_build_object(
    'state', 'valid',
    'document_id', target_document.id,
    'storage_path', target_document.current_pdf_path,
    'allow_download', target_link.allow_download,
    'expires_at', target_link.expires_at
  );
end;
$$;

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
    'documents', coalesce(documents.rows, '[]'::jsonb),
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
    select jsonb_agg(to_jsonb(row_data) order by row_data.issued_at desc nulls last, row_data.created_at desc) as rows
    from (
      select d.id,
             d.document_type,
             d.document_number,
             d.title,
             d.status,
             d.signature_status,
             d.visibility,
             d.current_version,
             d.issued_at,
             d.patient_access_enabled,
             d.current_pdf_path,
             d.professional_snapshot->>'full_name' as professional_name,
             d.professional_snapshot->>'display_title' as professional_title
      from dozeclin.clinical_documents d
      where d.patient_id = p.id
        and d.visibility = 'patient'
        and d.patient_access_enabled = true
        and d.status in ('issued', 'revoked', 'archived')
        and d.document_type <> 'clinical_progress'
      order by d.issued_at desc nulls last, d.created_at desc
      limit 20
    ) row_data
  ) documents on true
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

alter table dozeclin.professional_signatures enable row level security;
alter table dozeclin.clinical_document_sequences enable row level security;
alter table dozeclin.document_templates enable row level security;
alter table dozeclin.clinical_documents enable row level security;
alter table dozeclin.document_versions enable row level security;
alter table dozeclin.document_events enable row level security;
alter table dozeclin.document_public_links enable row level security;

drop policy if exists "professional_signatures_select_staff" on dozeclin.professional_signatures;
create policy "professional_signatures_select_staff" on dozeclin.professional_signatures
for select using (
  clinic_id = dozeclin.current_clinic_id()
  and dozeclin.current_profile_role() in ('clinic_admin', 'supervisor', 'professional')
);

drop policy if exists "professional_signatures_insert_owner_or_admin" on dozeclin.professional_signatures;
create policy "professional_signatures_insert_owner_or_admin" on dozeclin.professional_signatures
for insert with check (
  clinic_id = dozeclin.current_clinic_id()
  and (
    dozeclin.current_profile_role() in ('clinic_admin', 'supervisor')
    or (owner_type = 'professional' and profile_id = dozeclin.current_active_profile_id())
  )
);

drop policy if exists "professional_signatures_update_owner_or_admin" on dozeclin.professional_signatures;
create policy "professional_signatures_update_owner_or_admin" on dozeclin.professional_signatures
for update using (
  clinic_id = dozeclin.current_clinic_id()
  and (
    dozeclin.current_profile_role() in ('clinic_admin', 'supervisor')
    or (owner_type = 'professional' and profile_id = dozeclin.current_active_profile_id())
  )
) with check (
  clinic_id = dozeclin.current_clinic_id()
  and (
    dozeclin.current_profile_role() in ('clinic_admin', 'supervisor')
    or (owner_type = 'professional' and profile_id = dozeclin.current_active_profile_id())
  )
);

drop policy if exists "document_templates_select_staff" on dozeclin.document_templates;
create policy "document_templates_select_staff" on dozeclin.document_templates
for select using (
  (clinic_id is null or clinic_id = dozeclin.current_clinic_id())
  and dozeclin.current_profile_role() in ('clinic_admin', 'supervisor', 'professional', 'reception')
);

drop policy if exists "clinical_documents_select_staff_or_patient" on dozeclin.clinical_documents;
create policy "clinical_documents_select_staff_or_patient" on dozeclin.clinical_documents
for select using (
  (
    clinic_id = dozeclin.current_clinic_id()
    and dozeclin.current_profile_role() in ('clinic_admin', 'supervisor', 'professional', 'reception')
  )
  or (
    patient_id = dozeclin.current_patient_id()
    and visibility = 'patient'
    and patient_access_enabled = true
    and status in ('issued', 'revoked', 'archived')
    and document_type <> 'clinical_progress'
  )
);

drop policy if exists "clinical_documents_insert_staff" on dozeclin.clinical_documents;
create policy "clinical_documents_insert_staff" on dozeclin.clinical_documents
for insert with check (
  clinic_id = dozeclin.current_clinic_id()
  and dozeclin.current_profile_role() in ('clinic_admin', 'supervisor', 'professional')
);

drop policy if exists "clinical_documents_update_staff" on dozeclin.clinical_documents;
create policy "clinical_documents_update_staff" on dozeclin.clinical_documents
for update using (
  clinic_id = dozeclin.current_clinic_id()
  and dozeclin.current_profile_role() in ('clinic_admin', 'supervisor', 'professional')
) with check (
  clinic_id = dozeclin.current_clinic_id()
  and dozeclin.current_profile_role() in ('clinic_admin', 'supervisor', 'professional')
);

drop policy if exists "document_versions_select_staff" on dozeclin.document_versions;
create policy "document_versions_select_staff" on dozeclin.document_versions
for select using (
  clinic_id = dozeclin.current_clinic_id()
  and dozeclin.current_profile_role() in ('clinic_admin', 'supervisor', 'professional')
);

drop policy if exists "document_versions_insert_via_staff" on dozeclin.document_versions;
create policy "document_versions_insert_via_staff" on dozeclin.document_versions
for insert with check (
  clinic_id = dozeclin.current_clinic_id()
  and dozeclin.current_profile_role() in ('clinic_admin', 'supervisor', 'professional')
);

drop policy if exists "document_events_select_staff" on dozeclin.document_events;
create policy "document_events_select_staff" on dozeclin.document_events
for select using (
  clinic_id = dozeclin.current_clinic_id()
  and dozeclin.current_profile_role() in ('clinic_admin', 'supervisor', 'professional')
);

drop policy if exists "document_public_links_select_staff" on dozeclin.document_public_links;
create policy "document_public_links_select_staff" on dozeclin.document_public_links
for select using (
  clinic_id = dozeclin.current_clinic_id()
  and dozeclin.current_profile_role() in ('clinic_admin', 'supervisor', 'professional', 'reception')
);

revoke all on dozeclin.professional_signatures from anon;
revoke all on dozeclin.clinical_document_sequences from anon, authenticated;
revoke all on dozeclin.document_templates from anon;
revoke all on dozeclin.clinical_documents from anon;
revoke all on dozeclin.document_versions from anon;
revoke all on dozeclin.document_events from anon;
revoke all on dozeclin.document_public_links from anon;

revoke delete on dozeclin.professional_signatures from authenticated;
revoke delete on dozeclin.document_templates from authenticated;
revoke delete on dozeclin.clinical_documents from authenticated;
revoke delete on dozeclin.document_versions from authenticated;
revoke delete on dozeclin.document_events from authenticated;
revoke delete on dozeclin.document_public_links from authenticated;

grant select, insert, update on dozeclin.professional_signatures to authenticated;
grant select on dozeclin.document_templates to authenticated;
grant select, insert, update on dozeclin.clinical_documents to authenticated;
grant select, insert on dozeclin.document_versions to authenticated;
grant select on dozeclin.document_events to authenticated;
grant select on dozeclin.document_public_links to authenticated;

grant all privileges on dozeclin.professional_signatures to service_role;
grant all privileges on dozeclin.clinical_document_sequences to service_role;
grant all privileges on dozeclin.document_templates to service_role;
grant all privileges on dozeclin.clinical_documents to service_role;
grant all privileges on dozeclin.document_versions to service_role;
grant all privileges on dozeclin.document_events to service_role;
grant all privileges on dozeclin.document_public_links to service_role;
grant all privileges on storage.objects to service_role;
grant all privileges on storage.buckets to service_role;

revoke execute on function dozeclin.current_profile() from public, anon;
revoke execute on function dozeclin.can_manage_documents(uuid) from public, anon;
revoke execute on function dozeclin.can_share_documents(uuid) from public, anon;
revoke execute on function dozeclin.sha256_jsonb(jsonb) from public, anon;
revoke execute on function dozeclin.hash_public_token(text) from public, anon;
revoke execute on function dozeclin.patient_initials(text) from public, anon;
revoke execute on function dozeclin.document_prefix_for_type(dozeclin.clinical_document_type) from public, anon;
revoke execute on function dozeclin.next_clinical_document_number(uuid, dozeclin.clinical_document_type, timestamptz) from public, anon, authenticated;
revoke execute on function dozeclin.audit_document_event(uuid, uuid, dozeclin.document_event_type, jsonb) from public, anon, authenticated;
revoke execute on function dozeclin.build_clinical_document_hash(dozeclin.clinical_documents) from public, anon;
revoke execute on function dozeclin.protect_professional_signature() from public, anon, authenticated;
revoke execute on function dozeclin.protect_clinical_document() from public, anon, authenticated;
revoke execute on function dozeclin.block_document_version_delete() from public, anon, authenticated;
revoke execute on function dozeclin.create_document_from_appointment(uuid, uuid, uuid, dozeclin.clinical_document_type, text, dozeclin.document_visibility, boolean) from public, anon;
revoke execute on function dozeclin.issue_clinical_document(uuid) from public, anon;
revoke execute on function dozeclin.sign_clinical_document(uuid, uuid) from public, anon;
revoke execute on function dozeclin.enable_public_document_validation(uuid) from public, anon;
revoke execute on function dozeclin.revoke_clinical_document(uuid, text) from public, anon;
revoke execute on function dozeclin.archive_clinical_document(uuid) from public, anon;
revoke execute on function dozeclin.set_document_patient_access(uuid, boolean) from public, anon;
revoke execute on function dozeclin.create_document_share_link(uuid, text, boolean, integer) from public, anon;
revoke execute on function dozeclin.consume_document_share_link(text) from public, anon, authenticated;

grant execute on function dozeclin.current_profile() to authenticated, service_role;
grant execute on function dozeclin.can_manage_documents(uuid) to authenticated, service_role;
grant execute on function dozeclin.can_share_documents(uuid) to authenticated, service_role;
grant execute on function dozeclin.hash_public_token(text) to service_role;
grant execute on function dozeclin.patient_initials(text) to authenticated, service_role;
grant execute on function dozeclin.document_prefix_for_type(dozeclin.clinical_document_type) to authenticated, service_role;
grant execute on function dozeclin.next_clinical_document_number(uuid, dozeclin.clinical_document_type, timestamptz) to service_role;
grant execute on function dozeclin.audit_document_event(uuid, uuid, dozeclin.document_event_type, jsonb) to authenticated, service_role;
grant execute on function dozeclin.build_clinical_document_hash(dozeclin.clinical_documents) to authenticated, service_role;
grant execute on function dozeclin.create_document_from_appointment(uuid, uuid, uuid, dozeclin.clinical_document_type, text, dozeclin.document_visibility, boolean) to authenticated;
grant execute on function dozeclin.issue_clinical_document(uuid) to authenticated;
grant execute on function dozeclin.sign_clinical_document(uuid, uuid) to authenticated;
grant execute on function dozeclin.enable_public_document_validation(uuid) to authenticated, service_role;
grant execute on function dozeclin.verify_public_document(text) to anon, authenticated, service_role;
grant execute on function dozeclin.revoke_clinical_document(uuid, text) to authenticated;
grant execute on function dozeclin.archive_clinical_document(uuid) to authenticated;
grant execute on function dozeclin.set_document_patient_access(uuid, boolean) to authenticated;
grant execute on function dozeclin.create_document_share_link(uuid, text, boolean, integer) to authenticated;
grant execute on function dozeclin.consume_document_share_link(text) to service_role;

commit;
