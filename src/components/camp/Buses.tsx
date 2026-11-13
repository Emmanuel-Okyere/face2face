"use client";

import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { api, Button, Card, cx, Empty, Field, Input, MoreMenu, Pill } from "@/components/ui";
import type { Bus, Person, TabProps } from "./types";
import { ask, toast, toastError } from "@/components/feedback";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export default function Buses({ d, reload }: TabProps) {
  const [adding, setAdding] = useState(d.buses.length === 0);
  const [editing, setEditing] = useState<string | null>(null);
  const [captain, setCaptain] = useState<Bus | null>(null);
  const [busy, setBusy] = useState<"" | "fill" | "all">("");
  const [result, setResult] = useState<{ changed: number; unplaced: { id: string; reason: string }[] } | null>(null);
  const hh = useMemo(() => new Map(d.households.map((h) => [h.id, h])), [d.households]);
  const live = d.people.filter((p) => p.status === "registered");
  const riders = live.filter((p) => p.needs_bus);
  const onBus = new Map<string, Person[]>();
  for (const p of live) if (p.bus_id) onBus.set(p.bus_id, [...(onBus.get(p.bus_id) ?? []), p].sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0)));
  const waiting = riders.filter((p) => !p.bus_id);
  const seats = d.buses.reduce((n, b) => n + b.seats, 0);

  const run = async (mode: "fill" | "all") => {
    if (mode === "all" && !(await ask({ title: "Re-plan every seat?", body: "Locked seats stay; everyone else may move to a different bus or seat.", confirm: "Re-plan" }))) return;
    setBusy(mode);
    try {
      setResult(await api(`/api/admin/events/${d.event.id}/allocate`, { method: "POST", json: { what: "seats", mode } }));
      await reload();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy("");
    }
  };
  const move = async (p: Person, busId: string | null) => {
    try {
      await api(`/api/admin/events/${d.event.id}/registrants?rid=${p.id}`, { method: "PATCH", json: { bus: busId ? { id: busId } : null } });
      await reload();
    } catch (e) {
      toastError(e);
    }
  };

  /** A printable passenger list for the driver / bus captain, with a tick column for boarding. */
  const manifest = (b: Bus) => {
    const rows = (onBus.get(b.id) ?? [])
      .map((p) => `<tr><td>${p.seat}</td><td>${esc(p.full_name)}</td><td>${esc(hh.get(p.household_id)?.church)}</td><td>${esc(hh.get(p.household_id)?.contact_phone ?? "")}</td><td class="box"></td></tr>`)
      .join("");
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(b.name)} manifest</title>
<style>body{font:14px system-ui,sans-serif;margin:32px}h1{margin:0 0 4px}p{margin:0 0 16px;color:#555}table{width:100%;border-collapse:collapse}
th,td{border-bottom:1px solid #ddd;padding:6px 8px;text-align:left}th{font-size:12px;color:#555}.box{width:28px;border:1px solid #999}</style>
<h1>${esc(d.event.name)} · ${esc(b.name)}</h1><p>${[b.pickup && `Pickup: ${esc(b.pickup)}`, b.departs && `Departs: ${esc(b.departs)}`, b.driver && `Driver: ${esc(b.driver)}`, `${(onBus.get(b.id) ?? []).length}/${b.seats} seats`].filter(Boolean).join(" · ")}</p>
<table><thead><tr><th>Seat</th><th>Name</th><th>Church</th><th>Contact</th><th>✓</th></tr></thead><tbody>${rows}</tbody></table>`);
    w.document.close();
    w.print();
  };

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-4">
        <div className="min-w-0 flex-1">
          <div className="font-medium">
            {riders.length - waiting.length} of {riders.length} riders have a seat
          </div>
          <div className="text-xs text-muted">
            {d.buses.length} buses · {seats} seats{seats < riders.length ? ` · ${riders.length - seats} short` : ""}. People registered together sit together; each church rides its own bus where one is set.
          </div>
        </div>
        <Button onClick={() => run("fill")} loading={busy === "fill"} disabled={!d.buses.length || !!busy}>
          Assign seats
        </Button>
        <Button variant="ghost" onClick={() => run("all")} loading={busy === "all"} disabled={!d.buses.length || !!busy}>
          Re-plan all
        </Button>
        {!adding && (
          <Button variant="ghost" onClick={() => setAdding(true)}>
            + Buses
          </Button>
        )}
      </Card>

      {result && (
        <Card className="flex items-start justify-between gap-3 text-sm">
          <div>
            {result.changed ? `✓ ${result.changed} seats assigned or changed.` : "Nothing to change."}{" "}
            {result.unplaced.length > 0 && `${result.unplaced.length} still without a seat (${result.unplaced[0].reason.toLowerCase()}).`}
          </div>
          <button onClick={() => setResult(null)} className="text-muted hover:text-ink" aria-label="Dismiss">
            ×
          </button>
        </Card>
      )}

      {adding && <BusForm d={d} onDone={async () => (setAdding(false), await reload())} onCancel={d.buses.length ? () => setAdding(false) : undefined} />}
      {d.buses.length === 0 && !adding && <Empty title="No buses yet">Add buses with their seat count, then assign seats in one click.</Empty>}

      <div className="grid gap-3 lg:grid-cols-2">
        {d.buses.map((b) => {
          const on = onBus.get(b.id) ?? [];
          return editing === b.id ? (
            <BusForm key={b.id} d={d} bus={b} onDone={async () => (setEditing(null), await reload())} onCancel={() => setEditing(null)} />
          ) : (
            <Card key={b.id} className="space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{b.name}</span>
                {b.churches.length ? b.churches.map((c) => <Pill key={c}>{c}</Pill>) : <Pill>Any church</Pill>}
                <div className="ml-auto flex items-center gap-1">
                  <button onClick={() => setCaptain(b)} className="rounded-lg px-2 py-1 text-xs font-medium text-ink hover:bg-surface-2">
                    Boarding
                  </button>
                  <button onClick={() => setEditing(b.id)} className="rounded-lg px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-ink">
                    Edit
                  </button>
                  <MoreMenu items={[{ label: "Print manifest", onClick: () => manifest(b) }]} />
                </div>
              </div>
              <div className="text-xs text-muted">{[b.pickup && `From ${b.pickup}`, b.departs, b.driver].filter(Boolean).join(" · ") || "No pickup details"}</div>
              <BoardingStatus d={d} bus={b} assigned={on.length} />
              {/* Seat map: filled seats dark, free seats outlined. */}
              <div className="flex flex-wrap gap-1">
                {Array.from({ length: b.seats }, (_, i) => {
                  const p = on.find((x) => x.seat === i + 1);
                  return (
                    <span
                      key={i}
                      title={p ? `${i + 1}: ${p.full_name}` : `${i + 1}: free`}
                      className={cx("flex size-6 items-center justify-center rounded-md text-[10px] tabular-nums", p ? "bg-ink text-white" : "border border-line text-muted")}
                    >
                      {i + 1}
                    </span>
                  );
                })}
              </div>
              {on.length > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-xs text-muted">
                    {on.length}/{b.seats} passengers
                  </summary>
                  <ul className="mt-2 space-y-1">
                    {on.map((p) => (
                      <li key={p.id} className="flex items-center gap-2">
                        <span className="w-6 text-right text-xs tabular-nums text-muted">{p.seat}</span>
                        <span className="min-w-0 flex-1 truncate">
                          {p.full_name} <span className="text-xs text-muted">{hh.get(p.household_id)?.church}</span>
                        </span>
                        <SeatSelect d={d} person={p} counts={onBus} onMove={move} />
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </Card>
          );
        })}
      </div>

      {captain && <CaptainLink d={d} bus={d.buses.find((x) => x.id === captain.id) ?? captain} onClose={() => setCaptain(null)} reload={reload} />}

      {waiting.length > 0 && d.buses.length > 0 && (
        <Card>
          <h3 className="mb-2 text-sm font-medium">Need a seat · {waiting.length}</h3>
          <ul className="grid gap-1 text-sm sm:grid-cols-2">
            {waiting.map((p) => (
              <li key={p.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">
                  {p.full_name} <span className="text-xs text-muted">{hh.get(p.household_id)?.church}</span>
                </span>
                <SeatSelect d={d} person={p} counts={onBus} onMove={move} placeholder="Seat on…" />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function SeatSelect({ d, person, counts, onMove, placeholder = "Move" }: { d: TabProps["d"]; person: Person; counts: Map<string, Person[]>; onMove: (p: Person, id: string | null) => void; placeholder?: string }) {
  return (
    <select value="" onChange={(e) => e.target.value && onMove(person, e.target.value === "-" ? null : e.target.value)} className="max-w-28 rounded-lg border border-line bg-surface px-1.5 py-0.5 text-xs text-muted">
      <option value="">{placeholder}</option>
      {person.bus_id && <option value="-">Remove seat</option>}
      {d.buses
        .filter((b) => b.id !== person.bus_id && (counts.get(b.id)?.length ?? 0) < b.seats)
        .map((b) => (
          <option key={b.id} value={b.id}>
            {b.name} ({b.seats - (counts.get(b.id)?.length ?? 0)} free)
          </option>
        ))}
    </select>
  );
}

function BusForm({ d, bus, onDone, onCancel }: { d: TabProps["d"]; bus?: Bus; onDone: () => Promise<void>; onCancel?: () => void }) {
  const [f, setFState] = useState({
    name: bus?.name ?? "Bus",
    count: "1",
    seats: String(bus?.seats ?? 60),
    churches: bus?.churches ?? [],
    pickup: bus?.pickup ?? "",
    departs: bus?.departs ?? "",
    driver: bus?.driver ?? "",
  });
  const setF = (p: Partial<typeof f>) => setFState({ ...f, ...p });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const json = { ...f, seats: Number(f.seats), count: Number(f.count) };
      if (bus) {
        const r = await api<{ moved: number }>(`/api/admin/events/${d.event.id}/buses?bid=${bus.id}`, { method: "PUT", json });
        if (r.moved) toast(`${r.moved} ${r.moved === 1 ? "person" : "people"} no longer fit and lost their seat`, "info");
        else toast("Bus saved");
      } else await api(`/api/admin/events/${d.event.id}/buses`, { method: "POST", json });
      await onDone();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Card className="ring-2 ring-ink/10">
      <form onSubmit={save} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={bus ? "Name" : "Name"} hint={!bus && Number(f.count) > 1 ? `${f.name} 1, ${f.name} 2…` : undefined}>
          <Input required value={f.name} onChange={(e) => setF({ name: e.target.value })} />
        </Field>
        {!bus && (
          <Field label="How many">
            <Input type="number" min={1} max={50} value={f.count} onChange={(e) => setF({ count: e.target.value })} />
          </Field>
        )}
        <Field label="Seats each">
          <Input type="number" min={1} max={120} required value={f.seats} onChange={(e) => setF({ seats: e.target.value })} />
        </Field>
        <Field label="Pickup point">
          <Input value={f.pickup} onChange={(e) => setF({ pickup: e.target.value })} placeholder="Awoshie chapel" />
        </Field>
        <Field label="Departs">
          <Input value={f.departs} onChange={(e) => setF({ departs: e.target.value })} placeholder="Fri 6:00 am" />
        </Field>
        <Field label="Driver (optional)">
          <Input value={f.driver} onChange={(e) => setF({ driver: e.target.value })} />
        </Field>
        <div className="space-y-1.5 sm:col-span-2 lg:col-span-4">
          <div className="text-xs font-medium text-muted">For churches (none selected = any church)</div>
          <div className="flex flex-wrap gap-1.5">
            {d.event.churches.length === 0 && <span className="text-xs text-muted">Add the district&apos;s churches in Setup to assign buses per church.</span>}
            {d.event.churches.map((c) => {
              const on = f.churches.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setF({ churches: on ? f.churches.filter((x) => x !== c) : [...f.churches, c] })}
                  className={cx("rounded-full border px-3 py-1 text-xs", on ? "border-ink bg-ink text-white" : "border-line text-muted hover:text-ink")}
                >
                  {c}
                </button>
              );
            })}
          </div>
        </div>
        {err && <p className="text-sm text-danger sm:col-span-2 lg:col-span-4">{err}</p>}
        <div className="flex justify-end gap-2 sm:col-span-2 lg:col-span-4">
          {bus && (
            <Button
              type="button"
              variant="subtle"
              className="mr-auto text-danger"
              onClick={async () => {
                if (!(await ask({ title: `Delete ${bus.name}?`, body: "Its passengers lose their seats.", confirm: "Delete", danger: true }))) return;
                await api(`/api/admin/events/${d.event.id}/buses?bid=${bus.id}`, { method: "DELETE" });
                toast(`${bus.name} deleted`);
                await onDone();
              }}
            >
              Delete
            </Button>
          )}
          {onCancel && (
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button type="submit" loading={busy}>
            {bus ? "Save" : "Add buses"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** Live boarding count for each trip that has started (same rules as the captain's page). */
function BoardingStatus({ d, bus }: { d: TabProps["d"]; bus: Bus; assigned: number }) {
  const assignedHere = d.people.filter((p) => p.status === "registered" && p.bus_id === bus.id);
  const trips = (["out", "back"] as const)
    .map((trip) => {
      const rows = d.boardings.filter((x) => x.trip === trip);
      if (!rows.length) return null;
      const of = new Map(rows.map((x) => [x.registrant_id, x]));
      const onHere = rows.filter((x) => x.bus_id === bus.id && x.method !== "skipped").length;
      // Expected: our passengers, minus "not coming" and those who took another bus, plus anyone who took ours instead.
      const ours = assignedHere.filter((p) => {
        const x = of.get(p.id);
        return !x || (x.method !== "skipped" && x.bus_id === bus.id);
      }).length;
      const extras = rows.filter((x) => x.bus_id === bus.id && x.method !== "skipped" && !assignedHere.some((p) => p.id === x.registrant_id)).length;
      return { trip, onHere, expected: ours + extras };
    })
    .filter(Boolean) as { trip: "out" | "back"; onHere: number; expected: number }[];
  if (!trips.length) return null;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {trips.map((t) => (
        <span key={t.trip} className={t.onHere >= t.expected ? "font-medium text-[#2e7d4f]" : "text-ink/80"}>
          {t.trip === "out" ? "Going" : "Return"}: {t.onHere} / {t.expected} on board
          {t.onHere < t.expected && <span className="text-muted"> · {t.expected - t.onHere} missing</span>}
        </span>
      ))}
    </div>
  );
}

/** The bus captain's link: send it, show it as a QR, or replace it. */
function CaptainLink({ d, bus, onClose, reload }: { d: TabProps["d"]; bus: Bus; onClose: () => void; reload: () => Promise<void> }) {
  const url = `${d.origin}/board/${bus.captain_token}`;
  const [qr, setQr] = useState("");
  useEffect(() => {
    QRCode.toDataURL(url, { width: 360, margin: 1 }).then(setQr);
  }, [url]);
  const share = `${d.event.name} — ${bus.name} boarding list: ${url}`;
  return (
    <Card className="ring-2 ring-ink/10">
      <div className="flex flex-col gap-5 sm:flex-row">
        {/* eslint-disable-next-line @next/next/no-img-element -- generated data: URL */}
        {qr ? <img src={qr} alt="Captain link QR code" className="size-40 shrink-0 self-center rounded-xl border border-line" /> : <div className="size-40 shrink-0 rounded-xl bg-surface-2" />}
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <h3 className="font-medium">{bus.name} — captain&apos;s boarding list</h3>
            <p className="text-sm text-muted">
              For the bus captain&apos;s phone. No login needed.
            </p>
          </div>
          <div className="truncate rounded-xl bg-surface-2 px-3 py-2 font-mono text-xs">{url}</div>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={async () => {
                await navigator.clipboard.writeText(url);
                toast("Link copied");
              }}
            >
              Copy link
            </Button>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(share)}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center rounded-full border border-line px-4 py-2 text-sm hover:bg-surface-2"
            >
              Send on WhatsApp
            </a>
            <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-full border border-line px-4 py-2 text-sm hover:bg-surface-2">
              Open
            </a>
            <Button
              variant="subtle"
              onClick={async () => {
                const ok = await ask({ title: "Make a new captain link?", body: "The current link stops working immediately. Use this if it was shared with the wrong person.", confirm: "New link", danger: true });
                if (!ok) return;
                try {
                  await api(`/api/admin/events/${d.event.id}/buses?bid=${bus.id}`, { method: "PATCH" });
                  await reload();
                  toast("New link ready");
                } catch (e) {
                  toastError(e);
                }
              }}
            >
              New link
            </Button>
            <Button variant="ghost" className="ml-auto" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
