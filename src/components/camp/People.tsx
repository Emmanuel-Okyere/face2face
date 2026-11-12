"use client";

import { useMemo, useState } from "react";
import { PhoneDisplay } from "@/components/PhoneInput";
import { api, Button, Card, cx, Empty, Input, MoreMenu, Pill } from "@/components/ui";
import { pairKey, possibleDuplicates } from "@/lib/camp/duplicates";
import { daysLabel, eventDays, plural, roomLabel } from "@/lib/camp/format";
import RegistrationForm, { ageGroupName, blankRegistration, checkRegistration, effectiveForm, toPayload, type RegistrationDraft } from "./RegistrationForm";
import type { Household, Person, TabProps } from "./types";
import { ask, toast, toastError } from "@/components/feedback";

export default function People({ d, reload }: TabProps) {
  const [q, setQ] = useState("");
  const [church, setChurch] = useState("");
  const [show, setShow] = useState<"registered" | "cancelled" | "all">("registered");
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const rooms = useMemo(() => new Map(d.rooms.map((r) => [r.id, r])), [d.rooms]);
  const buses = useMemo(() => new Map(d.buses.map((b) => [b.id, b])), [d.buses]);
  const churches = useMemo(() => [...new Set([...d.event.churches, ...d.households.map((h) => h.church)])].sort(), [d]);
  const form = effectiveForm(d.event.form, d.event.rooms_enabled);
  const allDays = form.days ? eventDays(d.event.starts_on, d.event.ends_on) : [];
  // Room / bus columns appear once allocation has started (before that, every row would just say "no bed yet").
  const showRooms = d.event.rooms_enabled && d.people.some((p) => p.room_id);
  const showBuses = d.event.buses_enabled && d.people.some((p) => p.bus_id);
  // Arrival marking only matters once the event is under way.
  const started = !d.event.starts_on || new Date().toISOString().slice(0, 10) >= d.event.starts_on;
  const eventInfo = {
    churches: d.event.churches,
    child_age: d.event.child_age,
    age_groups: d.event.age_groups,
    questions: d.event.questions,
    unit_label: d.event.unit_label,
    days: allDays,
    form,
    buses: d.event.buses_enabled,
  };

  const byHousehold = useMemo(() => {
    const m = new Map<string, Person[]>();
    for (const p of d.people) m.set(p.household_id, [...(m.get(p.household_id) ?? []), p]);
    return m;
  }, [d.people]);

  const needle = q.trim().toLowerCase();
  const list = d.households
    .filter((h) => !church || h.church === church)
    .map((h) => ({ h, members: (byHousehold.get(h.id) ?? []).filter((p) => show === "all" || p.status === show) }))
    .filter(({ h, members }) => members.length && (!needle || h.code.toLowerCase().includes(needle) || h.contact_name.toLowerCase().includes(needle) || (h.contact_phone ?? "").includes(needle.replace(/^0/, "")) || members.some((m) => m.full_name.toLowerCase().includes(needle) || m.code.toLowerCase().includes(needle))))
    .reverse(); // newest first

  // Headline breakdown: by church, gender and age group.
  const live = d.people.filter((p) => p.status === "registered");
  const churchOf = new Map(d.households.map((h) => [h.id, h.church]));
  const count = (f: (p: Person) => string | null) => {
    const m = new Map<string, number>();
    for (const p of live) {
      const k = f(p);
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };

  /** Jump to a registration (e.g. the one that already has a phone number) and open it for editing. */
  const openRegistration = (hid: string) => {
    setQ("");
    setChurch("");
    setShow("registered");
    setEditing(hid);
    setTimeout(() => document.getElementById(`reg-${hid}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  const patch = async (p: Person, json: Record<string, unknown>) => {
    try {
      await api(`/api/admin/events/${d.event.id}/registrants?rid=${p.id}`, { method: "PATCH", json });
      await reload();
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <div className="space-y-4">
      {live.length > 0 && (
        <Card className="flex flex-wrap gap-x-6 gap-y-3 text-xs">
          <Breakdown title={plural(d.event.unit_label)} rows={count((p) => churchOf.get(p.household_id) ?? null)} onPick={setChurch} active={church} />
          {form.gender && <Breakdown title="Gender" rows={count((p) => (p.gender === "female" ? "Female" : p.gender === "male" ? "Male" : null))} />}
          <Breakdown title="Age groups" rows={count((p) => p.age_group ?? ageGroupName(p.age, d.event.age_groups) ?? "Age not given")} />
          {allDays.length > 1 && <Breakdown title="Per day" rows={allDays.map((day) => [daysLabel([day], allDays) + " " + Number(day.slice(8)), live.filter((p) => !p.days || p.days.includes(day)).length] as [string, number])} />}
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone or code" className="w-64" />
        <select value={church} onChange={(e) => setChurch(e.target.value)} className="rounded-xl border border-line bg-surface px-3 py-2 text-sm">
          <option value="">All {plural(d.event.unit_label).toLowerCase()}</option>
          {churches.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <select value={show} onChange={(e) => setShow(e.target.value as typeof show)} className="rounded-xl border border-line bg-surface px-3 py-2 text-sm">
          <option value="registered">Registered</option>
          <option value="cancelled">Cancelled</option>
          <option value="all">Everyone</option>
        </select>
        <div className="ml-auto flex gap-2">
          <a href={`/api/admin/events/${d.event.id}/export`} className="rounded-full border border-line bg-surface px-4 py-2 text-sm hover:bg-surface-2">
            Export CSV
          </a>
          {editing !== "new" && <Button onClick={() => setEditing("new")}>+ Register</Button>}
        </div>
      </div>

      <Duplicates d={d} reload={reload} onOpen={openRegistration} />

      {editing === "new" && <Editor d={d} eventInfo={eventInfo} onDone={async () => (setEditing(null), await reload())} onCancel={() => setEditing(null)} onOpen={openRegistration} />}

      {list.length === 0 && editing !== "new" ? (
        <Empty title={d.households.length ? "No one matches" : "No registrations yet"}>
          {d.households.length ? "Try another search." : "Share the registration link, or register people here."}
        </Empty>
      ) : (
        <div className="space-y-3">
          {list.map(({ h, members }) =>
            editing === h.id ? (
              <div key={h.id} id={`reg-${h.id}`} className="scroll-mt-24">
              <Editor d={d} eventInfo={eventInfo} household={h} members={byHousehold.get(h.id) ?? []} onDone={async () => (setEditing(null), await reload())} onCancel={() => setEditing(null)} onOpen={openRegistration} />
              </div>
            ) : (
              <Card key={h.id} className="scroll-mt-24 p-0">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-4 py-3">
                  <div className="min-w-0">
                    <div className="font-medium">{h.contact_name}</div>
                    <div className="flex flex-wrap gap-x-3 text-xs text-muted">
                      <span>{h.church}</span>
                      {h.contact_phone && <PhoneDisplay value={h.contact_phone} compact />}
                    </div>
                  </div>
                  <div className="ml-auto flex items-center">
                    <button onClick={() => setEditing(h.id)} className="rounded-lg px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-ink">
                      Edit
                    </button>
                    <MoreMenu
                      items={[
                        { label: "Open pass", onClick: () => window.open(`/pass/${h.pass_token}`, "_blank", "noopener") },
                        {
                          label: "Delete",
                          danger: true,
                          onClick: async () => {
                            const n = (byHousehold.get(h.id) ?? []).length;
                            const ok = await ask({
                              title: `Delete ${h.contact_name}'s registration?`,
                              body: `${n === 1 ? "1 person" : `${n} people`} — their beds and seats are freed. This can't be undone; use Cancel on a person to keep a record instead.`,
                              confirm: "Delete",
                              danger: true,
                            });
                            if (!ok) return;
                            await api(`/api/admin/events/${d.event.id}/households?hid=${h.id}`, { method: "DELETE" });
                            toast("Registration deleted");
                            await reload();
                          },
                        },
                      ]}
                    />
                  </div>
                </div>
                <ul className="divide-y divide-line/70">
                  {members.map((p) => {
                    const room = p.room_id ? rooms.get(p.room_id) : null;
                    const bus = p.bus_id ? buses.get(p.bus_id) : null;
                    const group = p.age_group ?? ageGroupName(p.age, d.event.age_groups);
                    const when = daysLabel(p.days, allDays);
                    return (
                      <li key={p.id} className={cx("group flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm", p.status === "cancelled" && "opacity-50")}>
                        <span className={cx("size-2 shrink-0 rounded-full", p.gender === "female" ? "bg-[#d97ab0]" : p.gender === "male" ? "bg-[#5b8fd9]" : "bg-line")} title={p.gender ?? undefined} />
                        <div className="min-w-40 flex-1">
                          <span className={cx(p.status === "cancelled" && "line-through")}>{p.full_name}</span>
                          <span className="ml-2 text-xs text-muted">
                            {p.age !== null ? `${p.age} · ` : ""}
                            {group ?? ""}
                            {when ? ` · ${when} only` : ""}
                          </span>
                        </div>
                        {showRooms && <span className="w-44 truncate text-xs">{room ? `${roomLabel(room)} · bed ${p.bed}` : <span className="text-muted">No bed yet</span>}</span>}
                        {showBuses && <span className="w-32 truncate text-xs">{bus ? `${bus.name} · seat ${p.seat}` : <span className="text-muted">{p.needs_bus ? "No seat yet" : "Own transport"}</span>}</span>}
                        <div className="ml-auto flex items-center gap-1">
                          {p.status === "registered" && (started || p.arrived_at) && (
                            <button
                              onClick={() => patch(p, { arrived: !p.arrived_at })}
                              className={cx("rounded-lg px-2 py-1 text-xs", p.arrived_at ? "font-medium text-[#2e7d4f] hover:bg-surface-2" : "text-muted hover:bg-surface-2 hover:text-ink")}
                              title="Mark arrival at camp"
                            >
                              {p.arrived_at ? "Arrived ✓" : "Arrived?"}
                            </button>
                          )}
                          <button
                            onClick={() => patch(p, { status: p.status === "registered" ? "cancelled" : "registered" })}
                            className={cx(
                              "rounded-lg px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-ink",
                              p.status === "registered" && "sm:opacity-0 sm:focus:opacity-100 sm:group-hover:opacity-100",
                            )}
                          >
                            {p.status === "registered" ? "Cancel" : "Restore"}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            ),
          )}
        </div>
      )}
    </div>
  );
}

function Breakdown({ title, rows, onPick, active }: { title: string; rows: [string, number][]; onPick?: (k: string) => void; active?: string }) {
  return (
    <div className="min-w-40">
      <div className="mb-1.5 text-muted">{title}</div>
      <div className="flex flex-wrap gap-1.5">
        {rows.slice(0, 12).map(([k, n]) =>
          onPick ? (
            <button key={k} onClick={() => onPick(active === k ? "" : k)} className={cx("rounded-full px-2.5 py-0.5", active === k ? "bg-ink text-white" : "bg-surface-2 hover:bg-line")}>
              {k} <b className="tabular-nums">{n}</b>
            </button>
          ) : (
            <Pill key={k}>
              {k} <b className="tabular-nums">{n}</b>
            </Pill>
          ),
        )}
      </div>
    </div>
  );
}

function Editor({
  d,
  eventInfo,
  household,
  members,
  onDone,
  onCancel,
  onOpen,
}: {
  d: TabProps["d"];
  eventInfo: Parameters<typeof RegistrationForm>[0]["event"];
  household?: Household;
  members?: Person[];
  onDone: () => Promise<void>;
  onCancel: () => void;
  onOpen: (householdId: string) => void;
}) {
  const [f, setF] = useState<RegistrationDraft>(() =>
    household
      ? {
          church: household.church,
          contact_name: household.contact_name,
          contact_phone: household.contact_phone ?? "",
          contact_email: household.contact_email ?? "",
          days: null,
          members: (members ?? []).map((m) => ({
            id: m.id,
            full_name: m.full_name,
            gender: m.gender ?? "",
            age: m.age === null ? "" : String(m.age),
            age_group: m.age_group ?? "",
            days: m.days,
            relation: m.relation ?? "relative",
            phone: m.phone ?? "",
            needs_bus: m.needs_bus,
            answers: m.answers ?? {},
          })),
        }
      : blankRegistration(),
  );
  const [notify, setNotify] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [existing, setExisting] = useState<string | null>(null);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = checkRegistration(f, eventInfo.days, eventInfo.form);
    if (problem) return setErr(problem);
    setBusy(true);
    setErr("");
    try {
      const url = `/api/admin/events/${d.event.id}/households${household ? `?hid=${household.id}` : ""}`;
      await api(url, { method: household ? "PUT" : "POST", json: { ...toPayload(f, eventInfo.days, eventInfo.form, eventInfo.buses), ...(household ? {} : { notify }) } });
      await onDone();
    } catch (e) {
      setErr((e as Error).message);
      const match = (e as { data?: { code?: string; match?: { householdId: string } } }).data;
      setExisting(match?.code === "duplicate" && match.match ? match.match.householdId : null);
      setBusy(false);
    }
  };
  return (
    <Card className="ring-2 ring-ink/10">
      <form onSubmit={save} className="space-y-4">
        <RegistrationForm event={eventInfo} value={f} onChange={setF} />
        {err && (
          <p className="text-sm text-danger">
            {err}{" "}
            {existing && (
              <button type="button" onClick={() => onOpen(existing)} className="font-medium text-ink underline underline-offset-2">
                Open that registration
              </button>
            )}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-end gap-3">
          {!household && (d.channels.sms || d.channels.email) && (
            <label className="mr-auto flex items-center gap-2 text-xs text-muted">
              <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="size-4 accent-[var(--ink)]" />
              Send them their pass
            </label>
          )}
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            {household ? "Save" : "Register"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** People who look registered twice (same name and age, different registrations), for an admin to settle. */
function Duplicates({ d, reload, onOpen }: { d: TabProps["d"]; reload: () => Promise<void>; onOpen: (hid: string) => void }) {
  const [busy, setBusy] = useState("");
  const pairs = possibleDuplicates(d.people, d.event.age_groups, d.event.duplicates_ignored);
  if (!pairs.length) return null;
  const hh = new Map(d.households.map((h) => [h.id, h]));
  const size = (hid: string) => d.people.filter((p) => p.household_id === hid && p.status === "registered").length;
  const where = (p: Person) => {
    const h = hh.get(p.household_id);
    const n = size(p.household_id);
    return n === 1 ? `on their own · ${h?.church}` : `with ${h?.contact_name} (${n} people) · ${h?.church}`;
  };
  const age = (p: Person) => (p.age !== null ? `${p.age}` : (p.age_group ?? "age not given"));

  const remove = async (p: Person, other: Person) => {
    const ok = await ask({
      title: `Remove this copy of ${p.full_name}?`,
      body: `They stay registered ${where(other).split(" · ")[0]}. Any bed or seat this copy had is freed.`,
      confirm: "Remove",
      danger: true,
    });
    if (!ok) return;
    setBusy(p.id);
    try {
      const r = await api<{ registrationRemoved: boolean }>(`/api/admin/events/${d.event.id}/registrants?rid=${p.id}`, { method: "DELETE" });
      toast(r.registrationRemoved ? "Duplicate removed (its registration was empty and is gone too)" : "Duplicate removed");
      await reload();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy("");
    }
  };
  const notSame = async (a: Person, b: Person) => {
    setBusy(pairKey(a.id, b.id));
    try {
      await api(`/api/admin/events/${d.event.id}/duplicates`, { method: "POST", json: { a: a.id, b: b.id } });
      toast("Marked as two different people");
      await reload();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy("");
    }
  };

  return (
    <Card className="space-y-3">
      <div>
        <h3 className="font-medium">Possible duplicates · {pairs.length}</h3>
        <p className="text-xs text-muted">Same name and age in different registrations. Keep one, or mark them as different people.</p>
      </div>
      <ul className="space-y-2">
        {pairs.slice(0, 20).map(([a, b]) => (
          <li key={pairKey(a.id, b.id)} className="rounded-2xl border border-line p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                [a, b],
                [b, a],
              ].map(([p, other]) => (
                <div key={p.id} className="flex items-center gap-2 rounded-xl bg-surface-2/50 px-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <button onClick={() => onOpen(p.household_id)} className="truncate text-left font-medium hover:underline">
                      {p.full_name} <span className="font-normal text-muted">· {age(p)}</span>
                    </button>
                    <div className="truncate text-xs text-muted">{where(p)}</div>
                  </div>
                  <button
                    onClick={() => remove(p, other)}
                    disabled={!!busy}
                    className="shrink-0 rounded-lg px-2 py-1 text-xs text-muted hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                  >
                    Remove this one
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-2 text-right">
              <button onClick={() => notSame(a, b)} disabled={!!busy} className="text-xs text-muted hover:text-ink disabled:opacity-40">
                Not the same person
              </button>
            </div>
          </li>
        ))}
      </ul>
      {pairs.length > 20 && <p className="text-xs text-muted">Showing 20 of {pairs.length}. Settle these and the rest appear.</p>}
    </Card>
  );
}
