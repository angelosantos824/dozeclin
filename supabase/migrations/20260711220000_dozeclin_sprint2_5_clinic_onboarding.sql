begin;

alter table dozeclin.clinics
  add column if not exists specialty text not null default 'general',
  add column if not exists plan_code text not null default 'basic',
  add column if not exists owner_profile_id uuid,
  add column if not exists activated_at timestamptz,
  add column if not exists suspended_at timestamptz,
  add column if not exists suspension_reason text;

alter table dozeclin.clinics enable row level security;
alter table dozeclin.profiles enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'clinics_specialty_check'
      and conrelid = 'dozeclin.clinics'::regclass
  ) then
    alter table dozeclin.clinics
      add constraint clinics_specialty_check
      check (specialty in ('psychoanalysis', 'psychology', 'dentistry', 'nutrition', 'physiotherapy', 'pediatrics', 'psychiatry', 'multidisciplinary', 'general', 'other'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'clinics_plan_code_check'
      and conrelid = 'dozeclin.clinics'::regclass
  ) then
    alter table dozeclin.clinics
      add constraint clinics_plan_code_check
      check (plan_code in ('basic', 'professional', 'premium', 'custom'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'clinics_owner_profile_id_fkey'
      and conrelid = 'dozeclin.clinics'::regclass
  ) then
    alter table dozeclin.clinics
      add constraint clinics_owner_profile_id_fkey
      foreign key (owner_profile_id)
      references dozeclin.profiles(id)
      on delete restrict;
  end if;
end $$;

create unique index if not exists idx_dozeclin_clinics_document_unique
  on dozeclin.clinics(document)
  where document is not null and btrim(document) <> '';

create unique index if not exists idx_dozeclin_clinics_slug_unique
  on dozeclin.clinics(slug);

create index if not exists idx_dozeclin_clinics_status
  on dozeclin.clinics(status);

create index if not exists idx_dozeclin_clinics_plan_code
  on dozeclin.clinics(plan_code);

create index if not exists idx_dozeclin_clinics_specialty
  on dozeclin.clinics(specialty);

create index if not exists idx_dozeclin_clinics_owner_profile_id
  on dozeclin.clinics(owner_profile_id);

create index if not exists idx_dozeclin_clinics_email
  on dozeclin.clinics(lower(email));

create index if not exists idx_dozeclin_clinics_created_at
  on dozeclin.clinics(created_at);

create or replace function dozeclin.is_super_admin()
returns boolean
language sql
security definer
set search_path = dozeclin, auth
as $$
  select exists (
    select 1
    from dozeclin.profiles p
    where p.auth_user_id = auth.uid()
      and p.role = 'super_admin'
      and p.status = 'active'
  );
$$;

create or replace function dozeclin.normalize_slug(input_text text)
returns text
language sql
immutable
as $$
  select trim(
    both '-'
    from regexp_replace(
      lower(
        translate(
          coalesce(input_text, ''),
          'ÁÀÂÃÄÅáàâãäåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
          'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn'
        )
      ),
      '[^a-z0-9]+',
      '-',
      'g'
    )
  );
$$;

create or replace function dozeclin.protect_clinic_saas_fields()
returns trigger
language plpgsql
security definer
set search_path = dozeclin, public
as $$
declare
  controlled_update boolean :=
    coalesce(
      current_setting('dozeclin.saas_controlled_update', true),
      'false'
    ) = 'true';
  active_role dozeclin.user_role := dozeclin.current_profile_role();
begin
  if old.status is distinct from new.status
    or old.plan_code is distinct from new.plan_code
    or old.owner_profile_id is distinct from new.owner_profile_id
    or old.activated_at is distinct from new.activated_at
    or old.suspended_at is distinct from new.suspended_at
    or old.suspension_reason is distinct from new.suspension_reason
  then
    if not controlled_update then
      raise exception 'Campos SaaS da clinica so podem ser alterados por funcoes administrativas controladas.';
    end if;
  end if;

  if dozeclin.is_super_admin() then
    return new;
  end if;

  if active_role <> 'clinic_admin' then
    raise exception 'Perfil sem permissao para alterar dados da clinica.';
  end if;

  if old.id is distinct from new.id
    or old.slug is distinct from new.slug
    or old.document is distinct from new.document
    or old.specialty is distinct from new.specialty
    or old.created_at is distinct from new.created_at
  then
    raise exception 'Campos comerciais da clinica nao podem ser alterados por administradores da clinica.';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_clinic_saas_fields_before_update on dozeclin.clinics;
create trigger protect_clinic_saas_fields_before_update
before update on dozeclin.clinics
for each row execute function dozeclin.protect_clinic_saas_fields();

create or replace function dozeclin.create_clinic_with_admin(
  p_name text,
  p_legal_name text,
  p_slug text,
  p_document text,
  p_email text,
  p_phone text,
  p_whatsapp text,
  p_country text,
  p_city text,
  p_address text,
  p_postal_code text,
  p_timezone text,
  p_default_currency text,
  p_specialty text,
  p_plan_code text,
  p_primary_color text,
  p_secondary_color text,
  p_admin_full_name text,
  p_admin_email text,
  p_admin_phone text
)
returns dozeclin.clinics
language plpgsql
security definer
set search_path = dozeclin, public, auth
as $$
declare
  created_clinic dozeclin.clinics;
  created_admin dozeclin.profiles;
  normalized_slug text;
  normalized_clinic_email text;
  normalized_admin_email text;
  normalized_specialty text := coalesce(nullif(btrim(p_specialty), ''), 'psychoanalysis');
  normalized_plan text := coalesce(nullif(btrim(p_plan_code), ''), 'basic');
begin
  if not dozeclin.is_super_admin() then
    raise exception 'Apenas administradores do produto podem criar clinicas.';
  end if;

  if nullif(btrim(p_name), '') is null then
    raise exception 'Nome da clinica e obrigatorio.';
  end if;

  if nullif(btrim(p_admin_full_name), '') is null then
    raise exception 'Nome do administrador e obrigatorio.';
  end if;

  normalized_admin_email := lower(nullif(btrim(p_admin_email), ''));
  if normalized_admin_email is null then
    raise exception 'Email do administrador e obrigatorio.';
  end if;

  if normalized_admin_email !~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$' then
    raise exception 'Email do administrador invalido.';
  end if;

  normalized_clinic_email := lower(nullif(btrim(p_email), ''));
  if normalized_clinic_email is not null
    and normalized_clinic_email !~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$'
  then
    raise exception 'Email da clinica invalido.';
  end if;

  if normalized_specialty not in ('psychoanalysis', 'psychology', 'dentistry', 'nutrition', 'physiotherapy', 'pediatrics', 'psychiatry', 'multidisciplinary', 'general', 'other') then
    raise exception 'Especialidade invalida.';
  end if;

  if normalized_plan not in ('basic', 'professional', 'premium', 'custom') then
    raise exception 'Plano invalido.';
  end if;

  normalized_slug := dozeclin.normalize_slug(coalesce(nullif(p_slug, ''), p_name));
  if normalized_slug = '' then
    raise exception 'Slug da clinica invalido.';
  end if;

  if exists (
    select 1
    from dozeclin.profiles p
    where lower(p.email) = normalized_admin_email
  ) then
    raise exception 'Ja existe um perfil com este email de administrador.';
  end if;

  perform set_config('dozeclin.saas_controlled_update', 'true', true);

  insert into dozeclin.clinics (
    name,
    legal_name,
    slug,
    document,
    email,
    phone,
    whatsapp,
    country,
    city,
    address,
    postal_code,
    timezone,
    default_currency,
    specialty,
    plan_code,
    primary_color,
    secondary_color,
    status,
    activated_at
  ) values (
    btrim(p_name),
    nullif(btrim(p_legal_name), ''),
    normalized_slug,
    nullif(btrim(p_document), ''),
    normalized_clinic_email,
    nullif(btrim(p_phone), ''),
    nullif(btrim(p_whatsapp), ''),
    coalesce(nullif(btrim(p_country), ''), 'Portugal'),
    nullif(btrim(p_city), ''),
    nullif(btrim(p_address), ''),
    nullif(btrim(p_postal_code), ''),
    coalesce(nullif(btrim(p_timezone), ''), 'Europe/Lisbon'),
    coalesce(nullif(btrim(p_default_currency), ''), 'EUR'),
    normalized_specialty,
    normalized_plan,
    coalesce(nullif(btrim(p_primary_color), ''), '#7c3aed'),
    coalesce(nullif(btrim(p_secondary_color), ''), '#a855f7'),
    'trial',
    now()
  )
  returning * into created_clinic;

  insert into dozeclin.profiles (
    clinic_id,
    auth_user_id,
    full_name,
    email,
    phone,
    role,
    status,
    specialty
  ) values (
    created_clinic.id,
    null,
    btrim(p_admin_full_name),
    normalized_admin_email,
    nullif(btrim(p_admin_phone), ''),
    'clinic_admin',
    'pending_invite',
    normalized_specialty
  )
  returning * into created_admin;

  update dozeclin.clinics
  set owner_profile_id = created_admin.id,
      updated_at = now()
  where id = created_clinic.id
  returning * into created_clinic;

  insert into dozeclin.clinic_settings (
    clinic_id,
    specialty_label,
    require_record_signature,
    allow_online_booking,
    notification_email
  ) values (
    created_clinic.id,
    case normalized_specialty
      when 'psychoanalysis' then 'Psicanalise'
      when 'psychology' then 'Psicologia'
      when 'dentistry' then 'Odontologia'
      when 'nutrition' then 'Nutricao'
      when 'physiotherapy' then 'Fisioterapia'
      when 'pediatrics' then 'Pediatria'
      when 'psychiatry' then 'Psiquiatria'
      when 'multidisciplinary' then 'Clinica multidisciplinar'
      else 'Clinica'
    end,
    true,
    false,
    normalized_clinic_email
  )
  on conflict (clinic_id) do nothing;

  insert into dozeclin.audit_logs (
    clinic_id,
    user_id,
    action,
    entity,
    entity_id,
    new_data
  ) values (
    created_clinic.id,
    auth.uid(),
    'clinics.create',
    'clinics',
    created_clinic.id,
    jsonb_build_object(
      'clinic_id', created_clinic.id,
      'owner_profile_id', created_admin.id,
      'status', created_clinic.status,
      'plan_code', created_clinic.plan_code,
      'specialty', created_clinic.specialty
    )
  );

  return created_clinic;
end;
$$;

create or replace function dozeclin.update_clinic_status(
  p_clinic_id uuid,
  p_status dozeclin.clinic_status,
  p_reason text default null
)
returns dozeclin.clinics
language plpgsql
security definer
set search_path = dozeclin, public, auth
as $$
declare
  old_clinic dozeclin.clinics;
  updated_clinic dozeclin.clinics;
begin
  if not dozeclin.is_super_admin() then
    raise exception 'Apenas administradores do produto podem alterar o estado da clinica.';
  end if;

  if p_status in ('suspended', 'cancelled') and nullif(btrim(p_reason), '') is null then
    raise exception 'Informe o motivo para suspender ou cancelar a clinica.';
  end if;

  select *
  into old_clinic
  from dozeclin.clinics
  where id = p_clinic_id
  for update;

  if not found then
    raise exception 'Clinica nao encontrada.';
  end if;

  perform set_config('dozeclin.saas_controlled_update', 'true', true);

  update dozeclin.clinics
  set status = p_status,
      activated_at = case
        when p_status in ('trial', 'active') then coalesce(activated_at, now())
        else activated_at
      end,
      suspended_at = case
        when p_status in ('suspended', 'cancelled') then now()
        else null
      end,
      suspension_reason = case
        when p_status in ('suspended', 'cancelled') then btrim(p_reason)
        else null
      end,
      updated_at = now()
  where id = p_clinic_id
  returning * into updated_clinic;

  insert into dozeclin.audit_logs (
    clinic_id,
    user_id,
    action,
    entity,
    entity_id,
    previous_data,
    new_data
  ) values (
    updated_clinic.id,
    auth.uid(),
    'clinics.status.update',
    'clinics',
    updated_clinic.id,
    jsonb_build_object(
      'status', old_clinic.status,
      'suspended_at', old_clinic.suspended_at,
      'suspension_reason', old_clinic.suspension_reason
    ),
    jsonb_build_object(
      'status', updated_clinic.status,
      'suspended_at', updated_clinic.suspended_at,
      'suspension_reason', updated_clinic.suspension_reason
    )
  );

  return updated_clinic;
end;
$$;

create or replace function dozeclin.update_clinic_plan(
  p_clinic_id uuid,
  p_plan_code text
)
returns dozeclin.clinics
language plpgsql
security definer
set search_path = dozeclin, public, auth
as $$
declare
  old_clinic dozeclin.clinics;
  updated_clinic dozeclin.clinics;
  normalized_plan text := lower(nullif(btrim(p_plan_code), ''));
begin
  if not dozeclin.is_super_admin() then
    raise exception 'Apenas administradores do produto podem alterar o plano da clinica.';
  end if;

  if normalized_plan not in ('basic', 'professional', 'premium', 'custom') then
    raise exception 'Plano invalido.';
  end if;

  select *
  into old_clinic
  from dozeclin.clinics
  where id = p_clinic_id
  for update;

  if not found then
    raise exception 'Clinica nao encontrada.';
  end if;

  perform set_config('dozeclin.saas_controlled_update', 'true', true);

  update dozeclin.clinics
  set plan_code = normalized_plan,
      updated_at = now()
  where id = p_clinic_id
  returning * into updated_clinic;

  insert into dozeclin.audit_logs (
    clinic_id,
    user_id,
    action,
    entity,
    entity_id,
    previous_data,
    new_data
  ) values (
    updated_clinic.id,
    auth.uid(),
    'clinics.plan.update',
    'clinics',
    updated_clinic.id,
    jsonb_build_object('plan_code', old_clinic.plan_code),
    jsonb_build_object('plan_code', updated_clinic.plan_code)
  );

  return updated_clinic;
end;
$$;

create or replace function dozeclin.get_clinic_primary_admin(p_clinic_id uuid)
returns table (
  id uuid,
  clinic_id uuid,
  full_name text,
  email text,
  phone text,
  status dozeclin.user_status
)
language plpgsql
security definer
set search_path = dozeclin, public, auth
as $$
begin
  if not dozeclin.is_super_admin() then
    raise exception 'Apenas administradores do produto podem consultar o administrador principal.';
  end if;

  return query
  select p.id, p.clinic_id, p.full_name, p.email, p.phone, p.status
  from dozeclin.profiles p
  join dozeclin.clinics c on c.id = p.clinic_id
  where c.id = p_clinic_id
    and p.id = c.owner_profile_id
    and p.role = 'clinic_admin'
  limit 1;
end;
$$;

drop policy if exists "clinics_select_own" on dozeclin.clinics;
drop policy if exists "clinics_update_admin" on dozeclin.clinics;
drop policy if exists "clinics_select_saas_or_own" on dozeclin.clinics;
drop policy if exists "clinics_insert_super_admin" on dozeclin.clinics;
drop policy if exists "clinics_update_super_admin" on dozeclin.clinics;
drop policy if exists "clinics_update_own_basic" on dozeclin.clinics;

create policy "clinics_select_saas_or_own" on dozeclin.clinics
for select using (
  dozeclin.is_super_admin()
  or id = dozeclin.current_clinic_id()
);

create policy "clinics_update_super_admin" on dozeclin.clinics
for update using (dozeclin.is_super_admin())
with check (dozeclin.is_super_admin());

create policy "clinics_update_own_basic" on dozeclin.clinics
for update using (
  id = dozeclin.current_clinic_id()
  and dozeclin.current_profile_role() = 'clinic_admin'
)
with check (id = dozeclin.current_clinic_id());

drop policy if exists "profiles_select_own_clinic" on dozeclin.profiles;
drop policy if exists "profiles_select_own_clinic_or_saas" on dozeclin.profiles;

create policy "profiles_select_own_clinic" on dozeclin.profiles
for select using (
  id = dozeclin.current_profile_id()
  or clinic_id = dozeclin.current_clinic_id()
);

revoke execute on function dozeclin.is_super_admin() from public, anon;
revoke execute on function dozeclin.normalize_slug(text) from public, anon;
revoke execute on function dozeclin.protect_clinic_saas_fields() from public, anon, authenticated;
revoke execute on function dozeclin.create_clinic_with_admin(text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text) from public, anon;
revoke execute on function dozeclin.update_clinic_status(uuid, dozeclin.clinic_status, text) from public, anon;
revoke execute on function dozeclin.update_clinic_plan(uuid, text) from public, anon;
revoke execute on function dozeclin.get_clinic_primary_admin(uuid) from public, anon;

grant execute on function dozeclin.is_super_admin() to authenticated, service_role;
grant execute on function dozeclin.normalize_slug(text) to authenticated, service_role;
grant execute on function dozeclin.create_clinic_with_admin(text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text) to authenticated, service_role;
grant execute on function dozeclin.update_clinic_status(uuid, dozeclin.clinic_status, text) to authenticated, service_role;
grant execute on function dozeclin.update_clinic_plan(uuid, text) to authenticated, service_role;
grant execute on function dozeclin.get_clinic_primary_admin(uuid) to authenticated, service_role;

commit;
