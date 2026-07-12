begin;

alter table dozeclin.clinic_settings
  add column if not exists require_record_signature boolean not null default true,
  add column if not exists allow_online_booking boolean not null default false,
  add column if not exists notification_email text;

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
set search_path = dozeclin, auth
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

revoke execute on function dozeclin.create_clinic_with_admin(text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function dozeclin.create_clinic_with_admin(text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text) to authenticated, service_role;

commit;
