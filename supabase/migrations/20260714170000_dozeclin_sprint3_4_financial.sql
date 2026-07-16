begin;

do $$
begin
  create type dozeclin.financial_charge_type as enum ('appointment', 'package', 'manual', 'subscription', 'adjustment');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type dozeclin.financial_charge_status as enum ('pending', 'partially_paid', 'paid', 'overdue', 'cancelled', 'refunded');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type dozeclin.financial_payment_method as enum ('cash', 'bank_transfer', 'card', 'pix', 'mb_way', 'stripe', 'paypal', 'other');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type dozeclin.financial_payment_status as enum ('confirmed', 'pending', 'cancelled', 'refunded');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type dozeclin.financial_receipt_status as enum ('issued', 'cancelled');
exception
  when duplicate_object then null;
end $$;

alter table dozeclin.clinic_settings
  add column if not exists default_session_price numeric(12, 2),
  add column if not exists auto_create_charge_on_completion boolean not null default false,
  add column if not exists default_payment_terms_days integer not null default 0,
  add column if not exists receipt_prefix text,
  add column if not exists financial_email text,
  add column if not exists allow_partial_payments boolean not null default true;

create table if not exists dozeclin.financial_receipt_sequences (
  clinic_id uuid not null references dozeclin.clinics(id) on delete restrict,
  receipt_year integer not null,
  last_number integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (clinic_id, receipt_year)
);

create table if not exists dozeclin.financial_charges (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references dozeclin.clinics(id) on delete restrict,
  patient_id uuid not null references dozeclin.patients(id) on delete restrict,
  appointment_id uuid references dozeclin.appointments(id) on delete set null,
  description text not null,
  charge_type dozeclin.financial_charge_type not null default 'manual',
  status dozeclin.financial_charge_status not null default 'pending',
  currency char(3) not null,
  amount numeric(12, 2) not null,
  discount_amount numeric(12, 2) not null default 0,
  final_amount numeric(12, 2) not null,
  due_date date,
  paid_amount numeric(12, 2) not null default 0,
  remaining_amount numeric(12, 2) not null,
  notes text,
  created_by uuid references dozeclin.profiles(id) on delete set null,
  cancelled_by uuid references dozeclin.profiles(id) on delete set null,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists dozeclin.financial_payments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references dozeclin.clinics(id) on delete restrict,
  charge_id uuid not null references dozeclin.financial_charges(id) on delete restrict,
  patient_id uuid not null references dozeclin.patients(id) on delete restrict,
  amount numeric(12, 2) not null,
  currency char(3) not null,
  payment_method dozeclin.financial_payment_method not null default 'cash',
  payment_status dozeclin.financial_payment_status not null default 'confirmed',
  payment_date timestamptz not null default now(),
  idempotency_key text,
  external_reference text,
  notes text,
  registered_by uuid references dozeclin.profiles(id) on delete set null,
  cancelled_by uuid references dozeclin.profiles(id) on delete set null,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists dozeclin.financial_receipts (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references dozeclin.clinics(id) on delete restrict,
  payment_id uuid not null unique references dozeclin.financial_payments(id) on delete restrict,
  charge_id uuid not null references dozeclin.financial_charges(id) on delete restrict,
  patient_id uuid not null references dozeclin.patients(id) on delete restrict,
  receipt_number text not null,
  currency char(3) not null,
  amount numeric(12, 2) not null,
  issued_at timestamptz not null default now(),
  issued_by uuid references dozeclin.profiles(id) on delete set null,
  status dozeclin.financial_receipt_status not null default 'issued',
  cancelled_at timestamptz,
  cancelled_by uuid references dozeclin.profiles(id) on delete set null,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  unique (clinic_id, receipt_number)
);

alter table dozeclin.financial_charges
  drop constraint if exists financial_charges_currency_check,
  add constraint financial_charges_currency_check check (currency in ('EUR', 'BRL', 'USD')),
  drop constraint if exists financial_charges_amount_check,
  add constraint financial_charges_amount_check check (amount > 0),
  drop constraint if exists financial_charges_discount_check,
  add constraint financial_charges_discount_check check (discount_amount >= 0),
  drop constraint if exists financial_charges_final_amount_check,
  add constraint financial_charges_final_amount_check check (final_amount >= 0),
  drop constraint if exists financial_charges_paid_amount_check,
  add constraint financial_charges_paid_amount_check check (paid_amount >= 0 and paid_amount <= final_amount),
  drop constraint if exists financial_charges_remaining_amount_check,
  add constraint financial_charges_remaining_amount_check check (remaining_amount >= 0),
  drop constraint if exists financial_charges_appointment_type_check,
  add constraint financial_charges_appointment_type_check check (charge_type <> 'appointment' or appointment_id is not null);

alter table dozeclin.financial_payments
  drop constraint if exists financial_payments_currency_check,
  add constraint financial_payments_currency_check check (currency in ('EUR', 'BRL', 'USD')),
  drop constraint if exists financial_payments_amount_check,
  add constraint financial_payments_amount_check check (amount > 0);

alter table dozeclin.financial_receipts
  drop constraint if exists financial_receipts_currency_check,
  add constraint financial_receipts_currency_check check (currency in ('EUR', 'BRL', 'USD')),
  drop constraint if exists financial_receipts_amount_check,
  add constraint financial_receipts_amount_check check (amount > 0);

create unique index if not exists idx_dozeclin_financial_charges_active_appointment
on dozeclin.financial_charges(appointment_id, charge_type)
where appointment_id is not null
  and charge_type = 'appointment'
  and status in ('pending', 'partially_paid', 'paid', 'overdue');

create index if not exists idx_dozeclin_financial_charges_clinic_status
on dozeclin.financial_charges(clinic_id, status, due_date);

create index if not exists idx_dozeclin_financial_charges_patient
on dozeclin.financial_charges(clinic_id, patient_id, created_at desc);

create index if not exists idx_dozeclin_financial_payments_charge
on dozeclin.financial_payments(clinic_id, charge_id, payment_date desc);

create index if not exists idx_dozeclin_financial_payments_patient
on dozeclin.financial_payments(clinic_id, patient_id, payment_date desc);

create unique index if not exists idx_dozeclin_financial_payments_idempotency
on dozeclin.financial_payments(clinic_id, idempotency_key)
where idempotency_key is not null;

create index if not exists idx_dozeclin_financial_receipts_patient
on dozeclin.financial_receipts(clinic_id, patient_id, issued_at desc);

drop trigger if exists set_financial_charges_updated_at on dozeclin.financial_charges;
create trigger set_financial_charges_updated_at before update on dozeclin.financial_charges
for each row execute function dozeclin.set_updated_at();

drop trigger if exists set_financial_payments_updated_at on dozeclin.financial_payments;
create trigger set_financial_payments_updated_at before update on dozeclin.financial_payments
for each row execute function dozeclin.set_updated_at();

create or replace function dozeclin.can_access_financial(target_clinic_id uuid)
returns boolean
language sql
security definer
set search_path = dozeclin, auth
stable
as $$
  select exists (
    select 1
    from dozeclin.profiles p
    join dozeclin.clinics c on c.id = p.clinic_id
    where (p.auth_user_id = auth.uid() or p.id = auth.uid())
      and p.status = 'active'
      and p.clinic_id = target_clinic_id
      and c.status in ('trial', 'active')
      and p.role in ('clinic_admin', 'finance', 'supervisor', 'reception')
  );
$$;

create or replace function dozeclin.can_manage_financial(target_clinic_id uuid)
returns boolean
language sql
security definer
set search_path = dozeclin, auth
stable
as $$
  select exists (
    select 1
    from dozeclin.profiles p
    join dozeclin.clinics c on c.id = p.clinic_id
    where (p.auth_user_id = auth.uid() or p.id = auth.uid())
      and p.status = 'active'
      and p.clinic_id = target_clinic_id
      and c.status in ('trial', 'active')
      and p.role in ('clinic_admin', 'finance', 'supervisor', 'reception')
  );
$$;

create or replace function dozeclin.normalize_financial_charge()
returns trigger
language plpgsql
security definer
set search_path = dozeclin, auth
as $$
begin
  new.currency := upper(new.currency);
  new.description := nullif(trim(coalesce(new.description, '')), '');

  if new.description is null then
    raise exception 'Descricao obrigatoria.';
  end if;

  if new.currency not in ('EUR', 'BRL', 'USD') then
    raise exception 'Moeda invalida.';
  end if;

  if new.amount <= 0 then
    raise exception 'Valor deve ser maior que zero.';
  end if;

  if new.discount_amount < 0 then
    raise exception 'Desconto nao pode ser negativo.';
  end if;

  new.final_amount := round(new.amount - new.discount_amount, 2);

  if new.final_amount < 0 then
    raise exception 'Valor final nao pode ser negativo.';
  end if;

  new.paid_amount := round(coalesce(new.paid_amount, 0), 2);
  new.remaining_amount := round(new.final_amount - new.paid_amount, 2);

  if new.paid_amount > new.final_amount then
    raise exception 'Valor pago nao pode superar o valor final.';
  end if;

  if new.appointment_id is not null and not exists (
    select 1
    from dozeclin.appointments a
    where a.id = new.appointment_id
      and a.clinic_id = new.clinic_id
      and a.patient_id = new.patient_id
      and a.status = 'completed'
  ) then
    raise exception 'Appointment deve estar concluido para gerar cobranca.';
  end if;

  if not exists (
    select 1
    from dozeclin.patients p
    where p.id = new.patient_id
      and p.clinic_id = new.clinic_id
      and p.status <> 'archived'
  ) then
    raise exception 'Paciente invalido para esta cobranca.';
  end if;

  if tg_op = 'UPDATE' then
    if old.status in ('cancelled', 'refunded') and new.status is distinct from old.status then
      raise exception 'Cobranca em estado final nao pode retornar.';
    end if;

    if old.status = 'paid' and new.status in ('pending', 'partially_paid', 'overdue') then
      raise exception 'Cobranca paga nao pode voltar para pendente.';
    end if;
  end if;

  if new.status not in ('cancelled', 'refunded') then
    if new.remaining_amount = 0 then
      new.status := 'paid';
    elsif new.paid_amount > 0 then
      new.status := 'partially_paid';
    else
      new.status := 'pending';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists normalize_financial_charge_before_write on dozeclin.financial_charges;
create trigger normalize_financial_charge_before_write
before insert or update on dozeclin.financial_charges
for each row execute function dozeclin.normalize_financial_charge();

create or replace function dozeclin.protect_financial_charge_integrity()
returns trigger
language plpgsql
security definer
set search_path = dozeclin, auth
as $$
begin
  if old.clinic_id is distinct from new.clinic_id
    or old.patient_id is distinct from new.patient_id
    or old.appointment_id is distinct from new.appointment_id
    or old.charge_type is distinct from new.charge_type
    or old.currency is distinct from new.currency
    or old.created_by is distinct from new.created_by then
    raise exception 'Campos estruturais da cobranca financeira sao imutaveis.';
  end if;

  if old.status in ('cancelled', 'refunded')
    and (
      old.amount is distinct from new.amount
      or old.discount_amount is distinct from new.discount_amount
      or old.final_amount is distinct from new.final_amount
      or old.paid_amount is distinct from new.paid_amount
      or old.remaining_amount is distinct from new.remaining_amount
      or old.status is distinct from new.status
      or old.description is distinct from new.description
      or old.due_date is distinct from new.due_date
      or old.notes is distinct from new.notes
      or old.cancelled_at is distinct from new.cancelled_at
      or old.cancelled_by is distinct from new.cancelled_by
      or old.cancellation_reason is distinct from new.cancellation_reason
    ) then
    raise exception 'Cobranca em estado final nao pode ser alterada.';
  end if;

  if coalesce(current_setting('dozeclin.financial_rpc', true), '') <> 'on'
    and (
      old.amount is distinct from new.amount
      or old.discount_amount is distinct from new.discount_amount
      or old.final_amount is distinct from new.final_amount
      or old.paid_amount is distinct from new.paid_amount
      or old.remaining_amount is distinct from new.remaining_amount
      or old.status is distinct from new.status
      or old.description is distinct from new.description
      or old.due_date is distinct from new.due_date
      or old.notes is distinct from new.notes
      or old.cancelled_at is distinct from new.cancelled_at
      or old.cancelled_by is distinct from new.cancelled_by
      or old.cancellation_reason is distinct from new.cancellation_reason
    ) then
    raise exception 'Cobranca financeira deve ser alterada por RPC.';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_financial_charge_integrity_before_update on dozeclin.financial_charges;
create trigger protect_financial_charge_integrity_before_update
before update on dozeclin.financial_charges
for each row execute function dozeclin.protect_financial_charge_integrity();

create or replace function dozeclin.protect_financial_payment_integrity()
returns trigger
language plpgsql
security definer
set search_path = dozeclin, auth
as $$
begin
  if old.clinic_id is distinct from new.clinic_id
    or old.charge_id is distinct from new.charge_id
    or old.patient_id is distinct from new.patient_id
    or old.currency is distinct from new.currency
    or old.registered_by is distinct from new.registered_by
    or old.idempotency_key is distinct from new.idempotency_key then
    raise exception 'Campos estruturais do pagamento financeiro sao imutaveis.';
  end if;

  if old.payment_status = 'confirmed'
    and (
      old.amount is distinct from new.amount
      or old.payment_method is distinct from new.payment_method
      or old.payment_date is distinct from new.payment_date
      or old.external_reference is distinct from new.external_reference
      or old.notes is distinct from new.notes
      or old.payment_status is distinct from new.payment_status
      or old.cancelled_at is distinct from new.cancelled_at
      or old.cancelled_by is distinct from new.cancelled_by
      or old.cancellation_reason is distinct from new.cancellation_reason
    ) then
    raise exception 'Pagamento confirmado nao pode ser editado livremente.';
  end if;

  if coalesce(current_setting('dozeclin.financial_rpc', true), '') <> 'on'
    and (
      old.amount is distinct from new.amount
      or old.payment_method is distinct from new.payment_method
      or old.payment_date is distinct from new.payment_date
      or old.external_reference is distinct from new.external_reference
      or old.notes is distinct from new.notes
      or old.payment_status is distinct from new.payment_status
      or old.cancelled_at is distinct from new.cancelled_at
      or old.cancelled_by is distinct from new.cancelled_by
      or old.cancellation_reason is distinct from new.cancellation_reason
    ) then
    raise exception 'Pagamento financeiro deve ser alterado por RPC.';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_financial_payment_integrity_before_update on dozeclin.financial_payments;
create trigger protect_financial_payment_integrity_before_update
before update on dozeclin.financial_payments
for each row execute function dozeclin.protect_financial_payment_integrity();

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
    or old.issued_by is distinct from new.issued_by then
    raise exception 'Campos estruturais do recibo financeiro sao imutaveis.';
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
      or old.cancelled_at is distinct from new.cancelled_at
      or old.cancelled_by is distinct from new.cancelled_by
      or old.cancellation_reason is distinct from new.cancellation_reason
    ) then
    raise exception 'Recibo financeiro deve ser alterado por RPC.';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_financial_receipt_integrity_before_update on dozeclin.financial_receipts;
create trigger protect_financial_receipt_integrity_before_update
before update on dozeclin.financial_receipts
for each row execute function dozeclin.protect_financial_receipt_integrity();

create or replace function dozeclin.protect_financial_delete()
returns trigger
language plpgsql
security definer
set search_path = dozeclin, auth
as $$
begin
  raise exception 'Exclusao fisica financeira nao permitida.';
end;
$$;

drop trigger if exists protect_financial_charges_delete on dozeclin.financial_charges;
create trigger protect_financial_charges_delete
before delete on dozeclin.financial_charges
for each row execute function dozeclin.protect_financial_delete();

drop trigger if exists protect_financial_payments_delete on dozeclin.financial_payments;
create trigger protect_financial_payments_delete
before delete on dozeclin.financial_payments
for each row execute function dozeclin.protect_financial_delete();

drop trigger if exists protect_financial_receipts_delete on dozeclin.financial_receipts;
create trigger protect_financial_receipts_delete
before delete on dozeclin.financial_receipts
for each row execute function dozeclin.protect_financial_delete();

create or replace function dozeclin.next_receipt_number(p_clinic_id uuid, p_issued_at timestamptz default now())
returns text
language plpgsql
security definer
set search_path = dozeclin, auth
as $$
declare
  target_year integer := extract(year from p_issued_at)::integer;
  next_number integer;
  prefix text;
begin
  insert into dozeclin.financial_receipt_sequences (clinic_id, receipt_year, last_number)
  values (p_clinic_id, target_year, 0)
  on conflict (clinic_id, receipt_year) do nothing;

  update dozeclin.financial_receipt_sequences frs
  set last_number = last_number + 1,
      updated_at = now()
  where frs.clinic_id = p_clinic_id
    and frs.receipt_year = target_year
  returning last_number into next_number;

  select nullif(trim(coalesce(cs.receipt_prefix, '')), '')
  into prefix
  from dozeclin.clinic_settings cs
  where cs.clinic_id = p_clinic_id;

  return concat(coalesce(prefix, target_year::text), '-', lpad(next_number::text, 6, '0'));
end;
$$;

create or replace function dozeclin.create_financial_charge(
  p_patient_id uuid,
  p_description text,
  p_charge_type dozeclin.financial_charge_type,
  p_appointment_id uuid default null,
  p_currency text default null,
  p_amount numeric default null,
  p_discount_amount numeric default 0,
  p_due_date date default null,
  p_notes text default null
)
returns dozeclin.financial_charges
language plpgsql
security definer
set search_path = dozeclin, auth
as $$
declare
  current_profile dozeclin.profiles;
  target_clinic dozeclin.clinics;
  saved dozeclin.financial_charges;
begin
  select p.*
  into current_profile
  from dozeclin.profiles p
  where (p.auth_user_id = auth.uid() or p.id = auth.uid())
    and p.status = 'active'
    and p.role in ('clinic_admin', 'finance', 'supervisor', 'reception')
  limit 1;

  if not found then
    raise exception 'Utilizador sem permissao financeira.';
  end if;

  select *
  into target_clinic
  from dozeclin.clinics
  where id = current_profile.clinic_id
    and status in ('trial', 'active');

  if not found then
    raise exception 'Clinica indisponivel para financeiro.';
  end if;

  if not dozeclin.can_manage_financial(current_profile.clinic_id) then
    raise exception 'Utilizador sem permissao financeira.';
  end if;

  if p_charge_type = 'appointment' and p_appointment_id is null then
    raise exception 'Appointment obrigatorio para cobranca de sessao.';
  end if;

  set local dozeclin.financial_rpc = 'on';

  insert into dozeclin.financial_charges (
    clinic_id,
    patient_id,
    appointment_id,
    description,
    charge_type,
    currency,
    amount,
    discount_amount,
    final_amount,
    due_date,
    paid_amount,
    remaining_amount,
    notes,
    created_by
  )
  values (
    current_profile.clinic_id,
    p_patient_id,
    p_appointment_id,
    p_description,
    coalesce(p_charge_type, 'manual'),
    upper(coalesce(nullif(trim(p_currency), ''), target_clinic.default_currency, 'EUR')),
    p_amount,
    coalesce(p_discount_amount, 0),
    0,
    p_due_date,
    0,
    0,
    nullif(trim(coalesce(p_notes, '')), ''),
    current_profile.id
  )
  returning * into saved;

  insert into dozeclin.audit_logs (clinic_id, user_id, action, entity, entity_id, new_data)
  values (
    saved.clinic_id,
    auth.uid(),
    'financial.charge_created',
    'financial_charges',
    saved.id,
    jsonb_build_object(
      'patient_id', saved.patient_id,
      'appointment_id', saved.appointment_id,
      'charge_type', saved.charge_type,
      'currency', saved.currency,
      'final_amount', saved.final_amount,
      'status', saved.status
    )
  );

  return saved;
end;
$$;

create or replace function dozeclin.register_payment(
  p_charge_id uuid,
  p_amount numeric,
  p_payment_method dozeclin.financial_payment_method default 'cash',
  p_payment_date timestamptz default now(),
  p_external_reference text default null,
  p_notes text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = dozeclin, auth
as $$
declare
  current_profile dozeclin.profiles;
  current_charge dozeclin.financial_charges;
  target_clinic dozeclin.clinics;
  saved_payment dozeclin.financial_payments;
  saved_receipt dozeclin.financial_receipts;
  receipt_no text;
  next_paid numeric(12, 2);
  next_remaining numeric(12, 2);
  effective_idempotency_key text;
begin
  select p.*
  into current_profile
  from dozeclin.profiles p
  where (p.auth_user_id = auth.uid() or p.id = auth.uid())
    and p.status = 'active'
    and p.role in ('clinic_admin', 'finance', 'supervisor', 'reception')
  limit 1;

  if not found then
    raise exception 'Utilizador sem permissao financeira.';
  end if;

  select *
  into target_clinic
  from dozeclin.clinics
  where id = current_profile.clinic_id
    and status in ('trial', 'active');

  if not found then
    raise exception 'Clinica indisponivel para financeiro.';
  end if;

  effective_idempotency_key := nullif(trim(coalesce(p_idempotency_key, p_external_reference, '')), '');

  if effective_idempotency_key is not null then
    select fp.*
    into saved_payment
    from dozeclin.financial_payments fp
    where fp.clinic_id = current_profile.clinic_id
      and fp.idempotency_key = effective_idempotency_key
    limit 1;

    if found then
      select fc.*
      into current_charge
      from dozeclin.financial_charges fc
      where fc.id = saved_payment.charge_id
        and fc.clinic_id = current_profile.clinic_id;

      select fr.*
      into saved_receipt
      from dozeclin.financial_receipts fr
      where fr.payment_id = saved_payment.id
        and fr.clinic_id = current_profile.clinic_id;

      return jsonb_build_object(
        'charge', to_jsonb(current_charge),
        'payment', to_jsonb(saved_payment),
        'receipt', to_jsonb(saved_receipt),
        'idempotent', true
      );
    end if;
  end if;

  select *
  into current_charge
  from dozeclin.financial_charges
  where id = p_charge_id
    and clinic_id = current_profile.clinic_id
  for update;

  if not found then
    raise exception 'Cobranca nao encontrada.';
  end if;

  if current_charge.status in ('cancelled', 'refunded') then
    raise exception 'Cobranca cancelada ou reembolsada nao pode receber pagamento.';
  end if;

  if p_amount <= 0 then
    raise exception 'Valor do pagamento deve ser maior que zero.';
  end if;

  if p_amount > current_charge.remaining_amount then
    raise exception 'Pagamento maior que o saldo restante.';
  end if;

  next_paid := round(current_charge.paid_amount + p_amount, 2);
  next_remaining := round(current_charge.final_amount - next_paid, 2);

  set local dozeclin.financial_rpc = 'on';

  insert into dozeclin.financial_payments (
    clinic_id,
    charge_id,
    patient_id,
    amount,
    currency,
    payment_method,
    payment_status,
    payment_date,
    idempotency_key,
    external_reference,
    notes,
    registered_by
  )
  values (
    current_charge.clinic_id,
    current_charge.id,
    current_charge.patient_id,
    p_amount,
    current_charge.currency,
    coalesce(p_payment_method, 'cash'),
    'confirmed',
    coalesce(p_payment_date, now()),
    effective_idempotency_key,
    nullif(trim(coalesce(p_external_reference, '')), ''),
    nullif(trim(coalesce(p_notes, '')), ''),
    current_profile.id
  )
  returning * into saved_payment;

  update dozeclin.financial_charges
  set paid_amount = next_paid,
      remaining_amount = next_remaining,
      status = case when next_remaining = 0 then 'paid'::dozeclin.financial_charge_status else 'partially_paid'::dozeclin.financial_charge_status end
  where id = current_charge.id
  returning * into current_charge;

  receipt_no := dozeclin.next_receipt_number(current_charge.clinic_id, saved_payment.payment_date);

  insert into dozeclin.financial_receipts (
    clinic_id,
    payment_id,
    charge_id,
    patient_id,
    receipt_number,
    currency,
    amount,
    issued_at,
    issued_by,
    status
  )
  values (
    current_charge.clinic_id,
    saved_payment.id,
    current_charge.id,
    current_charge.patient_id,
    receipt_no,
    current_charge.currency,
    saved_payment.amount,
    now(),
    current_profile.id,
    'issued'
  )
  returning * into saved_receipt;

  insert into dozeclin.audit_logs (clinic_id, user_id, action, entity, entity_id, new_data)
  values (
    current_charge.clinic_id,
    auth.uid(),
    'financial.payment_registered',
    'financial_payments',
    saved_payment.id,
    jsonb_build_object(
      'charge_id', current_charge.id,
      'patient_id', current_charge.patient_id,
      'currency', saved_payment.currency,
      'amount', saved_payment.amount,
      'payment_method', saved_payment.payment_method
    )
  );

  insert into dozeclin.audit_logs (clinic_id, user_id, action, entity, entity_id, new_data)
  values (
    current_charge.clinic_id,
    auth.uid(),
    'financial.receipt_issued',
    'financial_receipts',
    saved_receipt.id,
    jsonb_build_object(
      'payment_id', saved_payment.id,
      'charge_id', current_charge.id,
      'receipt_number', saved_receipt.receipt_number,
      'currency', saved_receipt.currency,
      'amount', saved_receipt.amount
    )
  );

  return jsonb_build_object(
    'charge', to_jsonb(current_charge),
    'payment', to_jsonb(saved_payment),
    'receipt', to_jsonb(saved_receipt),
    'idempotent', false
  );
end;
$$;

create or replace function dozeclin.cancel_charge(
  p_charge_id uuid,
  p_reason text
)
returns dozeclin.financial_charges
language plpgsql
security definer
set search_path = dozeclin, auth
as $$
declare
  current_profile dozeclin.profiles;
  current_charge dozeclin.financial_charges;
  saved dozeclin.financial_charges;
begin
  select p.*
  into current_profile
  from dozeclin.profiles p
  where (p.auth_user_id = auth.uid() or p.id = auth.uid())
    and p.status = 'active'
    and p.role in ('clinic_admin', 'finance', 'supervisor', 'reception')
  limit 1;

  if not found then
    raise exception 'Utilizador sem permissao financeira.';
  end if;

  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'Motivo de cancelamento obrigatorio.';
  end if;

  if not exists (
    select 1
    from dozeclin.clinics c
    where c.id = current_profile.clinic_id
      and c.status in ('trial', 'active')
  ) then
    raise exception 'Clinica indisponivel para financeiro.';
  end if;

  select *
  into current_charge
  from dozeclin.financial_charges
  where id = p_charge_id
    and clinic_id = current_profile.clinic_id
  for update;

  if not found then
    raise exception 'Cobranca nao encontrada.';
  end if;

  if exists (
    select 1
    from dozeclin.financial_payments fp
    where fp.charge_id = current_charge.id
      and fp.payment_status = 'confirmed'
  ) then
    raise exception 'Cobranca com pagamento confirmado exige fluxo de estorno.';
  end if;

  set local dozeclin.financial_rpc = 'on';

  update dozeclin.financial_charges
  set status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = current_profile.id,
      cancellation_reason = trim(p_reason)
  where id = current_charge.id
  returning * into saved;

  insert into dozeclin.audit_logs (clinic_id, user_id, action, entity, entity_id, previous_data, new_data)
  values (
    saved.clinic_id,
    auth.uid(),
    'financial.charge_cancelled',
    'financial_charges',
    saved.id,
    jsonb_build_object('status', current_charge.status),
    jsonb_build_object('status', saved.status, 'cancelled_at', saved.cancelled_at)
  );

  return saved;
end;
$$;

create or replace function dozeclin.maybe_create_appointment_charge(p_appointment_id uuid)
returns dozeclin.financial_charges
language plpgsql
security definer
set search_path = dozeclin, auth
as $$
declare
  target_appointment dozeclin.appointments;
  settings dozeclin.clinic_settings;
  target_clinic dozeclin.clinics;
  saved dozeclin.financial_charges;
begin
  select *
  into target_appointment
  from dozeclin.appointments
  where id = p_appointment_id;

  if not found then
    return null;
  end if;

  select *
  into settings
  from dozeclin.clinic_settings
  where clinic_id = target_appointment.clinic_id;

  select *
  into target_clinic
  from dozeclin.clinics
  where id = target_appointment.clinic_id;

  if not coalesce(settings.auto_create_charge_on_completion, false) then
    return null;
  end if;

  if coalesce(settings.default_session_price, 0) <= 0 then
    return null;
  end if;

  if exists (
    select 1
    from dozeclin.financial_charges fc
    where fc.appointment_id = target_appointment.id
      and fc.charge_type = 'appointment'
      and fc.status in ('pending', 'partially_paid', 'paid', 'overdue')
  ) then
    return null;
  end if;

  set local dozeclin.financial_rpc = 'on';

  insert into dozeclin.financial_charges (
    clinic_id,
    patient_id,
    appointment_id,
    description,
    charge_type,
    currency,
    amount,
    discount_amount,
    final_amount,
    due_date,
    paid_amount,
    remaining_amount,
    created_by
  )
  values (
    target_appointment.clinic_id,
    target_appointment.patient_id,
    target_appointment.id,
    'Sessao concluida',
    'appointment',
    upper(coalesce(target_clinic.default_currency, 'EUR')),
    settings.default_session_price,
    0,
    0,
    current_date + coalesce(settings.default_payment_terms_days, 0),
    0,
    0,
    target_appointment.updated_by
  )
  returning * into saved;

  insert into dozeclin.audit_logs (clinic_id, user_id, action, entity, entity_id, new_data)
  values (
    saved.clinic_id,
    auth.uid(),
    'financial.charge_created',
    'financial_charges',
    saved.id,
    jsonb_build_object(
      'source', 'appointment_completed',
      'appointment_id', saved.appointment_id,
      'currency', saved.currency,
      'final_amount', saved.final_amount
    )
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

  if p_next_status = 'completed' then
    begin
      perform dozeclin.maybe_create_appointment_charge(saved.id);
    exception
      when others then
        insert into dozeclin.audit_logs (clinic_id, user_id, action, entity, entity_id, new_data)
        values (
          saved.clinic_id,
          auth.uid(),
          'financial.charge_auto_failed',
          'appointments',
          saved.id,
          jsonb_build_object('error', sqlerrm)
        );
    end;
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

create or replace function dozeclin.get_financial_dashboard_summary()
returns jsonb
language plpgsql
security definer
set search_path = dozeclin, auth
stable
as $$
declare
  current_clinic uuid := dozeclin.current_clinic_id();
  clinic_timezone text;
  month_start date;
  month_end date;
  payload jsonb;
begin
  if current_clinic is null or not dozeclin.can_access_financial(current_clinic) then
    raise exception 'Utilizador sem permissao financeira.';
  end if;

  select coalesce(c.timezone, 'Europe/Lisbon')
  into clinic_timezone
  from dozeclin.clinics c
  where c.id = current_clinic;

  month_start := date_trunc('month', now() at time zone clinic_timezone)::date;
  month_end := (month_start + interval '1 month')::date;

  select jsonb_build_object(
    'currencies', coalesce(currency_rows.rows, '[]'::jsonb),
    'pending_charges', coalesce((select count(*) from dozeclin.financial_charges where clinic_id = current_clinic and status = 'pending'), 0),
    'partial_charges', coalesce((select count(*) from dozeclin.financial_charges where clinic_id = current_clinic and status = 'partially_paid'), 0),
    'overdue_charges', coalesce((
      select count(*)
      from dozeclin.financial_charges
      where clinic_id = current_clinic
        and status in ('pending', 'overdue')
        and due_date is not null
        and due_date < (now() at time zone clinic_timezone)::date
    ), 0),
    'receipts_issued', coalesce((select count(*) from dozeclin.financial_receipts where clinic_id = current_clinic and status = 'issued'), 0),
    'completed_without_charge', coalesce((
      select count(*)
      from dozeclin.appointments a
      where a.clinic_id = current_clinic
        and a.status = 'completed'
        and not exists (
          select 1 from dozeclin.financial_charges fc
          where fc.appointment_id = a.id
            and fc.status <> 'cancelled'
        )
    ), 0)
  )
  into payload
  from lateral (
    select jsonb_agg(to_jsonb(row_data) order by row_data.currency) as rows
    from (
      select c.currency,
             coalesce(sum(c.remaining_amount) filter (where c.status in ('pending', 'partially_paid', 'overdue')), 0) as receivable,
             coalesce((
               select sum(p.amount)
               from dozeclin.financial_payments p
               where p.clinic_id = current_clinic
                 and p.currency = c.currency
                 and p.payment_status = 'confirmed'
                 and (p.payment_date at time zone clinic_timezone)::date >= month_start
                 and (p.payment_date at time zone clinic_timezone)::date < month_end
             ), 0) as received_month,
             coalesce(sum(c.remaining_amount) filter (
               where c.status in ('pending', 'overdue')
                 and c.due_date is not null
                 and c.due_date < (now() at time zone clinic_timezone)::date
             ), 0) as overdue
      from dozeclin.financial_charges c
      where c.clinic_id = current_clinic
      group by c.currency
      union
      select currency, 0, 0, 0
      from (values ('EUR'), ('BRL'), ('USD')) as allowed(currency)
      where not exists (
        select 1 from dozeclin.financial_charges fc
        where fc.clinic_id = current_clinic
          and fc.currency = allowed.currency
      )
    ) row_data
  ) currency_rows;

  return payload;
end;
$$;

create or replace function dozeclin.get_patient_financial_summary(p_patient_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = dozeclin, auth
stable
as $$
declare
  current_clinic uuid := dozeclin.current_clinic_id();
  payload jsonb;
begin
  if current_clinic is null or not dozeclin.can_access_financial(current_clinic) then
    raise exception 'Utilizador sem permissao financeira.';
  end if;

  if not exists (
    select 1 from dozeclin.patients p
    where p.id = p_patient_id
      and p.clinic_id = current_clinic
  ) then
    raise exception 'Paciente nao encontrado.';
  end if;

  select jsonb_build_object(
    'charges', coalesce(charges.rows, '[]'::jsonb),
    'payments', coalesce(payments.rows, '[]'::jsonb),
    'receipts', coalesce(receipts.rows, '[]'::jsonb),
    'open_balance', coalesce(open_balance.rows, '[]'::jsonb)
  )
  into payload
  from lateral (
    select jsonb_agg(
      to_jsonb(c)
      || jsonb_build_object(
        'status',
        case
          when c.status = 'pending' and c.due_date is not null and c.due_date < current_date
            then 'overdue'
          else c.status::text
        end
      )
      order by c.created_at desc
    ) as rows
    from dozeclin.financial_charges c
    where c.clinic_id = current_clinic
      and c.patient_id = p_patient_id
  ) charges
  cross join lateral (
    select jsonb_agg(to_jsonb(p) order by p.payment_date desc) as rows
    from dozeclin.financial_payments p
    where p.clinic_id = current_clinic
      and p.patient_id = p_patient_id
  ) payments
  cross join lateral (
    select jsonb_agg(to_jsonb(r) order by r.issued_at desc) as rows
    from dozeclin.financial_receipts r
    where r.clinic_id = current_clinic
      and r.patient_id = p_patient_id
  ) receipts
  cross join lateral (
    select jsonb_agg(to_jsonb(row_data) order by row_data.currency) as rows
    from (
      select currency, sum(remaining_amount) as amount
      from dozeclin.financial_charges
      where clinic_id = current_clinic
        and patient_id = p_patient_id
        and status in ('pending', 'partially_paid', 'overdue')
      group by currency
    ) row_data
  ) open_balance;

  return payload;
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
             fr.receipt_number,
             fr.currency,
             fr.amount,
             fr.issued_at,
             fr.status
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

alter table dozeclin.financial_charges enable row level security;
alter table dozeclin.financial_payments enable row level security;
alter table dozeclin.financial_receipts enable row level security;
alter table dozeclin.financial_receipt_sequences enable row level security;

drop policy if exists "financial_charges_select_staff_or_patient" on dozeclin.financial_charges;
create policy "financial_charges_select_staff_or_patient" on dozeclin.financial_charges
for select using (
  dozeclin.can_access_financial(clinic_id)
  or dozeclin.is_patient_self(patient_id)
);

drop policy if exists "financial_charges_insert_via_rpc" on dozeclin.financial_charges;
create policy "financial_charges_insert_via_rpc" on dozeclin.financial_charges
for insert with check (
  dozeclin.can_manage_financial(clinic_id)
  and coalesce(current_setting('dozeclin.financial_rpc', true), '') = 'on'
);

drop policy if exists "financial_charges_update_via_rpc" on dozeclin.financial_charges;
create policy "financial_charges_update_via_rpc" on dozeclin.financial_charges
for update using (dozeclin.can_manage_financial(clinic_id))
with check (
  dozeclin.can_manage_financial(clinic_id)
  and coalesce(current_setting('dozeclin.financial_rpc', true), '') = 'on'
);

drop policy if exists "financial_payments_select_staff_or_patient" on dozeclin.financial_payments;
create policy "financial_payments_select_staff_or_patient" on dozeclin.financial_payments
for select using (
  dozeclin.can_access_financial(clinic_id)
  or dozeclin.is_patient_self(patient_id)
);

drop policy if exists "financial_payments_insert_via_rpc" on dozeclin.financial_payments;
create policy "financial_payments_insert_via_rpc" on dozeclin.financial_payments
for insert with check (
  dozeclin.can_manage_financial(clinic_id)
  and coalesce(current_setting('dozeclin.financial_rpc', true), '') = 'on'
);

drop policy if exists "financial_receipts_select_staff_or_patient" on dozeclin.financial_receipts;
create policy "financial_receipts_select_staff_or_patient" on dozeclin.financial_receipts
for select using (
  dozeclin.can_access_financial(clinic_id)
  or dozeclin.is_patient_self(patient_id)
);

drop policy if exists "financial_receipts_insert_via_rpc" on dozeclin.financial_receipts;
create policy "financial_receipts_insert_via_rpc" on dozeclin.financial_receipts
for insert with check (
  dozeclin.can_manage_financial(clinic_id)
  and coalesce(current_setting('dozeclin.financial_rpc', true), '') = 'on'
);

drop policy if exists "financial_receipt_sequences_select_rpc" on dozeclin.financial_receipt_sequences;
create policy "financial_receipt_sequences_select_rpc" on dozeclin.financial_receipt_sequences
for select using (
  dozeclin.can_manage_financial(clinic_id)
  and coalesce(current_setting('dozeclin.financial_rpc', true), '') = 'on'
);

drop policy if exists "financial_receipt_sequences_insert_rpc" on dozeclin.financial_receipt_sequences;
create policy "financial_receipt_sequences_insert_rpc" on dozeclin.financial_receipt_sequences
for insert with check (
  dozeclin.can_manage_financial(clinic_id)
  and coalesce(current_setting('dozeclin.financial_rpc', true), '') = 'on'
);

drop policy if exists "financial_receipt_sequences_update_rpc" on dozeclin.financial_receipt_sequences;
create policy "financial_receipt_sequences_update_rpc" on dozeclin.financial_receipt_sequences
for update using (
  dozeclin.can_manage_financial(clinic_id)
  and coalesce(current_setting('dozeclin.financial_rpc', true), '') = 'on'
) with check (
  dozeclin.can_manage_financial(clinic_id)
  and coalesce(current_setting('dozeclin.financial_rpc', true), '') = 'on'
);

revoke select, insert, update, delete on dozeclin.financial_charges from authenticated;
revoke select, insert, update, delete on dozeclin.financial_payments from authenticated;
revoke select, insert, update, delete on dozeclin.financial_receipts from authenticated;
revoke all on dozeclin.financial_receipt_sequences from authenticated;

grant select (
  id,
  clinic_id,
  patient_id,
  appointment_id,
  description,
  charge_type,
  status,
  currency,
  amount,
  discount_amount,
  final_amount,
  due_date,
  paid_amount,
  remaining_amount,
  created_by,
  cancelled_by,
  cancelled_at,
  created_at,
  updated_at
) on dozeclin.financial_charges to authenticated;

grant select (
  id,
  clinic_id,
  charge_id,
  patient_id,
  amount,
  currency,
  payment_method,
  payment_status,
  payment_date,
  registered_by,
  cancelled_at,
  created_at,
  updated_at
) on dozeclin.financial_payments to authenticated;

grant select (
  id,
  clinic_id,
  payment_id,
  charge_id,
  patient_id,
  receipt_number,
  currency,
  amount,
  issued_at,
  issued_by,
  status,
  cancelled_at,
  created_at
) on dozeclin.financial_receipts to authenticated;

revoke execute on function dozeclin.can_access_financial(uuid) from public, anon;
revoke execute on function dozeclin.can_manage_financial(uuid) from public, anon;
revoke execute on function dozeclin.normalize_financial_charge() from public, anon, authenticated;
revoke execute on function dozeclin.protect_financial_charge_integrity() from public, anon, authenticated;
revoke execute on function dozeclin.protect_financial_payment_integrity() from public, anon, authenticated;
revoke execute on function dozeclin.protect_financial_receipt_integrity() from public, anon, authenticated;
revoke execute on function dozeclin.protect_financial_delete() from public, anon, authenticated;
revoke execute on function dozeclin.next_receipt_number(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function dozeclin.create_financial_charge(uuid, text, dozeclin.financial_charge_type, uuid, text, numeric, numeric, date, text) from public, anon;
revoke execute on function dozeclin.register_payment(uuid, numeric, dozeclin.financial_payment_method, timestamptz, text, text, text) from public, anon;
revoke execute on function dozeclin.cancel_charge(uuid, text) from public, anon;
revoke execute on function dozeclin.maybe_create_appointment_charge(uuid) from public, anon, authenticated;
revoke execute on function dozeclin.get_financial_dashboard_summary() from public, anon;
revoke execute on function dozeclin.get_patient_financial_summary(uuid) from public, anon;

grant execute on function dozeclin.can_access_financial(uuid) to authenticated, service_role;
grant execute on function dozeclin.can_manage_financial(uuid) to authenticated, service_role;
grant execute on function dozeclin.create_financial_charge(uuid, text, dozeclin.financial_charge_type, uuid, text, numeric, numeric, date, text) to authenticated;
grant execute on function dozeclin.register_payment(uuid, numeric, dozeclin.financial_payment_method, timestamptz, text, text, text) to authenticated;
grant execute on function dozeclin.cancel_charge(uuid, text) to authenticated;
grant execute on function dozeclin.get_financial_dashboard_summary() to authenticated;
grant execute on function dozeclin.get_patient_financial_summary(uuid) to authenticated;

grant all privileges on dozeclin.financial_charges to service_role;
grant all privileges on dozeclin.financial_payments to service_role;
grant all privileges on dozeclin.financial_receipts to service_role;
grant all privileges on dozeclin.financial_receipt_sequences to service_role;
grant execute on function dozeclin.maybe_create_appointment_charge(uuid) to service_role;
grant execute on function dozeclin.next_receipt_number(uuid, timestamptz) to service_role;

commit;
