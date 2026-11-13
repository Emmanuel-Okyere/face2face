import { z } from "zod";
import { loadEvent } from "@/lib/camp/events";
import { handle, HttpError, json, requireOrg } from "@/lib/http";
import { tenant } from "@/lib/tenant";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Serving links and plates served. In "by church" mode every church gets its
 * own kitchen link (created the first time it's needed).
 */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { org } = await requireOrg(req);
  const id = z.uuid().parse((await params).id);
  const data = await tenant(org.id, async (sql) => {
    const e = await loadEvent(sql, id);
    let kitchens: { church: string; token: string }[] = [];
    if (e.meals_mode === "by_church" && e.churches.length) {
      for (const c of e.churches) await sql`insert into event_kitchens (event_id, church) values (${id}, ${c}) on conflict do nothing`;
      kitchens = (await sql`select church, token from event_kitchens where event_id = ${id} and church = any(${e.churches})`) as unknown as typeof kitchens;
      kitchens.sort((a, b) => e.churches.indexOf(a.church) - e.churches.indexOf(b.church));
    }
    // Plates per day and meal, by the eater's church.
    const served = await sql`
      select m.day::text as day, m.meal, h.church, count(*)::int as n
      from event_meals m join event_registrants r on r.id = m.registrant_id join event_households h on h.id = r.household_id
      where m.event_id = ${id} group by 1, 2, 3 order by 1`;
    return { token: e.meal_token, kitchens, served };
  });
  return json(data);
});

/** A new serving link (?church= for one church's kitchen); the old one stops working at once. */
export const PATCH = handle<Ctx>(async (req, { params }) => {
  const { org } = await requireOrg(req);
  const id = z.uuid().parse((await params).id);
  const church = req.nextUrl.searchParams.get("church");
  const [row] = await tenant(org.id, (sql) =>
    church
      ? sql`update event_kitchens set token = replace(gen_random_uuid()::text, '-', '') where event_id = ${id} and church = ${church} returning token`
      : sql`update events set meal_token = replace(gen_random_uuid()::text, '-', '') where id = ${id} returning meal_token as token`,
  );
  if (!row) throw new HttpError(404, "Not found");
  return json({ token: row.token });
});
