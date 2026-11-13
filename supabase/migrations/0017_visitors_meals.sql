-- 1. Visitors: people who come to a service but aren't members. Saved as a
--    person marked is_visitor (so "first time" vs "returning" is just their
--    visit count), checked in with method 'visitor', and kept out of members'
--    attendance rates and "who didn't come" lists. "Make member" clears the flag.
alter table people add column if not exists is_visitor boolean not null default false;
alter table people add column if not exists invited_by text;
create index if not exists people_visitor_idx on people (org_id) where is_visitor;
alter type attendance_method add value if not exists 'visitor';

-- 2. Camp meals: each event's meal times, a serving-station link for the
--    kitchen, and one row per person per meal per day (served once).
alter table events add column if not exists meals_enabled boolean not null default false;
alter table events add column if not exists meals jsonb not null default
  '[{"key":"breakfast","name":"Breakfast","from":"06:00","to":"09:30"},{"key":"lunch","name":"Lunch","from":"12:00","to":"15:00"},{"key":"supper","name":"Supper","from":"18:00","to":"21:00"}]';
alter table events add column if not exists meal_token text not null default replace(gen_random_uuid()::text, '-', '');
create unique index if not exists events_meal_token_key on events (meal_token);

create table if not exists event_meals (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null default nullif(current_setting('app.org_id', true), '')::uuid
                  references organizations (id) on delete cascade,
  event_id      uuid not null references events (id) on delete cascade,
  registrant_id uuid not null references event_registrants (id) on delete cascade,
  day           date not null,
  meal          text not null check (meal ~ '^[a-z0-9_]{1,30}$'),
  method        text not null check (method in ('scan', 'tap')),
  served_at     timestamptz not null default now(),
  unique (registrant_id, day, meal)
);
create index if not exists event_meals_event_idx on event_meals (event_id, day, meal);

alter table event_meals enable row level security;
grant select, insert, update, delete on event_meals to f2f_tenant;
drop policy if exists tenant_isolation on event_meals;
create policy tenant_isolation on event_meals for all to f2f_tenant
  using (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (org_id = nullif(current_setting('app.org_id', true), '')::uuid);
