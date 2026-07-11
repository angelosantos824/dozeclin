begin;

create extension if not exists pgcrypto;
create schema if not exists dozeclin;

do $$
begin
  create type dozeclin.clinic_status as enum ('trial', 'active', 'suspended', 'cancelled');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type dozeclin.user_role as enum (
    'super_admin',
    'clinic_admin',
    'reception',
    'professional',
    'finance',
    'supervisor',
    'patient'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type dozeclin.user_status as enum ('active', 'inactive', 'invited', 'suspended');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type dozeclin.patient_status as enum ('active', 'inactive', 'discharged', 'archived');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type dozeclin.appointment_status as enum (
    'scheduled',
    'confirmed',
    'in_progress',
    'completed',
    'cancelled',
    'no_show'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type dozeclin.anamnesis_status as enum ('draft', 'sent', 'completed', 'reviewed');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type dozeclin.task_status as enum ('pending', 'in_progress', 'completed', 'cancelled');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type dozeclin.financial_entry_type as enum ('income', 'expense');
exception
  when duplicate_object then null;
end $$;

create or replace function dozeclin.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists dozeclin.clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_name text,
  slug text unique not null,
  document text,
  email text,
  phone text,
  whatsapp text,
  country text,
  city text,
  address text,
  postal_code text,
  timezone text not null default 'Europe/Lisbon',
  default_currency text not null default 'EUR',
  logo_url text,
  primary_color text not null default '#176B87',
  secondary_color text not null default '#64CCC5',
  status dozeclin.clinic_status not null default 'trial',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists dozeclin.clinic_settings (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null unique references dozeclin.clinics(id) on delete restrict,
  specialty_label text,
  professional_registration_label text,
  appointment_duration integer not null default 50,
  appointment_interval integer not null default 10,
  cancellation_policy text,
  default_language text not null default 'pt-PT',
  footer_text text,
  watermark_url text,
  email_signature text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists dozeclin.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  clinic_id uuid references dozeclin.clinics(id) on delete restrict,
  full_name text not null,
  email text not null,
  phone text,
  role dozeclin.user_role not null,
  professional_registration text,
  specialty text,
  status dozeclin.user_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists dozeclin.patients (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references dozeclin.clinics(id) on delete restrict,
  full_name text not null,
  email text not null,
  phone text,
  birth_date date,
  document text,
  address text,
  timezone text not null default 'Europe/Lisbon',
  status dozeclin.patient_status not null default 'active',
  access_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists dozeclin.appointments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references dozeclin.clinics(id) on delete restrict,
  patient_id uuid not null references dozeclin.patients(id) on delete restrict,
  professional_id uuid references dozeclin.profiles(id) on delete set null,
  appointment_date date not null,
  start_time time not null,
  end_time time not null,
  status dozeclin.appointment_status not null default 'scheduled',
  appointment_type text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists dozeclin.medical_records (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references dozeclin.clinics(id) on delete restrict,
  patient_id uuid not null references dozeclin.patients(id) on delete restrict,
  professional_id uuid references dozeclin.profiles(id) on delete set null,
  appointment_id uuid references dozeclin.appointments(id) on delete set null,
  title text not null,
  content text not null,
  is_confidential boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists dozeclin.anamnesis_forms (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references dozeclin.clinics(id) on delete restrict,
  patient_id uuid not null references dozeclin.patients(id) on delete restrict,
  professional_id uuid references dozeclin.profiles(id) on delete set null,
  form_type text not null default 'default',
  answers jsonb not null default '{}'::jsonb,
  status dozeclin.anamnesis_status not null default 'draft',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists dozeclin.patient_tasks (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references dozeclin.clinics(id) on delete restrict,
  patient_id uuid not null references dozeclin.patients(id) on delete restrict,
  professional_id uuid references dozeclin.profiles(id) on delete set null,
  title text not null,
  description text,
  start_date date,
  end_date date,
  status dozeclin.task_status not null default 'pending',
  patient_feedback jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists dozeclin.financial_entries (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references dozeclin.clinics(id) on delete restrict,
  patient_id uuid references dozeclin.patients(id) on delete set null,
  appointment_id uuid references dozeclin.appointments(id) on delete set null,
  description text not null,
  amount numeric(12, 2) not null,
  currency text not null default 'EUR',
  type dozeclin.financial_entry_type not null,
  category text,
  payment_method text,
  status text not null default 'pending',
  entry_date date not null default current_date,
  created_by uuid references dozeclin.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists dozeclin.audit_logs (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid references dozeclin.clinics(id) on delete restrict,
  user_id uuid references auth.users(id) on delete set null default auth.uid(),
  action text not null,
  entity text not null,
  entity_id uuid,
  previous_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_dozeclin_profiles_clinic_id on dozeclin.profiles(clinic_id);
create index if not exists idx_dozeclin_patients_clinic_id on dozeclin.patients(clinic_id);
create index if not exists idx_dozeclin_appointments_clinic_id on dozeclin.appointments(clinic_id);
create index if not exists idx_dozeclin_medical_records_clinic_id on dozeclin.medical_records(clinic_id);
create index if not exists idx_dozeclin_anamnesis_forms_clinic_id on dozeclin.anamnesis_forms(clinic_id);
create index if not exists idx_dozeclin_patient_tasks_clinic_id on dozeclin.patient_tasks(clinic_id);
create index if not exists idx_dozeclin_financial_entries_clinic_id on dozeclin.financial_entries(clinic_id);
create index if not exists idx_dozeclin_audit_logs_clinic_id on dozeclin.audit_logs(clinic_id);

drop trigger if exists set_clinics_updated_at on dozeclin.clinics;
create trigger set_clinics_updated_at before update on dozeclin.clinics
for each row execute function dozeclin.set_updated_at();

drop trigger if exists set_clinic_settings_updated_at on dozeclin.clinic_settings;
create trigger set_clinic_settings_updated_at before update on dozeclin.clinic_settings
for each row execute function dozeclin.set_updated_at();

drop trigger if exists set_profiles_updated_at on dozeclin.profiles;
create trigger set_profiles_updated_at before update on dozeclin.profiles
for each row execute function dozeclin.set_updated_at();

drop trigger if exists set_patients_updated_at on dozeclin.patients;
create trigger set_patients_updated_at before update on dozeclin.patients
for each row execute function dozeclin.set_updated_at();

drop trigger if exists set_appointments_updated_at on dozeclin.appointments;
create trigger set_appointments_updated_at before update on dozeclin.appointments
for each row execute function dozeclin.set_updated_at();

drop trigger if exists set_medical_records_updated_at on dozeclin.medical_records;
create trigger set_medical_records_updated_at before update on dozeclin.medical_records
for each row execute function dozeclin.set_updated_at();

drop trigger if exists set_anamnesis_forms_updated_at on dozeclin.anamnesis_forms;
create trigger set_anamnesis_forms_updated_at before update on dozeclin.anamnesis_forms
for each row execute function dozeclin.set_updated_at();

drop trigger if exists set_patient_tasks_updated_at on dozeclin.patient_tasks;
create trigger set_patient_tasks_updated_at before update on dozeclin.patient_tasks
for each row execute function dozeclin.set_updated_at();

drop trigger if exists set_financial_entries_updated_at on dozeclin.financial_entries;
create trigger set_financial_entries_updated_at before update on dozeclin.financial_entries
for each row execute function dozeclin.set_updated_at();

create or replace function dozeclin.current_profile_role()
returns dozeclin.user_role
language sql
security definer
set search_path = dozeclin, auth
stable
as $$
  select role from dozeclin.profiles where id = auth.uid();
$$;

create or replace function dozeclin.current_clinic_id()
returns uuid
language sql
security definer
set search_path = dozeclin, auth
stable
as $$
  select clinic_id from dozeclin.profiles where id = auth.uid();
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
    where id = auth.uid()
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
    where id = auth.uid()
      and status = 'active'
      and clinic_id = target_clinic_id
      and role in ('clinic_admin', 'reception', 'professional', 'finance', 'supervisor')
  );
$$;

create or replace function dozeclin.can_access_clinical_records(target_clinic_id uuid)
returns boolean
language sql
security definer
set search_path = dozeclin, auth
stable
as $$
  select exists (
    select 1
    from dozeclin.profiles
    where id = auth.uid()
      and status = 'active'
      and clinic_id = target_clinic_id
      and role in ('clinic_admin', 'professional', 'supervisor')
  );
$$;

alter table dozeclin.clinics enable row level security;
alter table dozeclin.clinic_settings enable row level security;
alter table dozeclin.profiles enable row level security;
alter table dozeclin.patients enable row level security;
alter table dozeclin.appointments enable row level security;
alter table dozeclin.medical_records enable row level security;
alter table dozeclin.anamnesis_forms enable row level security;
alter table dozeclin.patient_tasks enable row level security;
alter table dozeclin.financial_entries enable row level security;
alter table dozeclin.audit_logs enable row level security;

drop policy if exists "clinics_select_own" on dozeclin.clinics;
create policy "clinics_select_own" on dozeclin.clinics
for select using (id = dozeclin.current_clinic_id() or dozeclin.current_profile_role() = 'super_admin');

drop policy if exists "clinics_update_admin" on dozeclin.clinics;
create policy "clinics_update_admin" on dozeclin.clinics
for update using (id = dozeclin.current_clinic_id() and dozeclin.current_profile_role() = 'clinic_admin')
with check (id = dozeclin.current_clinic_id());

drop policy if exists "clinic_settings_manage_own" on dozeclin.clinic_settings;
create policy "clinic_settings_manage_own" on dozeclin.clinic_settings
for all using (clinic_id = dozeclin.current_clinic_id() and dozeclin.current_profile_role() = 'clinic_admin')
with check (clinic_id = dozeclin.current_clinic_id());

drop policy if exists "profiles_select_own_clinic" on dozeclin.profiles;
create policy "profiles_select_own_clinic" on dozeclin.profiles
for select using (id = auth.uid() or clinic_id = dozeclin.current_clinic_id());

drop policy if exists "profiles_update_self_or_admin" on dozeclin.profiles;
create policy "profiles_update_self_or_admin" on dozeclin.profiles
for update using (id = auth.uid() or (clinic_id = dozeclin.current_clinic_id() and dozeclin.current_profile_role() = 'clinic_admin'))
with check (clinic_id = dozeclin.current_clinic_id());

drop policy if exists "patients_select_staff" on dozeclin.patients;
create policy "patients_select_staff" on dozeclin.patients
for select using (dozeclin.is_clinic_staff(clinic_id));

drop policy if exists "patients_insert_staff" on dozeclin.patients;
create policy "patients_insert_staff" on dozeclin.patients
for insert with check (
  clinic_id = dozeclin.current_clinic_id()
  and dozeclin.current_profile_role() in ('clinic_admin', 'reception', 'professional')
);

drop policy if exists "patients_update_staff" on dozeclin.patients;
create policy "patients_update_staff" on dozeclin.patients
for update using (
  clinic_id = dozeclin.current_clinic_id()
  and dozeclin.current_profile_role() in ('clinic_admin', 'reception', 'professional')
) with check (clinic_id = dozeclin.current_clinic_id());

drop policy if exists "appointments_staff_manage" on dozeclin.appointments;
create policy "appointments_staff_manage" on dozeclin.appointments
for all using (dozeclin.is_clinic_staff(clinic_id))
with check (clinic_id = dozeclin.current_clinic_id());

drop policy if exists "medical_records_clinical_only" on dozeclin.medical_records;
create policy "medical_records_clinical_only" on dozeclin.medical_records
for all using (dozeclin.can_access_clinical_records(clinic_id))
with check (clinic_id = dozeclin.current_clinic_id() and dozeclin.can_access_clinical_records(clinic_id));

drop policy if exists "anamnesis_clinical_only" on dozeclin.anamnesis_forms;
create policy "anamnesis_clinical_only" on dozeclin.anamnesis_forms
for all using (dozeclin.can_access_clinical_records(clinic_id))
with check (clinic_id = dozeclin.current_clinic_id() and dozeclin.can_access_clinical_records(clinic_id));

drop policy if exists "patient_tasks_staff_manage" on dozeclin.patient_tasks;
create policy "patient_tasks_staff_manage" on dozeclin.patient_tasks
for all using (dozeclin.is_clinic_staff(clinic_id))
with check (clinic_id = dozeclin.current_clinic_id());

drop policy if exists "financial_entries_finance_only" on dozeclin.financial_entries;
create policy "financial_entries_finance_only" on dozeclin.financial_entries
for all using (
  clinic_id = dozeclin.current_clinic_id()
  and dozeclin.current_profile_role() in ('clinic_admin', 'finance')
) with check (
  clinic_id = dozeclin.current_clinic_id()
  and dozeclin.current_profile_role() in ('clinic_admin', 'finance')
);

drop policy if exists "audit_logs_insert_own_clinic" on dozeclin.audit_logs;
create policy "audit_logs_insert_own_clinic" on dozeclin.audit_logs
for insert with check (clinic_id = dozeclin.current_clinic_id());

drop policy if exists "audit_logs_select_admin" on dozeclin.audit_logs;
create policy "audit_logs_select_admin" on dozeclin.audit_logs
for select using (
  clinic_id = dozeclin.current_clinic_id()
  and dozeclin.current_profile_role() in ('clinic_admin', 'supervisor')
);

grant usage on schema dozeclin to anon, authenticated, service_role;

grant select on dozeclin.clinics to authenticated;
grant update on dozeclin.clinics to authenticated;

grant select, insert, update on dozeclin.clinic_settings to authenticated;
grant select, update on dozeclin.profiles to authenticated;
grant select, insert, update on dozeclin.patients to authenticated;
grant select, insert, update on dozeclin.appointments to authenticated;
grant select, insert, update on dozeclin.medical_records to authenticated;
grant select, insert, update on dozeclin.anamnesis_forms to authenticated;
grant select, insert, update on dozeclin.patient_tasks to authenticated;
grant select, insert, update on dozeclin.financial_entries to authenticated;
grant select, insert on dozeclin.audit_logs to authenticated;

grant all privileges on all tables in schema dozeclin to service_role;
grant all privileges on all routines in schema dozeclin to service_role;
grant usage on all sequences in schema dozeclin to service_role;

commit;
