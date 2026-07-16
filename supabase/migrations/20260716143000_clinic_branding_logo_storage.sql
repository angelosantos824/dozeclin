begin;

update storage.buckets
set
  file_size_limit = 5242880,
  allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
where id = 'document-assets';

create or replace function dozeclin.can_manage_clinic_branding_asset(
  p_object_name text
)
returns boolean
language sql
stable
security definer
set search_path = dozeclin, auth
as $$
  with path_parts as (
    select string_to_array(coalesce(p_object_name, ''), '/') as parts
  ),
  parsed as (
    select
      parts[1] as root_folder,
      parts[2] as clinic_id_text,
      parts[3] as file_name
    from path_parts
    where array_length(parts, 1) = 3
  ),
  validated as (
    select
      root_folder,
      case
        when clinic_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then clinic_id_text::uuid
        else null
      end as clinic_id,
      file_name
    from parsed
  )
  select auth.uid() is not null
    and exists (
      select 1
      from validated v
      join dozeclin.profiles p
        on p.auth_user_id = auth.uid()
       and p.clinic_id = v.clinic_id
       and p.role = 'clinic_admin'
       and p.status = 'active'
      join dozeclin.clinics c
        on c.id = v.clinic_id
       and c.status in ('trial', 'active')
      where v.root_folder = 'clinic-branding'
        and v.clinic_id is not null
        and v.file_name ~* '^logo\.(png|jpe?g|webp)$'
    );
$$;

create or replace function dozeclin.can_read_clinic_branding_asset(
  p_object_name text
)
returns boolean
language sql
stable
security definer
set search_path = dozeclin, auth
as $$
  with path_parts as (
    select string_to_array(coalesce(p_object_name, ''), '/') as parts
  ),
  parsed as (
    select
      parts[1] as root_folder,
      parts[2] as clinic_id_text,
      parts[3] as file_name
    from path_parts
    where array_length(parts, 1) = 3
  ),
  validated as (
    select
      root_folder,
      case
        when clinic_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then clinic_id_text::uuid
        else null
      end as clinic_id,
      file_name
    from parsed
  )
  select auth.uid() is not null
    and exists (
      select 1
      from validated v
      join dozeclin.profiles p
        on p.auth_user_id = auth.uid()
       and p.clinic_id = v.clinic_id
       and p.status = 'active'
      join dozeclin.clinics c
        on c.id = v.clinic_id
       and c.status in ('trial', 'active')
      where v.root_folder = 'clinic-branding'
        and v.clinic_id is not null
        and v.file_name ~* '^logo\.(png|jpe?g|webp)$'
    );
$$;

drop policy if exists "clinic_branding_assets_select_own" on storage.objects;
drop policy if exists "clinic_branding_assets_insert_own" on storage.objects;
drop policy if exists "clinic_branding_assets_update_own" on storage.objects;
drop policy if exists "clinic_branding_assets_delete_own" on storage.objects;

create policy "clinic_branding_assets_select_own"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'document-assets'
  and dozeclin.can_read_clinic_branding_asset(name)
);

create policy "clinic_branding_assets_insert_own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'document-assets'
  and dozeclin.can_manage_clinic_branding_asset(name)
  and lower(storage.extension(name)) in ('png', 'jpg', 'jpeg', 'webp')
);

create policy "clinic_branding_assets_update_own"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'document-assets'
  and dozeclin.can_manage_clinic_branding_asset(name)
)
with check (
  bucket_id = 'document-assets'
  and dozeclin.can_manage_clinic_branding_asset(name)
  and lower(storage.extension(name)) in ('png', 'jpg', 'jpeg', 'webp')
);

create policy "clinic_branding_assets_delete_own"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'document-assets'
  and dozeclin.can_manage_clinic_branding_asset(name)
);

revoke execute on function dozeclin.can_manage_clinic_branding_asset(text) from public, anon;
revoke execute on function dozeclin.can_read_clinic_branding_asset(text) from public, anon;
grant execute on function dozeclin.can_manage_clinic_branding_asset(text) to authenticated, service_role;
grant execute on function dozeclin.can_read_clinic_branding_asset(text) to authenticated, service_role;

commit;
