"use client";

import { useMemo, useState } from "react";
import { api, Button, Card, cx, Empty, Field, Group, Input, Pill } from "@/components/ui";
import { roomLabel } from "@/lib/camp/format";
import { ageGroupName } from "./RegistrationForm";
import type { Person, Room, TabProps } from "./types";
import { ask, toast, toastError } from "@/components/feedback";

const GENDER: Record<Room["gender"], { label: string; tone: "info" | "accent" | "good" }> = {
  male: { label: "Men", tone: "info" },
  female: { label: "Women", tone: "accent" },
  family: { label: "Family", tone: "good" },
};

export default function Rooms({ d, reload }: TabProps) {
  const [adding, setAdding] = useState(d.rooms.length === 0);
  const [busy, setBusy] = useState<"" | "fill" | "all">("");
  const [result, setResult] = useState<{ changed: number; unplaced: { id: string; reason: string }[] } | null>(null);
  const [editRoom, setEditRoom] = useState<string | null>(null);
  const churchOf = useMemo(() => new Map(d.households.map((h) => [h.id, h.church])), [d.households]);
  const live = d.people.filter((p) => p.status === "registered");
  const inRoom = new Map<string, Person[]>();
  for (const p of live) if (p.room_id) inRoom.set(p.room_id, [...(inRoom.get(p.room_id) ?? []), p].sort((a, b) => (a.bed ?? 0) - (b.bed ?? 0)));
  const unplaced = live.filter((p) => !p.room_id);
  const buildings = [...new Set(d.rooms.map((r) => r.building))];
  const beds = d.rooms.reduce((n, r) => n + r.beds, 0);
  const free = (r: Room) => r.beds - (inRoom.get(r.id)?.length ?? 0);

  const run = async (mode: "fill" | "all") => {
    if (mode === "all" && !(await ask({ title: "Re-plan every bed?", body: "People you moved by hand (locked 🔒) stay put; everyone else may move to a different bed.", confirm: "Re-plan" }))) return;
    setBusy(mode);
    try {
      setResult(await api(`/api/admin/events/${d.event.id}/allocate`, { method: "POST", json: { what: "rooms", mode } }));
      await reload();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy("");
    }
  };
  const move = async (p: Person, roomId: string | null) => {
    try {
      await api(`/api/admin/events/${d.event.id}/registrants?rid=${p.id}`, { method: "PATCH", json: { room: roomId ? { id: roomId } : null } });
      await reload();
    } catch (e) {
      toastError(e);
    }
  };
  const lock = async (p: Person) => {
    await api(`/api/admin/events/${d.event.id}/registrants?rid=${p.id}`, { method: "PATCH", json: { room_locked: !p.room_locked } });
    await reload();
  };
  const nameOf = (id: string) => d.people.find((p) => p.id === id)?.full_name ?? "Someone";

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-4">
        <div className="min-w-0 flex-1">
          <div className="font-medium">
            {live.length - unplaced.length} of {live.length} people have a bed
          </div>
          <div className="text-xs text-muted">
            {d.rooms.length} rooms · {beds} beds{beds < live.length ? ` · ${live.length - beds} short` : ""}. Families with children ({d.event.child_age} and under) stay
            together; men and women apart; churches together.
          </div>
        </div>
        <Button onClick={() => run("fill")} loading={busy === "fill"} disabled={!d.rooms.length || !!busy}>
          Assign beds
        </Button>
        <Button variant="ghost" onClick={() => run("all")} loading={busy === "all"} disabled={!d.rooms.length || !!busy}>
          Re-plan all
        </Button>
        {!adding && (
          <Button variant="ghost" onClick={() => setAdding(true)}>
            + Rooms
          </Button>
        )}
      </Card>

      {result && (
        <Card className={cx("text-sm", result.unplaced.length ? "border-warn/50" : "border-good/40")}>
          <div className="flex items-start justify-between gap-3">
            <div>
              {result.changed ? `✓ ${result.changed} ${result.changed === 1 ? "person" : "people"} placed or moved.` : "Nothing to change."}{" "}
              {result.unplaced.length > 0 && `${result.unplaced.length} still without a bed:`}
              {result.unplaced.length > 0 && (
                <ul className="mt-1 text-xs text-muted">
                  {result.unplaced.slice(0, 8).map((u) => (
                    <li key={u.id}>
                      {nameOf(u.id)}: {u.reason}
                    </li>
                  ))}
                  {result.unplaced.length > 8 && <li>…and {result.unplaced.length - 8} more</li>}
                </ul>
              )}
            </div>
            <button onClick={() => setResult(null)} className="text-muted hover:text-ink" aria-label="Dismiss">
              ×
            </button>
          </div>
        </Card>
      )}

      {adding && <AddRooms d={d} onDone={async () => (setAdding(false), await reload())} onCancel={d.rooms.length ? () => setAdding(false) : undefined} />}

      {d.rooms.length === 0 && !adding && <Empty title="No rooms yet">Add buildings and rooms, then assign beds in one click.</Empty>}

      {buildings.map((b) => (
        <section key={b} className="space-y-2">
          <h3 className="text-sm font-medium text-muted">{b || "Rooms"}</h3>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {d.rooms
              .filter((r) => r.building === b)
              .map((r) => {
                const occ = inRoom.get(r.id) ?? [];
                return editRoom === r.id ? (
                  <EditRoom key={r.id} d={d} room={r} onDone={async () => (setEditRoom(null), await reload())} onCancel={() => setEditRoom(null)} />
                ) : (
                  <Card key={r.id} className="space-y-3 p-4">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{r.name}</span>
                      <Pill>{GENDER[r.gender].label}</Pill>
                      {r.church && <Pill>{r.church}</Pill>}
                      <button onClick={() => setEditRoom(r.id)} className="ml-auto text-xs text-muted hover:text-ink">
                        Edit
                      </button>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                        <div className={cx("h-full rounded-full", occ.length >= r.beds ? "bg-ink" : "bg-good")} style={{ width: `${Math.min(100, (occ.length / r.beds) * 100)}%` }} />
                      </div>
                      {occ.length}/{r.beds}
                    </div>
                    {occ.length > 0 && (
                      <ul className="space-y-1 text-sm">
                        {occ.map((p) => (
                          <li key={p.id} className="group flex items-center gap-2">
                            <span className="w-5 text-right text-xs tabular-nums text-muted">{p.bed}</span>
                            <span className="min-w-0 flex-1 truncate">
                              {p.full_name}
                              <span className="ml-1.5 text-xs text-muted">
                                {churchOf.get(p.household_id)}
                                {` · ${p.age ?? p.age_group ?? "?"}`}
                              </span>
                            </span>
                            <button onClick={() => lock(p)} className={cx("text-xs", p.room_locked ? "" : "opacity-0 group-hover:opacity-60")} title={p.room_locked ? "Locked: automatic allocation won't move them" : "Lock in this bed"}>
                              {p.room_locked ? "🔒" : "🔓"}
                            </button>
                            <MoveSelect d={d} person={p} free={free} onMove={move} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                );
              })}
          </div>
        </section>
      ))}

      {unplaced.length > 0 && d.rooms.length > 0 && (
        <Card>
          <h3 className="mb-2 text-sm font-medium">Without a bed · {unplaced.length}</h3>
          <ul className="grid gap-1 text-sm sm:grid-cols-2">
            {unplaced.map((p) => (
              <li key={p.id} className="flex items-center gap-2">
                <span className={cx("size-2 shrink-0 rounded-full", p.gender === "female" ? "bg-[#d97ab0]" : "bg-[#5b8fd9]")} />
                <span className="min-w-0 flex-1 truncate">
                  {p.full_name}
                  <span className="ml-1.5 text-xs text-muted">
                    {churchOf.get(p.household_id)} · {p.age_group ?? ageGroupName(p.age, d.event.age_groups) ?? "?"}
                  </span>
                </span>
                <MoveSelect d={d} person={p} free={free} onMove={move} placeholder="Place in…" />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function MoveSelect({ d, person, free, onMove, placeholder = "Move" }: { d: TabProps["d"]; person: Person; free: (r: Room) => number; onMove: (p: Person, id: string | null) => void; placeholder?: string }) {
  const options = d.rooms.filter((r) => r.id !== person.room_id && (r.gender === "family" || r.gender === person.gender) && free(r) > 0);
  return (
    <select
      value=""
      onChange={(e) => e.target.value && onMove(person, e.target.value === "-" ? null : e.target.value)}
      className={cx("max-w-28 rounded-lg border border-line bg-surface px-1.5 py-0.5 text-xs text-muted", person.room_id && "sm:opacity-0 sm:focus:opacity-100 sm:group-hover:opacity-100")}
      aria-label={`Move ${person.full_name}`}
    >
      <option value="">{placeholder}</option>
      {person.room_id && <option value="-">Remove from room</option>}
      {options.map((r) => (
        <option key={r.id} value={r.id}>
          {roomLabel(r)} ({free(r)} free)
        </option>
      ))}
    </select>
  );
}

function RoomFields({ d, f, setF }: { d: TabProps["d"]; f: { building: string; beds: string; gender: Room["gender"]; church: string }; setF: (p: Partial<typeof f>) => void }) {
  return (
    <>
      <Field label="Building">
        <Input value={f.building} onChange={(e) => setF({ building: e.target.value })} placeholder="Block A" />
      </Field>
      <Field label="Beds per room">
        <Input type="number" min={1} max={200} required value={f.beds} onChange={(e) => setF({ beds: e.target.value })} />
      </Field>
      <Group label="For">
        <div className="flex w-fit rounded-xl border border-line bg-surface p-1 text-sm">
          {(["female", "male", "family"] as const).map((g) => (
            <button key={g} type="button" onClick={() => setF({ gender: g })} className={cx("rounded-lg px-3 py-1", f.gender === g ? "bg-ink text-white" : "text-muted hover:text-ink")}>
              {GENDER[g].label}
            </button>
          ))}
        </div>
      </Group>
      <Field label="Only for church (optional)">
        <select value={f.church} onChange={(e) => setF({ church: e.target.value })} className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm">
          <option value="">Any church</option>
          {d.event.churches.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </Field>
    </>
  );
}

function AddRooms({ d, onDone, onCancel }: { d: TabProps["d"]; onDone: () => Promise<void>; onCancel?: () => void }) {
  const [f, setFState] = useState({ building: "", names: "1-10", beds: "6", gender: "female" as Room["gender"], church: "" });
  const setF = (p: Partial<typeof f>) => setFState({ ...f, ...p });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await api(`/api/admin/events/${d.event.id}/rooms`, { method: "POST", json: { ...f, beds: Number(f.beds), church: f.church || null } });
      await onDone();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Card className="ring-2 ring-ink/10">
      <form onSubmit={save} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <RoomFields d={d} f={f} setF={setF} />
        <Field label="Rooms" hint="1-10, or A, B, C">
          <Input required value={f.names} onChange={(e) => setF({ names: e.target.value })} />
        </Field>
        {err && <p className="text-sm text-danger lg:col-span-5">{err}</p>}
        <div className="flex justify-end gap-2 sm:col-span-2 lg:col-span-5">
          {onCancel && (
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button type="submit" loading={busy}>
            Add rooms
          </Button>
        </div>
      </form>
    </Card>
  );
}

function EditRoom({ d, room, onDone, onCancel }: { d: TabProps["d"]; room: Room; onDone: () => Promise<void>; onCancel: () => void }) {
  const [f, setFState] = useState({ name: room.name, building: room.building, beds: String(room.beds), gender: room.gender, church: room.church ?? "" });
  const setF = (p: Partial<typeof f>) => setFState({ ...f, ...p });
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{ moved: number }>(`/api/admin/events/${d.event.id}/rooms?rid=${room.id}`, { method: "PUT", json: { ...f, beds: Number(f.beds), church: f.church || null } });
      if (r.moved) toast(`${r.moved} ${r.moved === 1 ? "person no longer fits and was" : "people no longer fit and were"} taken out of this room`, "info");
      else toast("Room saved");
      await onDone();
    } catch (e) {
      toastError(e);
      setBusy(false);
    }
  };
  return (
    <Card className="p-4 ring-2 ring-ink/10">
      <form onSubmit={save} className="grid gap-3">
        <Field label="Room">
          <Input required value={f.name} onChange={(e) => setF({ name: e.target.value })} />
        </Field>
        <RoomFields d={d} f={f} setF={setF} />
        <div className="flex gap-2">
          <Button
            type="button"
            variant="subtle"
            className="mr-auto text-danger"
            onClick={async () => {
              if (!(await ask({ title: `Delete ${roomLabel(room)}?`, body: "Anyone in it loses their bed.", confirm: "Delete", danger: true }))) return;
              await api(`/api/admin/events/${d.event.id}/rooms?rid=${room.id}`, { method: "DELETE" });
              toast(`${roomLabel(room)} deleted`);
              await onDone();
            }}
          >
            Delete
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            Save
          </Button>
        </div>
      </form>
    </Card>
  );
}
