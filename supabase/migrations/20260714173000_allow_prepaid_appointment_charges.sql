begin;

create or replace function dozeclin.normalize_financial_charge()
returns trigger
language plpgsql
security definer
set search_path = dozeclin, auth
as $$
begin
  new.currency := upper(new.currency);
  new.description := nullif(trim(coalesce(new.description, '')), '');

  if new.appointment_id is not null then
    new.charge_type := 'appointment';
  end if;

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
      and a.status in ('scheduled', 'confirmed', 'checked_in', 'in_progress', 'completed')
  ) then
    raise exception 'Este atendimento nao esta disponivel para cobranca.';
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
  target_appointment dozeclin.appointments;
  effective_charge_type dozeclin.financial_charge_type;
  effective_currency text;
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

  if not exists (
    select 1
    from dozeclin.patients p
    where p.id = p_patient_id
      and p.clinic_id = current_profile.clinic_id
      and p.status <> 'archived'
  ) then
    raise exception 'Paciente invalido para esta cobranca.';
  end if;

  effective_charge_type := case
    when p_appointment_id is not null then 'appointment'::dozeclin.financial_charge_type
    else coalesce(p_charge_type, 'manual'::dozeclin.financial_charge_type)
  end;

  if effective_charge_type = 'appointment' and p_appointment_id is null then
    raise exception 'Appointment obrigatorio para cobranca de sessao.';
  end if;

  if p_appointment_id is not null then
    select *
    into target_appointment
    from dozeclin.appointments a
    where a.id = p_appointment_id
      and a.clinic_id = current_profile.clinic_id
      and a.patient_id = p_patient_id
    for update;

    if not found
      or target_appointment.status not in ('scheduled', 'confirmed', 'checked_in', 'in_progress', 'completed') then
      raise exception 'Este atendimento nao esta disponivel para cobranca.';
    end if;

    if exists (
      select 1
      from dozeclin.financial_charges fc
      where fc.appointment_id = target_appointment.id
        and fc.charge_type = 'appointment'
        and fc.status in ('pending', 'partially_paid', 'paid', 'overdue')
    ) then
      raise exception 'Este atendimento ja possui cobranca ativa.';
    end if;
  end if;

  effective_currency := upper(coalesce(nullif(trim(p_currency), ''), target_clinic.default_currency, 'EUR'));

  if effective_currency not in ('EUR', 'BRL', 'USD') then
    raise exception 'Moeda invalida.';
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
    effective_charge_type,
    effective_currency,
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

  if not found or target_appointment.status <> 'completed' then
    return null;
  end if;

  select *
  into saved
  from dozeclin.financial_charges fc
  where fc.appointment_id = target_appointment.id
    and fc.charge_type = 'appointment'
    and fc.status in ('pending', 'partially_paid', 'paid', 'overdue')
  order by fc.created_at asc
  limit 1;

  if found then
    return saved;
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

revoke execute on function dozeclin.normalize_financial_charge() from public, anon, authenticated;
revoke execute on function dozeclin.maybe_create_appointment_charge(uuid) from public, anon, authenticated;
revoke execute on function dozeclin.create_financial_charge(uuid, text, dozeclin.financial_charge_type, uuid, text, numeric, numeric, date, text) from public, anon;
grant execute on function dozeclin.create_financial_charge(uuid, text, dozeclin.financial_charge_type, uuid, text, numeric, numeric, date, text) to authenticated;
grant execute on function dozeclin.maybe_create_appointment_charge(uuid) to service_role;

commit;
