begin;

alter table dozeclin.appointments
  add column if not exists scheduled_start timestamptz,
  add column if not exists scheduled_end timestamptz,
  add column if not exists clinic_timezone text,
  add column if not exists patient_timezone_snapshot text,
  add column if not exists meeting_url text,
  add column if not exists meeting_provider text,
  add column if not exists modality text not null default 'presential',
  add column if not exists expected_duration integer,
  add column if not exists actual_duration integer,
  add column if not exists room text,
  add column if not exists public_notes text,
  add column if not exists internal_notes text,
  add column if not exists confirmed_at timestamptz,
  add column if not exists checked_in_at timestamptz,
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists archived_at timestamptz,
  add column if not exists updated_by uuid references dozeclin.profiles(id) on delete set null,
  add column if not exists medical_record_id uuid;

update dozeclin.appointments a
set scheduled_start = coalesce(
      scheduled_start,
      (a.appointment_date + a.start_time) at time zone coalesce(c.timezone, 'Europe/Lisbon')
    ),
    scheduled_end = coalesce(
      scheduled_end,
      (a.appointment_date + a.end_time) at time zone coalesce(c.timezone, 'Europe/Lisbon')
    ),
    clinic_timezone = coalesce(a.clinic_timezone, c.timezone, 'Europe/Lisbon'),
    patient_timezone_snapshot = coalesce(a.patient_timezone_snapshot, p.timezone, c.timezone, 'Europe/Lisbon'),
    expected_duration = coalesce(a.expected_duration, greatest(1, extract(epoch from (a.end_time - a.start_time))::integer / 60)),
    modality = coalesce(nullif(a.modality, ''), coalesce(nullif(a.appointment_type, ''), 'presential'))
from dozeclin.clinics c
cross join dozeclin.patients p
where c.id = a.clinic_id
  and p.id = a.patient_id;

alter table dozeclin.appointments
  alter column scheduled_start set not null,
  alter column scheduled_end set not null,
  alter column clinic_timezone set not null,
  alter column patient_timezone_snapshot set not null,
  alter column expected_duration set not null;

do $$
begin
  alter table dozeclin.appointments
    add constraint appointments_modality_check
    check (modality in ('presential', 'online', 'home'));
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table dozeclin.appointments
    add constraint appointments_duration_check
    check (expected_duration between 1 and 720);
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table dozeclin.appointments
    add constraint appointments_scheduled_range_check
    check (scheduled_end > scheduled_start);
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table dozeclin.appointments
    add constraint appointments_medical_record_id_fkey
    foreign key (medical_record_id)
    references dozeclin.medical_records(id)
    on delete set null;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table dozeclin.medical_records
    add constraint medical_records_appointment_required
    check (appointment_id is not null) not valid;
exception
  when duplicate_object then null;
end $$;

create unique index if not exists idx_dozeclin_appointments_medical_record_id
on dozeclin.appointments(medical_record_id)
where medical_record_id is not null;

create unique index if not exists idx_dozeclin_medical_records_appointment_id
on dozeclin.medical_records(appointment_id)
where appointment_id is not null;

create index if not exists idx_dozeclin_appointments_scheduled_start
on dozeclin.appointments(clinic_id, scheduled_start);

create index if not exists idx_dozeclin_appointments_professional_range
on dozeclin.appointments(clinic_id, professional_id, scheduled_start, scheduled_end);

create or replace function dozeclin.assert_valid_iana_timezone(p_timezone text)
returns void
language plpgsql
stable
as $$
begin
  if nullif(trim(coalesce(p_timezone, '')), '') is null then
    raise exception 'Timezone obrigatorio.';
  end if;

  perform now() at time zone p_timezone;
exception
  when invalid_parameter_value then
    raise exception 'Timezone IANA invalido.';
end;
$$;

create or replace function dozeclin.assert_appointment_transition(
  p_current_status dozeclin.appointment_status,
  p_next_status dozeclin.appointment_status
)
returns void
language plpgsql
immutable
as $$
begin
  if p_current_status = p_next_status then
    return;
  end if;

  if p_current_status = 'scheduled'
    and p_next_status in ('confirmed', 'rescheduled', 'cancelled_by_patient', 'cancelled_by_clinic', 'no_show') then
    return;
  end if;

  if p_current_status = 'confirmed'
    and p_next_status in ('checked_in', 'rescheduled', 'cancelled_by_patient', 'cancelled_by_clinic', 'no_show') then
    return;
  end if;

  if p_current_status = 'checked_in' and p_next_status = 'in_progress' then
    return;
  end if;

  if p_current_status = 'in_progress' and p_next_status = 'completed' then
    return;
  end if;

  if p_current_status = 'completed' and p_next_status = 'archived' then
    return;
  end if;

  if p_current_status in ('rescheduled', 'cancelled', 'cancelled_by_patient', 'cancelled_by_clinic', 'no_show', 'archived') then
    raise exception 'Appointment em estado final nao pode retornar.';
  end if;

  raise exception 'Transicao de Appointment invalida.';
end;
$$;

create or replace function dozeclin.protect_appointment_status()
returns trigger
language plpgsql
security definer
set search_path = dozeclin, auth
as $$
begin
  if tg_op = 'UPDATE'
    and old.status is distinct from new.status
    and coalesce(current_setting('dozeclin.appointment_rpc', true), '') <> 'on' then
    raise exception 'Estado do Appointment deve ser alterado por RPC.';
  end if;

  if tg_op = 'UPDATE'
    and old.status in ('rescheduled', 'cancelled', 'cancelled_by_patient', 'cancelled_by_clinic', 'no_show', 'archived')
    and new.status is distinct from old.status then
    raise exception 'Appointment em estado final nao pode retornar.';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_appointment_status_before_update on dozeclin.appointments;
create trigger protect_appointment_status_before_update
before update on dozeclin.appointments
for each row execute function dozeclin.protect_appointment_status();

create or replace function dozeclin.validate_appointment()
returns trigger
language plpgsql
security definer
set search_path = dozeclin, auth
as $$
declare
  active_statuses dozeclin.appointment_status[] := array[
    'scheduled',
    'confirmed',
    'checked_in',
    'in_progress'
  ]::dozeclin.appointment_status[];
begin
  if new.clinic_id is null then
    raise exception 'Consulta sem clinica.';
  end if;

  if new.patient_id is null then
    raise exception 'Consulta sem paciente.';
  end if;

  if new.professional_id is null then
    raise exception 'Consulta sem profissional.';
  end if;

  if new.scheduled_end <= new.scheduled_start then
    raise exception 'O horario final deve ser posterior ao horario inicial.';
  end if;

  if new.end_time <= new.start_time then
    raise exception 'O horario final deve ser posterior ao horario inicial.';
  end if;

  perform dozeclin.assert_valid_iana_timezone(new.clinic_timezone);
  perform dozeclin.assert_valid_iana_timezone(new.patient_timezone_snapshot);

  if new.modality not in ('presential', 'online', 'home') then
    raise exception 'Modalidade invalida.';
  end if;

  if new.modality = 'online' and nullif(trim(coalesce(new.meeting_url, '')), '') is null then
    raise exception 'Link da sessao online obrigatorio.';
  end if;

  if not exists (
    select 1 from dozeclin.patients
    where id = new.patient_id
      and clinic_id = new.clinic_id
      and status <> 'archived'
  ) then
    raise exception 'Paciente invalido para esta clinica.';
  end if;

  if not exists (
    select 1 from dozeclin.profiles
    where id = new.professional_id
      and clinic_id = new.clinic_id
      and status = 'active'
      and role in ('professional', 'supervisor', 'clinic_admin')
  ) then
    raise exception 'Profissional invalido para esta clinica.';
  end if;

  if new.status = any(active_statuses) and exists (
    select 1
    from dozeclin.appointments existing
    where existing.id <> coalesce(new.id, gen_random_uuid())
      and existing.clinic_id = new.clinic_id
      and existing.professional_id = new.professional_id
      and existing.status = any(active_statuses)
      and existing.scheduled_start < new.scheduled_end
      and existing.scheduled_end > new.scheduled_start
  ) then
    raise exception 'O profissional ja possui uma consulta neste periodo.';
  end if;

  if new.status = 'completed'
    and not (
      dozeclin.current_profile_role() in ('clinic_admin', 'supervisor')
      or (
        dozeclin.current_profile_role() = 'professional'
        and new.professional_id = dozeclin.current_profile_id()
      )
    ) then
    raise exception 'Utilizador sem permissao para concluir consulta.';
  end if;

  return new;
end;
$$;

create or replace function dozeclin.create_appointment(
  p_patient_id uuid,
  p_professional_id uuid,
  p_local_date date,
  p_local_time time,
  p_expected_duration integer,
  p_clinic_timezone text,
  p_patient_timezone text,
  p_modality text,
  p_meeting_url text default null,
  p_room text default null,
  p_public_notes text default null,
  p_internal_notes text default null
)
returns dozeclin.appointments
language plpgsql
security definer
set search_path = dozeclin, auth
as $$
declare
  current_profile dozeclin.profiles;
  target_patient dozeclin.patients;
  scheduled_start_value timestamptz;
  scheduled_end_value timestamptz;
  saved dozeclin.appointments;
begin
  select *
  into current_profile
  from dozeclin.profiles
  where auth_user_id = auth.uid()
    and status = 'active'
    and role in ('clinic_admin', 'reception', 'professional', 'supervisor')
  limit 1;

  if not found then
    raise exception 'Apenas a equipa da clinica pode agendar sessoes.';
  end if;

  if not dozeclin.can_manage_appointment(current_profile.clinic_id, p_professional_id) then
    raise exception 'Utilizador sem permissao para este profissional.';
  end if;

  select *
  into target_patient
  from dozeclin.patients
  where id = p_patient_id
    and clinic_id = current_profile.clinic_id
    and status <> 'archived';

  if not found then
    raise exception 'Paciente invalido para esta clinica.';
  end if;

  perform dozeclin.assert_valid_iana_timezone(p_clinic_timezone);
  perform dozeclin.assert_valid_iana_timezone(p_patient_timezone);

  scheduled_start_value := (p_local_date + p_local_time) at time zone p_clinic_timezone;
  scheduled_end_value := scheduled_start_value + make_interval(mins => p_expected_duration);

  set local dozeclin.appointment_rpc = 'on';

  insert into dozeclin.appointments (
    clinic_id,
    patient_id,
    professional_id,
    appointment_date,
    start_time,
    end_time,
    status,
    appointment_type,
    notes,
    scheduled_start,
    scheduled_end,
    clinic_timezone,
    patient_timezone_snapshot,
    meeting_url,
    meeting_provider,
    modality,
    expected_duration,
    room,
    public_notes,
    internal_notes,
    created_by,
    updated_by
  )
  values (
    current_profile.clinic_id,
    target_patient.id,
    p_professional_id,
    p_local_date,
    p_local_time,
    (p_local_time + make_interval(mins => p_expected_duration))::time,
    'scheduled',
    p_modality,
    nullif(trim(coalesce(p_internal_notes, '')), ''),
    scheduled_start_value,
    scheduled_end_value,
    p_clinic_timezone,
    p_patient_timezone,
    nullif(trim(coalesce(p_meeting_url, '')), ''),
    case when p_modality = 'online' then 'google_meet' else null end,
    p_modality,
    p_expected_duration,
    nullif(trim(coalesce(p_room, '')), ''),
    nullif(trim(coalesce(p_public_notes, '')), ''),
    nullif(trim(coalesce(p_internal_notes, '')), ''),
    current_profile.id,
    current_profile.id
  )
  returning * into saved;

  insert into dozeclin.audit_logs (clinic_id, user_id, action, entity, entity_id, new_data)
  values (
    saved.clinic_id,
    auth.uid(),
    'appointment.created',
    'appointments',
    saved.id,
    jsonb_build_object(
      'status', saved.status,
      'scheduled_start', saved.scheduled_start,
      'scheduled_end', saved.scheduled_end,
      'modality', saved.modality
    )
  );

  return saved;
end;
$$;

create or replace function dozeclin.update_appointment_details(
  p_appointment_id uuid,
  p_patient_id uuid,
  p_professional_id uuid,
  p_local_date date,
  p_local_time time,
  p_expected_duration integer,
  p_clinic_timezone text,
  p_patient_timezone text,
  p_modality text,
  p_meeting_url text default null,
  p_room text default null,
  p_public_notes text default null,
  p_internal_notes text default null
)
returns dozeclin.appointments
language plpgsql
security definer
set search_path = dozeclin, auth
as $$
declare
  current_profile dozeclin.profiles;
  current_appointment dozeclin.appointments;
  scheduled_start_value timestamptz;
  scheduled_end_value timestamptz;
  saved dozeclin.appointments;
begin
  select *
  into current_profile
  from dozeclin.profiles
  where auth_user_id = auth.uid()
    and status = 'active'
    and role in ('clinic_admin', 'reception', 'professional', 'supervisor')
  limit 1;

  if not found then
    raise exception 'Apenas a equipa da clinica pode atualizar sessoes.';
  end if;

  select *
  into current_appointment
  from dozeclin.appointments
  where id = p_appointment_id
    and clinic_id = current_profile.clinic_id
  for update;

  if not found then
    raise exception 'Appointment nao encontrado.';
  end if;

  if current_appointment.status not in ('scheduled', 'confirmed') then
    raise exception 'Apenas sessoes agendadas ou confirmadas podem ser atualizadas.';
  end if;

  if not dozeclin.can_manage_appointment(current_profile.clinic_id, p_professional_id) then
    raise exception 'Utilizador sem permissao para este profissional.';
  end if;

  if not exists (
    select 1
    from dozeclin.patients
    where id = p_patient_id
      and clinic_id = current_profile.clinic_id
      and status <> 'archived'
  ) then
    raise exception 'Paciente invalido para esta clinica.';
  end if;

  perform dozeclin.assert_valid_iana_timezone(p_clinic_timezone);
  perform dozeclin.assert_valid_iana_timezone(p_patient_timezone);

  scheduled_start_value := (p_local_date + p_local_time) at time zone p_clinic_timezone;
  scheduled_end_value := scheduled_start_value + make_interval(mins => p_expected_duration);

  set local dozeclin.appointment_rpc = 'on';

  update dozeclin.appointments
  set patient_id = p_patient_id,
      professional_id = p_professional_id,
      appointment_date = p_local_date,
      start_time = p_local_time,
      end_time = (p_local_time + make_interval(mins => p_expected_duration))::time,
      appointment_type = p_modality,
      notes = nullif(trim(coalesce(p_internal_notes, '')), ''),
      scheduled_start = scheduled_start_value,
      scheduled_end = scheduled_end_value,
      clinic_timezone = p_clinic_timezone,
      patient_timezone_snapshot = p_patient_timezone,
      meeting_url = nullif(trim(coalesce(p_meeting_url, '')), ''),
      meeting_provider = case when p_modality = 'online' then 'google_meet' else null end,
      modality = p_modality,
      expected_duration = p_expected_duration,
      room = nullif(trim(coalesce(p_room, '')), ''),
      public_notes = nullif(trim(coalesce(p_public_notes, '')), ''),
      internal_notes = nullif(trim(coalesce(p_internal_notes, '')), ''),
      updated_by = current_profile.id,
      updated_at = now()
  where id = current_appointment.id
  returning * into saved;

  insert into dozeclin.audit_logs (clinic_id, user_id, action, entity, entity_id, previous_data, new_data)
  values (
    saved.clinic_id,
    auth.uid(),
    'appointment.updated',
    'appointments',
    saved.id,
    jsonb_build_object('scheduled_start', current_appointment.scheduled_start, 'scheduled_end', current_appointment.scheduled_end),
    jsonb_build_object('scheduled_start', saved.scheduled_start, 'scheduled_end', saved.scheduled_end)
  );

  return saved;
end;
$$;

create or replace function dozeclin.change_appointment_status(
  p_appointment_id uuid,
  p_next_status dozeclin.appointment_status
)
returns dozeclin.appointments
language plpgsql
security definer
set search_path = dozeclin, auth
as $$
declare
  current_profile dozeclin.profiles;
  current_appointment dozeclin.appointments;
  saved dozeclin.appointments;
  draft_record dozeclin.medical_records;
  audit_action text;
begin
  select *
  into current_profile
  from dozeclin.profiles
  where auth_user_id = auth.uid()
    and status = 'active'
    and role in ('clinic_admin', 'reception', 'professional', 'supervisor')
  limit 1;

  if not found then
    raise exception 'Apenas a equipa da clinica pode alterar sessoes.';
  end if;

  select *
  into current_appointment
  from dozeclin.appointments
  where id = p_appointment_id
    and clinic_id = current_profile.clinic_id
  for update;

  if not found then
    raise exception 'Appointment nao encontrado.';
  end if;

  if not dozeclin.can_manage_appointment(current_appointment.clinic_id, current_appointment.professional_id) then
    raise exception 'Utilizador sem permissao para este Appointment.';
  end if;

  perform dozeclin.assert_appointment_transition(current_appointment.status, p_next_status);

  set local dozeclin.appointment_rpc = 'on';

  update dozeclin.appointments
  set status = p_next_status,
      confirmed_at = case when p_next_status = 'confirmed' then coalesce(confirmed_at, now()) else confirmed_at end,
      checked_in_at = case when p_next_status = 'checked_in' then coalesce(checked_in_at, now()) else checked_in_at end,
      started_at = case when p_next_status = 'in_progress' then coalesce(started_at, now()) else started_at end,
      completed_at = case when p_next_status = 'completed' then coalesce(completed_at, now()) else completed_at end,
      cancelled_at = case when p_next_status in ('cancelled_by_patient', 'cancelled_by_clinic') then coalesce(cancelled_at, now()) else cancelled_at end,
      archived_at = case when p_next_status = 'archived' then coalesce(archived_at, now()) else archived_at end,
      actual_duration = case
        when p_next_status = 'completed' and started_at is not null
          then greatest(1, extract(epoch from (now() - started_at))::integer / 60)
        else actual_duration
      end,
      updated_by = current_profile.id,
      updated_at = now()
  where id = current_appointment.id
  returning * into saved;

  if p_next_status = 'completed' and saved.medical_record_id is null then
    insert into dozeclin.medical_records (
      clinic_id,
      patient_id,
      professional_id,
      appointment_id,
      record_type,
      title,
      content,
      record_date,
      status
    )
    values (
      saved.clinic_id,
      saved.patient_id,
      saved.professional_id,
      saved.id,
      'evolution',
      'Rascunho da sessao',
      'Rascunho criado automaticamente a partir do Appointment.',
      saved.completed_at,
      'draft'
    )
    on conflict (appointment_id) where appointment_id is not null do update
    set updated_at = dozeclin.medical_records.updated_at
    returning * into draft_record;

    update dozeclin.appointments
    set medical_record_id = draft_record.id,
        updated_at = now()
    where id = saved.id
    returning * into saved;

    insert into dozeclin.audit_logs (clinic_id, user_id, action, entity, entity_id, new_data)
    values (
      saved.clinic_id,
      auth.uid(),
      'medical_record.created_from_appointment',
      'medical_records',
      draft_record.id,
      jsonb_build_object('appointment_id', saved.id)
    );
  end if;

  audit_action := case
    when p_next_status = 'confirmed' then 'appointment.confirmed'
    when p_next_status = 'checked_in' then 'appointment.checked_in'
    when p_next_status = 'in_progress' then 'appointment.started'
    when p_next_status = 'completed' then 'appointment.completed'
    when p_next_status in ('cancelled_by_patient', 'cancelled_by_clinic') then 'appointment.cancelled'
    when p_next_status = 'rescheduled' then 'appointment.rescheduled'
    when p_next_status = 'no_show' then 'appointment.no_show'
    when p_next_status = 'archived' then 'appointment.archived'
    else 'appointment.updated'
  end;

  insert into dozeclin.audit_logs (clinic_id, user_id, action, entity, entity_id, previous_data, new_data)
  values (
    saved.clinic_id,
    auth.uid(),
    audit_action,
    'appointments',
    saved.id,
    jsonb_build_object('status', current_appointment.status),
    jsonb_build_object('status', saved.status)
  );

  return saved;
end;
$$;

create or replace function dozeclin.confirm_appointment(p_appointment_id uuid)
returns dozeclin.appointments
language sql
security definer
set search_path = dozeclin, auth
as $$
  select dozeclin.change_appointment_status(p_appointment_id, 'confirmed'::dozeclin.appointment_status);
$$;

create or replace function dozeclin.check_in_appointment(p_appointment_id uuid)
returns dozeclin.appointments
language sql
security definer
set search_path = dozeclin, auth
as $$
  select dozeclin.change_appointment_status(p_appointment_id, 'checked_in'::dozeclin.appointment_status);
$$;

create or replace function dozeclin.start_appointment(p_appointment_id uuid)
returns dozeclin.appointments
language sql
security definer
set search_path = dozeclin, auth
as $$
  select dozeclin.change_appointment_status(p_appointment_id, 'in_progress'::dozeclin.appointment_status);
$$;

create or replace function dozeclin.complete_appointment(p_appointment_id uuid)
returns dozeclin.appointments
language sql
security definer
set search_path = dozeclin, auth
as $$
  select dozeclin.change_appointment_status(p_appointment_id, 'completed'::dozeclin.appointment_status);
$$;

create or replace function dozeclin.mark_appointment_no_show(p_appointment_id uuid)
returns dozeclin.appointments
language sql
security definer
set search_path = dozeclin, auth
as $$
  select dozeclin.change_appointment_status(p_appointment_id, 'no_show'::dozeclin.appointment_status);
$$;

create or replace function dozeclin.cancel_appointment_by_patient(p_appointment_id uuid)
returns dozeclin.appointments
language sql
security definer
set search_path = dozeclin, auth
as $$
  select dozeclin.change_appointment_status(p_appointment_id, 'cancelled_by_patient'::dozeclin.appointment_status);
$$;

create or replace function dozeclin.cancel_appointment_by_clinic(p_appointment_id uuid)
returns dozeclin.appointments
language sql
security definer
set search_path = dozeclin, auth
as $$
  select dozeclin.change_appointment_status(p_appointment_id, 'cancelled_by_clinic'::dozeclin.appointment_status);
$$;

create or replace function dozeclin.reschedule_appointment(p_appointment_id uuid)
returns dozeclin.appointments
language sql
security definer
set search_path = dozeclin, auth
as $$
  select dozeclin.change_appointment_status(p_appointment_id, 'rescheduled'::dozeclin.appointment_status);
$$;

create or replace function dozeclin.archive_appointment(p_appointment_id uuid)
returns dozeclin.appointments
language sql
security definer
set search_path = dozeclin, auth
as $$
  select dozeclin.change_appointment_status(p_appointment_id, 'archived'::dozeclin.appointment_status);
$$;

create or replace function dozeclin.update_patient_timezone(p_timezone text)
returns dozeclin.patients
language plpgsql
security definer
set search_path = dozeclin, auth
as $$
declare
  current_patient uuid;
  saved dozeclin.patients;
begin
  perform dozeclin.assert_valid_iana_timezone(p_timezone);
  current_patient := dozeclin.current_patient_id();

  if current_patient is null then
    raise exception 'Portal do paciente nao encontrado ou indisponivel.';
  end if;

  update dozeclin.patients
  set timezone = p_timezone,
      updated_at = now()
  where id = current_patient
  returning * into saved;

  return saved;
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
    'appointments', coalesce(appointments.rows, '[]'::jsonb)
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
  where p.id = current_patient;

  return payload;
end;
$$;

drop policy if exists "appointments_staff_manage" on dozeclin.appointments;
drop policy if exists "appointments_select_staff_or_patient" on dozeclin.appointments;
create policy "appointments_select_staff_or_patient" on dozeclin.appointments
for select using (
  dozeclin.is_clinic_staff(clinic_id)
  or dozeclin.is_patient_self(patient_id)
);

drop policy if exists "appointments_insert_via_rpc" on dozeclin.appointments;
create policy "appointments_insert_via_rpc" on dozeclin.appointments
for insert with check (
  clinic_id = dozeclin.current_clinic_id()
  and dozeclin.can_manage_appointment(clinic_id, professional_id)
  and coalesce(current_setting('dozeclin.appointment_rpc', true), '') = 'on'
);

drop policy if exists "appointments_update_via_rpc" on dozeclin.appointments;
create policy "appointments_update_via_rpc" on dozeclin.appointments
for update using (
  clinic_id = dozeclin.current_clinic_id()
  and dozeclin.can_manage_appointment(clinic_id, professional_id)
) with check (
  clinic_id = dozeclin.current_clinic_id()
  and dozeclin.can_manage_appointment(clinic_id, professional_id)
  and coalesce(current_setting('dozeclin.appointment_rpc', true), '') = 'on'
);

revoke insert, update on dozeclin.appointments from authenticated;

revoke execute on function dozeclin.assert_valid_iana_timezone(text) from public, anon;
revoke execute on function dozeclin.assert_appointment_transition(dozeclin.appointment_status, dozeclin.appointment_status) from public, anon, authenticated;
revoke execute on function dozeclin.protect_appointment_status() from public, anon, authenticated;
revoke execute on function dozeclin.validate_appointment() from public, anon, authenticated;

grant execute on function dozeclin.create_appointment(uuid, uuid, date, time, integer, text, text, text, text, text, text, text) to authenticated;
grant execute on function dozeclin.update_appointment_details(uuid, uuid, uuid, date, time, integer, text, text, text, text, text, text, text) to authenticated;
grant execute on function dozeclin.change_appointment_status(uuid, dozeclin.appointment_status) to authenticated;
grant execute on function dozeclin.confirm_appointment(uuid) to authenticated;
grant execute on function dozeclin.check_in_appointment(uuid) to authenticated;
grant execute on function dozeclin.start_appointment(uuid) to authenticated;
grant execute on function dozeclin.complete_appointment(uuid) to authenticated;
grant execute on function dozeclin.mark_appointment_no_show(uuid) to authenticated;
grant execute on function dozeclin.cancel_appointment_by_patient(uuid) to authenticated;
grant execute on function dozeclin.cancel_appointment_by_clinic(uuid) to authenticated;
grant execute on function dozeclin.reschedule_appointment(uuid) to authenticated;
grant execute on function dozeclin.archive_appointment(uuid) to authenticated;
grant execute on function dozeclin.update_patient_timezone(text) to authenticated;

commit;
