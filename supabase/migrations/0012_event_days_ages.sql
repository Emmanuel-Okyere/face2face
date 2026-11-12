-- Camp registration, round two:
--   • which days each person attends (null = every day); buses are for first-day arrivals only
--   • age as an exact number OR one of the event's age groups ("Pathfinders 10–15")
--   • what the event calls its sub-groups: "Church" by default ("Zone", "District", …)
alter table event_registrants add column if not exists days date[];
alter table event_registrants add column if not exists age_group text;
alter table events add column if not exists unit_label text not null default 'Church'
  check (length(btrim(unit_label)) between 1 and 30);
