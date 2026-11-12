// Possible duplicate people across registrations: the same person registered
// twice (e.g. by their spouse and again by themselves with another phone).
// Flagged for an admin to review, never blocked: two people can share a name.

type AgeGroup = { name: string; upTo: number };
export type DupPerson = { id: string; household_id: string; full_name: string; age: number | null; age_group: string | null; status: string };

/** "Kwame  Mensah", "mensah kwame", "Kwame Mensah." → "kwame mensah" */
export function nameKey(name: string) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

function groupOf(p: DupPerson, groups: AgeGroup[]) {
  if (p.age_group) return p.age_group;
  if (p.age === null) return null;
  return groups.find((g) => p.age! <= g.upTo)?.name ?? null;
}

/** Ages that could be the same person: within 2 years, or the same range; unknown matches anything. */
function sameAge(a: DupPerson, b: DupPerson, groups: AgeGroup[]) {
  if (a.age !== null && b.age !== null) return Math.abs(a.age - b.age) <= 2;
  const ga = groupOf(a, groups);
  const gb = groupOf(b, groups);
  return !ga || !gb || ga === gb;
}

export const pairKey = (a: string, b: string) => [a, b].sort().join("|");

export function possibleDuplicates<P extends DupPerson>(people: P[], ageGroups: AgeGroup[], ignored: string[] = []): [P, P][] {
  const skip = new Set(ignored);
  const byName = new Map<string, P[]>();
  for (const p of people) {
    if (p.status !== "registered") continue;
    const k = nameKey(p.full_name);
    if (!k) continue;
    byName.set(k, [...(byName.get(k) ?? []), p]);
  }
  const out: [P, P][] = [];
  for (const group of byName.values()) {
    for (let i = 0; i < group.length; i++)
      for (let j = i + 1; j < group.length; j++) {
        const [a, b] = [group[i], group[j]];
        if (a.household_id === b.household_id) continue; // same registration: deliberate (e.g. twins)
        if (skip.has(pairKey(a.id, b.id))) continue;
        if (sameAge(a, b, ageGroups)) out.push([a, b]);
      }
  }
  return out;
}
