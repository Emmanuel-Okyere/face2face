-- Services: scheduled times when attendance can be taken (Sunday Service,
-- Midweek, a one-off convention, or "Every day" for workplaces). Check-ins are
-- only accepted while a service's check-in window is open, and are recorded
-- against that service on that day.

create table if not exists services (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null default nullif(current_setting('app.org_id', true), '')::uuid
                  references organizations (id) on delete cascade,
  name          text not null check (length(btrim(name)) between 1 and 80),
  kind          text not null check (kind in ('weekly', 'once', 'daily')),
  weekdays      int[] check (weekdays <@ array[0,1,2,3,4,5,6]),   -- 0 = Sunday … 6 = Saturday (weekly)
  on_date       date,                                              -- once
  start_time    time not null,
  end_time      time not null,
  opens_before  int not null default 30 check (opens_before between 0 and 240),   -- minutes before start
  closes_after  int not null default 0  check (closes_after between 0 and 240),   -- minutes after end
  late_after    int check (late_after between 0 and 600),          -- minutes after start; null = no lateness
  audience      text[],                                            -- expected groups; null/empty = everyone
  active        boolean not null default true,                     -- false = archived
  created_at    timestamptz not null default now(),
  check (end_time > start_time),
  check (kind <> 'weekly' or cardinality(weekdays) > 0),
  check (kind <> 'once' or on_date is not null)
);
create index if not exists services_org_idx on services (org_id) where active;

alter table services enable row level security;
grant select, insert, update, delete on services to f2f_tenant;
drop policy if exists tenant_isolation on services;
create policy tenant_isolation on services for all to f2f_tenant
  using (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (org_id = nullif(current_setting('app.org_id', true), '')::uuid);

-- Attendance belongs to a service occurrence (service + local day).
alter table attendance add column if not exists service_id uuid references services (id);
alter table attendance add column if not exists late boolean not null default false;

-- Every existing organization gets an "Every day" service (keeps today's behaviour),
-- and existing check-ins move under it, with lateness computed from the old setting.
do $$
declare o record; sid uuid; late_min int;
begin
  for o in select id, late_after from organizations loop
    select id into sid from services where org_id = o.id and kind = 'daily' order by created_at limit 1;
    if sid is null then
      late_min := case when o.late_after is null then null
                       else split_part(o.late_after, ':', 1)::int * 60 + split_part(o.late_after, ':', 2)::int end;
      insert into services (org_id, name, kind, start_time, end_time, opens_before, closes_after, late_after)
      values (o.id, 'Every day', 'daily', '00:00', '23:59', 0, 0, late_min)
      returning id into sid;
    end if;
    update attendance a set service_id = sid,
      late = case when o.late_after is null then false
                  else (a.checked_in_at at time zone (select time_zone from organizations where id = o.id))::time > o.late_after::time end
    where a.org_id = o.id and a.service_id is null;
  end loop;
end $$;

alter table attendance alter column service_id set not null;
alter table attendance drop constraint if exists attendance_person_id_day_key;
create unique index if not exists attendance_person_service_day_key on attendance (person_id, service_id, day);
create index if not exists attendance_service_day_idx on attendance (service_id, day);

-- Optional location check for phone check-in links.
alter table organizations add column if not exists geo_lat double precision check (geo_lat between -90 and 90);
alter table organizations add column if not exists geo_lng double precision check (geo_lng between -180 and 180);
alter table organizations add column if not exists geo_radius_m int not null default 200 check (geo_radius_m between 50 and 5000);
alter table organizations add column if not exists geo_required boolean not null default false;
