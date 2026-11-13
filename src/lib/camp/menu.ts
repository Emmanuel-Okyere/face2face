import "server-only";
import type { Tx } from "@/lib/tenant";

export type MenuRow = { church: string | null; day: string; meal: string; dishes: string };

/** "Jollof rice, chicken\nSalad" → ["Jollof rice", "chicken", "Salad"] */
export const dishList = (s: string) =>
  s
    .split(/[\n,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);

/** All menu entries for an event (optionally some days). */
export async function loadMenu(sql: Tx, eventId: string, days?: string[]) {
  return (await sql`
    select church, day::text as day, meal, dishes from event_menu
    where event_id = ${eventId} ${days ? sql`and day = any(${days}::date[])` : sql``}
    order by day, meal`) as unknown as MenuRow[];
}

/** What a church eats at a meal: its own menu, else the all-churches one. */
export function pick(menu: MenuRow[], church: string | null, day: string, meal: string) {
  return (church ? menu.find((m) => m.church === church && m.day === day && m.meal === meal) : undefined) ?? menu.find((m) => m.church === null && m.day === day && m.meal === meal) ?? null;
}
