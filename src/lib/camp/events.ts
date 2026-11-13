import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { HttpError } from "@/lib/http";
import { mailEnabled, sendMail } from "@/lib/mail";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import { checkFieldDefs, coerce, toE164, type FieldDef } from "@/lib/person-fields";
import { sendSms, smsEnabled } from "@/lib/sms";
import { tenant, type Tx } from "@/lib/tenant";
import type { AgeGroup } from "./allocate";

export type EventRow = {
  id: string;
  org_id: string;
  name: string;
  venue: string | null;
  starts_on: string | null;
  ends_on: string | null;
  registration_open: boolean;
  churches: string[];
  age_groups: AgeGroup[];
  child_age: number;
  questions: FieldDef[];
  public_token: string;
  archived: boolean;
  unit_label: string;
  rooms_enabled: boolean;
  buses_enabled: boolean;
  form: FormConfig;
  duplicates_ignored: string[];
  meals_enabled: boolean;
  meals_mode: "together" | "by_church";
  meals: MealSlot[];
  meal_token: string;
  created_at: string;
};

/** A meal served at the event each day, with the time window it's served in. */
export type MealSlot = { key: string; name: string; from: string; to: string };
export const mealSlotSchema = z
  .object({
    key: z.string().regex(/^[a-z0-9_]{1,30}$/),
    name: z.string().trim().min(1).max(40),
    from: z.string().regex(/^\d{2}:\d{2}$/),
    to: z.string().regex(/^\d{2}:\d{2}$/),
  })
  .refine((m) => m.from < m.to, "A meal must end after it starts");

/** What an event's registration form asks for (beyond name, church and contact phone). */
export type FormConfig = { gender: boolean; age: "both" | "range" | "exact" | "off"; days: boolean; email: boolean; member_phone: boolean };
export const DEFAULT_FORM: FormConfig = { gender: true, age: "both", days: true, email: true, member_phone: true };
export const formSchema = z.object({
  gender: z.boolean().default(true),
  age: z.enum(["both", "range", "exact", "off"]).default("both"),
  days: z.boolean().default(true),
  email: z.boolean().default(true),
  member_phone: z.boolean().default(true),
});
/** Rooms need gender (never mixed) and some idea of age (children stay with a parent). */
export function effectiveForm(e: { form?: Partial<FormConfig> | null; rooms_enabled: boolean }): FormConfig {
  const f = { ...DEFAULT_FORM, ...(e.form ?? {}) };
  if (e.rooms_enabled) {
    f.gender = true;
    if (f.age === "off") f.age = "range";
  }
  return f;
}

// Dates come back as plain YYYY-MM-DD strings (no time-zone shifting).
export const EVENT_COLS = `id, org_id, name, venue, to_char(starts_on, 'YYYY-MM-DD') as starts_on,
  to_char(ends_on, 'YYYY-MM-DD') as ends_on, registration_open, churches, age_groups, child_age, questions,
  public_token, archived, unit_label, rooms_enabled, buses_enabled, form, duplicates_ignored, meals_enabled, meals_mode, meals, meal_token, created_at`;

/** Every day of the event (YYYY-MM-DD), or [] when dates aren't set. Capped at 31 days. */
export function eventDays(e: Pick<EventRow, "starts_on" | "ends_on">) {
  if (!e.starts_on) return [];
  const out: string[] = [];
  const d = new Date(`${e.starts_on}T12:00:00Z`);
  const end = e.ends_on ?? e.starts_on;
  while (out.length < 31) {
    const s = d.toISOString().slice(0, 10);
    if (s > end) break;
    out.push(s);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** Exact age if given, else the top of the chosen age range (enough to tell children from adults). */
export function effectiveAge(r: { age: number | null; age_group?: string | null }, e: Pick<EventRow, "age_groups">) {
  if (r.age !== null && r.age !== undefined) return r.age;
  return e.age_groups.find((g) => g.name === r.age_group)?.upTo ?? null;
}

/** Buses only take people who are there on the first day. */
export const ridesBus = (r: { needs_bus: boolean; days?: string[] | null }, e: Pick<EventRow, "starts_on">) =>
  r.needs_bus && (!r.days || !e.starts_on || r.days.includes(e.starts_on));

export async function loadEvent(sql: Tx, id: string): Promise<EventRow> {
  const [e] = await sql.unsafe(`select ${EVENT_COLS} from events where id = $1`, [id]);
  if (!e) throw new HttpError(404, "Event not found");
  return e as unknown as EventRow;
}

// ── Settings ─────────────────────────────────────────────────────────────────

/** Same as the database default: SDA-style groups, editable per event. */
export const DEFAULT_AGE_GROUPS = [
  { name: "Children", upTo: 9 },
  { name: "Pathfinders", upTo: 15 },
  { name: "Youth", upTo: 30 },
  { name: "Adults", upTo: 59 },
  { name: "Seniors", upTo: 150 },
];

const day = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date")]).nullable().optional().transform((v) => v || null);
const clean = (max: number) => z.string().trim().max(max);

export const eventSchema = z.object({
  name: clean(120).min(1, "Give the event a name"),
  venue: clean(200).nullable().optional().transform((v) => v || null),
  starts_on: day,
  ends_on: day,
  registration_open: z.boolean().default(true),
  churches: z.array(clean(120).min(1)).max(300).default([]).transform((a) => [...new Set(a)]),
  age_groups: z
    .array(z.object({ name: clean(40).min(1), upTo: z.number().int().min(0).max(150) }))
    .min(1)
    .max(12)
    .default(DEFAULT_AGE_GROUPS)
    .transform((g) => [...g].sort((a, b) => a.upTo - b.upTo)),
  child_age: z.number().int().min(0).max(21).default(12),
  unit_label: clean(30).min(1).default("Church"),
  rooms_enabled: z.boolean().default(true),
  buses_enabled: z.boolean().default(true),
  form: formSchema.default(DEFAULT_FORM),
  meals_enabled: z.boolean().default(false),
  meals_mode: z.enum(["together", "by_church"]).default("together"),
  meals: z
    .array(mealSlotSchema)
    .max(8)
    .default([
      { key: "breakfast", name: "Breakfast", from: "06:00", to: "09:30" },
      { key: "lunch", name: "Lunch", from: "12:00", to: "15:00" },
      { key: "supper", name: "Supper", from: "18:00", to: "21:00" },
    ])
    .refine((m) => new Set(m.map((x) => x.key)).size === m.length, "Each meal needs a different name"),
  questions: z.array(z.any()).max(30).default([]),
  archived: z.boolean().optional(),
});

export function checkEvent(e: z.infer<typeof eventSchema>) {
  if (e.starts_on && e.ends_on && e.ends_on < e.starts_on) throw new HttpError(400, "The event can't end before it starts");
  const err = checkFieldDefs(e.questions as FieldDef[]);
  if (err) throw new HttpError(400, err);
}

// ── Registration (public form and admin) ────────────────────────────────────

export const RELATIONS = ["self", "spouse", "child", "parent", "sibling", "relative", "other"] as const;

export const householdSchema = z.object({
  church: clean(120).min(1, "Choose your church"),
  contact_name: clean(120).optional(), // defaults to person 1
  contact_phone: clean(40).min(1, "Enter a phone number for SMS"),
  contact_email: z.union([z.literal(""), z.email().max(200)]).nullable().optional().transform((v) => v || null),
  members: z
    .array(
      z.object({
        id: z.uuid().optional(), // admin edits
        full_name: clean(120).min(1, "Every person needs a name"),
        gender: z.enum(["male", "female"]).nullable().optional(),
        age: z.number().int().min(0).max(120).nullable(),
        age_group: clean(40).nullable().optional(), // a range instead of an exact age
        days: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(31).nullable().optional(),
        relation: z.enum(RELATIONS).nullable().optional(),
        phone: clean(40).nullable().optional(),
        needs_bus: z.boolean().default(false),
        answers: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .min(1, "Add at least one person")
    .max(25, "Up to 25 people per registration"),
  website: z.string().max(500).optional(), // honeypot: real people never fill it (checked by the route)
});
export type HouseholdInput = z.infer<typeof householdSchema>;

/** Normalise a registration against the event: church list, phones, answers. */
export function normalizeHousehold(e: EventRow, h: HouseholdInput) {
  const unit = e.unit_label.toLowerCase();
  if (!e.churches.length) throw new HttpError(400, `Registration isn't ready yet: the organizers haven't added the ${unit} list.`);
  if (!e.churches.includes(h.church)) throw new HttpError(400, `Choose your ${unit} from the list`);
  const form = effectiveForm(e);
  const allDays = form.days ? eventDays(e) : [];
  const phone = toE164(h.contact_phone, "GH");
  if (!phone) throw new HttpError(400, "That phone number doesn't look right");
  const questions = (e.questions ?? []).filter((q) => q.enabled !== false);
  const members = h.members.map((m, i) => {
    const answers: Record<string, unknown> = {};
    for (const q of questions) {
      const [v, err] = coerce(q, m.answers[q.key]);
      if (err) throw new HttpError(400, `${m.full_name || `Person ${i + 1}`}: ${err}`);
      if (v !== null) answers[q.key] = v;
    }
    let ph: string | null = null;
    if (form.member_phone && m.phone?.trim()) {
      ph = toE164(m.phone, "GH");
      if (!ph) throw new HttpError(400, `${m.full_name}: that phone number doesn't look right`);
    }
    const who = m.full_name || `Person ${i + 1}`;
    let gender: "male" | "female" | null = null;
    if (form.gender) {
      if (!m.gender) throw new HttpError(400, `${who}: choose male or female`);
      gender = m.gender;
    }
    // Age as configured: an exact age, a range (one of the event's groups), either, or not asked.
    let age: number | null = null;
    let age_group: string | null = null;
    if (form.age !== "off") {
      if (m.age !== null && form.age !== "range") age = m.age;
      else if (m.age_group && form.age !== "exact") {
        if (!e.age_groups.some((g) => g.name === m.age_group)) throw new HttpError(400, `${who}: choose an age range from the list`);
        age_group = m.age_group;
      } else throw new HttpError(400, `${who}: ${form.age === "exact" ? "give an age" : form.age === "range" ? "choose an age range" : "give an age or choose an age range"}`);
    }
    // Days attending: null = every day. Unknown days are dropped.
    let days: string[] | null = null;
    if (allDays.length && m.days) {
      const picked = allDays.filter((d) => m.days!.includes(d));
      if (!picked.length) throw new HttpError(400, `${who}: choose at least one day`);
      days = picked.length === allDays.length ? null : picked;
    }
    const needs_bus = e.buses_enabled && ridesBus({ needs_bus: m.needs_bus, days }, e);
    return { ...m, gender, age, phone: ph, answers, age_group, days, needs_bus, relation: m.relation ?? (i === 0 ? "self" : null) };
  });
  return { ...h, contact_name: h.contact_name || members[0].full_name, contact_phone: phone, contact_email: form.email ? h.contact_email : null, members };
}

// ── Duplicates ───────────────────────────────────────────────────────────────

export type PhoneConflict = { phone: string; household_id: string; contact_name: string; church: string; people: number };

/** Every phone in a registration: the contact's and each person's own. */
export const phonesOf = (h: ReturnType<typeof normalizeHousehold>) => [...new Set([h.contact_phone, ...h.members.map((m) => m.phone).filter((p): p is string => !!p)])];

/**
 * Registrations in this event already using any of these numbers, as a
 * contact or as a person's own phone. `exclude` skips the registration being edited.
 */
export async function phoneConflicts(sql: Tx, eventId: string, phones: string[], exclude?: string): Promise<PhoneConflict[]> {
  if (!phones.length) return [];
  const rows = await sql`
    select distinct on (h.id) x.phone, h.id as household_id, h.contact_name, h.church,
      (select count(*)::int from event_registrants r2 where r2.household_id = h.id and r2.status = 'registered') as people
    from (
      select contact_phone as phone, id as household_id from event_households where event_id = ${eventId} and contact_phone = any(${phones})
      union all
      select r.phone, r.household_id from event_registrants r where r.event_id = ${eventId} and r.status = 'registered' and r.phone = any(${phones})
    ) x join event_households h on h.id = x.household_id
    where ${exclude ?? null}::uuid is null or h.id <> ${exclude ?? null}::uuid`;
  return rows as unknown as PhoneConflict[];
}

export const nationalPhone = (e164: string) => parsePhoneNumberFromString(e164)?.formatNational() ?? e164;

/** Postgres unique violation on the one-registration-per-phone rule (two submits at the same instant). */
export const isPhoneClash = (e: unknown) => (e as { code?: string; constraint_name?: string })?.code === "23505" && /phone/.test((e as { constraint_name?: string }).constraint_name ?? "");

export async function insertHousehold(sql: Tx, e: EventRow, h: ReturnType<typeof normalizeHousehold>, source: "public" | "admin") {
  const [hh] = await sql`
    insert into event_households (event_id, church, contact_name, contact_phone, contact_email, source)
    values (${e.id}, ${h.church}, ${h.contact_name}, ${h.contact_phone}, ${h.contact_email}, ${source})
    returning id, code, pass_token`;
  for (const m of h.members) {
    await sql`
      insert into event_registrants (event_id, household_id, full_name, gender, age, age_group, days, relation, phone, needs_bus, answers)
      values (${e.id}, ${hh.id}, ${m.full_name}, ${m.gender}, ${m.age}, ${m.age_group}, ${m.days}::date[], ${m.relation}, ${m.phone}, ${m.needs_bus}, ${sql.json(m.answers as never)})`;
  }
  return hh as { id: string; code: string; pass_token: string };
}

// ── Notifications ────────────────────────────────────────────────────────────

export type Kind = "registered" | "room" | "bus" | "broadcast";
const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 24);
const first = (n: string) => n.trim().split(/\s+/)[0];

type HH = { id: string; contact_name: string; contact_phone: string | null; contact_email: string | null; code: string; pass_token: string; church: string };
type Member = { household_id: string; full_name: string; status: string; room: string | null; bed: number | null; bus: string | null; seat: number | null; pickup: string | null; departs: string | null };

/** The lines a household's message is about; identical lines = nothing new to say. */
function linesFor(kind: Kind, members: Member[]) {
  const live = members.filter((m) => m.status === "registered");
  if (kind === "registered") return live.map((m) => m.full_name);
  if (kind === "room") return live.filter((m) => m.room).map((m) => `${first(m.full_name)}: ${m.room}, bed ${m.bed}`);
  if (kind === "bus") {
    const rows = live.filter((m) => m.bus);
    const buses = [...new Set(rows.map((m) => m.bus))];
    return buses.flatMap((b) => {
      const on = rows.filter((m) => m.bus === b);
      const meta = [on[0].pickup && `from ${on[0].pickup}`, on[0].departs].filter(Boolean).join(", ");
      return [`${b}${meta ? ` (${meta})` : ""}: ${on.map((m) => `${first(m.full_name)} seat ${m.seat}`).join(", ")}`];
    });
  }
  return [];
}

function compose(kind: Kind, e: EventRow, h: HH, lines: string[], link: string, custom?: string) {
  const hi = `Hi ${first(h.contact_name)},`;
  switch (kind) {
    case "registered":
      return {
        subject: `You're registered for ${e.name}`,
        text: `${e.name}: ${hi} you're registered${lines.length > 1 ? ` (${lines.length} people)` : ""}. Code ${h.code}. Your pass: ${link}`,
      };
    case "room":
      return { subject: `${e.name}: your room`, text: `${e.name} rooms\n${lines.join("\n")}\nPass: ${link}` };
    case "bus":
      return { subject: `${e.name}: your bus seat`, text: `${e.name} bus\n${lines.join("\n")}\nPass: ${link}` };
    case "broadcast":
      return { subject: e.name, text: `${e.name}: ${custom}` };
  }
}

/**
 * Queue a message for each household (optionally only some / one church). The
 * same content is never queued twice to the same number, so "Send room details"
 * can be pressed again after changes: only families whose rooms changed (or who
 * newly got one) are messaged.
 */
export async function queueMessages(
  sql: Tx,
  e: EventRow,
  kind: Kind,
  origin: string,
  opts: { householdIds?: string[]; church?: string | null; body?: string } = {},
) {
  const hhs = (await sql`
    select id, contact_name, contact_phone, contact_email, code, pass_token, church from event_households
    where event_id = ${e.id}
      ${opts.householdIds ? sql`and id = any(${opts.householdIds})` : sql``}
      ${opts.church ? sql`and church = ${opts.church}` : sql``}`) as unknown as HH[];
  if (!hhs.length) return { queued: 0, skipped: 0 };
  const members = (await sql`
    select r.household_id, r.full_name, r.status, r.bed, r.seat,
      case when rm.id is null then null when rm.building = '' then rm.name else rm.building || ' ' || rm.name end as room,
      b.name as bus, b.pickup, b.departs
    from event_registrants r
    left join event_rooms rm on rm.id = r.room_id
    left join event_buses b on b.id = r.bus_id
    where r.household_id = any(${hhs.map((h) => h.id)})
    order by r.created_at`) as unknown as Member[];

  let queued = 0;
  let skipped = 0;
  const sms = smsEnabled();
  const mail = mailEnabled();
  for (const h of hhs) {
    const lines = linesFor(kind, members.filter((m) => m.household_id === h.id));
    if (kind !== "broadcast" && !lines.length) {
      skipped++;
      continue;
    }
    if (kind === "broadcast" && !members.some((m) => m.household_id === h.id && m.status === "registered")) {
      skipped++;
      continue;
    }
    const link = `${origin}/pass/${h.pass_token}`;
    const msg = compose(kind, e, h, lines, link, opts.body);
    const dedupe = hash(kind === "broadcast" ? opts.body ?? "" : lines.join("|"));
    const targets: { channel: "sms" | "email"; to: string }[] = [];
    if (sms && h.contact_phone) targets.push({ channel: "sms", to: h.contact_phone });
    if (mail && h.contact_email) targets.push({ channel: "email", to: h.contact_email });
    if (!targets.length) {
      skipped++;
      continue;
    }
    for (const t of targets) {
      const r = await sql`
        insert into event_messages (event_id, household_id, channel, recipient, kind, dedupe, body, subject)
        values (${e.id}, ${h.id}, ${t.channel}, ${t.to}, ${kind}, ${dedupe}, ${msg.text}, ${msg.subject})
        on conflict do nothing returning id`;
      if (r.length) queued++;
    }
  }
  return { queued, skipped };
}

/**
 * Send up to `limit` queued messages. Rows are claimed with SKIP LOCKED, so two
 * admins pressing Send at once never send the same message twice.
 */
export async function sendQueued(orgId: string, eventId: string, limit = 20) {
  const batch = (await tenant(orgId, (sql) => sql`
    update event_messages set status = 'sending', attempts = attempts + 1
    where id in (
      select id from event_messages
      where event_id = ${eventId} and (status = 'queued' or (status = 'sending' and created_at < now() - interval '10 minutes'))
      order by created_at limit ${limit} for update skip locked)
    returning id, channel, recipient, body, subject, attempts`)) as unknown as {
    id: string;
    channel: "sms" | "email";
    recipient: string;
    body: string;
    subject: string | null;
    attempts: number;
  }[];

  let sent = 0;
  let failed = 0;
  await Promise.all(
    batch.map(async (m) => {
      let ok = false;
      let error: string | null = null;
      let retry = false;
      if (m.channel === "sms") {
        const r = await sendSms(m.recipient, m.body);
        ok = r.ok;
        if (!r.ok) [error, retry] = [r.error, r.retry];
      } else {
        try {
          await sendMail({ to: m.recipient, subject: m.subject ?? "", lines: m.body.split("\n") });
          ok = true;
        } catch (e) {
          [error, retry] = [(e as Error).message.slice(0, 300), true];
        }
      }
      const status = ok ? "sent" : retry && m.attempts < 3 ? "queued" : "failed";
      await tenant(orgId, (sql) => sql`
        update event_messages set status = ${status}, error = ${error}, sent_at = case when ${ok} then now() end
        where id = ${m.id}`);
      if (ok) sent++;
      else if (status === "failed") failed++;
    }),
  );
  const [{ left }] = await tenant(orgId, (sql) => sql`select count(*)::int as left from event_messages where event_id = ${eventId} and status in ('queued', 'sending')`);
  return { sent, failed, left: left as number };
}
