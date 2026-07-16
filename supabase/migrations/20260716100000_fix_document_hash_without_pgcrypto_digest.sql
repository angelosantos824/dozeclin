begin;

do $$
begin
  if to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception 'A extensão pgcrypto/digest não está disponível no schema extensions.';
  end if;
end;
$$;

create or replace function dozeclin.sha256_jsonb(p_payload jsonb)
returns text
language sql
immutable
as $$
  select encode(extensions.digest(convert_to(p_payload::text, 'UTF8'), 'sha256'::text), 'hex');
$$;

create or replace function dozeclin.hash_public_token(p_token text)
returns text
language sql
immutable
as $$
  select encode(extensions.digest(convert_to(coalesce(p_token, ''), 'UTF8'), 'sha256'::text), 'hex');
$$;

revoke execute on function dozeclin.sha256_jsonb(jsonb) from public, anon;
revoke execute on function dozeclin.hash_public_token(text) from public, anon;
grant execute on function dozeclin.hash_public_token(text) to service_role;

commit;
