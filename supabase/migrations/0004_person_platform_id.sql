-- Every person gets a short, readable PLATFORM ID (e.g. K7QM-4XHT), unique
-- across all organizations. The organization's own ID code becomes optional.
--
-- Alphabet: 30 characters with the confusable ones removed (0 O 1 I L U), so IDs
-- are easy to read aloud and type on a phone. 30^8 ≈ 6.6 × 10^11 combinations.
-- IDs aren't secrets: badges and links are separately HMAC-signed.

create or replace function gen_person_ref() returns text
language plpgsql volatile
security definer               -- sees every org's IDs (bypasses tenant RLS) to guarantee global uniqueness
set search_path = public, pg_temp
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTVWXYZ';
  bytes bytea;
  r text;
begin
  loop
    bytes := uuid_send(gen_random_uuid());   -- 16 cryptographically random bytes (v4 UUID)
    r := '';
    for i in 0..7 loop
      -- Skip byte 6 (UUID version nibble); modulo bias over 256→30 is negligible for IDs.
      r := r || substr(alphabet, 1 + (get_byte(bytes, case when i >= 6 then i + 2 else i end) % 30), 1);
      if i = 3 then r := r || '-'; end if;
    end loop;
    exit when not exists (select 1 from people where ref = r);
  end loop;
  return r;
end $$;
revoke all on function gen_person_ref() from public;
grant execute on function gen_person_ref() to f2f_tenant, current_user;

alter table people add column if not exists ref text;
update people set ref = gen_person_ref() where ref is null;
alter table people alter column ref set default gen_person_ref();
alter table people alter column ref set not null;
create unique index if not exists people_ref_key on people (ref);
do $$ begin
  alter table people add constraint people_ref_format check (ref ~ '^[2-9A-HJKMNP-TV-Z]{4}-[2-9A-HJKMNP-TV-Z]{4}$');
exception when duplicate_object then null; end $$;

-- The organization's own code (staff / student / member number) is now optional.
-- Still unique within an organization when present (NULLs don't collide).
alter table people alter column code drop not null;
update people set code = null where code = '';
do $$ begin
  alter table people add constraint people_code_not_blank check (code is null or length(btrim(code)) > 0);
exception when duplicate_object then null; end $$;
