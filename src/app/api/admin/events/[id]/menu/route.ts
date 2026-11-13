import { z } from "zod";
import { eventDays, loadEvent } from "@/lib/camp/events";
import { loadMenu } from "@/lib/camp/menu";
import { body, handle, HttpError, json, requireOrg } from "@/lib/http";
import { tenant } from "@/lib/tenant";

type Ctx = { params: Promise<{ id: string }> };
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const GET = handle<Ctx>(async (req, { params }) => {
  const { org } = await requireOrg(req);
  const id = z.uuid().parse((await params).id);
  return json({ menu: await tenant(org.id, (sql) => loadMenu(sql, id)) });
});

const editSchema = z.object({
  church: z.string().trim().max(120).nullable(), // null = every church
  day,
  meal: z.string().regex(/^[a-z0-9_]{1,30}$/),
  dishes: z.string().trim().max(600),
});

/** Set one meal's menu (empty text clears it). */
export const PUT = handle<Ctx>(async (req, { params }) => {
  const { org } = await requireOrg(req);
  const id = z.uuid().parse((await params).id);
  const m = await body(req, editSchema);
  await tenant(org.id, async (sql) => {
    const e = await loadEvent(sql, id);
    if (!e.meals.some((x) => x.key === m.meal)) throw new HttpError(400, "Unknown meal");
    if (m.church && !e.churches.includes(m.church)) throw new HttpError(400, `Unknown ${e.unit_label.toLowerCase()}`);
    if (!m.dishes) await sql`delete from event_menu where event_id = ${id} and church is not distinct from ${m.church} and day = ${m.day}::date and meal = ${m.meal}`;
    else
      await sql`
        insert into event_menu (event_id, church, day, meal, dishes) values (${id}, ${m.church}, ${m.day}::date, ${m.meal}, ${m.dishes})
        on conflict (event_id, church, day, meal) do update set dishes = excluded.dishes, updated_at = now()`;
  });
  return json({ ok: true });
});

/** Copy one day's menu (for one church, or the all-churches menu) to every other day of the event. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { org } = await requireOrg(req);
  const id = z.uuid().parse((await params).id);
  const p = await body(req, z.object({ action: z.literal("copy_day"), from: day, church: z.string().max(120).nullable() }));
  const n = await tenant(org.id, async (sql) => {
    const e = await loadEvent(sql, id);
    const targets = eventDays(e).filter((d) => d !== p.from);
    if (!targets.length) throw new HttpError(400, "Set the event dates first");
    const src = await sql`select meal, dishes from event_menu where event_id = ${id} and church is not distinct from ${p.church} and day = ${p.from}::date`;
    let count = 0;
    for (const d of targets)
      for (const r of src) {
        await sql`
          insert into event_menu (event_id, church, day, meal, dishes) values (${id}, ${p.church}, ${d}::date, ${r.meal}, ${r.dishes})
          on conflict (event_id, church, day, meal) do update set dishes = excluded.dishes, updated_at = now()`;
        count++;
      }
    return count;
  });
  return json({ copied: n });
});
