begin;

do $$
begin
  create type dozeclin.patient_request_status as enum (
    'new',
    'contacted',
    'qualified',
    'converted',
    'closed'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type dozeclin.patient_onboarding_status as enum (
    'not_started',
    'in_progress',
    'completed'
  );
exception
  when duplicate_object then null;
end $$;

alter table dozeclin.patients
  add column if not exists auth_user_id uuid references auth.users(id) on delete set null,
  add column if not exists sex text,
  add column if not exists marital_status text,
  add column if not exists profession text,
  add column if not exists city text,
  add column if not exists postal_code text,
  add column if not exists emergency_contact_name text,
  add column if not exists emergency_contact_phone text,
  add column if not exists profile_completed_at timestamptz;

create unique index if not exists idx_dozeclin_patients_auth_user_id
on dozeclin.patients(auth_user_id)
where auth_user_id is not null;

create table if not exists dozeclin.patient_requests (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references dozeclin.clinics(id) on delete restrict,
  patient_id uuid references dozeclin.patients(id) on delete set null,
  converted_patient_id uuid references dozeclin.patients(id) on delete set null,
  full_name text not null,
  email text not null,
  phone text not null,
  interest text not null,
  message text,
  consent_accepted boolean not null default false,
  consent_at timestamptz,
  status dozeclin.patient_request_status not null default 'new',
  source text not null default 'public_request',
  contacted_at timestamptz,
  converted_at timestamptz,
  closed_at timestamptz,
  closed_reason text,
  created_by uuid references dozeclin.profiles(id) on delete set null,
  updated_by uuid references dozeclin.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint patient_requests_email_lower_check check (email = lower(email)),
  constraint patient_requests_consent_check check (consent_accepted = true),
  constraint patient_requests_full_name_length_check check (char_length(full_name) between 3 and 160),
  constraint patient_requests_email_length_check check (char_length(email) between 6 and 254),
  constraint patient_requests_phone_length_check check (char_length(phone) between 6 and 32),
  constraint patient_requests_interest_length_check check (char_length(interest) between 2 and 120),
  constraint patient_requests_message_length_check check (message is null or char_length(message) <= 1200)
);

create table if not exists dozeclin.patient_portals (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references dozeclin.clinics(id) on delete restrict,
  patient_id uuid not null unique references dozeclin.patients(id) on delete cascade,
  profile_id uuid not null unique references dozeclin.profiles(id) on delete restrict,
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  request_id uuid references dozeclin.patient_requests(id) on delete set null,
  status text not null default 'active',
  welcome_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint patient_portals_status_check check (status in ('active', 'suspended', 'completed'))
);

create table if not exists dozeclin.patient_onboarding (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references dozeclin.clinics(id) on delete restrict,
  patient_id uuid not null unique references dozeclin.patients(id) on delete cascade,
  portal_id uuid not null unique references dozeclin.patient_portals(id) on delete cascade,
  status dozeclin.patient_onboarding_status not null default 'not_started',
  current_step text not null default 'welcome',
  profile_completed_at timestamptz,
  anamnesis_started_at timestamptz,
  anamnesis_completed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint patient_onboarding_step_check check (
    current_step in ('welcome', 'password', 'profile', 'anamnesis', 'completed')
  )
);

create index if not exists idx_dozeclin_patient_requests_clinic_status
on dozeclin.patient_requests(clinic_id, status, created_at desc);

create index if not exists idx_dozeclin_patient_requests_email
on dozeclin.patient_requests(clinic_id, email);

create index if not exists idx_dozeclin_patient_requests_phone
on dozeclin.patient_requests(clinic_id, phone);

create index if not exists idx_dozeclin_patient_onboarding_clinic_status
on dozeclin.patient_onboarding(clinic_id, status, current_step);

drop trigger if exists set_patient_requests_updated_at on dozeclin.patient_requests;
create trigger set_patient_requests_updated_at
before update on dozeclin.patient_requests
for each row execute function dozeclin.set_updated_at();

drop trigger if exists set_patient_portals_updated_at on dozeclin.patient_portals;
create trigger set_patient_portals_updated_at
before update on dozeclin.patient_portals
for each row execute function dozeclin.set_updated_at();

drop trigger if exists set_patient_onboarding_updated_at on dozeclin.patient_onboarding;
create trigger set_patient_onboarding_updated_at
before update on dozeclin.patient_onboarding
for each row execute function dozeclin.set_updated_at();

create or replace function dozeclin.current_patient_id()
returns uuid
language sql
security definer
set search_path = dozeclin, auth
stable
as $$
  select pp.patient_id
  from dozeclin.patient_portals pp
  join dozeclin.profiles p on p.id = pp.profile_id
  join dozeclin.clinics c on c.id = pp.clinic_id
  where pp.auth_user_id = auth.uid()
    and pp.status = 'active'
    and p.role = 'patient'
    and p.status = 'active'
    and p.must_change_password = false
    and c.status in ('trial', 'active')
  limit 1;
$$;

create or replace function dozeclin.is_patient_self(target_patient_id uuid)
returns boolean
language sql
security definer
set search_path = dozeclin, auth
stable
as $$
  select dozeclin.current_patient_id() = target_patient_id;
$$;

create or replace function dozeclin.patient_portal_is_available(target_patient_id uuid)
returns boolean
language sql
security definer
set search_path = dozeclin, auth
stable
as $$
  select exists (
    select 1
    from dozeclin.patients p
    join dozeclin.clinics c on c.id = p.clinic_id
    join dozeclin.profiles pr on pr.auth_user_id = auth.uid()
    join dozeclin.patient_portals pp on pp.patient_id = p.id and pp.auth_user_id = auth.uid()
    where p.id = target_patient_id
      and c.status in ('trial', 'active')
      and pr.role = 'patient'
      and pr.status = 'active'
      and pr.must_change_password = false
      and pp.status = 'active'
  );
$$;

create or replace function dozeclin.protect_patient_request_integrity()
returns trigger
language plpgsql
security definer
set search_path = dozeclin, auth
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if old.id is distinct from new.id
    or old.clinic_id is distinct from new.clinic_id
    or old.full_name is distinct from new.full_name
    or old.email is distinct from new.email
    or old.phone is distinct from new.phone
    or old.interest is distinct from new.interest
    or old.message is distinct from new.message
    or old.consent_accepted is distinct from new.consent_accepted
    or old.consent_at is distinct from new.consent_at
    or old.source is distinct from new.source
    or old.created_at is distinct from new.created_at
    or old.patient_id is distinct from new.patient_id
    or old.converted_patient_id is distinct from new.converted_patient_id
    or old.converted_at is distinct from new.converted_at
  then
    raise exception 'Campos imutaveis da solicitacao nao podem ser alterados.';
  end if;

  if old.status = 'converted' and new.status <> 'converted' then
    raise exception 'Solicitacao convertida nao pode voltar de estado.';
  end if;

  if old.status = 'closed' and new.status <> 'closed' then
    raise exception 'Solicitacao encerrada nao pode ser reaberta.';
  end if;

  if new.status = 'new' and old.status <> 'new' then
    raise exception 'Solicitacao nao pode retornar para novo.';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_patient_request_integrity_before_update on dozeclin.patient_requests;
create trigger protect_patient_request_integrity_before_update
before update on dozeclin.patient_requests
for each row execute function dozeclin.protect_patient_request_integrity();

create or replace function dozeclin.protect_patient_onboarding_integrity()
returns trigger
language plpgsql
security definer
set search_path = dozeclin, auth
as $$
begin
  if old.status = 'completed' and new.status <> 'completed' then
    raise exception 'Onboarding concluido nao pode voltar de estado.';
  end if;

  if old.current_step = 'completed' and new.current_step <> 'completed' then
    raise exception 'Onboarding concluido nao pode reabrir etapas.';
  end if;

  if old.completed_at is not null and new.completed_at is distinct from old.completed_at then
    raise exception 'Data de conclusao do onboarding nao pode ser alterada.';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_patient_onboarding_integrity_before_update on dozeclin.patient_onboarding;
create trigger protect_patient_onboarding_integrity_before_update
before update on dozeclin.patient_onboarding
for each row execute function dozeclin.protect_patient_onboarding_integrity();

create or replace function dozeclin.assert_patient_request_transition(
  p_current_status dozeclin.patient_request_status,
  p_next_status dozeclin.patient_request_status
)
returns void
language plpgsql
immutable
as $$
begin
  if p_current_status = p_next_status then
    return;
  end if;

  if p_current_status = 'new' and p_next_status in ('contacted', 'qualified', 'closed') then
    return;
  end if;

  if p_current_status = 'contacted' and p_next_status in ('qualified', 'closed') then
    return;
  end if;

  if p_current_status = 'qualified' and p_next_status = 'closed' then
    return;
  end if;

  if p_current_status = 'converted' or p_current_status = 'closed' then
    raise exception 'Solicitacao em estado final nao pode ser alterada.';
  end if;

  raise exception 'Transicao de solicitacao invalida.';
end;
$$;

create or replace function dozeclin.apply_patient_request_transition(
  p_request_id uuid,
  p_next_status dozeclin.patient_request_status,
  p_closed_reason text default null
)
returns dozeclin.patient_requests
language plpgsql
security definer
set search_path = dozeclin, auth
as $$
declare
  current_profile dozeclin.profiles;
  target_request dozeclin.patient_requests;
  updated_request dozeclin.patient_requests;
begin
  select *
  into current_profile
  from dozeclin.profiles
  where auth_user_id = auth.uid()
    and status = 'active'
    and role in ('clinic_admin', 'reception', 'professional', 'supervisor')
  limit 1;

  if not found then
    raise exception 'Apenas a equipa da clinica pode alterar solicitacoes.';
  end if;

  select *
  into target_request
  from dozeclin.patient_requests
  where id = p_request_id
    and clinic_id = current_profile.clinic_id
  for update;

  if not found then
    raise exception 'Solicitacao nao encontrada.';
  end if;

  perform dozeclin.assert_patient_request_transition(target_request.status, p_next_status);

  update dozeclin.patient_requests
  set status = p_next_status,
      contacted_at = case when p_next_status = 'contacted' then coalesce(contacted_at, now()) else contacted_at end,
      closed_at = case when p_next_status = 'closed' then coalesce(closed_at, now()) else closed_at end,
      closed_reason = case when p_next_status = 'closed' then nullif(trim(coalesce(p_closed_reason, '')), '') else closed_reason end,
      updated_by = current_profile.id,
      updated_at = now()
  where id = target_request.id
  returning * into updated_request;

  insert into dozeclin.audit_logs (clinic_id, user_id, action, entity, entity_id, previous_data, new_data)
  values (
    current_profile.clinic_id,
    auth.uid(),
    case
      when p_next_status = 'contacted' then 'patient_request.contacted'
      when p_next_status = 'qualified' then 'patient_request.qualified'
      when p_next_status = 'closed' then 'patient_request.closed'
      else 'patient_request.updated'
    end,
    'patient_requests',
    target_request.id,
    jsonb_build_object('status', target_request.status),
    jsonb_build_object('status', updated_request.status)
  );

  return updated_request;
end;
$$;

create or replace function dozeclin.mark_patient_request_contacted(p_request_id uuid)
returns dozeclin.patient_requests
language sql
security definer
set search_path = dozeclin, auth
as $$
  select dozeclin.apply_patient_request_transition(p_request_id, 'contacted'::dozeclin.patient_request_status, null);
$$;

create or replace function dozeclin.qualify_patient_request(p_request_id uuid)
returns dozeclin.patient_requests
language sql
security definer
set search_path = dozeclin, auth
as $$
  select dozeclin.apply_patient_request_transition(p_request_id, 'qualified'::dozeclin.patient_request_status, null);
$$;

create or replace function dozeclin.close_patient_request(p_request_id uuid, p_reason text)
returns dozeclin.patient_requests
language sql
security definer
set search_path = dozeclin, auth
as $$
  select dozeclin.apply_patient_request_transition(p_request_id, 'closed'::dozeclin.patient_request_status, p_reason);
$$;

drop function if exists dozeclin.submit_patient_request(text, text, text, text, text, text, boolean);

create or replace function dozeclin.submit_patient_request(
  p_clinic_slug text,
  p_full_name text,
  p_email text,
  p_phone text,
  p_interest text,
  p_message text,
  p_consent_accepted boolean,
  p_honeypot text default null,
  p_rendered_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = dozeclin, public
as $$
declare
  target_clinic dozeclin.clinics;
  normalized_email text := lower(trim(coalesce(p_email, '')));
  normalized_phone text := regexp_replace(trim(coalesce(p_phone, '')), '[^0-9+]', '', 'g');
  normalized_message text := nullif(left(trim(coalesce(p_message, '')), 1200), '');
  duplicate_exists boolean;
begin
  if nullif(trim(coalesce(p_honeypot, '')), '') is not null then
    return jsonb_build_object('ok', true);
  end if;

  if p_rendered_at is null or p_rendered_at > now() or p_rendered_at > now() - interval '3 seconds' then
    return jsonb_build_object('ok', true);
  end if;

  select *
  into target_clinic
  from dozeclin.clinics
  where slug = lower(trim(p_clinic_slug))
    and status in ('trial', 'active');

  if not found then
    return jsonb_build_object('ok', true);
  end if;

  if char_length(trim(coalesce(p_full_name, ''))) < 3
    or char_length(normalized_email) < 6
    or char_length(normalized_phone) < 6
    or char_length(trim(coalesce(p_interest, ''))) < 2
    or char_length(trim(coalesce(p_full_name, ''))) > 160
    or char_length(normalized_email) > 254
    or char_length(normalized_phone) > 32
    or char_length(trim(coalesce(p_interest, ''))) > 120
  then
    return jsonb_build_object('ok', true);
  end if;

  if p_consent_accepted is distinct from true then
    return jsonb_build_object('ok', true);
  end if;

  if normalized_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return jsonb_build_object('ok', true);
  end if;

  select exists (
    select 1
    from dozeclin.patient_requests pr
    where pr.clinic_id = target_clinic.id
      and pr.status in ('new', 'contacted')
      and pr.created_at >= now() - interval '5 minutes'
      and (pr.email = normalized_email or pr.phone = normalized_phone)
  )
  into duplicate_exists;

  if duplicate_exists then
    return jsonb_build_object('ok', true);
  end if;

  insert into dozeclin.patient_requests (
    clinic_id,
    full_name,
    email,
    phone,
    interest,
    message,
    consent_accepted,
    consent_at
  )
  values (
    target_clinic.id,
    left(trim(p_full_name), 160),
    normalized_email,
    normalized_phone,
    left(trim(p_interest), 120),
    normalized_message,
    true,
    now()
  );

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function dozeclin.start_patient_journey_transaction(
  p_request_id uuid,
  p_auth_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = dozeclin, auth
as $$
declare
  target_request dozeclin.patient_requests;
  target_clinic dozeclin.clinics;
  created_patient dozeclin.patients;
  created_profile dozeclin.profiles;
  created_portal dozeclin.patient_portals;
  created_onboarding dozeclin.patient_onboarding;
  created_anamnesis dozeclin.anamnesis_forms;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Fluxo interno invalido.';
  end if;

  select *
  into target_request
  from dozeclin.patient_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Solicitacao nao encontrada.';
  end if;

  if target_request.status <> 'qualified' then
    raise exception 'Apenas solicitacoes com atendimento confirmado podem iniciar acompanhamento.';
  end if;

  if target_request.patient_id is not null or target_request.converted_patient_id is not null then
    raise exception 'Solicitacao ja convertida.';
  end if;

  select *
  into target_clinic
  from dozeclin.clinics
  where id = target_request.clinic_id
  for update;

  if not found or target_clinic.status not in ('trial', 'active') then
    raise exception 'Clinica indisponivel para criar Portal do Paciente.';
  end if;

  if exists (
    select 1
    from dozeclin.patients p
    where p.clinic_id = target_request.clinic_id
      and p.email = target_request.email
  ) then
    raise exception 'Ja existe paciente com este email nesta clinica.';
  end if;

  if exists (
    select 1
    from dozeclin.profiles p
    where p.auth_user_id = p_auth_user_id
  ) then
    raise exception 'Utilizador Auth ja associado a outro perfil.';
  end if;

  insert into dozeclin.patients (
    clinic_id,
    auth_user_id,
    full_name,
    email,
    phone,
    status
  )
  values (
    target_request.clinic_id,
    p_auth_user_id,
    target_request.full_name,
    target_request.email,
    target_request.phone,
    'active'
  )
  returning * into created_patient;

  insert into dozeclin.profiles (
    clinic_id,
    auth_user_id,
    full_name,
    email,
    phone,
    role,
    status,
    must_change_password,
    activated_at
  )
  values (
    target_request.clinic_id,
    p_auth_user_id,
    target_request.full_name,
    target_request.email,
    target_request.phone,
    'patient',
    'active',
    true,
    now()
  )
  returning * into created_profile;

  insert into dozeclin.patient_portals (
    clinic_id,
    patient_id,
    profile_id,
    auth_user_id,
    request_id,
    status
  )
  values (
    target_request.clinic_id,
    created_patient.id,
    created_profile.id,
    p_auth_user_id,
    target_request.id,
    'active'
  )
  returning * into created_portal;

  insert into dozeclin.patient_onboarding (
    clinic_id,
    patient_id,
    portal_id,
    status,
    current_step
  )
  values (
    target_request.clinic_id,
    created_patient.id,
    created_portal.id,
    'not_started',
    'password'
  )
  returning * into created_onboarding;

  insert into dozeclin.anamnesis_forms (
    clinic_id,
    patient_id,
    form_type,
    answers,
    status
  )
  values (
    target_request.clinic_id,
    created_patient.id,
    'initial',
    '{}'::jsonb,
    'draft'
  )
  returning * into created_anamnesis;

  update dozeclin.patient_requests
  set patient_id = created_patient.id,
      converted_patient_id = created_patient.id,
      status = 'converted',
      converted_at = now(),
      updated_at = now()
  where id = target_request.id
  returning * into target_request;

  insert into dozeclin.audit_logs (clinic_id, user_id, action, entity, entity_id, new_data)
  values (
    target_request.clinic_id,
    null,
    'patient_journey.started',
    'patient_requests',
    target_request.id,
    jsonb_build_object(
      'patient_id', created_patient.id,
      'profile_id', created_profile.id,
      'portal_id', created_portal.id,
      'onboarding_id', created_onboarding.id,
      'anamnesis_id', created_anamnesis.id
    )
  );

  return jsonb_build_object(
    'request_id', target_request.id,
    'patient_id', created_patient.id,
    'profile_id', created_profile.id,
    'portal_id', created_portal.id,
    'onboarding_id', created_onboarding.id,
    'anamnesis_id', created_anamnesis.id
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
    'anamnesis', to_jsonb(af)
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
  where p.id = current_patient;

  return payload;
end;
$$;

create or replace function dozeclin.complete_patient_profile(
  p_profile jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = dozeclin, auth
as $$
declare
  current_patient uuid;
  current_onboarding dozeclin.patient_onboarding;
  updated_patient dozeclin.patients;
  updated_onboarding dozeclin.patient_onboarding;
begin
  current_patient := dozeclin.current_patient_id();

  if current_patient is null then
    raise exception 'Portal do paciente nao encontrado ou indisponivel.';
  end if;

  select *
  into current_onboarding
  from dozeclin.patient_onboarding
  where patient_id = current_patient
  for update;

  if not found then
    raise exception 'Onboarding nao encontrado.';
  end if;

  if current_onboarding.status = 'completed' then
    raise exception 'Onboarding concluido nao pode ser alterado.';
  end if;

  update dozeclin.patients
  set document = nullif(trim(coalesce(p_profile->>'document', '')), ''),
      birth_date = nullif(p_profile->>'birth_date', '')::date,
      sex = nullif(trim(coalesce(p_profile->>'sex', '')), ''),
      marital_status = nullif(trim(coalesce(p_profile->>'marital_status', '')), ''),
      profession = nullif(trim(coalesce(p_profile->>'profession', '')), ''),
      address = nullif(trim(coalesce(p_profile->>'address', '')), ''),
      city = nullif(trim(coalesce(p_profile->>'city', '')), ''),
      postal_code = nullif(trim(coalesce(p_profile->>'postal_code', '')), ''),
      emergency_contact_name = nullif(trim(coalesce(p_profile->>'emergency_contact_name', '')), ''),
      emergency_contact_phone = nullif(trim(coalesce(p_profile->>'emergency_contact_phone', '')), ''),
      profile_completed_at = now(),
      updated_at = now()
  where id = current_patient
  returning * into updated_patient;

  update dozeclin.patient_onboarding
  set status = 'in_progress',
      current_step = 'anamnesis',
      profile_completed_at = coalesce(profile_completed_at, now()),
      updated_at = now()
  where patient_id = current_patient
  returning * into updated_onboarding;

  insert into dozeclin.audit_logs (clinic_id, user_id, action, entity, entity_id, new_data)
  values (
    updated_patient.clinic_id,
    auth.uid(),
    'patient_profile.completed',
    'patients',
    updated_patient.id,
    jsonb_build_object('profile_completed_at', updated_patient.profile_completed_at)
  );

  return jsonb_build_object(
    'patient', to_jsonb(updated_patient),
    'onboarding', to_jsonb(updated_onboarding)
  );
end;
$$;

drop function if exists dozeclin.save_patient_anamnesis_step(text, jsonb, boolean);

create or replace function dozeclin.save_patient_anamnesis_step(
  p_section text,
  p_answers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = dozeclin, auth
as $$
declare
  current_patient uuid;
  current_onboarding dozeclin.patient_onboarding;
  existing_form dozeclin.anamnesis_forms;
  saved_form dozeclin.anamnesis_forms;
begin
  current_patient := dozeclin.current_patient_id();

  if current_patient is null then
    raise exception 'Portal do paciente nao encontrado ou indisponivel.';
  end if;

  select *
  into current_onboarding
  from dozeclin.patient_onboarding
  where patient_id = current_patient
  for update;

  if not found or current_onboarding.profile_completed_at is null or current_onboarding.current_step <> 'anamnesis' then
    raise exception 'Complete o cadastro antes de preencher a anamnese.';
  end if;

  if current_onboarding.status = 'completed' then
    raise exception 'Onboarding concluido nao pode ser alterado.';
  end if;

  select *
  into existing_form
  from dozeclin.anamnesis_forms
  where patient_id = current_patient
    and form_type = 'initial'
  order by created_at desc
  limit 1
  for update;

  if found and existing_form.status <> 'draft' then
    raise exception 'A anamnese concluida nao pode ser alterada.';
  end if;

  if not found then
    insert into dozeclin.anamnesis_forms (
      clinic_id,
      patient_id,
      form_type,
      answers,
      status
    )
    select clinic_id, id, 'initial', jsonb_build_object(p_section, coalesce(p_answers, '{}'::jsonb)), 'draft'
    from dozeclin.patients
    where id = current_patient
    returning * into saved_form;
  else
    update dozeclin.anamnesis_forms
    set answers = coalesce(answers, '{}'::jsonb)
        || jsonb_build_object(p_section, coalesce(p_answers, '{}'::jsonb)),
        updated_at = now()
    where id = existing_form.id
    returning * into saved_form;
  end if;

  update dozeclin.patient_onboarding
  set status = 'in_progress',
      current_step = 'anamnesis',
      anamnesis_started_at = coalesce(anamnesis_started_at, now()),
      updated_at = now()
  where patient_id = current_patient;

  return jsonb_build_object('anamnesis', to_jsonb(saved_form));
end;
$$;

create or replace function dozeclin.complete_patient_anamnesis()
returns jsonb
language plpgsql
security definer
set search_path = dozeclin, auth
as $$
declare
  current_patient uuid;
  current_onboarding dozeclin.patient_onboarding;
  current_form dozeclin.anamnesis_forms;
  completed_form dozeclin.anamnesis_forms;
  completed_onboarding dozeclin.patient_onboarding;
begin
  current_patient := dozeclin.current_patient_id();

  if current_patient is null then
    raise exception 'Portal do paciente nao encontrado ou indisponivel.';
  end if;

  select *
  into current_onboarding
  from dozeclin.patient_onboarding
  where patient_id = current_patient
  for update;

  if not found or current_onboarding.profile_completed_at is null or current_onboarding.current_step <> 'anamnesis' then
    raise exception 'Complete o cadastro antes de concluir a anamnese.';
  end if;

  if current_onboarding.status = 'completed' then
    raise exception 'Onboarding ja concluido.';
  end if;

  select *
  into current_form
  from dozeclin.anamnesis_forms
  where patient_id = current_patient
    and form_type = 'initial'
  order by created_at desc
  limit 1
  for update;

  if not found or current_form.status <> 'draft' or current_form.answers = '{}'::jsonb then
    raise exception 'Preencha a anamnese antes de concluir.';
  end if;

  update dozeclin.anamnesis_forms
  set status = 'completed',
      completed_at = now(),
      updated_at = now()
  where id = current_form.id
  returning * into completed_form;

  update dozeclin.patient_onboarding
  set status = 'completed',
      current_step = 'completed',
      anamnesis_completed_at = now(),
      completed_at = now(),
      updated_at = now()
  where id = current_onboarding.id
  returning * into completed_onboarding;

  insert into dozeclin.audit_logs (clinic_id, user_id, action, entity, entity_id, new_data)
  values
    (completed_form.clinic_id, auth.uid(), 'patient_anamnesis.completed', 'anamnesis_forms', completed_form.id, jsonb_build_object('completed_at', completed_form.completed_at)),
    (completed_form.clinic_id, auth.uid(), 'patient_onboarding.completed', 'patient_onboarding', completed_onboarding.id, jsonb_build_object('completed_at', completed_onboarding.completed_at));

  return jsonb_build_object(
    'anamnesis', to_jsonb(completed_form),
    'onboarding', to_jsonb(completed_onboarding)
  );
end;
$$;

alter table dozeclin.patient_requests enable row level security;
alter table dozeclin.patient_portals enable row level security;
alter table dozeclin.patient_onboarding enable row level security;

drop policy if exists "patient_requests_select_staff" on dozeclin.patient_requests;
create policy "patient_requests_select_staff" on dozeclin.patient_requests
for select using (dozeclin.is_clinic_staff(clinic_id));

drop policy if exists "patient_requests_update_staff" on dozeclin.patient_requests;

drop policy if exists "patients_select_self" on dozeclin.patients;
create policy "patients_select_self" on dozeclin.patients
for select using (dozeclin.is_patient_self(id));

drop policy if exists "patient_portals_select_staff_or_self" on dozeclin.patient_portals;
create policy "patient_portals_select_staff_or_self" on dozeclin.patient_portals
for select using (dozeclin.is_clinic_staff(clinic_id) or dozeclin.is_patient_self(patient_id));

drop policy if exists "patient_onboarding_select_staff_or_self" on dozeclin.patient_onboarding;
create policy "patient_onboarding_select_staff_or_self" on dozeclin.patient_onboarding
for select using (dozeclin.is_clinic_staff(clinic_id) or dozeclin.is_patient_self(patient_id));

drop policy if exists "anamnesis_select_patient_self" on dozeclin.anamnesis_forms;
create policy "anamnesis_select_patient_self" on dozeclin.anamnesis_forms
for select using (dozeclin.is_patient_self(patient_id));

grant select on dozeclin.patient_requests to authenticated;
grant select on dozeclin.patient_portals to authenticated;
grant select on dozeclin.patient_onboarding to authenticated;

revoke execute on function dozeclin.submit_patient_request(text, text, text, text, text, text, boolean, text, timestamptz) from public;
revoke execute on function dozeclin.current_patient_id() from public, anon;
revoke execute on function dozeclin.is_patient_self(uuid) from public, anon;
revoke execute on function dozeclin.patient_portal_is_available(uuid) from public, anon;
revoke execute on function dozeclin.protect_patient_request_integrity() from public, anon, authenticated;
revoke execute on function dozeclin.protect_patient_onboarding_integrity() from public, anon, authenticated;
revoke execute on function dozeclin.assert_patient_request_transition(dozeclin.patient_request_status, dozeclin.patient_request_status) from public, anon, authenticated;
revoke execute on function dozeclin.apply_patient_request_transition(uuid, dozeclin.patient_request_status, text) from public, anon, authenticated;
revoke execute on function dozeclin.mark_patient_request_contacted(uuid) from public, anon;
revoke execute on function dozeclin.qualify_patient_request(uuid) from public, anon;
revoke execute on function dozeclin.close_patient_request(uuid, text) from public, anon;
revoke execute on function dozeclin.start_patient_journey_transaction(uuid, uuid) from public, anon, authenticated;
revoke execute on function dozeclin.get_patient_portal_context() from public, anon;
revoke execute on function dozeclin.complete_patient_profile(jsonb) from public, anon;
revoke execute on function dozeclin.save_patient_anamnesis_step(text, jsonb) from public, anon;
revoke execute on function dozeclin.complete_patient_anamnesis() from public, anon;

grant execute on function dozeclin.submit_patient_request(text, text, text, text, text, text, boolean, text, timestamptz) to anon, authenticated;
grant execute on function dozeclin.mark_patient_request_contacted(uuid) to authenticated;
grant execute on function dozeclin.qualify_patient_request(uuid) to authenticated;
grant execute on function dozeclin.close_patient_request(uuid, text) to authenticated;
grant execute on function dozeclin.get_patient_portal_context() to authenticated;
grant execute on function dozeclin.complete_patient_profile(jsonb) to authenticated;
grant execute on function dozeclin.save_patient_anamnesis_step(text, jsonb) to authenticated;
grant execute on function dozeclin.complete_patient_anamnesis() to authenticated;

grant all privileges on dozeclin.patient_requests to service_role;
grant all privileges on dozeclin.patient_portals to service_role;
grant all privileges on dozeclin.patient_onboarding to service_role;
grant execute on function dozeclin.start_patient_journey_transaction(uuid, uuid) to service_role;
grant execute on function dozeclin.current_patient_id() to authenticated, service_role;
grant execute on function dozeclin.is_patient_self(uuid) to authenticated, service_role;
grant execute on function dozeclin.patient_portal_is_available(uuid) to authenticated, service_role;

commit;
