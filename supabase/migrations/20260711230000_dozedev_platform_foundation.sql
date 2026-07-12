begin;

create schema if not exists dozedev;

do $$
begin
  create type dozedev.platform_user_role as enum ('super_admin', 'product_admin', 'support');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type dozedev.platform_user_status as enum ('active', 'inactive', 'suspended');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type dozedev.product_status as enum ('active', 'inactive', 'development');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type dozedev.product_access_role as enum ('super_admin', 'product_admin', 'support');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type dozedev.product_access_status as enum ('active', 'inactive', 'suspended');
exception
  when duplicate_object then null;
end $$;

create table if not exists dozedev.platform_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete restrict,
  email text not null,
  full_name text,
  role dozedev.platform_user_role not null default 'support',
  status dozedev.platform_user_status not null default 'active',
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_users_email_lower_check check (email = lower(email))
);

create table if not exists dozedev.products (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  description text,
  schema_name text not null,
  status dozedev.product_status not null default 'development',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_code_lower_check check (code = lower(code)),
  constraint products_schema_name_lower_check check (schema_name = lower(schema_name))
);

create table if not exists dozedev.platform_user_products (
  id uuid primary key default gen_random_uuid(),
  platform_user_id uuid not null,
  product_id uuid not null,
  access_role dozedev.product_access_role not null default 'support',
  status dozedev.product_access_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_user_products_platform_user_id_fkey
    foreign key (platform_user_id)
    references dozedev.platform_users(id)
    on delete restrict,
  constraint platform_user_products_product_id_fkey
    foreign key (product_id)
    references dozedev.products(id)
    on delete restrict,
  constraint platform_user_products_unique unique (platform_user_id, product_id)
);

create table if not exists dozedev.platform_audit_logs (
  id uuid primary key default gen_random_uuid(),
  platform_user_id uuid references dozedev.platform_users(id) on delete restrict,
  auth_user_id uuid references auth.users(id) on delete restrict,
  action text not null,
  product_code text,
  entity text not null,
  entity_id text,
  previous_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_dozedev_platform_users_email_unique
  on dozedev.platform_users(lower(email));

create unique index if not exists idx_dozedev_products_code_unique
  on dozedev.products(code);

create index if not exists idx_dozedev_platform_users_auth_user_id
  on dozedev.platform_users(auth_user_id);

create index if not exists idx_dozedev_platform_users_status
  on dozedev.platform_users(status);

create index if not exists idx_dozedev_products_status
  on dozedev.products(status);

create index if not exists idx_dozedev_platform_user_products_user
  on dozedev.platform_user_products(platform_user_id);

create index if not exists idx_dozedev_platform_user_products_product
  on dozedev.platform_user_products(product_id);

create index if not exists idx_dozedev_platform_user_products_status
  on dozedev.platform_user_products(status);

create index if not exists idx_dozedev_platform_audit_logs_user
  on dozedev.platform_audit_logs(platform_user_id);

create index if not exists idx_dozedev_platform_audit_logs_product_code
  on dozedev.platform_audit_logs(product_code);

create or replace function dozedev.set_updated_at()
returns trigger
language plpgsql
set search_path = dozedev
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_platform_users_updated_at on dozedev.platform_users;
create trigger set_platform_users_updated_at
before update on dozedev.platform_users
for each row execute function dozedev.set_updated_at();

drop trigger if exists set_products_updated_at on dozedev.products;
create trigger set_products_updated_at
before update on dozedev.products
for each row execute function dozedev.set_updated_at();

drop trigger if exists set_platform_user_products_updated_at on dozedev.platform_user_products;
create trigger set_platform_user_products_updated_at
before update on dozedev.platform_user_products
for each row execute function dozedev.set_updated_at();

create or replace function dozedev.current_platform_user_id()
returns uuid
language sql
security definer
set search_path = dozedev, auth
stable
as $$
  select pu.id
  from dozedev.platform_users pu
  where pu.auth_user_id = auth.uid()
    and pu.status = 'active'
  limit 1;
$$;

create or replace function dozedev.current_platform_role()
returns dozedev.platform_user_role
language sql
security definer
set search_path = dozedev, auth
stable
as $$
  select pu.role
  from dozedev.platform_users pu
  where pu.auth_user_id = auth.uid()
    and pu.status = 'active'
  limit 1;
$$;

create or replace function dozedev.is_platform_super_admin()
returns boolean
language sql
security definer
set search_path = dozedev, auth
stable
as $$
  select exists (
    select 1
    from dozedev.platform_users pu
    where pu.auth_user_id = auth.uid()
      and pu.role = 'super_admin'
      and pu.status = 'active'
  );
$$;

create or replace function dozedev.can_access_product(p_product_code text)
returns boolean
language sql
security definer
set search_path = dozedev, auth
stable
as $$
  select exists (
    select 1
    from dozedev.platform_users pu
    join dozedev.platform_user_products pup on pup.platform_user_id = pu.id
    join dozedev.products pr on pr.id = pup.product_id
    where pu.auth_user_id = auth.uid()
      and pu.status = 'active'
      and pup.status = 'active'
      and pr.status in ('active', 'development')
      and pr.code = lower(btrim(p_product_code))
  );
$$;

create or replace function dozedev.register_product(
  p_code text,
  p_name text,
  p_schema_name text,
  p_status text default 'development'
)
returns dozedev.products
language plpgsql
security definer
set search_path = dozedev, auth, public
as $$
declare
  normalized_code text := lower(btrim(p_code));
  normalized_schema text := lower(btrim(p_schema_name));
  normalized_status text := lower(btrim(p_status));
  registered_product dozedev.products;
  admin_user dozedev.platform_users;
begin
  if not dozedev.is_platform_super_admin() then
    raise exception 'Apenas Super Admin global pode registar produtos.';
  end if;

  if normalized_code is null or normalized_code = '' then
    raise exception 'Codigo do produto e obrigatorio.';
  end if;

  if nullif(btrim(p_name), '') is null then
    raise exception 'Nome do produto e obrigatorio.';
  end if;

  if normalized_schema is null or normalized_schema = '' then
    raise exception 'Schema do produto e obrigatorio.';
  end if;

  if normalized_status not in ('active', 'inactive', 'development') then
    raise exception 'Status do produto invalido.';
  end if;

  insert into dozedev.products (code, name, schema_name, status)
  values (normalized_code, btrim(p_name), normalized_schema, normalized_status::dozedev.product_status)
  on conflict (code) do update
  set name = excluded.name,
      schema_name = excluded.schema_name,
      status = excluded.status,
      updated_at = now()
  returning * into registered_product;

  select *
  into admin_user
  from dozedev.platform_users
  where email = 'admin@dozedev.pt'
    and role = 'super_admin'
    and status = 'active'
  limit 1;

  if found then
    insert into dozedev.platform_user_products (
      platform_user_id,
      product_id,
      access_role,
      status
    ) values (
      admin_user.id,
      registered_product.id,
      'super_admin',
      'active'
    )
    on conflict (platform_user_id, product_id) do update
    set access_role = excluded.access_role,
        status = excluded.status,
        updated_at = now();
  end if;

  insert into dozedev.platform_audit_logs (
    platform_user_id,
    auth_user_id,
    action,
    product_code,
    entity,
    entity_id,
    new_data
  ) values (
    dozedev.current_platform_user_id(),
    auth.uid(),
    'products.register',
    registered_product.code,
    'products',
    registered_product.id::text,
    jsonb_build_object(
      'code', registered_product.code,
      'name', registered_product.name,
      'schema_name', registered_product.schema_name,
      'status', registered_product.status
    )
  );

  return registered_product;
end;
$$;

alter table dozedev.platform_users enable row level security;
alter table dozedev.products enable row level security;
alter table dozedev.platform_user_products enable row level security;
alter table dozedev.platform_audit_logs enable row level security;

drop policy if exists "platform_users_select_self_or_super_admin" on dozedev.platform_users;
create policy "platform_users_select_self_or_super_admin" on dozedev.platform_users
for select using (
  id = dozedev.current_platform_user_id()
  or dozedev.is_platform_super_admin()
);

drop policy if exists "platform_users_update_super_admin" on dozedev.platform_users;
create policy "platform_users_update_super_admin" on dozedev.platform_users
for update using (dozedev.is_platform_super_admin())
with check (dozedev.is_platform_super_admin());

drop policy if exists "products_select_accessible" on dozedev.products;
create policy "products_select_accessible" on dozedev.products
for select using (
  dozedev.is_platform_super_admin()
  or dozedev.can_access_product(code)
);

drop policy if exists "products_update_super_admin" on dozedev.products;
create policy "products_update_super_admin" on dozedev.products
for update using (dozedev.is_platform_super_admin())
with check (dozedev.is_platform_super_admin());

drop policy if exists "platform_user_products_select_self_or_super_admin" on dozedev.platform_user_products;
create policy "platform_user_products_select_self_or_super_admin" on dozedev.platform_user_products
for select using (
  platform_user_id = dozedev.current_platform_user_id()
  or dozedev.is_platform_super_admin()
);

drop policy if exists "platform_user_products_insert_super_admin" on dozedev.platform_user_products;
create policy "platform_user_products_insert_super_admin" on dozedev.platform_user_products
for insert with check (dozedev.is_platform_super_admin());

drop policy if exists "platform_user_products_update_super_admin" on dozedev.platform_user_products;
create policy "platform_user_products_update_super_admin" on dozedev.platform_user_products
for update using (dozedev.is_platform_super_admin())
with check (dozedev.is_platform_super_admin());

drop policy if exists "platform_audit_logs_select_super_admin" on dozedev.platform_audit_logs;
create policy "platform_audit_logs_select_super_admin" on dozedev.platform_audit_logs
for select using (dozedev.is_platform_super_admin());

drop policy if exists "platform_audit_logs_insert_super_admin" on dozedev.platform_audit_logs;

insert into dozedev.products (code, name, description, schema_name, status)
values
  ('dozeclin', 'DOZECLIN', 'Gestao clinica SaaS', 'dozeclin', 'active'),
  ('dozeeat', 'DOZEEAT', 'Produto DOZEDEV para restaurantes', 'dozeeat', 'development'),
  ('dozeiron', 'DOZEIRON', 'Produto DOZEDEV para academias', 'dozeiron', 'development'),
  ('dozemec', 'DOZEMEC', 'Produto DOZEDEV para oficinas', 'dozemec', 'development'),
  ('dozeplay', 'DOZEPLAY', 'Produto DOZEDEV para entretenimento', 'dozeplay', 'development')
on conflict (code) do update
set name = excluded.name,
    description = excluded.description,
    schema_name = excluded.schema_name,
    status = excluded.status,
    updated_at = now();

do $$
declare
  admin_auth_id uuid;
  admin_platform_id uuid;
  product_record record;
begin
  select au.id
  into admin_auth_id
  from auth.users au
  where lower(au.email) = 'admin@dozedev.pt'
  limit 1;

  if admin_auth_id is null then
    raise exception 'Utilizador admin@dozedev.pt nao encontrado no Supabase Auth.';
  end if;

  insert into dozedev.platform_users (
    auth_user_id,
    email,
    full_name,
    role,
    status
  ) values (
    admin_auth_id,
    'admin@dozedev.pt',
    'Administrador DOZEDEV',
    'super_admin',
    'active'
  )
  on conflict (auth_user_id) do update
  set email = excluded.email,
      full_name = coalesce(dozedev.platform_users.full_name, excluded.full_name),
      role = 'super_admin',
      status = 'active',
      updated_at = now()
  returning id into admin_platform_id;

  for product_record in
    select id, code
    from dozedev.products
    where code in ('dozeclin', 'dozeeat', 'dozeiron', 'dozemec', 'dozeplay')
  loop
    insert into dozedev.platform_user_products (
      platform_user_id,
      product_id,
      access_role,
      status
    ) values (
      admin_platform_id,
      product_record.id,
      'super_admin',
      'active'
    )
    on conflict (platform_user_id, product_id) do update
    set access_role = 'super_admin',
        status = 'active',
        updated_at = now();
  end loop;

  insert into dozedev.platform_audit_logs (
    platform_user_id,
    auth_user_id,
    action,
    product_code,
    entity,
    entity_id,
    new_data
  ) values (
    admin_platform_id,
    admin_auth_id,
    'platform.bootstrap',
    null,
    'platform_users',
    admin_platform_id::text,
    jsonb_build_object('email', 'admin@dozedev.pt', 'role', 'super_admin', 'status', 'active')
  );
end $$;

create or replace function dozeclin.is_super_admin()
returns boolean
language sql
security definer
set search_path = dozeclin, dozedev, auth
as $$
  select
    dozedev.is_platform_super_admin()
    and dozedev.can_access_product('dozeclin');
$$;

revoke execute on function dozedev.set_updated_at() from public, anon, authenticated;
revoke execute on function dozedev.current_platform_user_id() from public, anon;
revoke execute on function dozedev.current_platform_role() from public, anon;
revoke execute on function dozedev.is_platform_super_admin() from public, anon;
revoke execute on function dozedev.can_access_product(text) from public, anon;
revoke execute on function dozedev.register_product(text, text, text, text) from public, anon;
revoke execute on function dozeclin.is_super_admin() from public, anon;

grant usage on schema dozedev to authenticated;
grant select on dozedev.platform_users to authenticated;
grant select on dozedev.products to authenticated;
grant select on dozedev.platform_user_products to authenticated;
grant select on dozedev.platform_audit_logs to authenticated;

revoke insert, update, delete
on dozedev.platform_audit_logs
from authenticated, anon;

grant execute on function dozedev.current_platform_user_id() to authenticated, service_role;
grant execute on function dozedev.current_platform_role() to authenticated, service_role;
grant execute on function dozedev.is_platform_super_admin() to authenticated, service_role;
grant execute on function dozedev.can_access_product(text) to authenticated, service_role;
grant execute on function dozedev.register_product(text, text, text, text) to authenticated, service_role;
grant execute on function dozeclin.is_super_admin() to authenticated, service_role;

grant usage on schema dozedev to service_role;
grant all privileges on all tables in schema dozedev to service_role;
grant all privileges on all routines in schema dozedev to service_role;
grant usage on all sequences in schema dozedev to service_role;

commit;
