begin;

do $$
begin
  alter type dozeclin.user_status add value if not exists 'pending_invite';
exception
  when duplicate_object then null;
end $$;

alter table dozeclin.profiles
  drop constraint if exists profiles_id_fkey;

alter table dozeclin.profiles
  alter column id set default gen_random_uuid();

alter table dozeclin.profiles
  add column if not exists auth_user_id uuid references auth.users(id) on delete set null;

update dozeclin.profiles
set auth_user_id = id
where auth_user_id is null
  and exists (
    select 1
    from auth.users
    where auth.users.id = dozeclin.profiles.id
  );

create unique index if not exists idx_dozeclin_profiles_auth_user_id
on dozeclin.profiles(auth_user_id)
where auth_user_id is not null;

alter table dozeclin.appointments
  add column if not exists created_by uuid references dozeclin.profiles(id) on delete set null;

create index if not exists idx_dozeclin_appointments_date
on dozeclin.appointments(clinic_id, appointment_date);

create index if not exists idx_dozeclin_appointments_professional_date
on dozeclin.appointments(clinic_id, professional_id, appointment_date, start_time, end_time);

create or replace function dozeclin.current_profile_id()
returns uuid
language sql
security definer
set search_path = dozeclin, auth
stable
as $$
  select id
  from dozeclin.profiles
  where auth_user_id = auth.uid() or id = auth.uid()
  limit 1;
$$;

create or replace function dozeclin.current_profile_role()
returns dozeclin.user_role
language sql
security definer
set search_path = dozeclin, auth
stable
as $$
  select role
  from dozeclin.profiles
  where auth_user_id = auth.uid() or id = auth.uid()
  limit 1;
$$;

create or replace function dozeclin.current_clinic_id()
returns uuid
language sql
security definer
set search_path = dozeclin, auth
stable
as $$
  select clinic_id
  from dozeclin.profiles
  where auth_user_id = auth.uid() or id = auth.uid()
  limit 1;
$$;

create or replace function dozeclin.has_role(allowed_roles dozeclin.user_role[])
returns boolean
language sql
security definer
set search_path = dozeclin, auth
stable
as $$
  select exists (
    select 1
    from dozeclin.profiles
    where (auth_user_id = auth.uid() or id = auth.uid())
      and status = 'active'
      and role = any(allowed_roles)
  );
$$;

create or replace function dozeclin.is_clinic_staff(target_clinic_id uuid)
returns boolean
language sql
security definer
set search_path = dozeclin, auth
stable
as $$
  select exists (
    select 1
    from dozeclin.profiles
    where (auth_user_id = auth.uid() or id = auth.uid())
      and status = 'active'
      and clinic_id = target_clinic_id
      and role in ('clinic_admin', 'reception', 'professional', 'finance', 'supervisor')
  );
$$;

create or replace function dozeclin.can_manage_professionals(target_clinic_id uuid)
returns boolean
language sql
security definer
set search_path = dozeclin, auth
stable
as $$
  select exists (
    select 1
    from dozeclin.profiles
    where (auth_user_id = auth.uid() or id = auth.uid())
      and status = 'active'
      and clinic_id = target_clinic_id
      and role = 'clinic_admin'
  );
$$;

create or replace function dozeclin.can_manage_appointment(target_clinic_id uuid, target_professional_id uuid)
returns boolean
language sql
security definer
set search_path = dozeclin, auth
stable
as $$
  select exists (
    select 1
    from dozeclin.profiles
    where (auth_user_id = auth.uid() or id = auth.uid())
      and status = 'active'
      and clinic_id = target_clinic_id
      and (
        role in ('clinic_admin', 'reception', 'supervisor')
        or (role = 'professional' and id = target_professional_id)
      )
  );
$$;

create or replace function dozeclin.validate_appointment()
returns trigger
language plpgsql
security definer
set search_path = dozeclin, auth
as $$
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

  if new.end_time <= new.start_time then
    raise exception 'O horario final deve ser posterior ao horario inicial.';
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

  if new.status <> 'cancelled' and exists (
    select 1
    from dozeclin.appointments existing
    where existing.id <> coalesce(new.id, gen_random_uuid())
      and existing.clinic_id = new.clinic_id
      and existing.professional_id = new.professional_id
      and existing.appointment_date = new.appointment_date
      and existing.status <> 'cancelled'
      and existing.start_time < new.end_time
      and existing.end_time > new.start_time
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

drop trigger if exists validate_appointment_before_write on dozeclin.appointments;
create trigger validate_appointment_before_write
before insert or update on dozeclin.appointments
for each row execute function dozeclin.validate_appointment();

drop policy if exists "profiles_select_own_clinic" on dozeclin.profiles;
create policy "profiles_select_own_clinic" on dozeclin.profiles
for select using (
  id = dozeclin.current_profile_id()
  or clinic_id = dozeclin.current_clinic_id()
);

drop policy if exists "profiles_update_self_or_admin" on dozeclin.profiles;
create policy "profiles_update_self_or_admin" on dozeclin.profiles
for update using (
  id = dozeclin.current_profile_id()
  or dozeclin.can_manage_professionals(clinic_id)
) with check (clinic_id = dozeclin.current_clinic_id());

drop policy if exists "profiles_insert_admin" on dozeclin.profiles;
create policy "profiles_insert_admin" on dozeclin.profiles
for insert with check (
  clinic_id = dozeclin.current_clinic_id()
  and dozeclin.current_profile_role() = 'clinic_admin'
  and role in ('professional', 'supervisor')
);

drop policy if exists "appointments_staff_manage" on dozeclin.appointments;
create policy "appointments_staff_manage" on dozeclin.appointments
for all using (
  clinic_id = dozeclin.current_clinic_id()
  and (
    dozeclin.current_profile_role() in ('clinic_admin', 'reception', 'supervisor')
    or (
      dozeclin.current_profile_role() = 'professional'
      and professional_id = dozeclin.current_profile_id()
    )
  )
) with check (
  clinic_id = dozeclin.current_clinic_id()
  and dozeclin.can_manage_appointment(clinic_id, professional_id)
);

grant execute on function dozeclin.current_profile_id() to authenticated, service_role;
grant execute on function dozeclin.can_manage_professionals(uuid) to authenticated, service_role;
grant execute on function dozeclin.can_manage_appointment(uuid, uuid) to authenticated, service_role;
grant insert on dozeclin.profiles to authenticated;

commit;
