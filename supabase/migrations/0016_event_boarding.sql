-- Bus boarding: captains check people onto their bus (scan the pass QR, or tap
-- the name), for the trip there and the trip back, and see who's still missing.
--
--   event_buses.captain_token  the secret in the captain's link (/board/<token>);
--                              a new token makes the old link stop working
--   event_boardings            one row per person per trip: on board (scan/tap)
--                              or "not coming" on the bus (skipped)

alter table event_buses add column if not exists captain_token text not null
  default replace(gen_random_uuid()::text, '-', '');
create unique index if not exists event_buses_captain_token_key on event_buses (captain_token);

create table if not exists event_boardings (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null default nullif(current_setting('app.org_id', true), '')::uuid
                  references organizations (id) on delete cascade,
  event_id      uuid not null references events (id) on delete cascade,
  registrant_id uuid not null references event_registrants (id) on delete cascade,
  bus_id        uuid references event_buses (id) on delete set null,   -- the bus they actually boarded
  trip          text not null check (trip in ('out', 'back')),
  method        text not null check (method in ('scan', 'tap', 'skipped')),
  at            timestamptz not null default now(),
  unique (registrant_id, trip)
);
create index if not exists event_boardings_event_idx on event_boardings (event_id, trip);

alter table event_boardings enable row level security;
grant select, insert, update, delete on event_boardings to f2f_tenant;
drop policy if exists tenant_isolation on event_boardings;
create policy tenant_isolation on event_boardings for all to f2f_tenant
  using (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (org_id = nullif(current_setting('app.org_id', true), '')::uuid);
