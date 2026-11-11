import "server-only";
import type postgres from "postgres";
import type { NextRequest } from "next/server";
import { z } from "zod";
import type { AdminSession } from "./auth";
import { db } from "./db";
import { COOKIE } from "./keys";
import { resolveFields, type FieldDef } from "./person-fields";

export type Tx = postgres.TransactionSql;

export type Org = {
  id: string;
  name: string;
  slug: string;
  timeZone: string;
  lateAfter: string | null;
  selfCheckin: boolean;
  checkinKey: string;
  role: "owner" | "admin";
  personFields: FieldDef[];
  logoUrl: string | null; // null → show the default Face2Face mark
  geo: { lat: number | null; lng: number | null; radiusM: number; required: boolean };
};

/**
 * Run `fn` inside a transaction scoped to one organization: `app.org_id` is set
 * and the role drops to `f2f_tenant`, so Postgres row-level security hides every
 * other organization's rows — even from a query that forgets its WHERE clause.
 * Inserts pick up org_id automatically from the same setting.
 */
export async function tenant<T>(orgId: string, fn: (sql: Tx) => Promise<T>): Promise<T> {
  return db().begin(async (tx) => {
    await tx`select set_config('app.org_id', ${orgId}, true)`;
    await tx`set local role f2f_tenant`;
    return fn(tx);
  }) as Promise<T>;
}

type OrgRow = {
  id: string;
  name: string;
  slug: string;
  time_zone: string;
  late_after: string | null;
  self_checkin: boolean;
  checkin_key: string;
  role: "owner" | "admin";
  person_fields: unknown;
  logo_url: string | null;
  geo_lat: number | null;
  geo_lng: number | null;
  geo_radius_m: number;
  geo_required: boolean;
};

function toOrg(r: OrgRow): Org {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    timeZone: r.time_zone,
    lateAfter: r.late_after,
    selfCheckin: r.self_checkin,
    checkinKey: r.checkin_key,
    role: r.role,
    personFields: resolveFields(r.person_fields),
    logoUrl: r.logo_url,
    geo: { lat: r.geo_lat, lng: r.geo_lng, radiusM: r.geo_radius_m, required: r.geo_required },
  };
}

/** The org this admin is working in: the cookie's choice if they may access it, else their first. */
export async function resolveAdminOrg(admin: AdminSession, req: NextRequest): Promise<Org | null> {
  const wanted = z.uuid().safeParse(req.cookies.get(COOKIE.org)?.value);
  const sql = db();
  const rows = await sql<OrgRow[]>`
    select o.id, o.name, o.slug, o.time_zone, o.late_after, o.self_checkin, o.checkin_key, o.person_fields, o.logo_url, o.geo_lat, o.geo_lng, o.geo_radius_m, o.geo_required,
      coalesce(m.role, 'owner') as role
    from organizations o
    left join memberships m on m.org_id = o.id and m.admin_id = ${admin.id}
    where (m.admin_id is not null or ${admin.isPlatform})
      ${wanted.success ? sql`and o.id = ${wanted.data}` : sql``}
    order by m.created_at nulls last, o.created_at
    limit 1`;
  if (rows[0]) return toOrg(rows[0]);
  if (wanted.success) {
    // Stale/forbidden cookie → fall back to the admin's own first org.
    const [r] = await sql<OrgRow[]>`
      select o.id, o.name, o.slug, o.time_zone, o.late_after, o.self_checkin, o.checkin_key, o.person_fields, o.logo_url, o.geo_lat, o.geo_lng, o.geo_radius_m, o.geo_required, m.role
      from memberships m join organizations o on o.id = m.org_id
      where m.admin_id = ${admin.id} order by m.created_at limit 1`;
    return r ? toOrg(r) : null;
  }
  return null;
}

export async function loadOrg(where: { id: string } | { slug: string }): Promise<Org | null> {
  const sql = db();
  const [r] = await sql<OrgRow[]>`
    select id, name, slug, time_zone, late_after, self_checkin, checkin_key, person_fields, logo_url, geo_lat, geo_lng, geo_radius_m, geo_required, 'admin' as role
    from organizations where ${"id" in where ? sql`id = ${where.id}` : sql`slug = ${where.slug}`}`;
  return r ? toOrg(r) : null;
}

/** Local "today" (YYYY-MM-DD) in the organization's time zone. */
export function todayIn(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function isValidTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
