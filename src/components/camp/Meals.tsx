"use client";

import QRCode from "qrcode";
import { useCallback, useEffect, useState } from "react";
import { ask, toast, toastError } from "@/components/feedback";
import { api, Button, Card, cx, Input, MoreMenu } from "@/components/ui";
import { eventDays, plural } from "@/lib/camp/format";
import { Switch } from "./FormBuilder";
import type { TabProps } from "./types";

type Slot = { key: string; name: string; from: string; to: string };
type MenuRow = { church: string | null; day: string; meal: string; dishes: string };
type MealsData = { token: string; kitchens: { church: string; token: string }[]; served: { day: string; meal: string; church: string; n: number }[] };

const keyOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 30) || "meal";
const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/** Meals at the event: how food is served, the menu, the kitchens' scanning links, and plates served. */
export default function Meals({ d, reload }: TabProps) {
  const e = d.event;
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<MealsData | null>(null);
  const load = useCallback(() => api<MealsData>(`/api/admin/events/${e.id}/meals`).then(setData, toastError), [e.id]);
  useEffect(() => {
    load();
  }, [load, e.meals_mode, e.churches.length]);

  const save = async (patch: Partial<{ meals_enabled: boolean; meals: Slot[]; meals_mode: "together" | "by_church" }>, msg: string) => {
    setBusy(true);
    try {
      await api(`/api/admin/events/${e.id}`, { method: "PUT", json: { ...e, ...patch } });
      await reload();
      toast(msg);
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };
  const byChurch = e.meals_mode === "by_church";
  const unit = e.unit_label || "Church";

  return (
    <div className="space-y-4">
      <Card className="flex items-center gap-4">
        <Switch on={e.meals_enabled} onChange={(v) => save({ meals_enabled: v }, v ? "Meals turned on" : "Meals turned off")} disabled={busy} label="Serve meals with the pass card" />
        <div className="min-w-0 flex-1">
          <div className="font-medium">Meals with the pass card</div>
        </div>
      </Card>

      {e.meals_enabled && (
        <>
          <Card className="space-y-3">
            <div className="font-medium">How is food served?</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  ["together", "Together", "One kitchen, one menu"],
                  ["by_church", `By ${unit.toLowerCase()}`, `Own kitchen and menu`],
                ] as const
              ).map(([mode, title, text]) => (
                <button
                  key={mode}
                  type="button"
                  disabled={busy}
                  onClick={() => e.meals_mode !== mode && save({ meals_mode: mode }, mode === "together" ? "Serving together" : `Serving by ${unit.toLowerCase()}`)}
                  className={cx("rounded-2xl border p-4 text-left transition", e.meals_mode === mode ? "border-ink ring-1 ring-ink" : "border-line hover:border-ink/30")}
                >
                  <div className="font-medium">{title}</div>
                  <div className="mt-0.5 text-xs text-muted">{text}</div>
                </button>
              ))}
            </div>
            {byChurch && !e.churches.length && <p className="text-xs text-[#9a5f0c]">Add {plural(unit).toLowerCase()} in Setup.</p>}
          </Card>

          <MenuEditor d={d} />

          <MealTimes e={e} busy={busy} onSave={(meals) => save({ meals }, "Meal times saved")} />

          {data && <Kitchens d={d} data={data} onRotate={load} />}

          {data && <Served d={d} data={data} />}
        </>
      )}
    </div>
  );
}

/** Menu: pick a day (and a church), write what's served at each meal. Saves as you go. */
function MenuEditor({ d }: TabProps["d"] extends infer T ? { d: T } : never) {
  const e = d.event;
  const days = eventDays(e.starts_on, e.ends_on);
  const byChurch = e.meals_mode === "by_church";
  const [menu, setMenu] = useState<MenuRow[] | null>(null);
  const [day, setDay] = useState(() => {
    const today = new Date().toISOString().slice(0, 10);
    return days.includes(today) ? today : (days[0] ?? "");
  });
  const [church, setChurch] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const load = useCallback(() => api<{ menu: MenuRow[] }>(`/api/admin/events/${e.id}/menu`).then((r) => setMenu(r.menu), toastError), [e.id]);
  useEffect(() => {
    load();
  }, [load]);
  if (!days.length)
    return (
      <Card>
        <div className="font-medium">Menu</div>
        <p className="mt-1 text-sm text-muted">Set the event dates in Setup to write a menu for each day.</p>
      </Card>
    );
  const scope = byChurch ? church : null;
  const saved = (meal: string) => menu?.find((m) => m.church === scope && m.day === day && m.meal === meal)?.dishes ?? "";
  const fallback = (meal: string) => (scope ? menu?.find((m) => m.church === null && m.day === day && m.meal === meal)?.dishes : undefined);
  const k = (meal: string) => `${scope ?? ""}|${day}|${meal}`;
  const filled = (dd: string) => (menu ?? []).some((m) => m.day === dd && m.church === scope);

  const commit = async (meal: string) => {
    const text = drafts[k(meal)];
    if (text === undefined || text.trim() === saved(meal)) return;
    try {
      await api(`/api/admin/events/${e.id}/menu`, { method: "PUT", json: { church: scope, day, meal, dishes: text.trim() } });
      await load();
      toast("Menu saved");
    } catch (err) {
      toastError(err);
    }
  };

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-medium">Menu</div>
        </div>
        {byChurch && (
          <select value={church ?? ""} onChange={(ev) => setChurch(ev.target.value || null)} className="rounded-xl border border-line bg-surface px-3 py-2 text-sm">
            <option value="">All {plural(e.unit_label || "church").toLowerCase()}</option>
            {e.churches.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {days.map((dd) => (
          <button
            key={dd}
            type="button"
            onClick={() => setDay(dd)}
            className={cx("relative rounded-xl border px-3 py-1.5 text-sm", day === dd ? "border-ink bg-ink text-white" : "border-line text-muted hover:text-ink")}
          >
            {dayLabel(dd)}
            {filled(dd) && day !== dd && <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-good" aria-label="has a menu" />}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {e.meals.map((m) => (
          <label key={m.key} className="grid gap-1.5 sm:grid-cols-[8rem_1fr] sm:items-start">
            <span className="pt-2 text-sm font-medium">
              {m.name}
              <span className="block text-xs font-normal text-muted">
                {m.from}–{m.to}
              </span>
            </span>
            <textarea
              rows={2}
              value={drafts[k(m.key)] ?? saved(m.key)}
              onChange={(ev) => setDrafts({ ...drafts, [k(m.key)]: ev.target.value })}
              onBlur={() => commit(m.key)}
              placeholder={fallback(m.key) ?? "Jollof rice, chicken, salad"}
              className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-ink/40"
            />
          </label>
        ))}
      </div>

      {days.length > 1 && (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            onClick={async () => {
              const ok = await ask({ title: `Use ${dayLabel(day)}'s menu every day?`, body: "Other days' menus for the same meals are replaced.", confirm: "Copy to every day" });
              if (!ok) return;
              try {
                const r = await api<{ copied: number }>(`/api/admin/events/${e.id}/menu`, { method: "POST", json: { action: "copy_day", from: day, church: scope } });
                await load();
                toast(r.copied ? "Copied to every day" : "Nothing to copy yet");
              } catch (err) {
                toastError(err);
              }
            }}
          >
            Copy to every day
          </Button>
        </div>
      )}
    </Card>
  );
}

function MealTimes({ e, busy, onSave }: { e: TabProps["d"]["event"]; busy: boolean; onSave: (m: Slot[]) => void }) {
  const [slots, setSlots] = useState<Slot[]>(e.meals);
  const dirty = JSON.stringify(slots) !== JSON.stringify(e.meals);
  return (
    <Card className="space-y-3">
      <div className="font-medium">Meal times</div>
      <div className="space-y-2">
        {slots.map((m, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <Input value={m.name} onChange={(ev) => setSlots(slots.map((x, j) => (j === i ? { ...x, name: ev.target.value, key: x.key || keyOf(ev.target.value) } : x)))} className="w-40" aria-label="Meal name" />
            <Input type="time" value={m.from} onChange={(ev) => setSlots(slots.map((x, j) => (j === i ? { ...x, from: ev.target.value } : x)))} className="w-32" aria-label="From" />
            <span className="text-muted">–</span>
            <Input type="time" value={m.to} onChange={(ev) => setSlots(slots.map((x, j) => (j === i ? { ...x, to: ev.target.value } : x)))} className="w-32" aria-label="To" />
            {slots.length > 1 && (
              <button type="button" onClick={() => setSlots(slots.filter((_, j) => j !== i))} className="px-1 text-muted hover:text-danger" aria-label={`Remove ${m.name}`}>
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => {
            let key = "snack";
            for (let n = 2; slots.some((x) => x.key === key); n++) key = `snack_${n}`;
            setSlots([...slots, { key, name: "Snack", from: "16:00", to: "17:00" }]);
          }}
          className="text-xs text-muted hover:text-ink"
        >
          + Add a meal
        </button>
        {dirty && (
          <Button onClick={() => onSave(slots)} loading={busy}>
            Save meal times
          </Button>
        )}
      </div>
    </Card>
  );
}

/** Serving links: one for everybody, or one per church — plus the public menu page. */
function Kitchens({ d, data, onRotate }: { d: TabProps["d"]; data: MealsData; onRotate: () => void }) {
  const e = d.event;
  const byChurch = e.meals_mode === "by_church";
  const rows = byChurch ? data.kitchens.map((k) => ({ label: `${k.church} kitchen`, church: k.church as string | null, url: `${d.origin}/serve/${k.token}` })) : [{ label: "Serving station", church: null as string | null, url: `${d.origin}/serve/${data.token}` }];
  const menuUrl = `${d.origin}/menu/${e.public_token}`;
  const [qr, setQr] = useState<{ title: string; src: string } | null>(null);
  const showQr = async (title: string, url: string) => setQr({ title, src: await QRCode.toDataURL(url, { width: 480, margin: 1 }) });
  const rotate = async (church: string | null, label: string) => {
    if (!(await ask({ title: `New link for ${label}?`, body: "The current link stops working immediately.", confirm: "New link", danger: true }))) return;
    await api(`/api/admin/events/${e.id}/meals${church ? `?church=${encodeURIComponent(church)}` : ""}`, { method: "PATCH" }).then(() => (onRotate(), toast("New link ready")), toastError);
  };
  const copy = async (url: string) => {
    await navigator.clipboard.writeText(url);
    toast("Link copied");
  };
  return (
    <Card className="space-y-3">
      <div>
        <div className="font-medium">{byChurch ? "Kitchens" : "Serving station"}</div>
      </div>
      <ul className="divide-y divide-line/70">
        {rows.map((r) => (
          <li key={r.label} className="flex flex-wrap items-center gap-2 py-2.5">
            <span className="min-w-40 flex-1 text-sm font-medium">{r.label}</span>
            <Button variant="ghost" onClick={() => copy(r.url)}>
              Copy link
            </Button>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(`${e.name} — ${r.label}: ${r.url}`)}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center rounded-full border border-line px-4 py-2 text-sm hover:bg-surface-2"
            >
              WhatsApp
            </a>
            <MoreMenu
              items={[
                { label: "Show QR code", onClick: () => showQr(r.label, r.url) },
                { label: "Open", onClick: () => window.open(r.url, "_blank", "noopener") },
                { label: "New link", onClick: () => rotate(r.church, r.label), danger: true },
              ]}
            />
          </li>
        ))}
        <li className="flex flex-wrap items-center gap-2 py-2.5">
          <span className="min-w-40 flex-1 text-sm font-medium">Public menu page</span>
          <Button variant="ghost" onClick={() => copy(menuUrl)}>
            Copy link
          </Button>
          <Button variant="ghost" onClick={() => showQr("Menu", menuUrl)}>
            QR code
          </Button>
        </li>
      </ul>
      {qr && (
        <div className="flex items-center gap-4 rounded-2xl border border-line p-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- generated data: URL */}
          <img src={qr.src} alt={`${qr.title} QR code`} className="size-36 rounded-xl" />
          <div className="flex-1 text-sm">
            <div className="font-medium">{qr.title}</div>
            <a href={qr.src} download={`${qr.title.replace(/\W+/g, "-").toLowerCase()}-qr.png`} className="mt-2 inline-block text-xs underline">
              Download
            </a>
          </div>
          <button onClick={() => setQr(null)} className="self-start text-muted hover:text-ink" aria-label="Close">
            ×
          </button>
        </div>
      )}
    </Card>
  );
}

function Served({ d, data }: { d: TabProps["d"]; data: MealsData }) {
  const e = d.event;
  const [church, setChurch] = useState("");
  const days = [...new Set([...eventDays(e.starts_on, e.ends_on), ...data.served.map((x) => x.day)])].sort();
  const live = d.people.filter((p) => p.status === "registered" && (!church || d.households.find((h) => h.id === p.household_id)?.church === church));
  const expected = (day: string) => live.filter((p) => !p.days || p.days.includes(day)).length;
  const served = (day: string, meal: string) => data.served.filter((x) => x.day === day && x.meal === meal && (!church || x.church === church)).reduce((n, x) => n + x.n, 0);
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="font-medium">Plates served</div>
        {e.churches.length > 0 && (
          <select value={church} onChange={(ev) => setChurch(ev.target.value)} className="rounded-xl border border-line bg-surface px-3 py-1.5 text-sm">
            <option value="">All {plural(e.unit_label || "church").toLowerCase()}</option>
            {e.churches.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        )}
      </div>
      {days.length === 0 ? (
        <p className="text-sm text-muted">Set the event dates to see each day here.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="py-2 pr-3 font-normal">Day</th>
                {e.meals.map((m) => (
                  <th key={m.key} className="px-2 py-2 text-right font-normal">
                    {m.name}
                  </th>
                ))}
                <th className="py-2 pl-2 text-right font-normal">Expected</th>
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day} className="border-b border-line/60">
                  <td className="py-2 pr-3">{dayLabel(day)}</td>
                  {e.meals.map((m) => {
                    const n = served(day, m.key);
                    return (
                      <td key={m.key} className={cx("px-2 py-2 text-right tabular-nums", n ? "text-ink" : "text-muted")}>
                        {n || "·"}
                      </td>
                    );
                  })}
                  <td className="py-2 pl-2 text-right tabular-nums text-muted">{expected(day)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
