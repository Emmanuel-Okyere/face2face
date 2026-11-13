"use client";

import jsQR from "jsqr";
import { useParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useCamera } from "@/components/camera";
import { ask, toast, toastError } from "@/components/feedback";
import { api, cx, Logo, MoreMenu, Spinner } from "@/components/ui";

type Trip = "out" | "back";
type Person = {
  id: string;
  name: string;
  seat: number | null;
  church: string;
  phone: string | null;
  via: string | null;
  assignedHere: boolean;
  assignedBus: string | null;
  status: "missing" | "on" | "skipped" | "elsewhere";
  boardedBus: string | null;
  at: string | null;
};
type Data = { bus: { name: string; seats: number; pickup: string | null; departs: string | null; event: string }; trip: Trip; people: Person[]; sms: boolean };
type Tab = "missing" | "on" | "skipped";

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** The bus captain's page: scan or tap people on, see who's missing, call or text them. */
function Board() {
  const { token } = useParams<{ token: string }>();
  const [trip, setTrip] = useState<Trip>("out");
  const [d, setD] = useState<Data | null>(null);
  const [bad, setBad] = useState("");
  const [tab, setTab] = useState<Tab>("missing");
  const [q, setQ] = useState("");
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState("");
  const [church, setChurch] = useState("");

  const load = useCallback(
    () =>
      api<Data>(`/api/board/${token}?trip=${trip}`)
        .then(setD)
        .catch((e) => setBad(e.message)),
    [token, trip],
  );
  useEffect(() => {
    load();
    const t = setInterval(load, 8000); // other captains / admins boarding people too
    return () => clearInterval(t);
  }, [load]);

  /** Board, skip or undo; asks first when someone belongs on another bus. */
  const act = async (action: "board" | "skip" | "undo", who: { rid?: string; code?: string }, force = false): Promise<{ name: string; seat: number | null; already: boolean } | null> => {
    try {
      const r = await api<{ name: string; seat: number | null; already: boolean }>(`/api/board/${token}`, { method: "POST", json: { trip, action, force, ...who } });
      load();
      return r;
    } catch (e) {
      const data = (e as { data?: { code?: string; name?: string; assignedBus?: string } }).data;
      if (data?.code === "other_bus") {
        const ok = await ask({ title: `${data.name}'s seat is on ${data.assignedBus}`, body: "Board them on this bus anyway?", confirm: "Board here" });
        return ok ? act(action, who, true) : null;
      }
      throw e;
    }
  };

  if (bad)
    return (
      <Shell>
        <div className="py-24 text-center">
          <h1 className="text-lg font-semibold">Link not valid</h1>
          <p className="mt-1 text-sm text-muted">{bad}</p>
        </div>
      </Shell>
    );
  if (!d)
    return (
      <Shell>
        <div className="flex justify-center py-24">
          <Spinner />
        </div>
      </Shell>
    );

  const mine = d.people.filter((p) => p.assignedHere || p.status === "on");
  const on = d.people.filter((p) => p.status === "on");
  const missing = mine.filter((p) => p.assignedHere && (p.status === "missing" || p.status === "elsewhere"));
  const skipped = mine.filter((p) => p.status === "skipped");
  const expected = mine.filter((p) => p.assignedHere && p.status !== "skipped").length + on.filter((p) => !p.assignedHere).length;
  // A bus carrying several churches: each church's count, and a filter so leaders can chase their own people.
  const churches = [...new Set(mine.map((p) => p.church))].sort();
  const byChurch = churches.map((c) => ({ c, on: on.filter((p) => p.church === c).length, of: mine.filter((p) => p.church === c && p.status !== "skipped").length }));
  const ofChurch = (list: Person[]) => (church ? list.filter((p) => p.church === church) : list);
  const lists: Record<Tab, Person[]> = { missing: ofChurch(missing), on: ofChurch(on), skipped: ofChurch(skipped) };
  const needle = q.trim().toLowerCase();
  const shown = needle ? d.people.filter((p) => p.name.toLowerCase().includes(needle)) : lists[tab];
  const pct = expected ? Math.round((on.length / expected) * 100) : 0;

  return (
    <Shell>
      <header className="space-y-3">
        <div>
          <div className="text-xs text-muted">{d.bus.event}</div>
          <h1 className="text-2xl font-semibold tracking-tight">{d.bus.name}</h1>
          <div className="text-sm text-muted">{[d.bus.pickup, d.bus.departs].filter(Boolean).join(" · ")}</div>
        </div>
        <div className="flex rounded-xl border border-line bg-surface p-1 text-sm">
          {(
            [
              ["out", "Going"],
              ["back", "Return"],
            ] as const
          ).map(([t, l]) => (
            <button key={t} onClick={() => (setTrip(t), setD(null))} className={cx("flex-1 rounded-lg py-1.5", trip === t ? "bg-ink text-white" : "text-muted")}>
              {l}
            </button>
          ))}
        </div>
      </header>

      <section className="mt-4 rounded-3xl border border-line bg-surface p-5">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-5xl font-semibold tabular-nums tracking-tight">
              {on.length}
              <span className="text-2xl font-normal text-muted"> / {expected}</span>
            </div>
            <div className="mt-1 text-sm text-muted">
              on board
              {missing.length > 0 && <span className="font-medium text-[#9a5f0c]"> · {missing.length} missing</span>}
              {skipped.length > 0 && ` · ${skipped.length} not coming`}
            </div>
          </div>
          {missing.length === 0 && expected > 0 && <div className="text-sm font-medium text-[#2e7d4f]">Everyone&apos;s here</div>}
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-good transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button onClick={() => setScanning(true)} className="rounded-2xl bg-ink py-3 font-medium text-white active:scale-[0.99]">
            Scan passes
          </button>
          <button
            disabled={!d.sms || !lists.missing.length || busy === "sms"}
            onClick={async () => {
              const ok = await ask({
                title: `Text the ${lists.missing.length} missing${church ? ` from ${church}` : ""}?`,
                body: `Each gets: “${d.bus.name} is about to leave${d.bus.pickup ? ` from ${d.bus.pickup}` : ""}. … not on board yet — please come now.”`,
                confirm: "Send SMS",
              });
              if (!ok) return;
              setBusy("sms");
              try {
                const r = await api<{ sent: number; noPhone?: number }>(`/api/board/${token}`, { method: "POST", json: { trip, action: "sms", church: church || undefined } });
                toast(`${r.sent} SMS sent${r.noPhone ? ` · ${r.noPhone} have no phone` : ""}`);
              } catch (e) {
                toastError(e);
              } finally {
                setBusy("");
              }
            }}
            className="rounded-2xl border border-line py-3 font-medium disabled:opacity-40"
            title={d.sms ? undefined : "SMS isn't set up"}
          >
            SMS missing
          </button>
        </div>
      </section>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Find someone by name"
        className="mt-4 w-full rounded-2xl border border-line bg-surface px-4 py-3 text-sm outline-none focus:border-ink/30"
      />

      {!needle && churches.length > 1 && (
        <div className="-mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 text-sm">
          {[{ c: "", on: on.length, of: expected }, ...byChurch].map((x) => (
            <button
              key={x.c}
              onClick={() => setChurch(x.c)}
              className={cx("shrink-0 rounded-xl border px-3 py-1.5", church === x.c ? "border-ink bg-ink text-white" : "border-line bg-surface", x.of > 0 && x.on >= x.of && church !== x.c && "text-[#2e7d4f]")}
            >
              {x.c || "All"} <span className="tabular-nums opacity-70">{x.on}/{x.of}</span>
            </button>
          ))}
        </div>
      )}

      {!needle && (
        <div className="mt-3 flex gap-1 text-sm">
          {(
            [
              ["missing", `Missing ${lists.missing.length}`],
              ["on", `On board ${lists.on.length}`],
              ["skipped", `Not coming ${lists.skipped.length}`],
            ] as const
          ).map(([t, l]) => (
            <button key={t} onClick={() => setTab(t)} className={cx("rounded-full px-3 py-1.5", tab === t ? "bg-ink text-white" : "text-muted")}>
              {l}
            </button>
          ))}
        </div>
      )}

      <ul className="mt-2 divide-y divide-line/70 rounded-3xl border border-line bg-surface">
        {shown.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted">{needle ? "No one by that name on this bus." : tab === "missing" ? "No one is missing." : "No one yet."}</li>}
        {shown.map((p) => (
          <li key={p.id} className="flex items-center gap-2 px-3 py-3 sm:gap-3 sm:px-4">
            <span className="w-6 shrink-0 text-center text-xs tabular-nums text-muted">{p.seat ?? "–"}</span>
            <div className="min-w-0 flex-1">
              <div className="font-medium leading-snug">{p.name}</div>
              <div className="truncate text-xs text-muted">
                {p.status === "on"
                  ? `On board ${p.at ? time(p.at) : ""}${!p.assignedHere && p.assignedBus ? ` · seat was on ${p.assignedBus}` : ""}`
                  : p.status === "elsewhere"
                    ? `Boarded ${p.boardedBus}`
                    : [p.church, p.via && `via ${p.via}`].filter(Boolean).join(" · ")}
              </div>
            </div>
            {p.status !== "on" && p.phone && (
              <a href={`tel:${p.phone}`} className="flex size-9 shrink-0 items-center justify-center rounded-full border border-line text-ink/70" aria-label={`Call ${p.via ?? p.name}`}>
                <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden>
                  <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z" />
                </svg>
              </a>
            )}
            {p.status === "on" ? (
              <button
                onClick={async () => {
                  setBusy(p.id);
                  await act("undo", { rid: p.id }).catch(toastError);
                  setBusy("");
                }}
                disabled={busy === p.id}
                className="shrink-0 rounded-lg px-2 py-1 text-xs text-muted"
              >
                Undo
              </button>
            ) : (
              <>
                <button
                  onClick={async () => {
                    setBusy(p.id);
                    const r = await act("board", { rid: p.id }).catch((e) => (toastError(e), null));
                    if (r) toast(`${r.name} on board${r.seat ? ` · seat ${r.seat}` : ""}`);
                    setBusy("");
                  }}
                  disabled={busy === p.id}
                  className="shrink-0 rounded-full bg-ink px-3.5 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  Board
                </button>
                {p.status !== "skipped" && (
                  <MoreMenu items={[{ label: "Not coming on this bus", onClick: () => act("skip", { rid: p.id }).then((r) => r && toast(`${r.name} marked not coming`), toastError) }]} />
                )}
              </>
            )}
          </li>
        ))}
      </ul>

      {scanning && <Scanner trip={trip} onBoard={act} onClose={() => setScanning(false)} count={on.length} expected={expected} />}
    </Shell>
  );
}

/** Full-screen back-camera scanner: keeps scanning, one beep/buzz per person. */
function Scanner({
  onBoard,
  onClose,
  count,
  expected,
}: {
  trip: Trip;
  onBoard: (a: "board", who: { code: string }) => Promise<{ name: string; seat: number | null; already: boolean } | null>;
  onClose: () => void;
  count: number;
  expected: number;
}) {
  const { videoRef, state } = useCamera(true, "environment");
  const [last, setLast] = useState<{ tone: "good" | "warn" | "bad"; text: string } | null>(null);
  const recent = useRef(new Map<string, number>());
  const paused = useRef(false);

  useEffect(() => {
    if (state !== "ready") return;
    let alive = true;
    const video = videoRef.current!;
    const c = document.createElement("canvas");
    const show = (tone: "good" | "warn" | "bad", text: string) => {
      setLast({ tone, text });
      navigator.vibrate?.(tone === "good" ? 60 : [40, 60, 40]);
    };
    (async () => {
      while (alive) {
        if (!paused.current && video.videoWidth) {
          const scale = Math.min(1, 720 / video.videoWidth);
          c.width = video.videoWidth * scale;
          c.height = video.videoHeight * scale;
          const ctx = c.getContext("2d", { willReadFrequently: true })!;
          ctx.drawImage(video, 0, 0, c.width, c.height);
          const img = ctx.getImageData(0, 0, c.width, c.height);
          const hit = jsQR(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" });
          const code = hit?.data?.trim();
          // The same pass held in front of the camera isn't re-sent for a few seconds.
          if (code && Date.now() - (recent.current.get(code) ?? 0) > 4000) {
            recent.current.set(code, Date.now());
            paused.current = true;
            try {
              const r = await onBoard("board", { code });
              if (r) show(r.already ? "warn" : "good", r.already ? `${r.name} is already on board` : `${r.name}${r.seat ? ` · seat ${r.seat}` : ""}`);
            } catch (e) {
              show("bad", (e as Error).message);
            } finally {
              paused.current = false;
            }
          }
        }
        await new Promise((res) => setTimeout(res, 120));
      }
    })();
    return () => {
      alive = false;
    };
  }, [state, videoRef, onBoard]);

  useEffect(() => {
    if (!last) return;
    const t = setTimeout(() => setLast(null), 2200);
    return () => clearTimeout(t);
  }, [last]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="text-sm">
          <span className="text-xl font-semibold tabular-nums">{count}</span>
          <span className="text-white/60"> / {expected} on board</span>
        </div>
        <button onClick={onClose} className="rounded-full bg-white/15 px-4 py-2 text-sm font-medium">
          Done
        </button>
      </div>
      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} playsInline muted className="absolute inset-0 size-full object-cover" />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="size-64 max-w-[70vw] rounded-3xl border-2 border-white/80 shadow-[0_0_0_100vmax_rgba(0,0,0,0.35)]" />
        </div>
        {state !== "ready" && (
          <div className="absolute inset-0 flex items-center justify-center p-8 text-center text-sm text-white/80">
            {state === "denied" ? "Camera access was blocked. Allow it in your browser settings, or tap names in the list instead." : state === "unavailable" ? "No camera available. Tap names in the list instead." : "Starting camera…"}
          </div>
        )}
      </div>
      <div className="min-h-24 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4">
        {last ? (
          <div
            className={cx(
              "rounded-2xl px-4 py-3 text-center text-base font-medium",
              last.tone === "good" ? "bg-good text-white" : last.tone === "warn" ? "bg-warn text-white" : "bg-danger text-white",
            )}
          >
            {last.tone === "good" ? "✓ " : ""}
            {last.text}
          </div>
        ) : (
          <p className="text-center text-sm text-white/70">Point the camera at a pass QR code</p>
        )}
      </div>
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
      <Board />
    </Suspense>
  );
}
