import { z } from "zod";

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");

export const serviceSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    kind: z.enum(["weekly", "once", "daily"]),
    weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional().nullable(),
    // Only one-off services have a date; "" or null means none.
    on_date: z
      .union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a valid date")])
      .nullable()
      .optional()
      .transform((v) => v || null),
    start_time: HHMM,
    end_time: HHMM,
    opens_before: z.number().int().min(0).max(240).default(30),
    closes_after: z.number().int().min(0).max(240).default(0),
    late_after: z.number().int().min(0).max(600).nullable().default(null),
    audience: z.array(z.string().trim().min(1).max(120)).max(50).nullable().optional(),
    active: z.boolean().default(true),
  })
  .refine((s) => s.end_time > s.start_time, { message: "End time must be after the start time", path: ["end_time"] })
  .refine((s) => s.kind !== "weekly" || (s.weekdays?.length ?? 0) > 0, { message: "Pick at least one day", path: ["weekdays"] })
  .refine((s) => s.kind !== "once" || !!s.on_date, { message: "Pick a date", path: ["on_date"] });

export type ServiceInput = z.infer<typeof serviceSchema>;

export function normalize(s: ServiceInput) {
  return {
    ...s,
    weekdays: s.kind === "weekly" ? [...new Set(s.weekdays ?? [])].sort() : null,
    on_date: s.kind === "once" ? s.on_date! : null,
    audience: s.audience?.length ? [...new Set(s.audience)] : null,
  };
}
