import { clientIp } from "@/lib/auth";
import { EVENT_COLS, eventDays, type EventRow } from "@/lib/camp/events";
import { loadMenu } from "@/lib/camp/menu";
import { db } from "@/lib/db";
import { handle, HttpError, json } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { localNow } from "@/lib/service-schedule";
import { tenant } from "@/lib/tenant";

type Ctx = { params: Promise<{ token: string }> };

/** Public: the event's menu, for the notice board or the WhatsApp group. Same link as registration. */
export const GET = handle<Ctx>(async (req, { params }) => {
  await rateLimit(`menu:${clientIp(req)}`, 120, 600);
  const token = (await params).token;
  const bad = new HttpError(404, "This menu link isn't valid.");
  if (!/^[0-9a-f]{32}$/.test(token)) throw bad;
  const [row] = await db().unsafe(`select ${EVENT_COLS} from events where public_token = $1 and not archived`, [token]);
  if (!row) throw bad;
  const e = row as unknown as EventRow;
  if (!e.meals_enabled) throw new HttpError(404, "There's no menu for this event.");
  const [org] = await db()`select name, logo_url, time_zone from organizations where id = ${e.org_id}`;
  const days = eventDays(e);
  const byChurch = e.meals_mode === "by_church";
  const menu = await tenant(e.org_id, (sql) => loadMenu(sql, e.id));
  return json({
    org: { name: org.name, logoUrl: org.logo_url },
    event: { name: e.name, venue: e.venue, unit_label: e.unit_label || "Church", byChurch },
    today: localNow(org.time_zone).date,
    days,
    meals: e.meals.map(({ key, name, from, to }) => ({ key, name, from, to })),
    churches: byChurch ? e.churches : [],
    // Together: only the shared menu matters.
    menu: byChurch ? menu : menu.filter((m) => m.church === null),
  });
});
