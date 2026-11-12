"use client";

import { useEffect, useState } from "react";
import { PageHeader, useOrg } from "@/components/AdminShell";
import { api, Button, Card, cx, Empty, Field, Input, MoreMenu, Pill, Spinner } from "@/components/ui";
import { DAY_SHORT, describeSchedule, fmtMin, isOpen, localNow, toMin, windowOf, type Service, type ServiceKind } from "@/lib/service-schedule";
import { ask, toast } from "@/components/feedback";

type Row = Service & { held: number; checkins: number; last_held: string | null };
type Draft = {
  name: string;
  kind: ServiceKind;
  weekdays: number[];
  on_date: string;
  start_time: string;
  end_time: string;
  opens_before: number;
  closes_after: number;
  late_after: number | null;
  audience: string[];
  active: boolean;
};

const EMPTY: Draft = {
  name: "Church Service",
  kind: "weekly",
  weekdays: [0],
  on_date: "",
  start_time: "08:00",
  end_time: "11:00",
  opens_before: 30,
  closes_after: 0,
  late_after: 15,
  audience: [],
  active: true,
};

export default function Services() {
  const org = useOrg();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [groups, setGroups] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const load = () =>
    api<{ services: Row[]; groups: string[] }>("/api/admin/services").then((r) => {
      setRows(r.services);
      setGroups(r.groups);
    });
  useEffect(() => {
    load();
  }, []);

  const now = org ? localNow(org.timeZone) : null;
  const active = rows?.filter((s) => s.active) ?? [];
  const archived = rows?.filter((s) => !s.active) ?? [];

  const archive = async (s: Row) => {
    await api(`/api/admin/services/${s.id}`, { method: "PUT", json: toPayload({ ...toDraft(s), active: !s.active }) });
    load();
  };
  const remove = async (s: Row) => {
    if (!(await ask({ title: `Delete “${s.name}”?`, confirm: "Delete", danger: true }))) return;
    await api(`/api/admin/services/${s.id}`, { method: "DELETE" });
    toast(`${s.name} deleted`);
    load();
  };

  return (
    <>
      <PageHeader
        title="Services"
        actions={
          editing !== "new" && (
            <Button onClick={() => setEditing("new")}>
              + New service
            </Button>
          )
        }
      />
      {!rows ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : (
        <div className="space-y-3">
          {editing === "new" && (
            <ServiceForm
              initial={EMPTY}
              groups={groups}
              onCancel={() => setEditing(null)}
              onSave={async (d) => {
                await api("/api/admin/services", { method: "POST", json: toPayload(d) });
                setEditing(null);
                load();
              }}
            />
          )}
          {active.length === 0 && editing !== "new" && <Empty title="No services yet">Add one to start taking attendance.</Empty>}
          {active.map((s) =>
            editing === s.id ? (
              <ServiceForm
                key={s.id}
                initial={toDraft(s)}
                groups={groups}
                onCancel={() => setEditing(null)}
                onSave={async (d) => {
                  await api(`/api/admin/services/${s.id}`, { method: "PUT", json: toPayload(d) });
                  setEditing(null);
                  load();
                }}
              />
            ) : (
              <ServiceCard key={s.id} s={s} openNow={!!now && isOpen(s, now.date, now.min)} onEdit={() => setEditing(s.id)} onArchive={() => archive(s)} onDelete={() => remove(s)} />
            ),
          )}
          {archived.length > 0 && (
            <div className="pt-4">
              <h2 className="mb-2 text-sm text-muted">Archived</h2>
              <div className="space-y-2">
                {archived.map((s) => (
                  <ServiceCard key={s.id} s={s} openNow={false} onEdit={() => setEditing(s.id)} onArchive={() => archive(s)} onDelete={() => remove(s)} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

/** What the API expects: no date unless it's a one-off service. */
function toPayload(d: Draft) {
  return { ...d, on_date: d.kind === "once" && d.on_date ? d.on_date : null };
}

function toDraft(s: Service): Draft {
  return {
    name: s.name,
    kind: s.kind,
    weekdays: s.weekdays ?? [],
    on_date: s.on_date ?? "",
    start_time: s.start_time.slice(0, 5),
    end_time: s.end_time.slice(0, 5),
    opens_before: s.opens_before,
    closes_after: s.closes_after,
    late_after: s.late_after,
    audience: s.audience ?? [],
    active: s.active,
  };
}

function ServiceCard({ s, openNow, onEdit, onArchive, onDelete }: { s: Row; openNow: boolean; onEdit: () => void; onArchive: () => void; onDelete: () => void }) {
  const w = windowOf(s);
  const schedule = describeSchedule(s);
  const allDay = w.opens === 0 && w.closes >= 24 * 60 - 1;
  // One quiet line, only what isn't obvious: no repeat of the name, no "all day", no "everyone".
  const details = [
    schedule.toLowerCase() !== s.name.toLowerCase() && schedule,
    !allDay &&
      (w.opens !== toMin(s.start_time) || w.closes !== toMin(s.end_time)) &&
      (w.closes === toMin(s.end_time) ? `check-in from ${fmtMin(w.opens)}` : w.opens === toMin(s.start_time) ? `check-in until ${fmtMin(w.closes)}` : `check-in ${fmtMin(w.opens)}–${fmtMin(w.closes)}`),
    s.late_after !== null && `late after ${fmtMin(toMin(s.start_time) + s.late_after)}`,
    s.audience?.length && `for ${s.audience.join(", ")}`,
    s.held > 0 && `held ${s.held} ${s.held === 1 ? "time" : "times"}`,
  ].filter(Boolean) as string[];
  const line = details.join(" · ");
  return (
    <Card className={cx("flex items-center gap-3", !s.active && "opacity-60")}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{s.name}</span>
          {openNow && <Pill tone="good">Open now</Pill>}
        </div>
        {line && <div className="mt-0.5 text-sm text-muted first-letter:uppercase">{line}</div>}
      </div>
      {s.active ? (
        <Button variant="ghost" onClick={onEdit}>
          Edit
        </Button>
      ) : (
        <Button variant="ghost" onClick={onArchive}>
          Restore
        </Button>
      )}
      <MoreMenu
        items={[
          ...(s.active ? [{ label: "Archive", onClick: onArchive }] : []),
          ...(s.held === 0 ? [{ label: "Delete", onClick: onDelete, danger: true }] : []),
        ]}
      />
    </Card>
  );
}

const BEFORE = [0, 15, 30, 45, 60, 90, 120];
const AFTER = [0, 15, 30, 60, 90, 120];
const LATE: (number | null)[] = [null, 0, 5, 10, 15, 20, 30, 45, 60];

function ServiceForm({ initial, groups, onSave, onCancel }: { initial: Draft; groups: string[]; onSave: (d: Draft) => Promise<void>; onCancel: () => void }) {
  const [d, setD] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD({ ...d, [k]: v });
  const w = windowOf({ ...d, id: "", weekdays: d.weekdays, on_date: d.on_date || null, audience: null } as Service);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await onSave(d);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  const seg = "inline-flex rounded-full border border-line bg-surface p-1 text-sm";
  const segBtn = (on: boolean) => cx("rounded-full px-3.5 py-1", on ? "bg-ink text-white" : "text-muted hover:text-ink");
  const select = "w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm";

  return (
    <Card className="ring-2 ring-ink/10">
      <form onSubmit={save} className="space-y-4">
        <Field label="Name">
          <Input required maxLength={80} value={d.name} onChange={(e) => set("name", e.target.value)} placeholder="Church Service" autoFocus />
        </Field>

        <div className="space-y-2">
          <div className="text-xs font-medium text-muted">Repeats</div>
          <div className={seg}>
            {(
              [
                ["weekly", "Weekly"],
                ["once", "One date"],
                ["daily", "Every day"],
              ] as [ServiceKind, string][]
            ).map(([k, l]) => (
              <button type="button" key={k} onClick={() => set("kind", k)} className={segBtn(d.kind === k)}>
                {l}
              </button>
            ))}
          </div>
          {d.kind === "weekly" && (
            <div className="flex flex-wrap gap-1.5">
              {DAY_SHORT.map((label, i) => {
                const on = d.weekdays.includes(i);
                return (
                  <button
                    type="button"
                    key={i}
                    aria-pressed={on}
                    onClick={() => set("weekdays", on ? d.weekdays.filter((x) => x !== i) : [...d.weekdays, i])}
                    className={cx("w-12 rounded-full border py-1.5 text-sm transition", on ? "border-ink bg-ink text-white" : "border-line bg-surface text-muted hover:text-ink")}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}
          {d.kind === "once" && <Input type="date" required value={d.on_date} onChange={(e) => set("on_date", e.target.value)} className="w-auto" />}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Starts">
            <Input type="time" required value={d.start_time} onChange={(e) => set("start_time", e.target.value)} />
          </Field>
          <Field label="Ends">
            <Input type="time" required value={d.end_time} onChange={(e) => set("end_time", e.target.value)} />
          </Field>
          <Field label="Check-in opens">
            <select className={select} value={d.opens_before} onChange={(e) => set("opens_before", Number(e.target.value))}>
              {BEFORE.map((m) => (
                <option key={m} value={m}>
                  {m === 0 ? "At the start" : `${m} min before`}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Check-in closes">
            <select className={select} value={d.closes_after} onChange={(e) => set("closes_after", Number(e.target.value))}>
              {AFTER.map((m) => (
                <option key={m} value={m}>
                  {m === 0 ? "At the end" : `${m} min after`}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Late after">
            <select className={select} value={d.late_after ?? ""} onChange={(e) => set("late_after", e.target.value === "" ? null : Number(e.target.value))}>
              {LATE.map((m) => (
                <option key={String(m)} value={m ?? ""}>
                  {m === null ? "Don't track" : m === 0 ? "Start time" : `${m} min after start`}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <p className="text-xs text-muted">
          Check-in {fmtMin(w.opens)}–{fmtMin(w.closes)}
          {d.late_after !== null && ` · late after ${fmtMin(toMin(d.start_time) + d.late_after)}`}
        </p>

        <div className="space-y-2">
          <div className="text-xs font-medium text-muted">Expected</div>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => set("audience", [])} className={cx("rounded-full border px-3 py-1 text-sm", d.audience.length === 0 ? "border-ink bg-ink text-white" : "border-line text-muted")}>
              Everyone
            </button>
            {groups.map((g) => {
              const on = d.audience.includes(g);
              return (
                <button
                  type="button"
                  key={g}
                  onClick={() => set("audience", on ? d.audience.filter((x) => x !== g) : [...d.audience, g])}
                  className={cx("rounded-full border px-3 py-1 text-sm", on ? "border-ink bg-ink text-white" : "border-line text-muted hover:text-ink")}
                >
                  {g}
                </button>
              );
            })}
          </div>
        </div>

        {err && <p className="text-sm text-danger">{err}</p>}
        <div className="flex justify-end gap-2">
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
