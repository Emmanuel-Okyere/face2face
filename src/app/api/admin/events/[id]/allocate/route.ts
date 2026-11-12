import { z } from "zod";
import { allocateRooms, allocateSeats, type Camper } from "@/lib/camp/allocate";
import { effectiveAge, loadEvent, ridesBus } from "@/lib/camp/events";
import { body, handle, HttpError, json, requireOrg } from "@/lib/http";
import { tenant } from "@/lib/tenant";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Run automatic allocation. "fill" places only people without a bed/seat;
 * "all" re-plans everyone except locked placements. One transaction, rows
 * locked, so two admins pressing it at once can't double-book a bed.
 */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { org } = await requireOrg(req);
  const id = z.uuid().parse((await params).id);
  const p = await body(req, z.object({ what: z.enum(["rooms", "seats"]), mode: z.enum(["fill", "all"]).default("fill") }));
  const result = await tenant(org.id, async (sql) => {
    const e = await loadEvent(sql, id);
    if (p.what === "rooms" ? !e.rooms_enabled : !e.buses_enabled) throw new HttpError(400, `This event doesn't allocate ${p.what === "rooms" ? "rooms" : "bus seats"}. Turn it on in Setup.`);
    await sql`select pg_advisory_xact_lock(hashtext(${`alloc:${id}`}))`;
    const rows = await sql`
      select r.id, r.household_id, h.church, r.gender, r.age, r.age_group, to_json(r.days) as days, r.room_id, r.bed, r.room_locked, r.needs_bus, r.bus_id, r.seat, r.seat_locked
      from event_registrants r join event_households h on h.id = r.household_id
      where r.event_id = ${id} and r.status = 'registered' for update of r`;
    const campers: Camper[] = rows.map((r) => ({
      id: r.id,
      household: r.household_id,
      church: r.church,
      gender: r.gender,
      age: effectiveAge({ age: r.age, age_group: r.age_group }, e),
      room: r.room_id ? { id: r.room_id, bed: r.bed } : null,
      roomLocked: r.room_locked,
      needsBus: ridesBus({ needs_bus: r.needs_bus, days: r.days }, e), // first-day arrivals only
      seat: r.bus_id ? { id: r.bus_id, seat: r.seat } : null,
      seatLocked: r.seat_locked,
    }));

    if (p.what === "rooms") {
      // Rooms need a gender: anyone registered without one is left out and reported.
      const unknown = campers.filter((c) => !c.gender);
      campers.splice(0, campers.length, ...campers.filter((c) => c.gender));
      const rooms = await sql`select id, building, name, gender, beds, church from event_rooms where event_id = ${id}`;
      const out = allocateRooms(campers, rooms as never, { childAge: e.child_age, ageGroups: e.age_groups, mode: p.mode });
      out.unplaced.push(...unknown.map((c) => ({ id: c.id, reason: "Gender not given" })));
      // Clear first, then write, so swapped beds never collide on the unique index.
      const changed = campers.filter((c) => {
        const n = out.placed.get(c.id);
        return n !== undefined && (n?.id !== c.room?.id || n?.bed !== c.room?.bed);
      });
      if (changed.length) await sql`update event_registrants set room_id = null where id = any(${changed.map((c) => c.id)})`;
      for (const c of changed) {
        const n = out.placed.get(c.id);
        if (n) await sql`update event_registrants set room_id = ${n.id}, bed = ${n.bed} where id = ${c.id}`;
      }
      return { changed: changed.length, placed: [...out.placed.values()].filter(Boolean).length, unplaced: out.unplaced };
    }
    const buses = await sql`select id, name, seats, churches from event_buses where event_id = ${id}`;
    const out = allocateSeats(campers, buses as never, { mode: p.mode });
    const changed = campers.filter((c) => {
      const n = out.placed.get(c.id);
      return n !== undefined && (n?.id !== c.seat?.id || n?.seat !== c.seat?.seat);
    });
    if (changed.length) await sql`update event_registrants set bus_id = null where id = any(${changed.map((c) => c.id)})`;
    for (const c of changed) {
      const n = out.placed.get(c.id);
      if (n) await sql`update event_registrants set bus_id = ${n.id}, seat = ${n.seat} where id = ${c.id}`;
    }
    return { changed: changed.length, placed: [...out.placed.values()].filter(Boolean).length, unplaced: out.unplaced };
  });
  return json(result);
});
