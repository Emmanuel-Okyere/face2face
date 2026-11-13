import { z } from "zod";
import { body, handle, HttpError, json, requireOrg } from "@/lib/http";
import { servicesToday } from "@/lib/services";
import { isLate } from "@/lib/service-schedule";
import { tenant } from "@/lib/tenant";
import { visitorCheckIn, visitorSchema } from "@/lib/visitors";

/** Admin "+ Visitor": save a visitor and check them in (to the chosen service, or the open one). */
export const POST = handle(async (req) => {
  const { admin, org } = await requireOrg(req);
  const v = await body(req, visitorSchema.extend({ serviceId: z.uuid().optional() }));
  const r = await tenant(org.id, async (sql) => {
    let occurrence;
    if (v.serviceId) {
      const { now, services } = await servicesToday(sql, org);
      const s = services.find((x) => x.id === v.serviceId);
      if (!s) throw new HttpError(400, "That service isn't happening today");
      occurrence = { serviceId: s.id, serviceName: s.name, day: now.date, late: isLate(s, now.min) };
    }
    return visitorCheckIn(sql, org, v, { recordedBy: admin.id, occurrence });
  });
  return json(r);
});
