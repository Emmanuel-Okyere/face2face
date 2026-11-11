import { z } from "zod";
import { recordCheckIn } from "@/lib/attendance";
import { body, handle, HttpError, json, requireOrg } from "@/lib/http";
import { isLate } from "@/lib/service-schedule";
import { serviceForCheckIn, servicesToday } from "@/lib/services";
import { tenant } from "@/lib/tenant";

/** Today's services, for the manual check-in picker. */
export const GET = handle(async (req) => {
  const { org } = await requireOrg(req);
  const { services } = await tenant(org.id, (sql) => servicesToday(sql, org));
  return json({ services: services.map((s) => ({ id: s.id, name: s.name, start: s.start_time, end: s.end_time, open: s.open })) });
});

const schema = z.object({
  personId: z.uuid(),
  serviceId: z.uuid().optional(), // any service happening today; default = the one open now
  note: z.string().trim().max(300).optional(),
});

/** Manual fallback: an admin vouches for someone (camera broken, injury, forgot badge…). */
export const POST = handle(async (req) => {
  const { admin, org } = await requireOrg(req);
  const { personId, serviceId, note } = await body(req, schema);
  const result = await tenant(org.id, async (sql) => {
    const [p] = await sql`select 1 from people where id = ${personId} and active`;
    if (!p) throw new HttpError(404, "Person not found");
    let occ;
    if (serviceId) {
      // Admins may record for any of today's services, even after its window closed.
      const { now, services } = await servicesToday(sql, org);
      const s = services.find((x) => x.id === serviceId);
      if (!s) throw new HttpError(400, "That service isn't happening today");
      occ = { serviceId: s.id, serviceName: s.name, day: now.date, late: isLate(s, now.min) };
    } else {
      const o = await serviceForCheckIn(sql, org, personId);
      if (!o.service) throw new HttpError(409, "No service is open right now — choose one", {}, "no_service");
      occ = { serviceId: o.service.id, serviceName: o.service.name, day: o.day, late: o.late };
    }
    return recordCheckIn(sql, org, personId, "manual", occ, { recordedBy: admin.id, note: note || null });
  });
  return json(result);
});

/** Undo a mistaken check-in. */
export const DELETE = handle(async (req) => {
  const { org } = await requireOrg(req);
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id)) return json({ error: "id required" }, 400);
  await tenant(org.id, (sql) => sql`delete from attendance where id = ${id}`);
  return json({ ok: true });
});
