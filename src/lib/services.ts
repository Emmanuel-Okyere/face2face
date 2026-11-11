import "server-only";
import { fmtNext, isLate, isOpen, localNow, nextOpening, occursOn, pickService, type Service } from "./service-schedule";
import type { Org, Tx } from "./tenant";

/** All of the organization's services (active first). */
export async function listServices(sql: Tx, org: Org): Promise<Service[]> {
  return sql<Service[]>`
    select id, name, kind, weekdays, on_date::text, to_char(start_time, 'HH24:MI') as start_time,
      to_char(end_time, 'HH24:MI') as end_time, opens_before, closes_after, late_after, audience, active
    from services where org_id = ${org.id}
    order by active desc, start_time, name`;
}

export type ServiceNow = {
  now: { date: string; dow: number; min: number };
  open: Service[];
  next: { name: string; label: string; date: string; opens: number } | null;
};

/** What's open right now, and what opens next. */
export async function servicesNow(sql: Tx, org: Org): Promise<ServiceNow & { all: Service[] }> {
  const all = (await listServices(sql, org)).filter((s) => s.active);
  const now = localNow(org.timeZone);
  const open = all.filter((s) => isOpen(s, now.date, now.min));
  const n = nextOpening(all, now);
  return { all, now, open, next: n && { name: n.service.name, label: fmtNext(n, now.date), date: n.date, opens: n.opens } };
}

/** The service a person checks in to right now, with day and lateness — or null if none is open. */
export async function serviceForCheckIn(sql: Tx, org: Org, personId: string) {
  const { open, now, next } = await servicesNow(sql, org);
  if (!open.length) return { service: null, next } as const;
  const [p] = await sql`select group_name from people where id = ${personId}`;
  const service = pickService(open, p?.group_name ?? null)!;
  return { service, day: now.date, late: isLate(service, now.min), next } as const;
}

/** Services happening today (any time), for manual check-in and the dashboard. */
export async function servicesToday(sql: Tx, org: Org) {
  const { all, now, open } = await servicesNow(sql, org);
  const openIds = new Set(open.map((s) => s.id));
  return { now, services: all.filter((s) => occursOn(s, now.date)).map((s) => ({ ...s, open: openIds.has(s.id) })) };
}
