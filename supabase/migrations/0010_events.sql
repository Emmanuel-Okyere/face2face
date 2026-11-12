-- Events such as a district camp meeting: public family registration, room and
-- bed allocation, bus seats, and SMS/email notices to the people registered.
--
--   events            one per camp / convention (belongs to the organizing org, e.g. the district)
--   event_households  one registration: a family or a single person, with a contact phone
--   event_registrants each person attending (name, gender, age, church, room/bed, bus/seat)
--   event_rooms       configurable rooms with a bed count, gender and optional church
--   event_buses       configurable buses with a seat count and the churches they serve
--   event_messages    outbox of SMS/email notices: one row per message, never sent twice

create table if not exists events (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null default nullif(current_setting('app.org_id', true), '')::uuid
                  references organizations (id) on delete cascade,
  name          text not null check (length(btrim(name)) between 1 and 120),
  venue         text,
  starts_on     date,
  ends_on       date,
  registration_open boolean not null default true,
  churches      text[] not null default '{}',     -- participating churches, picked at registration
  age_groups    jsonb not null default '[{"name":"Children","upTo":9},{"name":"Pathfinders","upTo":15},{"name":"Youth","upTo":30},{"name":"Adults","upTo":59},{"name":"Seniors","upTo":150}]',
  child_age     int not null default 12 check (child_age between 0 and 21),  -- this age and under stay with a parent
  questions     jsonb not null default '[]',      -- extra per-person questions (FieldDef[])
  public_token  text not null unique default replace(gen_random_uuid()::text, '-', ''),
  archived      boolean not null default false,
  created_at    timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
create index if not exists events_org_idx on events (org_id);

create table if not exists event_rooms (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null default nullif(current_setting('app.org_id', true), '')::uuid
               references organizations (id) on delete cascade,
  event_id   uuid not null references events (id) on delete cascade,
  building   text not null default '',
  name       text not null check (length(btrim(name)) between 1 and 60),
  gender     text not null check (gender in ('male', 'female', 'family')),
  beds       int not null check (beds between 1 and 200),
  church     text,                                -- reserved for one church (optional)
  note       text,
  created_at timestamptz not null default now(),
  unique (event_id, building, name)
);
create index if not exists event_rooms_event_idx on event_rooms (event_id);

create table if not exists event_buses (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null default nullif(current_setting('app.org_id', true), '')::uuid
                 references organizations (id) on delete cascade,
  event_id     uuid not null references events (id) on delete cascade,
  name         text not null check (length(btrim(name)) between 1 and 60),
  seats        int not null check (seats between 1 and 120),
  churches     text[] not null default '{}',      -- empty = any church
  pickup       text,
  departs      text,                              -- free text, e.g. "Fri 6:00 am"
  driver       text,
  created_at   timestamptz not null default now(),
  unique (event_id, name)
);
create index if not exists event_buses_event_idx on event_buses (event_id);

create table if not exists event_households (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null default nullif(current_setting('app.org_id', true), '')::uuid
                  references organizations (id) on delete cascade,
  event_id      uuid not null references events (id) on delete cascade,
  church        text not null,
  contact_name  text not null,
  contact_phone text,                             -- E.164
  contact_email text,
  code          text not null unique default gen_person_ref(),   -- family code, e.g. 7KQ2-M9XD
  pass_token    text not null unique default replace(gen_random_uuid()::text, '-', ''),
  source        text not null default 'public' check (source in ('public', 'admin')),
  created_at    timestamptz not null default now()
);
create index if not exists event_households_event_idx on event_households (event_id);

create table if not exists event_registrants (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null default nullif(current_setting('app.org_id', true), '')::uuid
                  references organizations (id) on delete cascade,
  event_id      uuid not null references events (id) on delete cascade,
  household_id  uuid not null references event_households (id) on delete cascade,
  person_id     uuid references people (id) on delete set null,
  full_name     text not null check (length(btrim(full_name)) between 1 and 120),
  gender        text not null check (gender in ('male', 'female')),
  age           int check (age between 0 and 120),
  relation      text,                             -- self, spouse, child, parent, other
  phone         text,                             -- E.164, optional (adults)
  needs_bus     boolean not null default false,
  answers       jsonb not null default '{}',
  status        text not null default 'registered' check (status in ('registered', 'cancelled')),
  code          text not null unique default gen_person_ref(),   -- personal code on the pass / QR
  room_id       uuid references event_rooms (id) on delete set null,
  bed           int,
  room_locked   boolean not null default false,
  bus_id        uuid references event_buses (id) on delete set null,
  seat          int,
  seat_locked   boolean not null default false,
  arrived_at    timestamptz,
  created_at    timestamptz not null default now(),
  check ((room_id is null) = (bed is null)),
  check ((bus_id is null) = (seat is null))
);
create index if not exists event_registrants_event_idx on event_registrants (event_id);
create index if not exists event_registrants_household_idx on event_registrants (household_id);
create unique index if not exists event_registrants_bed_key on event_registrants (room_id, bed) where room_id is not null;
create unique index if not exists event_registrants_seat_key on event_registrants (bus_id, seat) where bus_id is not null;

create table if not exists event_messages (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null default nullif(current_setting('app.org_id', true), '')::uuid
                  references organizations (id) on delete cascade,
  event_id      uuid not null references events (id) on delete cascade,
  household_id  uuid references event_households (id) on delete cascade,
  channel       text not null check (channel in ('sms', 'email')),
  recipient     text not null,
  kind          text not null check (kind in ('registered', 'room', 'bus', 'broadcast')),
  dedupe        text not null,                    -- same content to the same person is queued once
  body          text not null,
  subject       text,
  status        text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed')),
  error         text,
  attempts      int not null default 0,
  created_at    timestamptz not null default now(),
  sent_at       timestamptz,
  unique (event_id, channel, recipient, kind, dedupe)
);
create index if not exists event_messages_queue_idx on event_messages (event_id, status);

-- Tenant isolation, same as every other organization-owned table.
do $$
declare t text;
begin
  foreach t in array array['events', 'event_rooms', 'event_buses', 'event_households', 'event_registrants', 'event_messages'] loop
    execute format('alter table %I enable row level security', t);
    execute format('grant select, insert, update, delete on %I to f2f_tenant', t);
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format($p$create policy tenant_isolation on %I for all to f2f_tenant
      using (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
      with check (org_id = nullif(current_setting('app.org_id', true), '')::uuid)$p$, t);
  end loop;
end $$;
