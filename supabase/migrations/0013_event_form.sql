-- Per-event registration form and features. Each event decides what it asks
-- (gender, age as exact/range/both/off, days attending, email, phones) and
-- whether it allocates rooms and/or bus seats at all.
alter table events add column if not exists rooms_enabled boolean not null default true;
alter table events add column if not exists buses_enabled boolean not null default true;
alter table events add column if not exists form jsonb not null
  default '{"gender": true, "age": "both", "days": true, "email": true, "member_phone": true}';
-- Gender is only required when the event allocates rooms.
alter table event_registrants alter column gender drop not null;
