import { z } from "zod";
import { ageGroupIndex } from "@/lib/camp/allocate";
import { loadEvent } from "@/lib/camp/events";
import { handle, requireOrg } from "@/lib/http";
import { tenant } from "@/lib/tenant";

type Ctx = { params: Promise<{ id: string }> };

function cell(v: unknown) {
  const s = v == null ? "" : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; // no spreadsheet formulas
  return `"${safe.replace(/"/g, '""')}"`;
}

/** Everyone registered, one row per person: family, church, age group, room/bed, bus/seat, answers. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { org } = await requireOrg(req);
  const id = z.uuid().parse((await params).id);
  const { e, rows } = await tenant(org.id, async (sql) => {
    const e = await loadEvent(sql, id);
    const rows = await sql`
      select h.code as registration_code, h.church, h.contact_name, h.contact_phone, h.contact_email,
        r.code, r.full_name, r.gender, r.age, r.age_group, to_json(r.days) as days, r.relation, r.phone, r.needs_bus, r.status, r.answers, r.arrived_at, r.created_at,
        rm.building, rm.name as room, r.bed, b.name as bus, r.seat
      from event_registrants r join event_households h on h.id = r.household_id
      left join event_rooms rm on rm.id = r.room_id left join event_buses b on b.id = r.bus_id
      where r.event_id = ${id} order by h.church, h.created_at, r.created_at`;
    return { e, rows };
  });
  const qs = (e.questions ?? []).filter((q) => q.enabled !== false);
  const header = ["registration_code", "church", "contact", "contact_phone", "contact_email", "code", "name", "gender", "age", "age_group", "days", "relation", "phone",
    "status", "building", "room", "bed", "needs_bus", "bus", "seat", "arrived_at", "registered_at", ...qs.map((q) => q.label)];
  const lines = rows.map((r) =>
    [r.registration_code, r.church, r.contact_name, r.contact_phone, r.contact_email, r.code, r.full_name, r.gender, r.age,
      r.age_group ?? (r.age === null ? "" : e.age_groups[ageGroupIndex(r.age, e.age_groups)]?.name ?? ""), r.days ? (r.days as string[]).join(" ") : "all", r.relation, r.phone, r.status, r.building, r.room, r.bed,
      r.needs_bus ? "yes" : "no", r.bus, r.seat, r.arrived_at?.toISOString?.() ?? "", r.created_at?.toISOString?.() ?? "",
      ...qs.map((q) => { const v = (r.answers ?? {})[q.key]; return typeof v === "boolean" ? (v ? "yes" : "no") : v; })]
      .map(cell).join(","),
  );
  const name = `${e.name.replace(/[^\w-]+/g, "_").slice(0, 40)}_registrations.csv`;
  return new Response("﻿" + [header.map(cell).join(","), ...lines].join("\r\n"), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" },
  });
});
