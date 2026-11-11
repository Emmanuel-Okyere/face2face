-- Multi-tenancy: every person, face, check-in, kiosk and attempt belongs to an
-- organization (a school, church, company…). Isolation is enforced twice:
--   1. the app scopes every query to the signed-in admin's / kiosk's org, and
--   2. Postgres row-level security: tenant queries run as role `f2f_tenant`
--      with `app.org_id` set, so even a query missing a WHERE can't see
--      another organization's rows.

-- ─── Organizations & memberships ─────────────────────────────────────────────
create table if not exists organizations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(name) between 1 and 120),
  slug          text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 48),
  time_zone     text not null default 'UTC',
  late_after    text check (late_after ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),  -- null = lateness off
  self_checkin  boolean not null default false,                                 -- allow phone check-in links
  checkin_key   text not null default replace(gen_random_uuid()::text, '-', ''), -- rotate to revoke the shared link
  created_at    timestamptz not null default now()
);

create table if not exists memberships (
  org_id      uuid not null references organizations (id) on delete cascade,
  admin_id    uuid not null references admins (id) on delete cascade,
  role        text not null check (role in ('owner', 'admin')),
  created_at  timestamptz not null default now(),
  primary key (org_id, admin_id)
);
create index if not exists memberships_admin_idx on memberships (admin_id);

alter table admins add column if not exists is_platform_admin boolean not null default false;   -- runs the SaaS: creates orgs
alter table admins add column if not exists must_change_password boolean not null default false; -- temp password set by someone else

alter type attendance_method add value if not exists 'link';  -- self check-in from a personal/shared link

-- ─── Existing single-tenant data → "Default organization" ───────────────────
do $$
declare d uuid;
begin
  if not exists (select 1 from organizations)
     and (exists (select 1 from admins) or exists (select 1 from people)) then
    insert into organizations (name, slug, time_zone, late_after)
    values ('Default organization', 'default', 'UTC', '09:00') returning id into d;
    insert into memberships (org_id, admin_id, role) select d, id, 'owner' from admins;
    update admins set is_platform_admin = true
     where id = (select id from admins order by created_at limit 1);
  end if;
end $$;

-- ─── org_id on every tenant table ────────────────────────────────────────────
do $$
declare t text; d uuid := (select id from organizations order by created_at limit 1);
begin
  foreach t in array array['people', 'face_embeddings', 'attendance', 'kiosks', 'attempts'] loop
    if not exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = t and column_name = 'org_id') then
      execute format('alter table %I add column org_id uuid references organizations (id) on delete cascade', t);
      if d is not null then
        execute format('update %I set org_id = $1', t) using d;
      end if;
      execute format('alter table %I alter column org_id set not null', t);
      -- Inserts made inside a tenant transaction get the org automatically.
      execute format($f$alter table %I alter column org_id set default nullif(current_setting('app.org_id', true), '')::uuid$f$, t);
      execute format('create index if not exists %I on %I (org_id)', t || '_org_idx', t);
    end if;
  end loop;
end $$;

-- ID codes are unique per organization, not globally.
alter table people drop constraint if exists people_code_key;
create unique index if not exists people_org_code_key on people (org_id, code);

-- A face or check-in can never point at another organization's person.
create unique index if not exists people_org_id_id_key on people (org_id, id);
do $$ begin
  alter table face_embeddings add constraint face_embeddings_same_org
    foreign key (org_id, person_id) references people (org_id, id) on delete cascade;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table attendance add constraint attendance_same_org
    foreign key (org_id, person_id) references people (org_id, id) on delete cascade;
exception when duplicate_object then null; end $$;

-- One global HNSW graph filtered per tenant loses recall (it returns the global
-- top-k, then drops other orgs' rows). Per org there are only ~5k vectors, so an
-- exact scan on the org index is fast (a few ms) and always correct.
drop index if exists face_embeddings_hnsw;
create index if not exists attendance_org_day_idx on attendance (org_id, day, checked_in_at desc);

-- ─── Row-level security for tenant queries ───────────────────────────────────
do $$ begin
  create role f2f_tenant nologin;
exception when duplicate_object then null; end $$;
grant f2f_tenant to current_user;  -- lets the app's login `SET ROLE f2f_tenant`
grant usage on schema public to f2f_tenant;
grant select, insert, update, delete on people, face_embeddings, attendance, kiosks, attempts to f2f_tenant;
grant usage, select on all sequences in schema public to f2f_tenant;
grant usage on type attendance_method to f2f_tenant;
grant select (id, name) on admins to f2f_tenant;  -- "recorded by" / "paired by" names only

do $$
declare t text;
begin
  foreach t in array array['people', 'face_embeddings', 'attendance', 'kiosks', 'attempts'] loop
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format($p$create policy tenant_isolation on %I for all to f2f_tenant
      using (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
      with check (org_id = nullif(current_setting('app.org_id', true), '')::uuid)$p$, t);
  end loop;
end $$;
-- f2f_tenant can read admin names (above) but no other admin rows.
drop policy if exists tenant_read_names on admins;
create policy tenant_read_names on admins for select to f2f_tenant using (true);

alter table organizations enable row level security;
alter table memberships   enable row level security;
