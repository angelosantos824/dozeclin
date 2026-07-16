begin;

alter table dozeclin.appointments
  add column if not exists rescheduled_to_appointment_id uuid,
  add column if not exists rescheduled_from_appointment_id uuid,
  add column if not exists rescheduled_at timestamptz,
  add column if not exists rescheduled_by uuid references dozeclin.profiles(id) on delete set null,
  add column if not exists reschedule_reason text;

do $$
begin
  alter table dozeclin.appointments
    add constraint appointments_rescheduled_to_appointment_id_fkey
    foreign key (rescheduled_to_appointment_id)
    references dozeclin.appointments(id)
    on delete set null;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table dozeclin.appointments
    add constraint appointments_rescheduled_from_appointment_id_fkey
    foreign key (rescheduled_from_appointment_id)
    references dozeclin.appointments(id)
    on delete restrict;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table dozeclin.appointments
    add constraint appointments_reschedule_not_self
    check (
      id is distinct from rescheduled_to_appointment_id
      and id is distinct from rescheduled_from_appointment_id
    );
exception
  when duplicate_object then null;
end $$;

create unique index if not exists idx_dozeclin_appointments_one_reschedule_successor
on dozeclin.appointments(rescheduled_to_appointment_id)
where rescheduled_to_appointment_id is not null;

create unique index if not exists idx_dozeclin_appointments_one_reschedule_origin
on dozeclin.appointments(rescheduled_from_appointment_id)
where rescheduled_from_appointment_id is not null;

create index if not exists idx_dozeclin_appointments_rescheduled_from
on dozeclin.appointments(rescheduled_from_appointment_id);

create index if not exists idx_dozeclin_appointments_rescheduled_to
on dozeclin.appointments(rescheduled_to_appointment_id);

create or replace function dozeclin.protect_appointment_reschedule_links()
returns trigger
language plpgsql
security definer
set search_path = dozeclin, auth
as $$
begin
  if new.rescheduled_to_appointment_id = new.id
    or new.rescheduled_from_appointment_id = new.id then
    raise exception 'Appointment nao pode apontar para si proprio.';
  end if;

  if new.rescheduled_to_appointment_id is not null
    and new.rescheduled_to_appointment_id is not distinct from new.rescheduled_from_appointment_id then
    raise exception 'Appointment nao pode ter predecessor e sucessor iguais.';
  end if;

  if new.rescheduled_from_appointment_id is not null and exists (
    select 1
    from dozeclin.appointments previous
    where previous.id = new.rescheduled_from_appointment_id
      and previous.rescheduled_from_appointment_id = new.id
  ) then
    raise exception 'Ciclo de remarcacao invalido.';
  end if;

  if new.rescheduled_to_appointment_id is not null and exists (
    select 1
    from dozeclin.appointments next_appointment
    where next_appointment.id = new.rescheduled_to_appointment_id
      and next_appointment.rescheduled_to_appointment_id = new.id
  ) then
    raise exception 'Ciclo de remarcacao invalido.';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_appointment_reschedule_links_before_write on dozeclin.appointments;
create trigger protect_appointment_reschedule_links_before_write
before insert or update on dozeclin.appointments
for each row execute function dozeclin.protect_appointment_reschedule_links();

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
      and existing.id <> coalesce(new.rescheduled_from_appointment_id, gen_random_uuid())
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
  if p_next_status = 'rescheduled' then
    raise exception 'Utilize o fluxo completo de reagendamento.';
  end if;

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

revoke execute on function dozeclin.reschedule_appointment(uuid) from public, anon, authenticated;
drop function if exists dozeclin.reschedule_appointment(uuid);

create or replace function dozeclin.reschedule_appointment(
  p_appointment_id uuid,
  p_new_local_date date,
  p_new_local_time time,
  p_expected_duration integer,
  p_professional_id uuid,
  p_modality text,
  p_meeting_url text default null,
  p_room text default null,
  p_public_notes text default null,
  p_internal_notes text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = dozeclin, auth
as $$
declare
  current_profile dozeclin.profiles;
  target_clinic dozeclin.clinics;
  original dozeclin.appointments;
  target_patient dozeclin.patients;
  scheduled_start_value timestamptz;
  scheduled_end_value timestamptz;
  created_appointment dozeclin.appointments;
  updated_original dozeclin.appointments;
begin
  select *
  into current_profile
  from dozeclin.profiles
  where auth_user_id = auth.uid()
    and status = 'active'
    and role in ('clinic_admin', 'reception', 'professional', 'supervisor')
  limit 1;

  if not found then
    raise exception 'Apenas a equipa da clinica pode remarcar sessoes.';
  end if;

  select *
  into original
  from dozeclin.appointments
  where id = p_appointment_id
    and clinic_id = current_profile.clinic_id
  for update;

  if not found then
    raise exception 'Appointment nao encontrado.';
  end if;

  select *
  into target_clinic
  from dozeclin.clinics
  where id = original.clinic_id
  for update;

  if not found or target_clinic.status not in ('trial', 'active') then
    raise exception 'Clinica indisponivel para remarcar sessoes.';
  end if;

  if original.status not in ('scheduled', 'confirmed') then
    raise exception 'Apenas sessoes agendadas ou confirmadas podem ser remarcadas.';
  end if;

  if original.rescheduled_to_appointment_id is not null then
    raise exception 'Appointment ja possui sucessor de remarcacao.';
  end if;

  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'Informe o motivo da remarcacao.';
  end if;

  if not dozeclin.can_manage_appointment(original.clinic_id, original.professional_id) then
    raise exception 'Utilizador sem permissao para este Appointment.';
  end if;

  if not dozeclin.can_manage_appointment(original.clinic_id, p_professional_id) then
    raise exception 'Utilizador sem permissao para o novo profissional.';
  end if;

  select *
  into target_patient
  from dozeclin.patients
  where id = original.patient_id
    and clinic_id = original.clinic_id
    and status <> 'archived';

  if not found then
    raise exception 'Paciente invalido para esta clinica.';
  end if;

  if not exists (
    select 1
    from dozeclin.profiles p
    where p.id = p_professional_id
      and p.clinic_id = original.clinic_id
      and p.status = 'active'
      and p.role in ('professional', 'supervisor', 'clinic_admin')
  ) then
    raise exception 'Profissional invalido para esta clinica.';
  end if;

  perform dozeclin.assert_valid_iana_timezone(original.clinic_timezone);
  perform dozeclin.assert_valid_iana_timezone(coalesce(target_patient.timezone, original.patient_timezone_snapshot));

  scheduled_start_value := (p_new_local_date + p_new_local_time) at time zone original.clinic_timezone;
  scheduled_end_value := scheduled_start_value + make_interval(mins => p_expected_duration);

  if exists (
    select 1
    from dozeclin.appointments existing
    where existing.id <> original.id
      and existing.clinic_id = original.clinic_id
      and existing.professional_id = p_professional_id
      and existing.status in ('scheduled', 'confirmed', 'checked_in', 'in_progress')
      and existing.scheduled_start < scheduled_end_value
      and existing.scheduled_end > scheduled_start_value
  ) then
    raise exception 'O profissional ja possui uma consulta neste periodo.';
  end if;

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
    updated_by,
    rescheduled_from_appointment_id
  )
  values (
    original.clinic_id,
    original.patient_id,
    p_professional_id,
    p_new_local_date,
    p_new_local_time,
    (p_new_local_time + make_interval(mins => p_expected_duration))::time,
    'scheduled',
    p_modality,
    nullif(trim(coalesce(p_internal_notes, original.internal_notes, '')), ''),
    scheduled_start_value,
    scheduled_end_value,
    original.clinic_timezone,
    coalesce(target_patient.timezone, original.patient_timezone_snapshot),
    nullif(trim(coalesce(p_meeting_url, '')), ''),
    case when p_modality = 'online' then 'google_meet' else null end,
    p_modality,
    p_expected_duration,
    nullif(trim(coalesce(p_room, '')), ''),
    nullif(trim(coalesce(p_public_notes, original.public_notes, '')), ''),
    nullif(trim(coalesce(p_internal_notes, original.internal_notes, '')), ''),
    current_profile.id,
    current_profile.id,
    original.id
  )
  returning * into created_appointment;

  update dozeclin.appointments
  set status = 'rescheduled',
      rescheduled_to_appointment_id = created_appointment.id,
      rescheduled_at = now(),
      rescheduled_by = current_profile.id,
      reschedule_reason = trim(p_reason),
      updated_by = current_profile.id,
      updated_at = now()
  where id = original.id
  returning * into updated_original;

  insert into dozeclin.audit_logs (clinic_id, user_id, action, entity, entity_id, previous_data, new_data)
  values (
    original.clinic_id,
    auth.uid(),
    'appointment.rescheduled',
    'appointments',
    original.id,
    jsonb_build_object('status', original.status, 'scheduled_start', original.scheduled_start),
    jsonb_build_object(
      'status', updated_original.status,
      'rescheduled_to_appointment_id', created_appointment.id,
      'new_scheduled_start', created_appointment.scheduled_start
    )
  );

  return jsonb_build_object(
    'original', to_jsonb(updated_original),
    'appointment', to_jsonb(created_appointment)
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
      select
        a.*,
        pr.full_name as professional_name,
        pr.specialty as professional_specialty,
        successor.scheduled_start as rescheduled_to_scheduled_start,
        successor.clinic_timezone as rescheduled_to_clinic_timezone
      from dozeclin.appointments a
      left join dozeclin.profiles pr on pr.id = a.professional_id
      left join dozeclin.appointments successor on successor.id = a.rescheduled_to_appointment_id
      where a.patient_id = p.id
      order by a.scheduled_start desc
      limit 20
    ) row_data
  ) appointments on true
  where p.id = current_patient;

  return payload;
end;
$$;

revoke execute on function dozeclin.protect_appointment_reschedule_links() from public, anon, authenticated;
revoke execute on function dozeclin.change_appointment_status(uuid, dozeclin.appointment_status) from public, anon, authenticated;
revoke execute on function dozeclin.reschedule_appointment(uuid, date, time, integer, uuid, text, text, text, text, text, text) from public, anon;
revoke execute on function dozeclin.confirm_appointment(uuid) from public, anon;
revoke execute on function dozeclin.check_in_appointment(uuid) from public, anon;
revoke execute on function dozeclin.start_appointment(uuid) from public, anon;
revoke execute on function dozeclin.complete_appointment(uuid) from public, anon;
revoke execute on function dozeclin.mark_appointment_no_show(uuid) from public, anon;
revoke execute on function dozeclin.cancel_appointment_by_patient(uuid) from public, anon;
revoke execute on function dozeclin.cancel_appointment_by_clinic(uuid) from public, anon;
revoke execute on function dozeclin.archive_appointment(uuid) from public, anon;

grant execute on function dozeclin.reschedule_appointment(uuid, date, time, integer, uuid, text, text, text, text, text, text) to authenticated;
grant execute on function dozeclin.confirm_appointment(uuid) to authenticated;
grant execute on function dozeclin.check_in_appointment(uuid) to authenticated;
grant execute on function dozeclin.start_appointment(uuid) to authenticated;
grant execute on function dozeclin.complete_appointment(uuid) to authenticated;
grant execute on function dozeclin.mark_appointment_no_show(uuid) to authenticated;
grant execute on function dozeclin.cancel_appointment_by_patient(uuid) to authenticated;
grant execute on function dozeclin.cancel_appointment_by_clinic(uuid) to authenticated;
grant execute on function dozeclin.archive_appointment(uuid) to authenticated;

commit;
