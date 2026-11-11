import "server-only";
import { config } from "./config";
import { toVector } from "./db";
import type { Org, Tx } from "./tenant";

// Everything here runs inside `tenant(org.id, …)`: row-level security already
// limits every table to the org, and queries also filter by org_id explicitly so
// the planner uses the per-org indexes.

export type Candidate = {
  id: string;
  ref: string;
  code: string; // org code, or platform ID when none
  full_name: string;
  group_name: string | null;
  avatar: string | null;
  distance: number;
};

export type MatchResult =
  | { status: "match"; person: Candidate; distance: number; margin: number | null }
  | { status: "unknown"; best: Candidate | null; distance: number | null }
  | { status: "ambiguous"; best: Candidate; second: Candidate; margin: number };

/**
 * Exact nearest-neighbour search over the org's templates (3–5 per person),
 * collapsed to the best distance per person. A match needs:
 *   1. best distance ≤ MATCH_THRESHOLD, and
 *   2. a clear gap to the runner-up person (≥ MATCH_MARGIN), so two lookalikes
 *      never get silently confused — the kiosk falls back to the QR badge instead.
 * ~5k vectors per org → an exact scan takes a few ms and has perfect recall.
 */
export async function matchDescriptor(sql: Tx, org: Org, descriptor: number[]): Promise<MatchResult> {
  const vec = toVector(descriptor);
  const rows = await sql<Candidate[]>`
    with best as (
      select person_id, min(embedding <-> ${vec}::vector) as d
      from face_embeddings
      where org_id = ${org.id}
      group by person_id
      order by d
      limit 2
    )
    select p.id, p.ref, coalesce(p.code, p.ref) as code, p.full_name, p.group_name, p.avatar_url as avatar, best.d::float8 as distance
    from best join people p on p.id = best.person_id
    where p.active
    order by best.d`;

  const [best, second] = rows;
  if (!best || best.distance > config.matchThreshold) {
    return { status: "unknown", best: best ?? null, distance: best?.distance ?? null };
  }
  const margin = second ? second.distance - best.distance : null;
  if (second && margin !== null && margin < config.matchMargin) {
    return { status: "ambiguous", best, second, margin };
  }
  return { status: "match", person: best, distance: best.distance, margin };
}

export type Method = "face" | "qr" | "manual" | "link";

export type CheckInExtras = {
  distance?: number | null;
  margin?: number | null;
  liveness?: unknown;
  kioskId?: string | null;
  recordedBy?: string | null;
  note?: string | null;
};

export type CheckInResult = {
  status: "checked_in" | "already";
  // `code` = the org's own code, or the platform ID when the org doesn't use codes.
  person: { id: string; ref: string; code: string; full_name: string; group_name: string | null; avatar: string | null };
  service: { id: string; name: string };
  at: string;
  method: Method;
  late: boolean;
  rank: number; // nth arrival at this service today
};

/** Which service occurrence a check-in belongs to. */
export type Occurrence = { serviceId: string; serviceName: string; day: string; late: boolean };

/** Record attendance for one service occurrence (idempotent per person/service/day). */
export async function recordCheckIn(
  sql: Tx,
  org: Org,
  personId: string,
  method: Method,
  occ: Occurrence,
  extras: CheckInExtras = {},
): Promise<CheckInResult> {
  const [person] = await sql`
    select id, ref, coalesce(code, ref) as code, full_name, group_name, avatar_url as avatar from people
    where id = ${personId} and org_id = ${org.id} and active`;
  if (!person) throw new Error("Person not found or inactive");

  const inserted = await sql`
    insert into attendance (org_id, person_id, service_id, day, late, method, distance, margin, liveness, kiosk_id, recorded_by, note)
    values (
      ${org.id}, ${personId}, ${occ.serviceId}, ${occ.day}::date, ${occ.late}, ${method}::attendance_method,
      ${extras.distance ?? null}, ${extras.margin ?? null},
      ${extras.liveness === undefined ? null : sql.json(extras.liveness as never)},
      ${extras.kioskId ?? null}, ${extras.recordedBy ?? null}, ${extras.note ?? null}
    )
    on conflict (person_id, service_id, day) do nothing
    returning id`;

  const [rec] = await sql`
    select a.checked_in_at, a.method::text as method, a.late,
      (select count(*)::int from attendance b
        where b.service_id = a.service_id and b.day = a.day and b.checked_in_at <= a.checked_in_at) as rank
    from attendance a
    where a.person_id = ${personId} and a.service_id = ${occ.serviceId} and a.day = ${occ.day}::date`;

  return {
    status: inserted.length ? "checked_in" : "already",
    person: { id: person.id, ref: person.ref, code: person.code, full_name: person.full_name, group_name: person.group_name, avatar: person.avatar },
    service: { id: occ.serviceId, name: occ.serviceName },
    at: new Date(rec.checked_in_at).toISOString(),
    method: rec.method,
    late: rec.late,
    rank: rec.rank,
  };
}

export async function logAttempt(
  sql: Tx,
  org: Org,
  a: { kioskId?: string | null; outcome: string; distance?: number | null; margin?: number | null; candidate?: string | null },
) {
  // Savepoint: a failed audit insert must not abort the caller's transaction.
  try {
    await sql.savepoint((sp) => sp`
      insert into attempts (org_id, kiosk_id, outcome, distance, margin, candidate)
      values (${org.id}, ${a.kioskId ?? null}, ${a.outcome}, ${a.distance ?? null}, ${a.margin ?? null}, ${a.candidate ?? null})`);
  } catch (e) {
    console.error("logAttempt failed", e);
  }
}
