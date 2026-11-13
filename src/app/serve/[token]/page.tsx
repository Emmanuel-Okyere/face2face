"use client";

import jsQR from "jsqr";
import { useParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { chime, useCamera } from "@/components/camera";
import { ask, toastError } from "@/components/feedback";
import { api, cx, Logo, Spinner } from "@/components/ui";

type Meal = { key: string; name: string; from: string; to: string };
type Info = {
  event: { name: string };
  kitchen: string | null; // a church's own kitchen, or null for everyone
  unit: string;
  dishes: Record<string, string | null>;
  meals: Meal[];
  today: string;
  day: string;
  meal: string;
  served: number;
  expected: number;
  recent: { full_name: string; served_at: string }[];
};
type Served = { name: string; meal: string; already: boolean; servedAt: string; diet: string[]; notToday: boolean; child: boolean };
type Shown = { tone: "good" | "bad" | "warn"; title: string; sub?: string; diet?: string[]; child?: boolean };

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const first = (n: string) => n.trim().split(/\s+/)[0];
const dayName = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/** The kitchen's serving station: scan a pass, see at once whether they've already eaten this meal. */
function Station() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<Info | null>(null);
  const [bad, setBad] = useState("");
  const [day, setDay] = useState<string | null>(null);
  const [meal, setMeal] = useState<string | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [scanning, setScanning] = useState(true);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ id: string; full_name: string; church: string; served_at: string | null; here: boolean }[]>([]);
  const sel = useRef({ day: "", meal: "" });

  const load = useCallback(() => {
    const qs = new URLSearchParams({ ...(day ? { day } : {}), ...(meal ? { meal } : {}) });
    return api<Info>(`/api/serve/${token}?${qs}`)
      .then((r) => {
        setInfo(r);
        sel.current = { day: r.day, meal: r.meal };
      })
      .catch((e) => setBad(e.message));
  }, [token, day, meal]);
  useEffect(() => {
    load();
    const t = setInterval(load, 10_000); // other serving points too
    return () => clearInterval(t);
  }, [load]);

  const serve = useCallback(
    (who: { code?: string; rid?: string }): Promise<Served | null> => {
      const attempt = async (force: boolean): Promise<Served | null> => {
        try {
          const r = await api<Served>(`/api/serve/${token}`, { method: "POST", json: { ...sel.current, ...who, force } });
          if (r.already) {
            chime("error");
            navigator.vibrate?.([80, 60, 80]);
            setShown({ tone: "bad", title: `Already had ${r.meal.toLowerCase()}`, sub: `${r.name} · served at ${time(r.servedAt)}` });
          } else {
            chime("ok");
            navigator.vibrate?.(60);
            setShown({
              tone: r.notToday ? "warn" : "good",
              title: `Enjoy your ${r.meal.toLowerCase()}, ${first(r.name)}`,
              sub: r.notToday ? `${r.name} isn't registered for today — served anyway` : r.name,
              diet: r.diet,
              child: r.child,
            });
          }
          load();
          return r;
        } catch (e) {
          const data = (e as { data?: { code?: string; name?: string; church?: string } }).data;
          if (data?.code === "other_kitchen") {
            chime("warn");
            const ok = await ask({ title: `${data.name} eats with ${data.church}`, body: "Serve them here anyway?", confirm: "Serve here" });
            return ok ? attempt(true) : null;
          }
          chime("error");
          setShown({ tone: "bad", title: (e as Error).message });
          return null;
        }
      };
      return attempt(false);
    },
    [token, load],
  );

  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => setShown(null), shown.tone === "bad" ? 4000 : 2600);
    return () => clearTimeout(t);
  }, [shown]);

  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(() => {
      const qs = new URLSearchParams({ q: q.trim(), day: sel.current.day, meal: sel.current.meal });
      api<{ people: typeof found }>(`/api/serve/${token}?${qs}`).then((r) => setFound(r.people), toastError);
    }, 200);
    return () => clearTimeout(t);
  }, [q, token, info?.served]);

  if (bad)
    return (
      <Shell>
        <div className="py-24 text-center">
          <h1 className="text-lg font-semibold">Link not valid</h1>
          <p className="mt-1 text-sm text-muted">{bad}</p>
        </div>
      </Shell>
    );
  if (!info)
    return (
      <Shell>
        <div className="flex justify-center py-24">
          <Spinner />
        </div>
      </Shell>
    );

  const current = info.meals.find((m) => m.key === info.meal);
  const left = Math.max(0, info.expected - info.served);
  const pct = info.expected ? Math.min(100, Math.round((info.served / info.expected) * 100)) : 0;

  return (
    <Shell>
      <header className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs text-muted">
              {info.event.name} · {info.kitchen ? `${info.kitchen} kitchen` : "serving"}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">{current?.name ?? "Meals"}</h1>
            <div className="text-sm text-muted">
              {info.day === info.today ? "Today" : dayName(info.day)} · {current?.from}–{current?.to}
            </div>
          </div>
          <input
            type="date"
            value={info.day}
            onChange={(e) => e.target.value && setDay(e.target.value)}
            className="rounded-xl border border-line bg-surface px-2 py-1.5 text-sm"
            aria-label="Day"
          />
        </div>
        <div className="flex rounded-xl border border-line bg-surface p-1 text-sm">
          {info.meals.map((m) => (
            <button key={m.key} onClick={() => setMeal(m.key)} className={cx("flex-1 rounded-lg py-1.5", info.meal === m.key ? "bg-ink text-white" : "text-muted")}>
              {m.name}
            </button>
          ))}
        </div>
      </header>

      <section className="mt-4 rounded-3xl border border-line bg-surface p-5">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-5xl font-semibold tabular-nums tracking-tight">{info.served}</div>
            <div className="mt-1 text-sm text-muted">served{info.expected ? ` · ${left} still to eat` : ""}</div>
          </div>
          <div className="text-right text-sm text-muted">of {info.expected}</div>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-good transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </div>
      </section>

      {info.dishes[info.meal] && (
        <section className="mt-4 rounded-3xl border border-line bg-surface px-5 py-4">
          <div className="text-xs text-muted">On the menu</div>
          <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-base font-medium">
            {info.dishes[info.meal]!
              .split(/[\n,;]+/)
              .map((d) => d.trim())
              .filter(Boolean)
              .map((d, i, all) => (
                <span key={i}>
                  {d}
                  {i < all.length - 1 && <span className="ml-2 text-muted">·</span>}
                </span>
              ))}
          </div>
        </section>
      )}

      <section className="mt-4 overflow-hidden rounded-3xl border border-line bg-black">
        {scanning ? <Camera onCode={(code) => serve({ code })} /> : <div className="aspect-[4/3]" />}
        <div className="flex items-center justify-between bg-surface px-4 py-2.5 text-sm">
          <span className="text-muted">{scanning ? "Hold the card's QR code up to the camera" : "Camera off"}</span>
          <button onClick={() => setScanning((s) => !s)} className="rounded-full border border-line px-3 py-1 text-xs">
            {scanning ? "Pause" : "Start camera"}
          </button>
        </div>
      </section>

      {shown && (
        <div
          role="status"
          className={cx(
            "pop fixed inset-x-3 top-3 z-50 rounded-3xl p-5 text-white shadow-2xl",
            shown.tone === "good" ? "bg-good" : shown.tone === "warn" ? "bg-[#b5761a]" : "bg-danger",
          )}
        >
          <div className="text-2xl font-semibold leading-tight">
            {shown.tone === "bad" ? "✕ " : "✓ "}
            {shown.title}
          </div>
          {shown.sub && <div className="mt-1 text-white/85">{shown.sub}</div>}
          {(shown.child || !!shown.diet?.length) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {shown.child && <span className="rounded-lg bg-white/20 px-2.5 py-1 text-sm font-medium">Child portion</span>}
              {shown.diet?.map((d) => (
                <span key={d} className="rounded-lg bg-white px-2.5 py-1 text-sm font-semibold text-ink">
                  {d}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="No card? Find their name"
        className="mt-4 w-full rounded-2xl border border-line bg-surface px-4 py-3 text-sm outline-none focus:border-ink/30"
      />
      {q.trim().length >= 2 && (
        <ul className="mt-2 divide-y divide-line/70 rounded-3xl border border-line bg-surface">
          {found.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">No one by that name.</li>}
          {found.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{p.full_name}</div>
                <div className="text-xs text-muted">
                  {p.served_at ? `Had ${current?.name.toLowerCase()} at ${time(p.served_at)}` : p.here ? p.church : `Eats with ${p.church}`}
                </div>
              </div>
              <button
                disabled={!!p.served_at}
                onClick={async () => {
                  const r = await serve({ rid: p.id });
                  if (r) setQ("");
                }}
                className="shrink-0 rounded-full bg-ink px-4 py-2 text-sm font-medium text-white disabled:bg-surface-2 disabled:text-muted"
              >
                {p.served_at ? "Served" : "Serve"}
              </button>
            </li>
          ))}
        </ul>
      )}

      {info.recent.length > 0 && (
        <div className="mt-5">
          <div className="mb-1.5 text-xs text-muted">Just served</div>
          <ul className="space-y-1 text-sm">
            {info.recent.map((r, i) => (
              <li key={i} className="flex justify-between">
                <span>{r.full_name}</span>
                <span className="tabular-nums text-muted">{time(r.served_at)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Shell>
  );
}

/** Back camera, scanning continuously; the same card isn't read twice within a few seconds. */
function Camera({ onCode }: { onCode: (code: string) => Promise<unknown> }) {
  const { videoRef, state } = useCamera(true, "environment");
  const recent = useRef(new Map<string, number>());
  const busy = useRef(false);
  const onCodeRef = useRef(onCode);
  useEffect(() => {
    onCodeRef.current = onCode;
  }, [onCode]);
  useEffect(() => {
    if (state !== "ready") return;
    let alive = true;
    const video = videoRef.current!;
    const c = document.createElement("canvas");
    (async () => {
      while (alive) {
        if (!busy.current && video.videoWidth) {
          const scale = Math.min(1, 720 / video.videoWidth);
          c.width = video.videoWidth * scale;
          c.height = video.videoHeight * scale;
          const ctx = c.getContext("2d", { willReadFrequently: true })!;
          ctx.drawImage(video, 0, 0, c.width, c.height);
          const hit = jsQR(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height, { inversionAttempts: "attemptBoth" });
          const code = hit?.data?.trim();
          if (code && Date.now() - (recent.current.get(code) ?? 0) > 5000) {
            recent.current.set(code, Date.now());
            busy.current = true;
            await onCodeRef.current(code).finally(() => (busy.current = false));
          }
        }
        await new Promise((r) => setTimeout(r, 120));
      }
    })();
    return () => {
      alive = false;
    };
  }, [state, videoRef]);
  return (
    <div className="relative aspect-[4/3]">
      <video ref={videoRef} playsInline muted className="absolute inset-0 size-full object-cover" />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="size-44 rounded-3xl border-2 border-white/80" />
      </div>
      {state !== "ready" && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white/80">
          {state === "denied" ? "Camera access was blocked. Allow it in the browser, or search names below." : state === "unavailable" ? "No camera here. Search names below." : "Starting camera…"}
        </div>
      )}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid-bg min-h-dvh px-4 pb-10 pt-6">
      <div className="mx-auto max-w-md">{children}</div>
      <div className="mx-auto mt-8 flex max-w-md justify-center opacity-50">
        <Logo />
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Station />
    </Suspense>
  );
}
