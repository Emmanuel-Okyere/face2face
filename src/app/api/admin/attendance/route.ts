import { handle, json, requireOrg } from "@/lib/http";
import { tenant, todayIn } from "@/lib/tenant";

const PAGE = 100;

function csvCell(v: unknown) {
  const s = v == null ? "" : v instanceof Date ? v.toISOString() : String(v);
  // Neutralise spreadsheet formula injection, then quote.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export const GET = handle(async (req) => {
  const { org } = await requireOrg(req);
  const sp = req.nextUrl.searchParams;
  const from = sp.get("from") || todayIn(org.timeZone);
  const to = sp.get("to") || from;
  const method = sp.get("method");
  const q = (sp.get("q") || "").trim();
  const format = sp.get("format");
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const service = sp.get("service");

  return tenant(org.id, async (sql) => {
    const where = sql`and`.join([
      sql`a.org_id = ${org.id}`,
      sql`a.day between ${from}::date and ${to}::date`,
      !!method && ["face", "qr", "manual", "link", "visitor"].includes(method) && sql`a.method = ${method}::attendance_method`,
      !!service && /^[0-9a-f-]{36}$/i.test(service) && sql`a.service_id = ${service}`,
      !!q &&
        sql`(p.full_name ilike ${"%" + q + "%"} or p.code ilike ${"%" + q + "%"} or p.group_name ilike ${"%" + q + "%"}
          or replace(p.ref, '-', '') ilike ${"%" + q.toUpperCase().replace(/[\s-]/g, "") + "%"})`,
    ]);
    const base = sql`
      select a.id, a.day::text as day, a.checked_in_at, a.method::text as method, a.distance, a.margin, a.note,
        p.id as person_id, p.ref, p.code, p.full_name, p.group_name, p.avatar_url as avatar,
        k.name as kiosk, ad.name as recorded_by, a.late, s.name as service,
        count(*) over()::int as total
      from attendance a
      join people p on p.id = a.person_id
      join services s on s.id = a.service_id
      left join kiosks k on k.id = a.kiosk_id
      left join admins ad on ad.id = a.recorded_by
      where ${where}
      order by a.checked_in_at desc`;

    if (format === "csv") {
      const rows = await sql`${base} limit 100000`;
      const header = ["day", "service", "checked_in_at", "platform_id", "code", "full_name", "group", "method", "late", "distance", "kiosk", "recorded_by", "note"];
      const lines = rows.map((r) =>
        [r.day, r.service, r.checked_in_at, r.ref, r.code, r.full_name, r.group_name, r.method, r.late, r.distance?.toFixed?.(3), r.kiosk, r.recorded_by, r.note]
          .map(csvCell)
          .join(","),
      );
      const name = `${org.slug}_attendance_${from}_${to}.csv`;
      return new Response([header.join(","), ...lines].join("\r\n"), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="${name}"`,
          "cache-control": "no-store",
        },
      });
    }

    const rows = await sql`${base} limit ${PAGE} offset ${(page - 1) * PAGE}`;
    return json({ rows: rows.map(omitTotal), total: rows[0]?.total ?? 0, page, pageSize: PAGE });
  });
});

function omitTotal<T extends { total?: unknown }>(r: T) {
  const out = { ...r };
  delete out.total;
  return out;
}
