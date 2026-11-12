"use client";

import { useCallback, useEffect, useState } from "react";
import { api, Button, Card, cx, Input } from "@/components/ui";
import { autoName, computeInsight, dimensions, MEASURE_LABEL, shown, type InsightData, type InsightResult } from "@/lib/camp/insight-engine";
import { MEASURES, type InsightSpec } from "@/lib/camp/insight-spec";
import type { EventData } from "./types";
import { ask, toast } from "@/components/feedback";

type Saved = { id: string; name: string; spec: InsightSpec; position: number; created_by: string | null };

// Categorical slots in fixed order (validated for colour-blind separation on this
// surface); an 8th+ category folds into "Other" in neutral grey. Single series uses one hue.
const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6"];
const OTHER = "#a3a29b";
const ONE = "#5b72d9";
const colorOf = (series: string[], s: string) => (series.length === 1 ? ONE : s === "Other" ? OTHER : SERIES[series.indexOf(s) % SERIES.length]);

const BLANK: InsightSpec = { measure: "people", by: "church", split: null, filters: [], chart: "bars", sort: "value" };

/** The team's own saved views of the event, plus the builder that makes them. */
export default function SavedInsights({ d }: { d: EventData }) {
  const data = d as unknown as InsightData;
  const [list, setList] = useState<Saved[] | null>(null);
  const [editing, setEditing] = useState<Saved | "new" | null>(null);
  const load = useCallback(() => api<{ insights: Saved[] }>(`/api/admin/events/${d.event.id}/insights`).then((r) => setList(r.insights)), [d.event.id]);
  useEffect(() => {
    load();
  }, [load]);

  const dims = dimensions(data);
  const has = (k: string) => dims.some((x) => x.key === k);
  const firstSelect = d.event.questions.find((q) => q.type === "select" && q.enabled !== false);
  // One-click starting points, only the ones this event can answer.
  const starters: { name: string; spec: InsightSpec }[] = [
    { name: "Bus riders by church", spec: { ...BLANK, measure: "bus" as const, by: "church" } },
    ...(has("day") ? [{ name: "People each day, by church", spec: { ...BLANK, by: "day", split: "church", chart: "columns" as const } }] : []),
    { name: "Children by church", spec: { ...BLANK, measure: "children" as const, by: "church" } },
    ...(firstSelect ? [{ name: `${firstSelect.label} by age group`, spec: { ...BLANK, by: `q:${firstSelect.key}`, split: "age_group", sort: "label" as const } }] : []),
    { name: "Not arrived yet, by church", spec: { ...BLANK, by: "church", filters: [{ dim: "arrived", values: ["Not yet"] }] } },
  ].filter((s) => !list?.some((x) => x.name === s.name));

  const remove = async (s: Saved) => {
    if (!(await ask({ title: `Delete “${s.name}”?`, body: "Only this saved view is removed; no registration data changes.", confirm: "Delete", danger: true }))) return;
    await api(`/api/admin/events/${d.event.id}/insights?iid=${s.id}`, { method: "DELETE" });
    toast("Insight deleted");
    load();
  };
  const move = async (i: number, by: -1 | 1) => {
    if (!list) return;
    const next = [...list];
    const j = i + by;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setList(next);
    await Promise.all(next.map((s, k) => api(`/api/admin/events/${d.event.id}/insights?iid=${s.id}`, { method: "PUT", json: { position: k } })));
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-medium">Your insights</h2>
          <p className="text-xs text-muted">Saved views of this event, shared with your team and always up to date.</p>
        </div>
        {editing !== "new" && <Button onClick={() => setEditing("new")}>+ New insight</Button>}
      </div>

      {editing === "new" && (
        <Builder
          d={data}
          dims={dims}
          initial={{ name: "", spec: BLANK }}
          onCancel={() => setEditing(null)}
          onSave={async (name, spec) => {
            await api(`/api/admin/events/${d.event.id}/insights`, { method: "POST", json: { name, spec } });
            setEditing(null);
            load();
          }}
        />
      )}

      {list && editing !== "new" && starters.length > 0 && (
        <Card className="text-sm">
          <div className="mb-2 text-muted">{list.length ? "More ideas:" : "Start from one of these, or build your own:"}</div>
          <div className="flex flex-wrap gap-1.5">
            {starters.map((s) => (
              <button
                key={s.name}
                onClick={async () => {
                  await api(`/api/admin/events/${d.event.id}/insights`, { method: "POST", json: s });
                  load();
                }}
                className="rounded-full border border-dashed border-line px-3 py-1 text-xs text-muted hover:border-ink/30 hover:text-ink"
              >
                + {s.name}
              </button>
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {list?.map((s, i) =>
          editing !== "new" && editing?.id === s.id ? (
            <div key={s.id} className="lg:col-span-2">
              <Builder
                d={data}
                dims={dims}
                initial={s}
                onCancel={() => setEditing(null)}
                onSave={async (name, spec) => {
                  await api(`/api/admin/events/${d.event.id}/insights?iid=${s.id}`, { method: "PUT", json: { name, spec } });
                  setEditing(null);
                  load();
                }}
              />
            </div>
          ) : (
            <InsightCard
              key={s.id}
              s={s}
              d={data}
              dims={dims}
              onEdit={() => setEditing(s)}
              onDelete={() => remove(s)}
              onMove={(by) => move(i, by)}
              first={i === 0}
              last={i === list.length - 1}
            />
          ),
        )}
      </div>
    </section>
  );
}

type Dims = ReturnType<typeof dimensions>;

function describe(spec: InsightSpec, dims: Dims, r: InsightResult) {
  const lab = (k: string) => dims.find((x) => x.key === k)?.label ?? k;
  const filt = spec.filters.map((f) => `${lab(f.dim)}: ${f.values.map(shown).join(", ")}`).join(" · ");
  return `${r.total} ${MEASURE_LABEL[spec.measure].toLowerCase()}${spec.filters.length ? ` of ${r.base}` : ""}${filt ? ` · ${filt}` : ""}`;
}

function InsightCard({ s, d, dims, onEdit, onDelete, onMove, first, last }: { s: Saved; d: InsightData; dims: Dims; onEdit: () => void; onDelete: () => void; onMove: (by: -1 | 1) => void; first: boolean; last: boolean }) {
  const r = computeInsight(s.spec, d);
  const csv = () => {
    const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const head = [dims.find((x) => x.key === s.spec.by)?.label ?? "", ...(r.series.length > 1 ? r.series : []), "Total"];
    const rows = r.groups.map((g) => [shown(g), ...(r.series.length > 1 ? r.series.map((x) => r.cell(g, x)) : []), r.rowTotal(g)]);
    const blob = new Blob(["﻿" + [head, ...rows].map((row) => row.map(cell).join(",")).join("\r\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${s.name.replace(/[^\w-]+/g, "_")}.csv`;
    a.click();
  };
  return (
    <Card className={cx(s.spec.chart === "table" && r.groups.length > 8 && "lg:col-span-2")}>
      <div className="mb-3 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-medium">{s.name}</h3>
          <p className="truncate text-xs text-muted">{describe(s.spec, dims, r)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5 text-xs text-muted">
          <button onClick={() => onMove(-1)} disabled={first} className="rounded px-1 hover:text-ink disabled:opacity-20" aria-label="Move earlier">
            ←
          </button>
          <button onClick={() => onMove(1)} disabled={last} className="rounded px-1 hover:text-ink disabled:opacity-20" aria-label="Move later">
            →
          </button>
          <button onClick={csv} className="rounded-lg px-2 py-1 hover:bg-surface-2 hover:text-ink">
            CSV
          </button>
          <button onClick={onEdit} className="rounded-lg px-2 py-1 hover:bg-surface-2 hover:text-ink">
            Edit
          </button>
          <button onClick={onDelete} className="flex size-6 items-center justify-center rounded-lg hover:bg-danger/10 hover:text-danger" aria-label={`Delete ${s.name}`}>
            ×
          </button>
        </div>
      </div>
      <Chart spec={s.spec} r={r} />
    </Card>
  );
}

function Chart({ spec, r }: { spec: InsightSpec; r: InsightResult }) {
  if (!r.total) return <p className="py-6 text-center text-sm text-muted">No one matches yet.</p>;
  if (spec.chart === "number" || !spec.by)
    return (
      <div className="py-2">
        <div className="text-5xl font-semibold tabular-nums tracking-tight">{r.total}</div>
        {spec.filters.length > 0 && <div className="mt-1 text-sm text-muted">{Math.round((r.total / Math.max(1, r.base)) * 100)}% of {r.base}</div>}
      </div>
    );
  const split = r.series.length > 1;
  const legend = split && (
    <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {r.series.map((s) => (
        <span key={s} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: colorOf(r.series, s) }} />
          {shown(s)}
        </span>
      ))}
    </div>
  );

  if (spec.chart === "table")
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="py-1.5 pr-3 font-normal" />
              {split && r.series.map((s) => <th key={s} className="px-2 py-1.5 text-right font-normal">{shown(s)}</th>)}
              <th className="py-1.5 pl-2 text-right font-normal">Total</th>
            </tr>
          </thead>
          <tbody>
            {r.groups.map((g) => (
              <tr key={g} className="border-b border-line/60">
                <td className="py-1.5 pr-3">{shown(g)}</td>
                {split && r.series.map((s) => <td key={s} className="px-2 py-1.5 text-right tabular-nums text-ink/80">{r.cell(g, s) || "·"}</td>)}
                <td className="py-1.5 pl-2 text-right font-medium tabular-nums">{r.rowTotal(g)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

  if (spec.chart === "columns") {
    const max = Math.max(1, ...r.groups.map((g) => r.series.reduce((n, s) => n + r.cell(g, s), 0)));
    const every = Math.ceil(r.groups.length / 10);
    return (
      <div>
        {legend}
        <div className="flex h-40 items-end gap-[2px] border-b border-line">
          {r.groups.map((g) => {
            const sum = r.series.reduce((n, s) => n + r.cell(g, s), 0);
            return (
              <div key={g} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${shown(g)}: ${r.rowTotal(g)}${split ? " — " + r.series.map((s) => `${shown(s)} ${r.cell(g, s)}`).join(", ") : ""}`}>
                <span className="mb-1 text-center text-[11px] tabular-nums text-muted">{r.rowTotal(g)}</span>
                <div className="flex flex-col-reverse gap-[2px]" style={{ height: `${(sum / max) * 82}%` }}>
                  {r.series.map((s) => {
                    const n = r.cell(g, s);
                    return n ? <span key={s} className="last:rounded-t-[4px]" style={{ flex: n, background: colorOf(r.series, s) }} /> : null;
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-1.5 flex gap-[2px]">
          {r.groups.map((g, i) => (
            <span key={g} className="min-w-0 flex-1 truncate text-center text-[10px] text-muted">
              {i % every === 0 ? shown(g) : ""}
            </span>
          ))}
        </div>
      </div>
    );
  }

  const max = Math.max(1, ...r.groups.map((g) => r.series.reduce((n, s) => n + r.cell(g, s), 0)));
  return (
    <div>
      {legend}
      <ul className="space-y-2.5">
        {r.groups.map((g) => {
          const sum = r.series.reduce((n, s) => n + r.cell(g, s), 0);
          return (
            <li key={g} className="grid grid-cols-[7rem_1fr_2.5rem] items-center gap-3 text-sm" title={`${shown(g)}: ${r.rowTotal(g)}${split ? " — " + r.series.map((s) => `${shown(s)} ${r.cell(g, s)}`).join(", ") : ""}`}>
              <span className="truncate text-ink/80">{shown(g)}</span>
              <span className="flex h-3 gap-[2px]" style={{ width: `${Math.max(2, (sum / max) * 100)}%` }}>
                {r.series.map((s) => {
                  const n = r.cell(g, s);
                  return n ? <span key={s} className="h-full last:rounded-r-[4px]" style={{ flex: n, background: colorOf(r.series, s) }} /> : null;
                })}
              </span>
              <span className="text-right tabular-nums text-ink/80">{r.rowTotal(g)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const sel = "w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm";

function Builder({ d, dims, initial, onSave, onCancel }: { d: InsightData; dims: Dims; initial: { name: string; spec: InsightSpec }; onSave: (name: string, spec: InsightSpec) => Promise<void>; onCancel: () => void }) {
  const [spec, setSpec] = useState<InsightSpec>(initial.spec);
  const [name, setName] = useState(initial.name);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<InsightSpec>) => setSpec((s) => ({ ...s, ...p }));
  const r = computeInsight(spec, d);
  const auto = autoName(spec, d);
  const [adding, setAdding] = useState("");

  const save = async () => {
    setBusy(true);
    setErr("");
    try {
      await onSave(name.trim() || auto, spec);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Card className="ring-2 ring-ink/10">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_1fr]">
        <div className="space-y-3">
          <label className="block space-y-1.5">
            <span className="block text-xs font-medium text-muted">Count</span>
            <select value={spec.measure} onChange={(e) => set({ measure: e.target.value as InsightSpec["measure"] })} className={sel}>
              {MEASURES.map((m) => (
                <option key={m} value={m}>
                  {MEASURE_LABEL[m]}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="block text-xs font-medium text-muted">Grouped by</span>
            <select value={spec.by ?? ""} onChange={(e) => set({ by: e.target.value || null, chart: !e.target.value ? "number" : spec.chart === "number" ? "bars" : spec.chart })} className={sel}>
              <option value="">Nothing — just the total</option>
              {dims.map((x) => (
                <option key={x.key} value={x.key}>
                  {x.label}
                </option>
              ))}
            </select>
          </label>
          {spec.by && (
            <label className="block space-y-1.5">
              <span className="block text-xs font-medium text-muted">Split by (optional)</span>
              <select value={spec.split ?? ""} onChange={(e) => set({ split: e.target.value || null })} className={sel}>
                <option value="">No split</option>
                {dims
                  .filter((x) => x.key !== spec.by)
                  .map((x) => (
                    <option key={x.key} value={x.key}>
                      {x.label}
                    </option>
                  ))}
              </select>
            </label>
          )}

          <div className="space-y-1.5">
            <span className="block text-xs font-medium text-muted">Only include</span>
            {spec.filters.map((f, i) => {
              const dim = dims.find((x) => x.key === f.dim);
              return (
                <div key={f.dim} className="rounded-xl border border-line p-2">
                  <div className="mb-1.5 flex items-center justify-between text-xs">
                    <span className="font-medium">{dim?.label}</span>
                    <button onClick={() => set({ filters: spec.filters.filter((_, j) => j !== i) })} className="text-muted hover:text-danger" aria-label="Remove filter">
                      ×
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {(dim?.values ?? []).map((v) => {
                      const on = f.values.includes(v);
                      return (
                        <button
                          key={v}
                          onClick={() => {
                            const values = on ? f.values.filter((x) => x !== v) : [...f.values, v];
                            set({ filters: values.length ? spec.filters.map((x, j) => (j === i ? { ...x, values } : x)) : spec.filters.filter((_, j) => j !== i) });
                          }}
                          className={cx("rounded-full border px-2.5 py-0.5 text-xs", on ? "border-ink bg-ink text-white" : "border-line text-muted hover:text-ink")}
                        >
                          {shown(v)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            <select
              value={adding}
              onChange={(e) => {
                const k = e.target.value;
                setAdding("");
                const first = dims.find((x) => x.key === k)?.values[0];
                if (k && first) set({ filters: [...spec.filters, { dim: k, values: [first] }] });
              }}
              className={cx(sel, "text-muted")}
            >
              <option value="">+ Add a filter…</option>
              {dims
                .filter((x) => !spec.filters.some((f) => f.dim === x.key) && x.values.length)
                .map((x) => (
                  <option key={x.key} value={x.key}>
                    {x.label}
                  </option>
                ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <span className="block text-xs font-medium text-muted">Show as</span>
            <div className="flex flex-wrap gap-1">
              {(spec.by ? (["bars", "columns", "table", "number"] as const) : (["number"] as const)).map((c) => (
                <button key={c} onClick={() => set({ chart: c })} className={cx("rounded-full border px-3 py-1 text-xs capitalize", spec.chart === c ? "border-ink bg-ink text-white" : "border-line text-muted hover:text-ink")}>
                  {c === "number" ? "One number" : c}
                </button>
              ))}
            </div>
          </div>
          {spec.by && spec.chart !== "number" && (
            <label className="flex items-center gap-2 text-xs text-muted">
              Order
              <select value={spec.sort} onChange={(e) => set({ sort: e.target.value as InsightSpec["sort"] })} className="rounded-lg border border-line bg-surface px-2 py-1 text-xs">
                <option value="value">Biggest first</option>
                <option value="label">Natural order</option>
              </select>
            </label>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={auto} maxLength={80} aria-label="Name" className="font-medium" />
          <div className="min-h-40 flex-1 rounded-2xl border border-dashed border-line p-4">
            <p className="mb-3 text-xs text-muted">{describe(spec, dims, r)}</p>
            <Chart spec={spec} r={r} />
          </div>
          {err && <p className="text-sm text-danger">{err}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button onClick={save} loading={busy}>
              Save insight
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
