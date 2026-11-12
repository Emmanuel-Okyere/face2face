import { z } from "zod";
import { body, handle, HttpError, json, requireOrg } from "@/lib/http";
import { tenant } from "@/lib/tenant";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  status: z.enum(["registered", "cancelled"]).optional(),
  // Move to a room (bed picked automatically if omitted) or null to unassign.
  room: z.object({ id: z.uuid(), bed: z.number().int().min(1).optional() }).nullable().optional(),
  room_locked: z.boolean().optional(),
  bus: z.object({ id: z.uuid(), seat: z.number().int().min(1).optional() }).nullable().optional(),
  seat_locked: z.boolean().optional(),
  needs_bus: z.boolean().optional(),
  arrived: z.boolean().optional(),
});

/** Manual changes to one person: cancel, move room/bed or bus/seat, lock, mark arrived. */
export const PATCH = handle<Ctx>(async (req, { params }) => {
  const { org } = await requireOrg(req);
  const id = z.uuid().parse((await params).id);
  const rid = z.uuid().parse(req.nextUrl.searchParams.get("rid"));
  const p = await body(req, schema);
  await tenant(org.id, async (sql) => {
    const [r] = await sql`select id, gender from event_registrants where id = ${rid} and event_id = ${id} for update`;
    if (!r) throw new HttpError(404, "Person not found");
    if (p.status) {
      await sql`update event_registrants set status = ${p.status} where id = ${rid}`;
      // Cancelled people give their bed and seat back.
      if (p.status === "cancelled") await sql`update event_registrants set room_id = null, bed = null, room_locked = false, bus_id = null, seat = null, seat_locked = false where id = ${rid}`;
    }
    if (p.room !== undefined) {
      if (p.room === null) await sql`update event_registrants set room_id = null, bed = null, room_locked = false where id = ${rid}`;
      else {
        const [room] = await sql`select id, beds, gender from event_rooms where id = ${p.room.id} and event_id = ${id}`;
        if (!room) throw new HttpError(404, "Room not found");
        if (room.gender !== "family" && room.gender !== r.gender) throw new HttpError(400, `That's a ${room.gender} room`);
        const used = new Set((await sql`select bed from event_registrants where room_id = ${room.id} and id <> ${rid}`).map((x) => x.bed as number));
        let bed = p.room.bed;
        if (bed !== undefined && (bed > room.beds || used.has(bed))) throw new HttpError(409, `Bed ${bed} isn't free`);
        if (bed === undefined) {
          bed = 1;
          while (used.has(bed)) bed++;
          if (bed > room.beds) throw new HttpError(409, "That room is full");
        }
        // Moved by hand → locked, so automatic allocation won't undo it.
        await sql`update event_registrants set room_id = ${room.id}, bed = ${bed}, room_locked = true where id = ${rid}`;
      }
    }
    if (p.room_locked !== undefined) await sql`update event_registrants set room_locked = ${p.room_locked} where id = ${rid} and room_id is not null`;
    if (p.needs_bus !== undefined) await sql`update event_registrants set needs_bus = ${p.needs_bus} where id = ${rid}`;
    if (p.bus !== undefined) {
      if (p.bus === null) await sql`update event_registrants set bus_id = null, seat = null, seat_locked = false where id = ${rid}`;
      else {
        const [bus] = await sql`select id, seats from event_buses where id = ${p.bus.id} and event_id = ${id}`;
        if (!bus) throw new HttpError(404, "Bus not found");
        const used = new Set((await sql`select seat from event_registrants where bus_id = ${bus.id} and id <> ${rid}`).map((x) => x.seat as number));
        let seat = p.bus.seat;
        if (seat !== undefined && (seat > bus.seats || used.has(seat))) throw new HttpError(409, `Seat ${seat} isn't free`);
        if (seat === undefined) {
          seat = 1;
          while (used.has(seat)) seat++;
          if (seat > bus.seats) throw new HttpError(409, "That bus is full");
        }
        await sql`update event_registrants set bus_id = ${bus.id}, seat = ${seat}, seat_locked = true, needs_bus = true where id = ${rid}`;
      }
    }
    if (p.seat_locked !== undefined) await sql`update event_registrants set seat_locked = ${p.seat_locked} where id = ${rid} and bus_id is not null`;
    if (p.arrived !== undefined) await sql`update event_registrants set arrived_at = case when ${p.arrived} then now() end where id = ${rid}`;
  });
  return json({ ok: true });
});
