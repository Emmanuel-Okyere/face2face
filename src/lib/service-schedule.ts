// Service schedules — pure functions shared by the server and the admin UI.
// All times are local to the organization's time zone.

export type ServiceKind = "weekly" | "once" | "daily";

export type Service = {
  id: string;
  name: string;
  kind: ServiceKind;
  weekdays: number[] | null; // 0 = Sunday … 6 = Saturday
  on_date: string | null; // YYYY-MM-DD
  start_time: string; // HH:MM[:SS]
  end_time: string;
  opens_before: number; // minutes
  closes_after: number; // minutes
  late_after: number | null; // minutes after start
  audience: string[] | null; // expected groups; null/empty = everyone
  active: boolean;
};

export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const DAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
export const fmtMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** Local date, weekday and minute-of-day in a time zone. */
export function localNow(timeZone: string, at = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return { date, dow: weekday(date), min: Number(parts.hour) * 60 + Number(parts.minute) };
}

export function weekday(date: string) {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}
export function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function occursOn(s: Service, date: string) {
  if (!s.active) return false;
  if (s.kind === "daily") return true;
  if (s.kind === "once") return s.on_date === date;
  return (s.weekdays ?? []).includes(weekday(date));
}

/** Check-in window in minutes of the day, clamped to the same day. */
export function windowOf(s: Service) {
  return {
    opens: Math.max(0, toMin(s.start_time) - s.opens_before),
    closes: Math.min(24 * 60 - 1, toMin(s.end_time) + s.closes_after),
  };
}

export function isOpen(s: Service, date: string, min: number) {
  if (!occursOn(s, date)) return false;
  const w = windowOf(s);
  return min >= w.opens && min <= w.closes;
}

export function isLate(s: Service, min: number) {
  return s.late_after !== null && min > toMin(s.start_time) + s.late_after;
}

export function expects(s: Service, group: string | null) {
  return !s.audience?.length || (!!group && s.audience.includes(group));
}

/** 2 = specifically for the person's group · 1 = for everyone · 0 = for other groups. */
function fit(s: Service, group: string | null) {
  if (!s.audience?.length) return 1;
  return group && s.audience.includes(group) ? 2 : 0;
}

/**
 * Which open service a person checks in to: one meant for their group first,
 * then one for everyone, then a specific service over "every day", then the
 * one that started first.
 */
export function pickService(open: Service[], group: string | null): Service | null {
  if (!open.length) return null;
  return [...open].sort(
    (a, b) =>
      fit(b, group) - fit(a, group) ||
      Number(a.kind === "daily") - Number(b.kind === "daily") ||
      toMin(a.start_time) - toMin(b.start_time),
  )[0];
}

/** The next time any service opens, within the coming week. */
export function nextOpening(services: Service[], now: { date: string; min: number }) {
  let best: { service: Service; date: string; opens: number } | null = null;
  for (let d = 0; d <= 7 && !best; d++) {
    const date = addDays(now.date, d);
    for (const s of services) {
      if (!occursOn(s, date)) continue;
      const { opens } = windowOf(s);
      if (d === 0 && opens <= now.min) continue;
      if (!best || opens < best.opens) best = { service: s, date, opens };
    }
  }
  return best;
}

/** "Sundays · 08:00–12:00", "Every day", "Fri 20 Dec · 18:00–21:00" */
export function describeSchedule(s: Pick<Service, "kind" | "weekdays" | "on_date" | "start_time" | "end_time">) {
  const time = `${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}`;
  if (s.kind === "daily") return s.start_time.startsWith("00:00") && s.end_time.startsWith("23:59") ? "Every day" : `Every day · ${time}`;
  if (s.kind === "once") {
    const d = s.on_date ? new Date(`${s.on_date}T12:00:00Z`).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "";
    return `${d} · ${time}`;
  }
  const days = [...(s.weekdays ?? [])].sort();
  const label =
    days.length === 7
      ? "Every day"
      : days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))
        ? "Weekdays"
        : days.length === 1
          ? `${DAY_LONG[days[0]]}s`
          : days.map((d) => DAY_SHORT[d]).join(", ");
  return `${label} · ${time}`;
}

export function fmtNext(n: { service: Service; date: string; opens: number }, today: string) {
  const when =
    n.date === today
      ? "today"
      : n.date === addDays(today, 1)
        ? "tomorrow"
        : DAY_LONG[weekday(n.date)];
  return `${n.service.name} · ${when} ${n.service.start_time.slice(0, 5)}`;
}
