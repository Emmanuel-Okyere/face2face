// Automatic room/bed and bus/seat allocation for events. Pure functions (no DB),
// so they're easy to test and reason about.
//
// Rooms, in order of importance:
//   1. Men and women never share a room. "Family" rooms take whole households.
//   2. Children (≤ childAge) stay with a parent: the whole family in a family room
//      if one fits, otherwise with their mother (or father) in her room.
//   3. A room reserved for a church only takes that church.
//   4. People from the same church stay together, then the same age group.
//   5. Rooms fill up before new ones are opened, so buildings stay compact.
// Locked placements (and, in "fill" mode, every existing placement) never move.
//
// Buses: households sit together, churches ride together; a bus assigned to
// churches only takes those churches, an unassigned bus takes anyone.

export type Gender = "male" | "female";
export type AgeGroup = { name: string; upTo: number };

export type Camper = {
  id: string;
  household: string;
  church: string;
  gender: Gender;
  age: number | null;
  room: { id: string; bed: number } | null;
  roomLocked: boolean;
  needsBus: boolean;
  seat: { id: string; seat: number } | null;
  seatLocked: boolean;
};

export type Room = { id: string; building: string; name: string; gender: Gender | "family"; beds: number; church: string | null };
export type Bus = { id: string; name: string; seats: number; churches: string[] };

export type Mode = "fill" | "all";
export type Result<P> = { placed: Map<string, P | null>; unplaced: { id: string; reason: string }[] };

export function ageGroupIndex(age: number | null, groups: AgeGroup[]) {
  if (age === null) return groups.length; // unknown age: treat as adult, after every group
  const i = groups.findIndex((g) => age <= g.upTo);
  return i === -1 ? groups.length : i;
}

const isChild = (c: Camper, childAge: number) => c.age !== null && c.age <= childAge;

// ── Rooms ────────────────────────────────────────────────────────────────────

type Unit = { members: Camper[]; gender: Gender | "family"; church: string; group: number; household: string; prefer?: string };

export function allocateRooms(
  campers: Camper[],
  rooms: Room[],
  opts: { childAge: number; ageGroups: AgeGroup[]; mode: Mode },
): Result<{ id: string; bed: number }> {
  const placed = new Map<string, { id: string; bed: number } | null>();
  const unplaced: { id: string; reason: string }[] = [];
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  const taken = new Map<string, Set<number>>(rooms.map((r) => [r.id, new Set()]));
  const churchesIn = new Map<string, Map<string, number>>(rooms.map((r) => [r.id, new Map()]));
  const groupsIn = new Map<string, Map<number, number>>(rooms.map((r) => [r.id, new Map()]));
  const roomOf = new Map<string, string>(); // camper → room, for children joining a placed parent

  const occupy = (c: Camper, roomId: string, bed: number) => {
    taken.get(roomId)!.add(bed);
    const ch = churchesIn.get(roomId)!;
    ch.set(c.church, (ch.get(c.church) ?? 0) + 1);
    const g = groupsIn.get(roomId)!;
    const gi = ageGroupIndex(c.age, opts.ageGroups);
    g.set(gi, (g.get(gi) ?? 0) + 1);
    roomOf.set(c.id, roomId);
  };

  // 1. Who stays where they are.
  const todo: Camper[] = [];
  for (const c of campers) {
    const keep = c.room && roomById.has(c.room.id) && (c.roomLocked || opts.mode === "fill") && c.room.bed >= 1 && c.room.bed <= roomById.get(c.room.id)!.beds;
    if (keep && !taken.get(c.room!.id)!.has(c.room!.bed)) {
      occupy(c, c.room!.id, c.room!.bed);
      placed.set(c.id, c.room);
    } else todo.push(c);
  }

  // 2. Build units: whole families, a parent with young children, or one person.
  const byHousehold = new Map<string, Camper[]>();
  for (const c of todo) byHousehold.set(c.household, [...(byHousehold.get(c.household) ?? []), c]);
  const familyRoomBeds = rooms.filter((r) => r.gender === "family").map((r) => r.beds);
  const units: Unit[] = [];
  for (const [household, members] of byHousehold) {
    const church = members[0].church;
    const group = Math.max(...members.map((m) => ageGroupIndex(m.age, opts.ageGroups)));
    const kids = members.filter((m) => isChild(m, opts.childAge));
    const adults = members.filter((m) => !isChild(m, opts.childAge));
    if (kids.length && adults.length && members.length > 1 && familyRoomBeds.some((b) => b >= members.length)) {
      units.push({ members, gender: "family", church, group, household });
      continue;
    }
    if (kids.length) {
      const guardian = adults.find((a) => a.gender === "female") ?? adults[0];
      if (guardian) {
        units.push({ members: [guardian, ...kids], gender: guardian.gender, church, group, household });
        for (const a of adults) if (a !== guardian) units.push({ members: [a], gender: a.gender, church, group: ageGroupIndex(a.age, opts.ageGroups), household });
        continue;
      }
      // Children registered after their parent was placed: join the parent's room.
      const all = campers.filter((c) => c.household === household && !isChild(c, opts.childAge));
      const parent = all.find((a) => a.gender === "female" && roomOf.has(a.id)) ?? all.find((a) => roomOf.has(a.id));
      if (parent) {
        const r = roomById.get(roomOf.get(parent.id)!)!;
        units.push({ members: kids, gender: r.gender, church, group, household, prefer: r.id });
        continue;
      }
    }
    for (const m of members) units.push({ members: [m], gender: m.gender, church, group: ageGroupIndex(m.age, opts.ageGroups), household });
  }

  // Biggest constraints first: families, then by church / age group so neighbours land together.
  units.sort(
    (a, b) =>
      Number(b.gender === "family") - Number(a.gender === "family") ||
      b.members.length - a.members.length ||
      a.church.localeCompare(b.church) ||
      a.group - b.group ||
      a.household.localeCompare(b.household),
  );

  const free = (r: Room) => r.beds - taken.get(r.id)!.size;
  const fits = (u: Unit, r: Room) =>
    free(r) >= u.members.length &&
    (u.prefer ? r.id === u.prefer : r.gender === u.gender) &&
    (!r.church || r.church === u.church);

  const score = (u: Unit, r: Room) => {
    const ch = churchesIn.get(r.id)!;
    const occupied = taken.get(r.id)!.size;
    const same = ch.get(u.church) ?? 0;
    const others = occupied - same;
    let s = 0;
    if (r.church === u.church) s += 100;
    s += same * 10 - others * 15; // keep churches together, mix only when needed
    s += (groupsIn.get(r.id)!.get(u.group) ?? 0) * 4; // same age group
    if (occupied > 0) s += 5; // fill open rooms before starting new ones
    s -= free(r) * 0.1; // tightest fit
    return s;
  };

  const place = (u: Unit): boolean => {
    let best: Room | null = null;
    let bestScore = -Infinity;
    for (const r of rooms) {
      if (!fits(u, r)) continue;
      const s = score(u, r);
      if (s > bestScore) [best, bestScore] = [r, s];
    }
    if (!best) return false;
    const t = taken.get(best.id)!;
    let bed = 1;
    for (const m of u.members) {
      while (t.has(bed)) bed++;
      occupy(m, best.id, bed);
      placed.set(m.id, { id: best.id, bed });
    }
    return true;
  };

  const fail = (m: Camper, reason: string) => {
    placed.set(m.id, null);
    unplaced.push({ id: m.id, reason });
  };
  /** Place a unit; children are never split from their parent into a room on their own. */
  const placeOrReport = (u: Unit) => {
    if (place(u)) return;
    const kids = u.members.filter((m) => isChild(m, opts.childAge));
    if (kids.length && u.members.length > kids.length) {
      u.members.forEach((m) => fail(m, `No ${u.gender === "family" ? "family room" : `${u.gender} room`} with ${u.members.length} free beds for a parent and children together`));
      return;
    }
    for (const m of u.members) {
      if (!place({ ...u, members: [m], gender: m.gender, prefer: undefined })) fail(m, `No free ${m.gender} bed${rooms.some((r) => r.church) ? " for this church" : ""}`);
    }
  };

  for (const u of units) {
    if (u.gender === "family" && !place(u)) {
      // Family rooms full: mother (or father) with the children, everyone else on their own.
      const kids = u.members.filter((m) => isChild(m, opts.childAge));
      const adults = u.members.filter((m) => !isChild(m, opts.childAge));
      const guardian = adults.find((a) => a.gender === "female") ?? adults[0];
      placeOrReport({ ...u, members: [guardian, ...kids], gender: guardian.gender });
      for (const a of adults) if (a !== guardian) placeOrReport({ ...u, members: [a], gender: a.gender });
      continue;
    }
    if (u.gender !== "family") placeOrReport(u);
  }
  return { placed, unplaced };
}

// ── Buses ────────────────────────────────────────────────────────────────────

export function allocateSeats(campers: Camper[], buses: Bus[], opts: { mode: Mode }): Result<{ id: string; seat: number }> {
  const placed = new Map<string, { id: string; seat: number } | null>();
  const unplaced: { id: string; reason: string }[] = [];
  const busById = new Map(buses.map((b) => [b.id, b]));
  const taken = new Map<string, Set<number>>(buses.map((b) => [b.id, new Set()]));
  const churchesOn = new Map<string, Map<string, number>>(buses.map((b) => [b.id, new Map()]));
  const sit = (c: Camper, busId: string, seat: number) => {
    taken.get(busId)!.add(seat);
    const m = churchesOn.get(busId)!;
    m.set(c.church, (m.get(c.church) ?? 0) + 1);
  };

  const riders = campers.filter((c) => c.needsBus);
  // People who no longer need the bus lose their seat (unless locked).
  for (const c of campers) if (!c.needsBus && c.seat && !c.seatLocked) placed.set(c.id, null);

  const todo: Camper[] = [];
  for (const c of riders) {
    const bus = c.seat && busById.get(c.seat.id);
    const keep = bus && (c.seatLocked || opts.mode === "fill") && c.seat!.seat >= 1 && c.seat!.seat <= bus.seats;
    if (keep && !taken.get(bus.id)!.has(c.seat!.seat)) {
      sit(c, bus.id, c.seat!.seat);
      placed.set(c.id, c.seat);
    } else todo.push(c);
  }

  const households = new Map<string, Camper[]>();
  for (const c of todo) households.set(c.household, [...(households.get(c.household) ?? []), c]);
  // Churches with their own buses first (so open buses are left for everyone else), then biggest groups.
  const dedicated = (church: string) => buses.some((b) => b.churches.includes(church));
  const groups = [...households.values()].sort(
    (a, b) =>
      Number(dedicated(b[0].church)) - Number(dedicated(a[0].church)) ||
      a[0].church.localeCompare(b[0].church) ||
      b.length - a.length,
  );

  const free = (b: Bus) => b.seats - taken.get(b.id)!.size;
  const allowed = (b: Bus, church: string) => b.churches.length === 0 || b.churches.includes(church);
  const pick = (church: string, n: number) => {
    let best: Bus | null = null;
    let bestScore = -Infinity;
    for (const b of buses) {
      if (!allowed(b, church) || free(b) < n) continue;
      const on = churchesOn.get(b.id)!;
      const same = on.get(church) ?? 0;
      const others = taken.get(b.id)!.size - same;
      const s = (b.churches.includes(church) ? 100 : 0) + same * 2 - others * 3 + (taken.get(b.id)!.size ? 5 : 0);
      if (s > bestScore) [best, bestScore] = [b, s];
    }
    return best;
  };
  const seatIn = (c: Camper, b: Bus) => {
    const t = taken.get(b.id)!;
    let s = 1;
    while (t.has(s)) s++;
    sit(c, b.id, s);
    placed.set(c.id, { id: b.id, seat: s });
  };

  for (const g of groups) {
    const church = g[0].church;
    const together = pick(church, g.length);
    if (together) {
      g.forEach((c) => seatIn(c, together));
      continue;
    }
    for (const c of g) {
      const b = pick(church, 1);
      if (b) seatIn(c, b);
      else {
        placed.set(c.id, null);
        unplaced.push({ id: c.id, reason: buses.some((x) => allowed(x, church)) ? "Buses for this church are full" : "No bus for this church" });
      }
    }
  }
  return { placed, unplaced };
}
