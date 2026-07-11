begin;

do $$
begin
  create type dozeclin.medical_record_type as enum (
    'evolution',
    'observation',
    'diagnosis',
    'conduct',
    'prescription',
    'other'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type dozeclin.medical_record_status as enum ('draft', 'signed', 'cancelled');
exception
  when duplicate_object then null;
end $$;

alter table dozeclin.medical_records
  add column if not exists record_type dozeclin.medical_record_type not null default 'evolution',
  add column if not exists diagnosis text,
  add column if not exists conduct text,
  add column if not exists prescription text,
  add column if not exists record_date timestamptz not null default now(),
  add column if not exists status dozeclin.medical_record_status not null default 'draft',
  add column if not exists created_by uuid,
  add column if not exists cancel_reason text,
  add column if not exists signed_at timestamptz,
  add column if not exists cancelled_at timestamptz;

alter table dozeclin.medical_records
  alter column title drop not null;

do $$
declare
  constraint_to_drop text;
begin
  for constraint_to_drop in
    select c.conname
    from pg_constraint c
    join pg_attribute a
      on a.attrelid = c.conrelid
      and a.attnum = any(c.conkey)
    where c.conrelid = 'dozeclin.medical_records'::regclass
      and c.contype = 'f'
      and a.attname = 'created_by'
  loop
    execute format(
      'alter table dozeclin.medical_records drop constraint %I',
      constraint_to_drop
    );
  end loop;

  alter table dozeclin.medical_records
    add constraint medical_records_created_by_fkey
    foreign key (created_by)
    references dozeclin.profiles(id)
    on delete restrict;
end $$;

create index if not exists idx_dozeclin_medical_records_patient_date
on dozeclin.medical_records(clinic_id, patient_id, record_date desc);

create index if not exists idx_dozeclin_medical_records_professional_date
on dozeclin.medical_records(clinic_id, professional_id, record_date desc);

create index if not exists idx_dozeclin_medical_records_status
on dozeclin.medical_records(clinic_id, status);

alter table dozeclin.medical_records enable row level security;

create or replace function dozeclin.current_active_profile_id()
returns uuid
language sql
security definer
set search_path = dozeclin, auth
stable
as $$
  select p.id
  from dozeclin.profiles p
  where p.auth_user_id = auth.uid()
    and p.status = 'active'
  limit 1;
$$;

create or replace function dozeclin.can_manage_medical_records(target_professional_id uuid)
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
      and p.clinic_id = dozeclin.current_clinic_id()
      and (
        p.role in ('clinic_admin', 'supervisor')
        or (p.role = 'professional' and p.id = target_professional_id)
      )
  );
$$;

create or replace function dozeclin.validate_medical_record()
returns trigger
language plpgsql
security definer
set search_path = dozeclin, auth
as $$
declare
  active_profile_id uuid;
  active_profile_role dozeclin.user_role;
begin
  active_profile_id := dozeclin.current_active_profile_id();
  active_profile_role := dozeclin.current_profile_role();

  if active_profile_id is null then
    raise exception 'Perfil autenticado ativo nao encontrado.';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := active_profile_id;
    new.created_at := now();
    new.signed_at := null;
    new.cancelled_at := null;
    new.cancel_reason := null;
    new.status := 'draft';
  end if;

  if new.clinic_id is null then
    raise exception 'Prontuario sem clinica.';
  end if;

  if new.clinic_id <> dozeclin.current_clinic_id() then
    raise exception 'Clinica invalida para o prontuario.';
  end if;

  if new.patient_id is null then
    raise exception 'Prontuario sem paciente.';
  end if;

  if new.professional_id is null then
    raise exception 'Prontuario sem profissional.';
  end if;

  if nullif(trim(coalesce(new.content, '')), '') is null then
    raise exception 'Conteudo clinico obrigatorio.';
  end if;

  if not exists (
    select 1
    from dozeclin.patients p
    where p.id = new.patient_id
      and p.clinic_id = new.clinic_id
      and p.status <> 'archived'
  ) then
    raise exception 'Paciente invalido para esta clinica.';
  end if;

  if tg_op = 'INSERT'
    or (tg_op = 'UPDATE' and old.status = 'draft' and new.professional_id is distinct from old.professional_id) then
    if not exists (
      select 1
      from dozeclin.profiles p
      where p.id = new.professional_id
        and p.clinic_id = new.clinic_id
        and p.status = 'active'
        and p.role in ('professional', 'supervisor', 'clinic_admin')
    ) then
      raise exception 'Profissional invalido para esta clinica.';
    end if;

    if not dozeclin.can_manage_medical_records(new.professional_id) then
      raise exception 'Utilizador sem permissao para este profissional.';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at
      or new.clinic_id is distinct from old.clinic_id
      or new.patient_id is distinct from old.patient_id then
      raise exception 'Campos de auditoria do prontuario nao podem ser alterados.';
    end if;

    if old.status = 'cancelled' then
      raise exception 'Registro cancelado nao pode ser alterado.';
    end if;

    if old.status = 'signed' then
      if new.status = 'signed' then
        raise exception 'Registro assinado nao pode ser alterado.';
      end if;

      if new.status = 'draft' then
        raise exception 'Registro assinado nao pode retornar a rascunho.';
      end if;

      if new.clinic_id is distinct from old.clinic_id
        or new.patient_id is distinct from old.patient_id
        or new.professional_id is distinct from old.professional_id
        or new.record_type is distinct from old.record_type
        or new.title is distinct from old.title
        or new.content is distinct from old.content
        or new.diagnosis is distinct from old.diagnosis
        or new.conduct is distinct from old.conduct
        or new.prescription is distinct from old.prescription
        or new.record_date is distinct from old.record_date
        or new.created_by is distinct from old.created_by
        or new.created_at is distinct from old.created_at
        or new.signed_at is distinct from old.signed_at then
        raise exception 'Registro assinado nao pode ter conteudo clinico alterado.';
      end if;
    end if;

    if old.status = 'draft' and new.status not in ('draft', 'signed', 'cancelled') then
      raise exception 'Transicao de status invalida.';
    end if;

    if old.status = 'cancelled' and new.status <> 'cancelled' then
      raise exception 'Registro cancelado nao pode ser reativado.';
    end if;

    if old.status = 'signed' and new.status not in ('signed', 'cancelled') then
      raise exception 'Transicao de status invalida para registro assinado.';
    end if;

    if old.status = 'draft' then
      if new.status = 'draft' then
        if new.signed_at is not null
          or new.cancelled_at is not null
          or new.cancel_reason is not null then
          new.signed_at := null;
          new.cancelled_at := null;
          new.cancel_reason := null;
        end if;

        new.signed_at := null;
        new.cancelled_at := null;
        new.cancel_reason := null;
      elsif new.status = 'signed' then
        if new.professional_id is distinct from old.professional_id
          or new.record_type is distinct from old.record_type
          or new.title is distinct from old.title
          or new.content is distinct from old.content
          or new.diagnosis is distinct from old.diagnosis
          or new.conduct is distinct from old.conduct
          or new.prescription is distinct from old.prescription
          or new.record_date is distinct from old.record_date
          or new.cancel_reason is distinct from old.cancel_reason
          or new.cancelled_at is distinct from old.cancelled_at then
          raise exception 'Registro deve ser salvo como rascunho antes da assinatura.';
        end if;

        new.signed_at := now();
        new.cancelled_at := null;
        new.cancel_reason := null;
      elsif new.status = 'cancelled' then
        if nullif(trim(coalesce(new.cancel_reason, '')), '') is null then
          raise exception 'Informe o motivo do cancelamento.';
        end if;
        new.cancelled_at := now();
        new.signed_at := null;
      end if;
    elsif old.status = 'signed' and new.status = 'cancelled' then
      if new.professional_id is distinct from old.professional_id
        or new.record_type is distinct from old.record_type
        or new.title is distinct from old.title
        or new.content is distinct from old.content
        or new.diagnosis is distinct from old.diagnosis
        or new.conduct is distinct from old.conduct
        or new.prescription is distinct from old.prescription
        or new.record_date is distinct from old.record_date then
        raise exception 'Cancelamento de registro assinado nao pode alterar o conteudo original.';
      end if;

      if nullif(trim(coalesce(new.cancel_reason, '')), '') is null then
        raise exception 'Informe o motivo do cancelamento.';
      end if;
      new.cancelled_at := now();
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists validate_medical_record_before_write on dozeclin.medical_records;
create trigger validate_medical_record_before_write
before insert or update on dozeclin.medical_records
for each row execute function dozeclin.validate_medical_record();

drop policy if exists "medical_records_clinical_only" on dozeclin.medical_records;

drop policy if exists "medical_records_select_clinic" on dozeclin.medical_records;
create policy "medical_records_select_clinic" on dozeclin.medical_records
for select using (
  clinic_id = dozeclin.current_clinic_id()
  and dozeclin.current_profile_role() in ('clinic_admin', 'professional', 'supervisor')
);

drop policy if exists "medical_records_insert_authorized" on dozeclin.medical_records;
create policy "medical_records_insert_authorized" on dozeclin.medical_records
for insert with check (
  clinic_id = dozeclin.current_clinic_id()
  and status = 'draft'
  and created_by = dozeclin.current_active_profile_id()
  and dozeclin.can_manage_medical_records(professional_id)
);

drop policy if exists "medical_records_update_authorized_drafts" on dozeclin.medical_records;
drop policy if exists "medical_records_sign_authorized" on dozeclin.medical_records;
drop policy if exists "medical_records_cancel_authorized" on dozeclin.medical_records;
drop policy if exists "medical_records_update_authorized" on dozeclin.medical_records;
create policy "medical_records_update_authorized" on dozeclin.medical_records
for update using (
  clinic_id = dozeclin.current_clinic_id()
  and status in ('draft', 'signed')
  and dozeclin.can_manage_medical_records(professional_id)
) with check (
  clinic_id = dozeclin.current_clinic_id()
  and status in ('draft', 'signed', 'cancelled')
  and dozeclin.can_manage_medical_records(professional_id)
);

revoke all on function dozeclin.current_active_profile_id() from public;
revoke all on function dozeclin.current_active_profile_id() from anon;
revoke all on function dozeclin.can_manage_medical_records(uuid) from public;
revoke all on function dozeclin.can_manage_medical_records(uuid) from anon;
revoke all on function dozeclin.validate_medical_record() from public;
revoke all on function dozeclin.validate_medical_record() from anon;
revoke all on function dozeclin.validate_medical_record() from authenticated;

grant execute on function dozeclin.current_active_profile_id() to authenticated, service_role;
grant execute on function dozeclin.can_manage_medical_records(uuid) to authenticated, service_role;

commit;
