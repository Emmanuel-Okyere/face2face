// Small display helpers shared by the public pages and the admin screens.

const d = (s: string) => new Date(`${s}T12:00:00Z`);
const part = (s: string, o: Intl.DateTimeFormatOptions) => d(s).toLocaleDateString("en-GB", { ...o, timeZone: "UTC" });
const wd = (s: string) => part(s, { weekday: "short" });
const dm = (s: string) => `${d(s).getUTCDate()} ${part(s, { month: "short" })}`;
const yr = (s: string) => s.slice(0, 4);

/** "Sun 20 – Sun 27 Dec 2026", "Fri 30 Dec 2026 – Mon 2 Jan 2027", "Sun 9 Aug 2026", or "" */
export function dateRange(start: string | null, end: string | null) {
  if (!start) return "";
  if (!end || end === start) return `${wd(start)} ${dm(start)} ${yr(start)}`;
  const left = start.slice(0, 7) === end.slice(0, 7) ? `${wd(start)} ${d(start).getUTCDate()}` : yr(start) === yr(end) ? `${wd(start)} ${dm(start)}` : `${wd(start)} ${dm(start)} ${yr(start)}`;
  return `${left} – ${wd(end)} ${dm(end)} ${yr(end)}`;
}

/** Whole days from today until `start` (negative once it has begun). */
export function daysUntil(start: string | null) {
  if (!start) return null;
  const today = new Date();
  const t = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((d(start).getTime() - 12 * 3600_000 - t) / 86_400_000);
}

export function countdown(start: string | null, end: string | null) {
  const n = daysUntil(start);
  if (n === null) return null;
  if (n > 1) return `${n} days to go`;
  if (n === 1) return "Starts tomorrow";
  if (n === 0) return "Starts today";
  const over = end ? daysUntil(end)! < 0 : n < 0;
  return over ? null : "Happening now";
}

export const roomLabel = (r: { building?: string | null; name: string }) => (r.building ? `${r.building} · ${r.name}` : r.name);

/** Every day from start to end (YYYY-MM-DD), max 31; [] without a start date. Mirrors the server. */
export function eventDays(start: string | null, end: string | null) {
  if (!start) return [];
  const out: string[] = [];
  const t = new Date(`${start}T12:00:00Z`);
  while (out.length < 31) {
    const s = t.toISOString().slice(0, 10);
    if (s > (end ?? start)) break;
    out.push(s);
    t.setUTCDate(t.getUTCDate() + 1);
  }
  return out;
}

/** "Tue–Thu", "Tue, Thu", or "" for every day. */
export function daysLabel(days: string[] | null, all: string[]) {
  if (!days || !all.length || days.length === all.length) return "";
  const wd = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
  const idx = days.map((d) => all.indexOf(d)).sort((a, b) => a - b);
  const consecutive = idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
  return consecutive && days.length > 2 ? `${wd(all[idx[0]])}–${wd(all[idx[idx.length - 1]])}` : idx.map((i) => wd(all[i])).join(", ");
}

/** "Church" → "Churches", "Zone" → "Zones", "Ministry" → "Ministries". */
export function plural(w: string) {
  if (/(s|x|z|ch|sh)$/i.test(w)) return `${w}es`;
  if (/[^aeiou]y$/i.test(w)) return `${w.slice(0, -1)}ies`;
  return `${w}s`;
}
