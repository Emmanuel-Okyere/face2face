-- When a room or bus is deleted, its people lose the room/bus (FK sets it to
-- null); clear the bed/seat number with it so the pair always stays consistent.
create or replace function event_registrant_clear_slots() returns trigger
language plpgsql as $$
begin
  if new.room_id is null then new.bed := null; new.room_locked := false; end if;
  if new.bus_id is null then new.seat := null; new.seat_locked := false; end if;
  return new;
end $$;

drop trigger if exists event_registrant_clear_slots on event_registrants;
create trigger event_registrant_clear_slots before update on event_registrants
  for each row execute function event_registrant_clear_slots();
