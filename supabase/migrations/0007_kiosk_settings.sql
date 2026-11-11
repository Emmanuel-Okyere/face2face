-- Editable kiosk settings.
alter table kiosks add column if not exists location text check (location is null or length(location) <= 120);
alter table kiosks add column if not exists allow_qr boolean not null default true;       -- show "Use QR badge instead"
alter table kiosks add column if not exists voice_default boolean not null default false;  -- spoken greeting on by default
alter table kiosks add column if not exists paused boolean not null default false;         -- temporarily not accepting check-ins
alter table kiosks drop constraint if exists kiosks_name_check;
alter table kiosks add constraint kiosks_name_check check (length(btrim(name)) between 1 and 80);
