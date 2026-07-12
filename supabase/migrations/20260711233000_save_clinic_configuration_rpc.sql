begin;

create or replace function dozeclin.save_clinic_configuration(
  p_clinic jsonb,
  p_settings jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = dozeclin, auth
as $$
declare
  current_profile dozeclin.profiles;
  saved_clinic dozeclin.clinics;
  saved_settings dozeclin.clinic_settings;
  normalized_email text := lower(nullif(btrim(p_clinic ->> 'email'), ''));
  appointment_duration_value integer := coalesce(nullif(p_settings ->> 'appointment_duration', '')::integer, 50);
  appointment_interval_value integer := coalesce(nullif(p_settings ->> 'appointment_interval', '')::integer, 10);
begin
  select *
  into current_profile
  from dozeclin.profiles
  where auth_user_id = auth.uid()
    and status = 'active'
  limit 1;

  if current_profile.id is null then
    raise exception 'Perfil ativo nao encontrado.';
  end if;

  if current_profile.must_change_password then
    raise exception 'Altere a senha inicial antes de continuar.';
  end if;

  if current_profile.role <> 'clinic_admin' then
    raise exception 'Apenas administradores da clinica podem guardar configuracoes.';
  end if;

  if current_profile.clinic_id is null then
    raise exception 'Perfil sem clinica associada.';
  end if;

  if not exists (
    select 1
    from dozeclin.clinics c
    where c.id = current_profile.clinic_id
      and c.status in ('trial', 'active')
  ) then
    raise exception 'A clinica nao esta disponivel para alteracoes.';
  end if;

  if nullif(btrim(p_clinic ->> 'name'), '') is null then
    raise exception 'Nome da clinica e obrigatorio.';
  end if;

  if nullif(btrim(p_clinic ->> 'timezone'), '') is null then
    raise exception 'Fuso horario e obrigatorio.';
  end if;

  if normalized_email is not null
    and normalized_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  then
    raise exception 'Email da clinica invalido.';
  end if;

  if appointment_duration_value < 5 or appointment_duration_value > 480 then
    raise exception 'Duracao da consulta invalida.';
  end if;

  if appointment_interval_value < 0 or appointment_interval_value > 120 then
    raise exception 'Intervalo da agenda invalido.';
  end if;

  update dozeclin.clinics
  set name = btrim(p_clinic ->> 'name'),
      legal_name = nullif(btrim(p_clinic ->> 'legal_name'), ''),
      email = normalized_email,
      phone = nullif(btrim(p_clinic ->> 'phone'), ''),
      whatsapp = nullif(btrim(p_clinic ->> 'whatsapp'), ''),
      country = nullif(btrim(p_clinic ->> 'country'), ''),
      city = nullif(btrim(p_clinic ->> 'city'), ''),
      address = nullif(btrim(p_clinic ->> 'address'), ''),
      postal_code = nullif(btrim(p_clinic ->> 'postal_code'), ''),
      timezone = btrim(p_clinic ->> 'timezone'),
      default_currency = coalesce(nullif(btrim(p_clinic ->> 'default_currency'), ''), 'EUR'),
      primary_color = coalesce(nullif(btrim(p_clinic ->> 'primary_color'), ''), '#176B87'),
      secondary_color = coalesce(nullif(btrim(p_clinic ->> 'secondary_color'), ''), '#64CCC5'),
      updated_at = now()
  where id = current_profile.clinic_id
  returning * into saved_clinic;

  if saved_clinic.id is null then
    raise exception 'Clinica nao encontrada.';
  end if;

  insert into dozeclin.clinic_settings (
    clinic_id,
    specialty_label,
    professional_registration_label,
    appointment_duration,
    appointment_interval,
    cancellation_policy,
    default_language,
    footer_text,
    email_signature
  ) values (
    current_profile.clinic_id,
    nullif(btrim(p_settings ->> 'specialty_label'), ''),
    nullif(btrim(p_settings ->> 'professional_registration_label'), ''),
    appointment_duration_value,
    appointment_interval_value,
    nullif(btrim(p_settings ->> 'cancellation_policy'), ''),
    'pt-PT',
    nullif(btrim(p_settings ->> 'footer_text'), ''),
    nullif(btrim(p_settings ->> 'email_signature'), '')
  )
  on conflict (clinic_id) do update
  set specialty_label = excluded.specialty_label,
      professional_registration_label = excluded.professional_registration_label,
      appointment_duration = excluded.appointment_duration,
      appointment_interval = excluded.appointment_interval,
      cancellation_policy = excluded.cancellation_policy,
      default_language = excluded.default_language,
      footer_text = excluded.footer_text,
      email_signature = excluded.email_signature,
      updated_at = now()
  returning * into saved_settings;

  return jsonb_build_object(
    'clinic', to_jsonb(saved_clinic),
    'settings', to_jsonb(saved_settings)
  );
end;
$$;

revoke execute on function dozeclin.save_clinic_configuration(jsonb, jsonb) from public, anon;
grant execute on function dozeclin.save_clinic_configuration(jsonb, jsonb) to authenticated, service_role;

commit;
