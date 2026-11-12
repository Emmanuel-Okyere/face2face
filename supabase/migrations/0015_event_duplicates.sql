-- Duplicate protection for event registrations.
--   • One registration per contact phone per event, enforced by the database
--     (so even two submissions at the same instant can't both get in).
--   • Pairs an admin has reviewed and marked "not the same person" are
--     remembered, so they stop showing as possible duplicates.
create unique index if not exists event_households_phone_key
  on event_households (event_id, contact_phone) where contact_phone is not null;

alter table events add column if not exists duplicates_ignored text[] not null default '{}';  -- "registrantA|registrantB" (sorted)
