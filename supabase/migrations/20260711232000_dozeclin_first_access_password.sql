begin;

alter table dozeclin.profiles
  add column if not exists must_change_password boolean not null default false,
  add column if not exists password_changed_at timestamptz,
  add column if not exists activated_at timestamptz;

create or replace function dozeclin.protect_profile_first_access_fields()
returns trigger
language plpgsql
security definer
set search_path = dozeclin, auth
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if old.must_change_password is distinct from new.must_change_password
    or old.password_changed_at is distinct from new.password_changed_at
    or old.activated_at is distinct from new.activated_at
  then
    raise exception 'Campos de primeiro acesso so podem ser alterados por fluxo seguro.';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_profile_first_access_fields_before_update on dozeclin.profiles;
create trigger protect_profile_first_access_fields_before_update
before update on dozeclin.profiles
for each row execute function dozeclin.protect_profile_first_access_fields();

create or replace function dozeclin.activate_clinic_admin_first_access(
  p_profile_id uuid,
  p_auth_user_id uuid
)
returns dozeclin.profiles
language plpgsql
security definer
set search_path = dozeclin, auth
as $$
declare
  target_profile dozeclin.profiles;
  updated_profile dozeclin.profiles;
begin
  select *
  into target_profile
  from dozeclin.profiles
  where id = p_profile_id
  for update;

  if not found then
    raise exception 'Perfil de administrador nao encontrado.';
  end if;

  if target_profile.role <> 'clinic_admin' then
    raise exception 'O perfil informado nao e administrador da clinica.';
  end if;

  if target_profile.status <> 'pending_invite' then
    raise exception 'O perfil informado nao esta pendente de convite.';
  end if;

  if target_profile.auth_user_id is not null then
    raise exception 'O perfil informado ja possui utilizador Auth associado.';
  end if;

  if exists (
    select 1
    from dozeclin.profiles p
    where p.auth_user_id = p_auth_user_id
  ) then
    raise exception 'Este utilizador Auth ja esta associado a outro perfil.';
  end if;

  update dozeclin.profiles
  set auth_user_id = p_auth_user_id,
      status = 'active',
      must_change_password = true,
      password_changed_at = null,
      activated_at = now(),
      updated_at = now()
  where id = p_profile_id
  returning * into updated_profile;

  return updated_profile;
end;
$$;

create or replace function dozeclin.mark_first_access_password_changed(
  p_auth_user_id uuid
)
returns dozeclin.profiles
language plpgsql
security definer
set search_path = dozeclin, auth
as $$
declare
  updated_profile dozeclin.profiles;
begin
  update dozeclin.profiles
  set must_change_password = false,
      password_changed_at = now(),
      status = 'active',
      updated_at = now()
  where auth_user_id = p_auth_user_id
    and must_change_password = true
  returning * into updated_profile;

  if not found then
    raise exception 'Perfil sem alteracao de senha obrigatoria pendente.';
  end if;

  return updated_profile;
end;
$$;

create or replace function dozeclin.mark_temporary_password_reset(
  p_profile_id uuid
)
returns dozeclin.profiles
language plpgsql
security definer
set search_path = dozeclin, auth
as $$
declare
  updated_profile dozeclin.profiles;
begin
  update dozeclin.profiles
  set must_change_password = true,
      password_changed_at = null,
      status = 'active',
      updated_at = now()
  where id = p_profile_id
    and role = 'clinic_admin'
    and auth_user_id is not null
  returning * into updated_profile;

  if not found then
    raise exception 'Perfil de administrador ativo nao encontrado.';
  end if;

  return updated_profile;
end;
$$;

revoke execute on function dozeclin.activate_clinic_admin_first_access(uuid, uuid) from public, anon, authenticated;
revoke execute on function dozeclin.mark_first_access_password_changed(uuid) from public, anon, authenticated;
revoke execute on function dozeclin.mark_temporary_password_reset(uuid) from public, anon, authenticated;
revoke execute on function dozeclin.protect_profile_first_access_fields() from public, anon, authenticated;

grant execute on function dozeclin.activate_clinic_admin_first_access(uuid, uuid) to service_role;
grant execute on function dozeclin.mark_first_access_password_changed(uuid) to service_role;
grant execute on function dozeclin.mark_temporary_password_reset(uuid) to service_role;

commit;
