begin;

drop policy if exists "professional_signatures_no_direct_read" on storage.objects;
drop policy if exists "professional_signatures_insert_own" on storage.objects;
drop policy if exists "professional_signatures_select_authorized" on storage.objects;
drop policy if exists "professional_signatures_update_own" on storage.objects;
drop policy if exists "professional_signatures_delete_own_unlinked" on storage.objects;

create or replace function dozeclin.can_upload_professional_signature(
  p_object_name text
)
returns boolean
language sql
stable
security definer
set search_path = dozeclin, storage, auth
as $$
  with path_parts as (
    select string_to_array(coalesce(p_object_name, ''), '/') as parts
  ),
  raw_parts as (
    select
      parts[1] as clinic_id_text,
      parts[2] as profile_id_text,
      parts[3] as signature_id_text,
      parts[4] as file_name
    from path_parts
    where array_length(parts, 1) = 4
  ),
  validated_parts as (
    select
      case
        when clinic_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then clinic_id_text::uuid
        else null
      end as clinic_id,
      case
        when profile_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then profile_id_text::uuid
        else null
      end as profile_id,
      case
        when signature_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then signature_id_text::uuid
        else null
      end as signature_id,
      file_name
    from raw_parts
  )
  select auth.uid() is not null
    and exists (
      select 1
      from validated_parts v
      join dozeclin.profiles p
        on p.id = v.profile_id
       and p.auth_user_id = auth.uid()
       and p.status = 'active'
      join dozeclin.clinics c
        on c.id = v.clinic_id
       and c.status in ('trial', 'active')
      where v.clinic_id is not null
        and v.profile_id is not null
        and v.signature_id is not null
        and v.file_name is not null
        and p.clinic_id = v.clinic_id
        and p.id = v.profile_id
    );
$$;

create or replace function dozeclin.can_read_professional_signature(
  p_object_name text
)
returns boolean
language sql
stable
security definer
set search_path = dozeclin, storage, auth
as $$
  with path_parts as (
    select string_to_array(coalesce(p_object_name, ''), '/') as parts
  ),
  raw_parts as (
    select
      parts[1] as clinic_id_text,
      parts[2] as profile_id_text,
      parts[3] as signature_id_text
    from path_parts
    where array_length(parts, 1) >= 4
  ),
  validated_parts as (
    select
      case
        when clinic_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then clinic_id_text::uuid
        else null
      end as clinic_id,
      case
        when profile_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then profile_id_text::uuid
        else null
      end as profile_id,
      case
        when signature_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then signature_id_text::uuid
        else null
      end as signature_id
    from raw_parts
  )
  select auth.uid() is not null
    and exists (
      select 1
      from validated_parts v
      join dozeclin.profiles p
        on p.auth_user_id = auth.uid()
       and p.status = 'active'
       and p.clinic_id = v.clinic_id
      join dozeclin.clinics c
        on c.id = v.clinic_id
       and c.status in ('trial', 'active')
      where v.clinic_id is not null
        and v.profile_id is not null
        and v.signature_id is not null
        and (
          p.id = v.profile_id
          or p.role in ('clinic_admin', 'supervisor')
        )
    );
$$;

create policy "professional_signatures_insert_own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'professional-signatures'
  and dozeclin.can_upload_professional_signature(name)
  and lower(storage.extension(name)) in ('png', 'webp', 'jpg', 'jpeg')
);

create policy "professional_signatures_select_authorized"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'professional-signatures'
  and dozeclin.can_read_professional_signature(name)
  and lower(storage.extension(name)) in ('png', 'webp', 'jpg', 'jpeg')
);

revoke execute on function dozeclin.can_upload_professional_signature(text) from public, anon;
revoke execute on function dozeclin.can_read_professional_signature(text) from public, anon;
grant execute on function dozeclin.can_upload_professional_signature(text) to authenticated, service_role;
grant execute on function dozeclin.can_read_professional_signature(text) to authenticated, service_role;

commit;
