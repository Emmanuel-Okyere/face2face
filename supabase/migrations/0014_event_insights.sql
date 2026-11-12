-- Saved, named views of an event's data ("Bus riders by church", "T-shirt sizes
-- by age group"). The spec says what to count, group by, split by and filter;
-- the numbers are always computed fresh from the registrations.
create table if not exists event_insights (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null default nullif(current_setting('app.org_id', true), '')::uuid
                references organizations (id) on delete cascade,
  event_id    uuid not null references events (id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 80),
  spec        jsonb not null,
  position    int not null default 0,
  created_by  uuid references admins (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists event_insights_event_idx on event_insights (event_id, position);

alter table event_insights enable row level security;
grant select, insert, update, delete on event_insights to f2f_tenant;
drop policy if exists tenant_isolation on event_insights;
create policy tenant_isolation on event_insights for all to f2f_tenant
  using (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (org_id = nullif(current_setting('app.org_id', true), '')::uuid);
