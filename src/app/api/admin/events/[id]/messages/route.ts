import { z } from "zod";
import { loadEvent, queueMessages, sendQueued } from "@/lib/camp/events";
import { body, handle, json, requireOrg } from "@/lib/http";
import { appOrigin } from "@/lib/mail";
import { rateLimit } from "@/lib/ratelimit";
import { tenant } from "@/lib/tenant";

type Ctx = { params: Promise<{ id: string }> };

/** Message log (latest first) with delivery status. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { org } = await requireOrg(req);
  const id = z.uuid().parse((await params).id);
  const rows = await tenant(org.id, (sql) => sql`
    select m.id, m.channel, m.recipient, m.kind, m.body, m.status, m.error, m.attempts, m.created_at, m.sent_at, h.contact_name, h.church
    from event_messages m left join event_households h on h.id = m.household_id
    where m.event_id = ${id} order by m.created_at desc limit 500`);
  return json({ messages: rows });
});

const queueSchema = z.object({
  kind: z.enum(["registered", "room", "bus", "broadcast"]),
  church: z.string().trim().max(120).nullable().optional(),
  body: z.string().trim().min(1).max(480).optional(),
});

/** Queue messages for every registration (or one church). Already-sent identical messages are skipped. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { org } = await requireOrg(req);
  const id = z.uuid().parse((await params).id);
  const p = await body(req, queueSchema);
  if (p.kind === "broadcast" && !p.body) return json({ error: "Write the message first" }, 400);
  const origin = appOrigin(req);
  const r = await tenant(org.id, async (sql) => queueMessages(sql, await loadEvent(sql, id), p.kind, origin, { church: p.church, body: p.body }));
  return json(r);
});

/** Send the next batch of queued messages; the page calls this until nothing is left. */
export const PUT = handle<Ctx>(async (req, { params }) => {
  const { org } = await requireOrg(req);
  const id = z.uuid().parse((await params).id);
  await rateLimit(`camp-send:${org.id}`, 600, 60 * 60);
  return json(await sendQueued(org.id, id, 20));
});

/** Put failed messages back in the queue. */
export const PATCH = handle<Ctx>(async (req, { params }) => {
  const { org } = await requireOrg(req);
  const id = z.uuid().parse((await params).id);
  const r = await tenant(org.id, (sql) => sql`update event_messages set status = 'queued', attempts = 0, error = null where event_id = ${id} and status = 'failed' returning id`);
  return json({ requeued: r.length });
});
