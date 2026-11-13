-- Menus and serving by church.
--   events.meals_mode   'together' = one kitchen and one menu for everybody;
--                       'by_church' = each church cooks for its own people, with
--                       its own menu (falling back to the all-churches menu) and
--                       its own serving-station link.
--   event_menu          what's served: per day, per meal, per church (null = all)
--   event_kitchens      one serving-station link per church in 'by_church' mode
--   event_meals.church  the kitchen that served the plate

alter table events add column if not exists meals_mode text not null default 'together'
  check (meals_mode in ('together', 'by_church'));

create table if not exists event_menu (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null default nullif(current_setting('app.org_id', true), '')::uuid
               references organizations (id) on delete cascade,
  event_id   uuid not null references events (id) on delete cascade,
  church     text,                                 -- null = every church
  day        date not null,
  meal       text not null check (meal ~ '^[a-z0-9_]{1,30}$'),
  dishes     text not null check (length(btrim(dishes)) between 1 and 600),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (event_id, church, day, meal)
);
create index if not exists event_menu_event_idx on event_menu (event_id, day);

create table if not exists event_kitchens (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null default nullif(current_setting('app.org_id', true), '')::uuid
               references organizations (id) on delete cascade,
  event_id   uuid not null references events (id) on delete cascade,
  church     text not null,
  token      text not null unique default replace(gen_random_uuid()::text, '-', ''),
  unique (event_id, church)
);

alter table event_meals add column if not exists church text;

do $$
declare t text;
begin
  foreach t in array array['event_menu', 'event_kitchens'] loop
    execute format('alter table %I enable row level security', t);
    execute format('grant select, insert, update, delete on %I to f2f_tenant', t);
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format($p$create policy tenant_isolation on %I for all to f2f_tenant
      using (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
      with check (org_id = nullif(current_setting('app.org_id', true), '')::uuid)$p$, t);
  end loop;
end $$;
