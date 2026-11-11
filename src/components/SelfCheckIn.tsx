"use client";

import { useEffect, useRef, useState } from "react";
import { chime, drawOverlay, nextFrame, sleep, useCamera } from "@/components/camera";
import { Avatar, Button, Input, OrgLogo, Spinner, cx } from "@/components/ui";
import { describe, distance, loadFaceApi, mean, observe, warmFaceEngine } from "@/lib/face/engine";
import { STEP_COPY, StepDetector, type StepType } from "@/lib/face/liveness";
import { assessQuality } from "@/lib/face/quality";

type Info = {
  org: { name: string; logoUrl: string | null };
  mode: "personal" | "shared";
  firstName?: string;
  idLabel?: string;
  service: string | null; // open now
  next: string | null;
  locationRequired: boolean;
};

/** The phone's current position (only asked for when the organization requires it). */
function getLocation(): Promise<{ lat: number; lng: number; accuracy: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("This phone can't share its location."));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => reject(new Error("Allow location access to check in.")),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  });
}
type Result =
  | {
      result: "checked_in" | "already";
      person: { full_name: string; code: string; group_name: string | null; avatar: string | null };
      at: string;
      late: boolean;
      rank: number;
      streak: number;
    }
  | { result: "not_you" | "liveness_failed" | "no_service"; reason?: string };

type Stage =
  | { k: "loading" }
  | { k: "invalid"; msg: string }
  | { k: "intro" }
  | { k: "scan"; hint: string; steps?: StepType[]; idx?: number; capturing?: boolean }
  | { k: "verifying" }
  | { k: "result"; r: Result };

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default function SelfCheckIn({ slug, k, p }: { slug: string; k: string | null; p: string | null }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [stage, setStage] = useState<Stage>({ k: "loading" });
  // Load the face engine while they read the intro, so the camera starts ready.
  useEffect(() => warmFaceEngine(), []);
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState<{ token: string; steps: StepType[] } | null>(null);

  useEffect(() => {
    const qs = new URLSearchParams({ ...(k ? { k } : {}), ...(p ? { p } : {}) });
    fetch(`/api/checkin/${encodeURIComponent(slug)}?${qs}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        setInfo(d);
        setStage({ k: "intro" });
      })
      .catch((e) => setStage({ k: "invalid", msg: e.message || "This link isn't valid." }));
  }, [slug, k, p]);

  const start = async () => {
    setBusy(true);
    setErr("");
    try {
      const location = info?.locationRequired ? await getLocation() : undefined;
      const r = await fetch(`/api/checkin/${encodeURIComponent(slug)}/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...(p ? { p } : { k, code: code.trim() }), location }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setChallenge({ token: d.token, steps: d.steps });
      setStage({ k: "scan", hint: "Getting the camera ready…" });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const title = info?.firstName ? `${greeting()}, ${info.firstName}` : greeting();

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      {/* Green header, like the mobile reference */}
      <header className="rounded-b-[28px] bg-good px-5 pb-8 pt-6 text-white">
        <div className="mx-auto max-w-md">
          <div className="flex items-center gap-2">
            {info && (
              <span className="rounded-xl bg-white p-1 shadow-sm">
                <OrgLogo src={info.org.logoUrl} name={info.org.name} size={28} />
              </span>
            )}
            <div className="text-xs uppercase tracking-wider text-white/80">{info?.org.name ?? "Check-in"}</div>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-white/80">
            {new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}
          </p>
        </div>
      </header>

      <main className="mx-auto -mt-5 w-full max-w-md flex-1 px-4 pb-8">
        {stage.k === "loading" && (
          <Panel>
            <div className="flex justify-center py-10">
              <Spinner />
            </div>
          </Panel>
        )}

        {stage.k === "invalid" && (
          <Panel>
            <p className="text-lg font-medium">Link not valid</p>
            <p className="mt-1 text-sm text-muted">{stage.msg}</p>
          </Panel>
        )}

        {stage.k === "intro" && info && !info.service && (
          <Panel>
            <p className="text-lg font-medium">No service right now</p>
            {info.next && <p className="mt-1 text-sm text-muted">Next: {info.next}</p>}
          </Panel>
        )}

        {stage.k === "intro" && info?.service && (
          <Panel>
            <p className="text-lg font-medium">{info.service}</p>
            {info.mode === "shared" && (
              <label className="mt-5 block space-y-1.5">
                <span className="text-xs font-medium text-muted">Your {info.idLabel ?? "ID"}</span>
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="e.g. K7QM-4XHT"
                  autoCapitalize="characters"
                  autoComplete="off"
                  className="py-3 text-base"
                />
              </label>
            )}
            {err && <p className="mt-3 text-sm text-danger">{err}</p>}
            <Button variant="good" className="mt-5 w-full py-3 text-base" onClick={start} loading={busy} disabled={info.mode === "shared" && !code.trim()}>
              Check in with my face
            </Button>
          </Panel>
        )}

        {(stage.k === "scan" || stage.k === "verifying") && challenge && (
          <Scanner
            slug={slug}
            challenge={challenge}
            stage={stage}
            onStage={setStage}
          />
        )}

        {stage.k === "result" && <ResultPanel r={stage.r} onRetry={() => setStage({ k: "intro" })} />}
      </main>
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="card-shadow rounded-3xl bg-surface p-6">{children}</div>;
}

function Scanner({
  slug,
  challenge,
  stage,
  onStage,
}: {
  slug: string;
  challenge: { token: string; steps: StepType[] };
  stage: Stage;
  onStage: (s: Stage) => void;
}) {
  const { videoRef, state: cam } = useCamera(true);
  const overlay = useRef<HTMLCanvasElement>(null);
  const onStageRef = useRef(onStage);
  useEffect(() => {
    onStageRef.current = onStage;
  }, [onStage]);

  useEffect(() => {
    if (cam !== "ready") return;
    let alive = true;
    const video = videoRef.current!;
    const set = (s: Stage) => alive && onStageRef.current(s);
    (async () => {
      await loadFaceApi((msg) => set({ k: "scan", hint: msg }));
      // 1. Steady, good-quality frontal face → anchor.
      let good = 0;
      let anchor: number[] | null = null;
      while (alive && !anchor) {
        const faces = await observe(video);
        const f = faces[0];
        if (!f) {
          drawOverlay(overlay.current, video, null);
          set({ k: "scan", hint: "Hold your phone at eye level" });
          good = 0;
          await nextFrame();
          continue;
        }
        const q = assessQuality(video, f, { requireFrontal: true, minSize: 0.25 });
        const ok = q.ok && faces.length === 1;
        drawOverlay(overlay.current, video, f, ok ? "good" : "bad");
        set({ k: "scan", hint: faces.length > 1 ? "Only you in the frame, please" : ok ? "Hold still…" : q.issues[0] });
        good = ok ? good + 1 : 0;
        if (good >= 5) anchor = (await describe(video))?.descriptor ?? null;
      }
      // 2. Liveness steps.
      const log: { type: StepType; ms: number }[] = [];
      for (let i = 0; alive && i < challenge.steps.length; i++) {
        const det = new StepDetector(challenge.steps[i]);
        const t0 = performance.now();
        set({ k: "scan", hint: "", steps: challenge.steps, idx: i });
        let done = false;
        while (alive && !done) {
          if (performance.now() - t0 > 10_000) {
            set({ k: "result", r: { result: "liveness_failed", reason: "Took too long — let's try again." } });
            return;
          }
          const f = (await observe(video))[0];
          drawOverlay(overlay.current, video, f ?? null, "good");
          if (f && det.update(f)) {
            done = true;
            log.push({ type: challenge.steps[i], ms: Math.round(performance.now() - t0) });
            chime("ok");
          }
        }
      }
      // 3. Frontal captures, each compared with the anchor.
      set({ k: "scan", hint: "Great smile — hold still…", capturing: true });
      const caps: { d: number[]; q: number }[] = [];
      let consistency = 0;
      const t1 = performance.now();
      while (alive && caps.length < 3) {
        if (performance.now() - t1 > 8000) {
          set({ k: "result", r: { result: "liveness_failed", reason: "Couldn't get a clear look — try again in better light." } });
          return;
        }
        const f = (await observe(video))[0];
        if (!f) continue;
        const q = assessQuality(video, f, { requireFrontal: true, minSize: 0.25 });
        drawOverlay(overlay.current, video, f, q.ok ? "good" : "bad");
        if (!q.ok) continue;
        const s = await describe(video);
        if (s?.descriptor && anchor) {
          consistency = Math.max(consistency, distance(s.descriptor, anchor));
          caps.push({ d: s.descriptor, q: q.score });
        }
        await sleep(60);
      }
      if (!alive) return;
      set({ k: "verifying" });
      const res = await fetch(`/api/checkin/${encodeURIComponent(slug)}/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: challenge.token,
          descriptor: mean(caps.map((c) => c.d)),
          liveness: { steps: log, consistency: Math.min(2, consistency), frames: caps.length, quality: caps.reduce((s, c) => s + c.q, 0) / caps.length },
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) set({ k: "result", r: { result: "liveness_failed", reason: d.error || "Something went wrong" } });
      else {
        chime(d.result === "checked_in" || d.result === "already" ? "ok" : "warn");
        set({ k: "result", r: d });
      }
    })();
    return () => {
      alive = false;
    };
  }, [cam, videoRef, challenge, slug]);

  const step = stage.k === "scan" && stage.steps && stage.idx !== undefined ? stage.steps[stage.idx] : null;

  return (
    <div className="space-y-4">
      <div className="card-shadow relative aspect-[3/4] overflow-hidden rounded-[28px] bg-[#2b2d2f]">
        <video ref={videoRef} playsInline muted className="absolute inset-0 size-full -scale-x-100 object-cover" />
        <canvas ref={overlay} className="absolute inset-0 size-full -scale-x-100 object-cover" />
        {cam !== "ready" && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-white/80">
            {cam === "starting" ? <Spinner className="size-6 text-white" /> : cam === "denied" ? "Allow camera access to check in, then reload." : "No camera available on this device."}
          </div>
        )}
        {stage.k === "verifying" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <Spinner className="size-8 text-white" />
          </div>
        )}
      </div>
      <div className="card-shadow rounded-2xl bg-surface px-5 py-4 text-center">
        {step ? (
          <div className="flex items-center justify-center gap-3">
            <span className="pop flex size-11 items-center justify-center rounded-xl bg-good-soft text-xl text-good" key={step}>
              {STEP_COPY[step].icon}
            </span>
            <div className="text-left">
              <div className="font-semibold">{STEP_COPY[step].title}</div>
              <div className="text-xs text-muted">{STEP_COPY[step].hint}</div>
            </div>
          </div>
        ) : (
          <p className="font-medium">{stage.k === "verifying" ? "Checking…" : stage.k === "scan" ? stage.hint : ""}</p>
        )}
      </div>
    </div>
  );
}

function ResultPanel({ r, onRetry }: { r: Result; onRetry: () => void }) {
  if ("person" in r) {
    const time = new Date(r.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return (
      <Panel>
        <div className="pop text-center">
          <div className="mx-auto mb-3 w-fit rounded-full ring-4 ring-good/40">
            <Avatar src={r.person.avatar} name={r.person.full_name} size={84} />
          </div>
          <div className="text-2xl font-semibold tracking-tight">{r.person.full_name}</div>
          <div className="text-sm text-muted">{r.person.code}</div>
          <div className="mt-5 grid grid-cols-2 gap-3 text-left">
            <div className="rounded-2xl bg-good-soft/60 p-4">
              <div className="text-xs text-good">Check in</div>
              <div className="text-2xl font-semibold tabular-nums">{time}</div>
            </div>
            <div className="rounded-2xl bg-surface-2 p-4">
              <div className="text-xs text-muted">Status</div>
              <div className="text-lg font-semibold">{r.result === "already" ? "Already in" : r.late ? "Late" : "On time"}</div>
            </div>
          </div>
        </div>
      </Panel>
    );
  }
  return (
    <Panel>
      <div className="shake text-center">
        <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-warn/15 text-xl text-warn">!</div>
        <div className="text-lg font-semibold">
          {r.result === "not_you" ? "We couldn't verify you" : r.result === "no_service" ? "Check-in is closed" : "Let's try that again"}
        </div>
        <p className={cx("mt-1 text-sm text-muted")}>{r.reason}</p>
        <Button className="mt-5 w-full" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </Panel>
  );
}
