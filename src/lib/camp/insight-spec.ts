import { z } from "zod";

// What a saved insight is: count something, grouped by one thing, optionally
// split by another, filtered, shown a certain way. Shared by the API (validation)
// and the page (building and computing).

export const MEASURES = ["people", "families", "children", "adults", "bus", "arrived"] as const;
export const CHARTS = ["bars", "columns", "table", "number"] as const;

/** Built-in dimensions; custom questions are "q:<field key>". */
export const DIMS = ["church", "age_group", "gender", "day", "family_size", "relation", "room_type", "room", "bus", "needs_bus", "arrived", "source", "registered"] as const;
const dim = z.string().regex(/^(church|age_group|gender|day|family_size|relation|room_type|room|bus|needs_bus|arrived|source|registered|q:c_[a-z0-9_]{1,40})$/, "Unknown field");

export const insightSpec = z.object({
  measure: z.enum(MEASURES).default("people"),
  by: dim.nullable().default("church"),
  split: dim.nullable().default(null),
  filters: z.array(z.object({ dim, values: z.array(z.string().max(120)).min(1).max(50) })).max(5).default([]),
  chart: z.enum(CHARTS).default("bars"),
  sort: z.enum(["value", "label"]).default("value"),
});
export type InsightSpec = z.infer<typeof insightSpec>;

export const insightSchema = z.object({ name: z.string().trim().min(1, "Give it a name").max(80), spec: insightSpec });
