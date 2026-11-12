// Turns a saved insight spec + the event's registrations into a table of
// numbers: groups (rows) × series (the split), ready to draw. Pure and
// client-safe, so insights are always computed from live data.
import type { FieldDef } from "@/lib/person-fields";
import { eventDays } from "./format";
import type { InsightSpec } from "./insight-spec";

type AgeGroup = { name: string; upTo: number };
export type InsightData = {
  event: {
    unit_label: string;
    starts_on: string | null;
    ends_on: string | null;
    child_age: number;
    age_groups: AgeGroup[];
    questions: FieldDef[];
    churches: string[];
  };
  households: { id: string; church: string; source: string }[];
  people: {
    id: string;
    household_id: string;
    gender: string | null;
    age: number | null;
    age_group: string | null;
    days: string[] | null;
    relation: string | null;
    needs_bus: boolean;
    answers: Record<string, unknown>;
    status: string;
    room_id: string | null;
    bus_id: string | null;
    arrived_at: string | null;
    created_at: string;
  }[];
  rooms: { id: string; building: string; name: string; gender: string }[];
  buses: { id: string; name: string }[];
};
type P = InsightData["people"][number];

export const MEASURE_LABEL: Record<InsightSpec["measure"], string> = {
  people: "People",
  families: "Registrations", // key kept as "families" so saved insights keep working
  children: "Children",
  adults: "Adults",
  bus: "Bus riders",
  arrived: "Arrived",
};

const RELATION: Record<string, string> = { self: "Contact person", spouse: "Spouse", child: "Child", parent: "Parent", sibling: "Brother / sister", relative: "Relative", other: "Other" };
const NONE = "Not given";
const wd = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" });

/** Everything you can group, split or filter by, with its values in natural order. */
export function dimensions(d: InsightData) {
  const e = d.event;
  const days = eventDays(e.starts_on, e.ends_on);
  const live = d.people.filter((p) => p.status === "registered");
  const dims: { key: string; label: string; order?: string[] }[] = [
    { key: "church", label: e.unit_label || "Church", order: e.churches },
    { key: "age_group", label: "Age group", order: [...e.age_groups.map((g) => g.name), NONE] },
    { key: "gender", label: "Gender", order: ["Female", "Male", NONE] },
    ...(days.length > 1 ? [{ key: "day", label: "Day attending", order: days.map(wd) }] : []),
    { key: "family_size", label: "Registration size", order: ["1", "2", "3", "4", "5", "6+"] },
    { key: "relation", label: "Relationship", order: Object.values(RELATION) },
    ...(d.rooms.length ? [{ key: "room_type", label: "Room type", order: ["Women's", "Men's", "Family", "No bed"] }, { key: "room", label: "Room" }] : []),
    ...(d.buses.length ? [{ key: "bus", label: "Bus", order: [...d.buses.map((b) => b.name), "No seat yet", "Own transport"] }] : []),
    { key: "needs_bus", label: "Needs the bus", order: ["Yes", "No"] },
    { key: "arrived", label: "Arrived", order: ["Arrived", "Not yet"] },
    { key: "source", label: "Registered by", order: ["Online", "Admin"] },
    { key: "registered", label: "Week registered" },
    ...(e.questions ?? [])
      .filter((q) => q.enabled !== false && q.type !== "longtext")
      .map((q) => ({
        key: `q:${q.key}`,
        label: q.label,
        order: q.type === "yesno" ? ["Yes", "No", "No answer"] : q.type === "select" ? [...(q.options ?? []), "No answer"] : undefined,
      })),
  ];
  // Values actually present (for filter pickers), in natural order.
  return dims.map((x) => {
    const seen = new Set<string>();
    for (const p of live) for (const v of valuesOf(x.key, p, d)) seen.add(v);
    const ordered = x.order ? [...x.order.filter((v) => seen.has(v)), ...[...seen].filter((v) => !x.order!.includes(v)).sort()] : [...seen].sort();
    return { ...x, values: ordered };
  });
}

/** A person's value(s) for a dimension. "Day attending" can have several. */
export function valuesOf(dim: string, p: P, d: InsightData): string[] {
  const e = d.event;
  switch (dim) {
    case "church":
      return [d.households.find((h) => h.id === p.household_id)?.church ?? NONE];
    case "age_group":
      return [p.age_group ?? (p.age === null ? NONE : (e.age_groups.find((g) => p.age! <= g.upTo)?.name ?? NONE))];
    case "gender":
      return [p.gender === "female" ? "Female" : p.gender === "male" ? "Male" : NONE];
    case "day": {
      const all = eventDays(e.starts_on, e.ends_on);
      return (p.days ?? all).map(wd);
    }
    case "family_size": {
      const n = d.people.filter((x) => x.household_id === p.household_id && x.status === "registered").length;
      return [n >= 6 ? "6+" : String(n)];
    }
    case "relation":
      return [RELATION[p.relation ?? ""] ?? NONE];
    case "room_type": {
      const r = d.rooms.find((x) => x.id === p.room_id);
      return [!r ? "No bed" : r.gender === "female" ? "Women's" : r.gender === "male" ? "Men's" : "Family"];
    }
    case "room": {
      const r = d.rooms.find((x) => x.id === p.room_id);
      return [r ? (r.building ? `${r.building} · ${r.name}` : r.name) : "No bed"];
    }
    case "bus": {
      const b = d.buses.find((x) => x.id === p.bus_id);
      return [b ? b.name : p.needs_bus ? "No seat yet" : "Own transport"];
    }
    case "needs_bus":
      return [p.needs_bus ? "Yes" : "No"];
    case "arrived":
      return [p.arrived_at ? "Arrived" : "Not yet"];
    case "source":
      return [d.households.find((h) => h.id === p.household_id)?.source === "admin" ? "Admin" : "Online"];
    case "registered": {
      const t = new Date(p.created_at);
      t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); // Monday
      return [`w/c ${t.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}|${t.toISOString().slice(0, 10)}`];
    }
  }
  if (dim.startsWith("q:")) {
    const v = p.answers?.[dim.slice(2)];
    if (v === undefined || v === null || v === "") return ["No answer"];
    return [typeof v === "boolean" ? (v ? "Yes" : "No") : String(v).trim()];
  }
  return [NONE];
}

/** "w/c 3 Nov|2026-11-03" sorts by the date but shows the label. */
export const shown = (v: string) => v.split("|")[0];

export type InsightResult = {
  groups: string[]; // row labels, in order
  series: string[]; // split labels (["Total"] when not split)
  cell: (g: string, s: string) => number;
  rowTotal: (g: string) => number;
  total: number; // everyone matching the filters
  base: number; // everyone counted before filters (for "x of y")
};

const MAX_SERIES = 7;
const MAX_GROUPS = 30;

export function computeInsight(spec: InsightSpec, d: InsightData): InsightResult {
  const e = d.event;
  const isChild = (p: P) => {
    const a = p.age ?? e.age_groups.find((g) => g.name === p.age_group)?.upTo ?? null;
    return a !== null && a <= e.child_age;
  };
  const counted = d.people.filter((p) => {
    if (p.status !== "registered") return false;
    if (spec.measure === "children") return isChild(p);
    if (spec.measure === "adults") return !isChild(p);
    if (spec.measure === "bus") return p.needs_bus;
    if (spec.measure === "arrived") return !!p.arrived_at;
    return true;
  });
  const matching = counted.filter((p) => spec.filters.every((f) => valuesOf(f.dim, p, d).some((v) => f.values.includes(shown(v)) || f.values.includes(v))));

  // Families = distinct registrations; everything else = distinct people.
  const unit = (p: P) => (spec.measure === "families" ? p.household_id : p.id);
  const cells = new Map<string, Map<string, Set<string>>>();
  const rows = new Map<string, Set<string>>();
  const seriesTotals = new Map<string, Set<string>>();
  for (const p of matching) {
    const gs = spec.by ? valuesOf(spec.by, p, d) : ["All"];
    const ss = spec.split ? valuesOf(spec.split, p, d) : ["Total"];
    for (const g of gs) {
      if (!rows.has(g)) rows.set(g, new Set());
      rows.get(g)!.add(unit(p));
      for (const s of ss) {
        if (!cells.has(g)) cells.set(g, new Map());
        const m = cells.get(g)!;
        if (!m.has(s)) m.set(s, new Set());
        m.get(s)!.add(unit(p));
        if (!seriesTotals.has(s)) seriesTotals.set(s, new Set());
        seriesTotals.get(s)!.add(unit(p));
      }
    }
  }

  const dims = dimensions(d);
  const orderOf = (dim: string | null) => dims.find((x) => x.key === dim)?.order;
  const natural = (dim: string | null, keys: string[]) => {
    const order = orderOf(dim);
    if (dim === "registered") return [...keys].sort((a, b) => (a.split("|")[1] ?? a).localeCompare(b.split("|")[1] ?? b));
    if (!order) return [...keys].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return [...keys].sort((a, b) => (order.indexOf(a) === -1 ? 999 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 999 : order.indexOf(b)) || a.localeCompare(b));
  };

  let groups = spec.sort === "label" || ["day", "registered", "family_size"].includes(spec.by ?? "") ? natural(spec.by, [...rows.keys()]) : [...rows.keys()].sort((a, b) => rows.get(b)!.size - rows.get(a)!.size);
  let series = natural(spec.split, [...seriesTotals.keys()]);

  // Too many series: keep the biggest, fold the rest into "Other" (never invent more colours).
  let foldS = new Set<string>();
  if (series.length > MAX_SERIES) {
    const keep = new Set([...series].sort((a, b) => seriesTotals.get(b)!.size - seriesTotals.get(a)!.size).slice(0, MAX_SERIES - 1));
    foldS = new Set(series.filter((s) => !keep.has(s)));
    series = [...series.filter((s) => keep.has(s)), "Other"];
  }
  let foldG = new Set<string>();
  if (groups.length > MAX_GROUPS) {
    foldG = new Set(groups.slice(MAX_GROUPS - 1));
    groups = [...groups.slice(0, MAX_GROUPS - 1), "Other"];
  }

  const unionCell = (g: string, s: string) => {
    const gs = g === "Other" && foldG.size ? [...foldG] : [g];
    const ss = s === "Other" && foldS.size ? [...foldS] : [s];
    const ids = new Set<string>();
    for (const gg of gs) for (const sss of ss) for (const id of cells.get(gg)?.get(sss) ?? []) ids.add(id);
    return ids.size;
  };
  const unionRow = (g: string) => {
    const gs = g === "Other" && foldG.size ? [...foldG] : [g];
    const ids = new Set<string>();
    for (const gg of gs) for (const id of rows.get(gg) ?? []) ids.add(id);
    return ids.size;
  };
  return {
    groups,
    series,
    cell: unionCell,
    rowTotal: unionRow,
    total: new Set(matching.map(unit)).size,
    base: new Set(counted.map(unit)).size,
  };
}

/** A sensible default name: "Bus riders by Church, split by Age group". */
export function autoName(spec: InsightSpec, d: InsightData) {
  const dims = dimensions(d);
  const lab = (k: string | null) => dims.find((x) => x.key === k)?.label ?? "";
  let n = MEASURE_LABEL[spec.measure];
  if (spec.by) n += ` by ${lab(spec.by).toLowerCase()}`;
  if (spec.split) n += ` and ${lab(spec.split).toLowerCase()}`;
  if (spec.filters.length) n += ` (${spec.filters.map((f) => f.values.map(shown).join("/")).join(", ")})`;
  return n.slice(0, 80);
}
