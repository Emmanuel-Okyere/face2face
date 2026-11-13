import { z } from "zod";
import { clientIp } from "@/lib/auth";
import { EVENT_COLS, type EventRow, type MealSlot } from "@/lib/camp/events";
import { loadMenu, pick } from "@/lib/camp/menu";
import { db } from "@/lib/db";
import { body, handle, HttpError, json } from "@/lib/http";
import { normalizeRef } from "@/lib/ids";
import { rateLimit } from "@/lib/ratelimit";
import { localNow, toMin } from "@/lib/service-schedule";
import { tenant } from "@/lib/tenant";

type Ctx = { params: Promise<{ token: string }> };
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The link is the key. The event's main link serves everyone; in "by church"
 * mode each church's kitchen has its own link and serves its own people.
 */
async function eventByToken(token: string) {
  const bad = new HttpError(404, "This serving link isn't valid. Ask the organizers for a new one.");
  if (!/^[0-9a-f]{32}$/.test(token)) throw bad;
  let church: string | null = null;
  let [e] = await db().unsafe(`select ${EVENT_COLS} from events where meal_token = $1 and not archived`, [token]);
  if (!e) {
    const [k] = await db()`select event_id, church from event_kitchens where token = ${token}`;
    if (!k) throw bad;
    [e] = await db().unsafe(`select ${EVENT_COLS} from events where id = $1 and not archived`, [k.event_id]);
    if (!e || (e as unknown as EventRow).meals_mode !== "by_church") throw bad;
    church = k.church as string;
  }
  const ev = e as unknown as EventRow;
  if (!ev.meals_enabled) throw new HttpError(403, "Meals aren't turned on for this event.");
  const [org] = await db()`select time_zone from organizations where id = ${ev.org_id}`;
  return { e: ev, tz: org.time_zone as string, church };
}

/** The meal being served now, else the next one today, else the last one. */
function currentMeal(meals: MealSlot[], min: number) {
  const sorted = [...meals].sort((a, b) => a.from.localeCompare(b.from));
  return sorted.find((m) => min >= toMin(m.from) && min <= toMin(m.to)) ?? sorted.find((m) => toMin(m.from) > min) ?? sorted.at(-1) ?? null;
}

/** Answers to food-related questions (diet, allergies…), shown to the server at the counter. */
function dietOf(e: EventRow, answers: Record<string, unknown>) {
  return (e.questions ?? [])
    .filter((q) => /diet|allerg|food|meal|vegetarian|halal/i.test(q.label))
    .map((q) => {
      const v = answers?.[q.key];
      if (v === undefined || v === null || v === "" || v === false) return null;
      return v === true ? q.label : String(v);
    })
    .filter(Boolean) as string[];
}

/** Served / expected for this meal — one church's people at a church kitchen, everyone otherwise. */
async function counts(e: EventRow, day: string, meal: string, church: string | null) {
  return tenant(e.org_id, async (sql) => {
    const ofChurch = church ? sql`and h.church = ${church}` : sql``;
    const [c] = await sql`
      select
        (select count(*)::int from event_meals m join event_registrants r on r.id = m.registrant_id join event_households h on h.id = r.household_id
          where m.event_id = ${e.id} and m.day = ${day}::date and m.meal = ${meal} ${ofChurch}) as served,
        (select count(*)::int from event_registrants r join event_households h on h.id = r.household_id
          where r.event_id = ${e.id} and r.status = 'registered' and (r.days is null or ${day}::date = any(r.days)) ${ofChurch}) as expected`;
    const recent = await sql`
      select r.full_name, m.served_at from event_meals m join event_registrants r on r.id = m.registrant_id join event_households h on h.id = r.household_id
      where m.event_id = ${e.id} and m.day = ${day}::date and m.meal = ${meal} ${ofChurch} order by m.served_at desc limit 6`;
    // The day's menu for this kitchen: its church's own, else the all-churches menu.
    const menu = await loadMenu(sql, e.id, [day]);
    const dishes = Object.fromEntries(e.meals.map((m) => [m.key, pick(menu, church, day, m.key)?.dishes ?? null]));
    return { served: c.served as number, expected: c.expected as number, recent, dishes };
  });
}

/** Station view: meals, today's suggestion, counts; or name search (?q=). */
export const GET = handle<Ctx>(async (req, { params }) => {
  await rateLimit(`serve:get:${clientIp(req)}`, 900, 600);
  const { e, tz, church } = await eventByToken((await params).token);
  const sp = req.nextUrl.searchParams;
  const now = localNow(tz);
  const day = DAY.test(sp.get("day") ?? "") ? sp.get("day")! : now.date;
  const meal = e.meals.find((m) => m.key === sp.get("meal"))?.key ?? currentMeal(e.meals, now.min)?.key ?? e.meals[0]?.key;
  const q = (sp.get("q") ?? "").trim();
  if (q.length >= 2) {
    const people = await tenant(e.org_id, (sql) => sql`
      select r.id, r.full_name, h.church, m.served_at, (${church}::text is null or h.church = ${church}) as here
      from event_registrants r join event_households h on h.id = r.household_id
      left join event_meals m on m.registrant_id = r.id and m.day = ${day}::date and m.meal = ${meal}
      where r.event_id = ${e.id} and r.status = 'registered' and r.full_name ilike ${"%" + q + "%"}
      order by (${church}::text is not null and h.church = ${church}) desc, r.full_name limit 12`);
    return json({ people });
  }
  return json({
    event: { name: e.name },
    kitchen: church,
    unit: e.unit_label,
    meals: e.meals,
    today: now.date,
    day,
    meal,
    ...(await counts(e, day, meal, church)),
  });
});

const schema = z.object({
  day: z.string().regex(DAY),
  meal: z.string().max(30),
  action: z.enum(["serve", "undo"]).default("serve"),
  code: z.string().max(40).optional(),
  rid: z.uuid().optional(),
  force: z.boolean().default(false), // serve someone from another church's kitchen anyway
});

/** Serve one person (scan their pass or tap their name). A second plate is refused with the time of the first. */
export const POST = handle<Ctx>(async (req, { params }) => {
  await rateLimit(`serve:post:${clientIp(req)}`, 1500, 600);
  const { e, church } = await eventByToken((await params).token);
  const a = await body(req, schema);
  const slot = e.meals.find((m) => m.key === a.meal);
  if (!slot) throw new HttpError(400, "Unknown meal");

  return tenant(e.org_id, async (sql) => {
    let p;
    const cols = sql`r.id, r.full_name, r.status, r.age, r.age_group, to_json(r.days) as days, r.answers, h.church`;
    if (a.rid) [p] = await sql`select ${cols} from event_registrants r join event_households h on h.id = r.household_id where r.id = ${a.rid} and r.event_id = ${e.id}`;
    else {
      const code = normalizeRef(a.code ?? "");
      if (code) [p] = await sql`select ${cols} from event_registrants r join event_households h on h.id = r.household_id where r.code = ${code} and r.event_id = ${e.id}`;
    }
    if (!p) throw new HttpError(404, a.code ? "That card isn't for this event." : "Person not found.", {}, "unknown");
    if (p.status !== "registered") throw new HttpError(409, `${p.full_name}'s registration was cancelled.`, {}, "cancelled");

    // Each church feeds its own people: ask before serving someone from another church's kitchen.
    if (a.action === "serve" && church && p.church !== church && !a.force) {
      return json({ error: `${p.full_name} eats with ${p.church}.`, code: "other_kitchen", name: p.full_name, church: p.church }, 409);
    }

    if (a.action === "undo") {
      await sql`delete from event_meals where registrant_id = ${p.id} and day = ${a.day}::date and meal = ${a.meal}`;
      return json({ ok: true, name: p.full_name });
    }
    const ins = await sql`
      insert into event_meals (event_id, registrant_id, day, meal, method, church)
      values (${e.id}, ${p.id}, ${a.day}::date, ${a.meal}, ${a.code ? "scan" : "tap"}, ${church ?? p.church})
      on conflict (registrant_id, day, meal) do nothing returning served_at`;
    const [first] = ins.length ? ins : await sql`select served_at from event_meals where registrant_id = ${p.id} and day = ${a.day}::date and meal = ${a.meal}`;
    const days = p.days as string[] | null;
    return json({
      name: p.full_name,
      meal: slot.name,
      already: !ins.length,
      servedAt: first.served_at,
      diet: dietOf(e, p.answers ?? {}),
      notToday: !!days && !days.some((d) => String(d).slice(0, 10) === a.day),
      child: p.age !== null ? p.age <= e.child_age : (e.age_groups.find((g) => g.name === p.age_group)?.upTo ?? 99) <= e.child_age,
    });
  });
});
