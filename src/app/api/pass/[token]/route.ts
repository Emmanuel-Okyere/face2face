import { clientIp } from "@/lib/auth";
import { ageGroupIndex } from "@/lib/camp/allocate";
import { effectiveAge, EVENT_COLS, type EventRow } from "@/lib/camp/events";
import { dishList, loadMenu, pick } from "@/lib/camp/menu";
import { db } from "@/lib/db";
import { handle, HttpError, json } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { localNow } from "@/lib/service-schedule";
import { tenant } from "@/lib/tenant";

type Ctx = { params: Promise<{ token: string }> };

/** Public: a registration's camp pass (who's registered, rooms, bus seats). The link itself is the key. */
export const GET = handle<Ctx>(async (req, { params }) => {
  await rateLimit(`pass:${clientIp(req)}`, 120, 600);
  const token = (await params).token;
  const bad = new HttpError(404, "This pass link isn't valid.");
  if (!/^[0-9a-f]{32}$/.test(token)) throw bad;
  const [h] = await db()`select id, org_id, event_id, church, contact_name, code from event_households where pass_token = ${token}`;
  if (!h) throw bad;
  const [tzRow] = await db()`select time_zone from organizations where id = ${h.org_id}`;
  const today = localNow(tzRow.time_zone).date;
  const data = await tenant(h.org_id, async (sql) => {
    const [e] = await sql.unsafe(`select ${EVENT_COLS} from events where id = $1`, [h.event_id]);
    // Today's meals per person (only when the event serves meals with the pass).
    const meals = await sql`
      select m.registrant_id, m.meal, m.served_at from event_meals m join event_registrants r on r.id = m.registrant_id
      where r.household_id = ${h.id} and m.day = ${today}::date`;
    const people = await sql`
      select r.id, r.full_name, r.gender, r.age, r.age_group, to_json(r.days) as days, r.code, r.status, r.bed, r.seat, r.needs_bus,
        rm.building, rm.name as room, b.name as bus, b.pickup, b.departs
      from event_registrants r left join event_rooms rm on rm.id = r.room_id left join event_buses b on b.id = r.bus_id
      where r.household_id = ${h.id} order by r.created_at`;
    const menu = await loadMenu(sql, h.event_id, [today]);
    return { e: e as unknown as EventRow, people, meals, menu };
  });
  const [org] = await db()`select name, logo_url from organizations where id = ${h.org_id}`;
  const { e } = data;
  return json({
    org: { name: org.name, logoUrl: org.logo_url },
    event: { name: e.name, venue: e.venue, starts_on: e.starts_on, ends_on: e.ends_on },
    registration: { code: h.code, church: h.church, contact: h.contact_name },
    // Today's food for this registration's church (or the shared menu when everyone eats together).
    menuToday: e.meals_enabled
      ? e.meals.map((m) => ({ name: m.name, from: m.from, to: m.to, dishes: dishList(pick(data.menu, e.meals_mode === "by_church" ? h.church : null, today, m.key)?.dishes ?? "") }))
      : null,
    menuToken: e.meals_enabled ? e.public_token : null,
    people: data.people
      .filter((p) => p.status === "registered")
      .map((p) => ({
        name: p.full_name,
        code: p.code,
        ageGroup: p.age_group ?? (p.age === null ? null : e.age_groups[ageGroupIndex(effectiveAge(p as never, e), e.age_groups)]?.name ?? null),
        days: p.days as string[] | null,
        room: p.room ? { building: p.building, name: p.room, bed: p.bed } : null,
        bus: p.bus ? { name: p.bus, seat: p.seat, pickup: p.pickup, departs: p.departs } : null,
        needsBus: p.needs_bus,
        mealsToday: e.meals_enabled
          ? e.meals.map((m) => ({ name: m.name, at: data.meals.find((x) => x.registrant_id === p.id && x.meal === m.key)?.served_at ?? null }))
          : null,
      })),
  });
});
