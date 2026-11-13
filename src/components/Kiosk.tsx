"use client";

import jsQR from "jsqr";
import { useCallback, useEffect, useRef, useState } from "react";
import { chime, drawOverlay, nextFrame, sleep, useCamera } from "@/components/camera";
import { Avatar, Button, cx, OrgLogo, Spinner } from "@/components/ui";
import { describe, distance, loadFaceApi, mean, observe, warmFaceEngine, type FaceObservation } from "@/lib/face/engine";
import { STEP_COPY, StepDetector, type StepType } from "@/lib/face/liveness";
import { assessQuality } from "@/lib/face/quality";

type CheckIn = {
  result: "checked_in" | "already";
  person: { id: string; code: string; full_name: string; group_name: string | null; avatar: string | null };
  at: string;
  method: "face" | "qr" | "manual" | "visitor";
  late: boolean;
  rank: number;
  streak: number;
  visitor?: boolean; // from the visitor form
  visits?: number;
};
type Outcome =
  | CheckIn
  | { result: "unknown" | "ambiguous" }
  | { result: "liveness_failed" | "bad_qr" | "error" | "no_service"; reason?: string; next?: string | null };

type Phase =
  | { k: "loading"; msg: string }
  | { k: "idle"; hint: string }
  | { k: "challenge"; steps: StepType[]; idx: number; hint?: string }
  | { k: "capturing" }
  | { k: "verifying" }
  | { k: "result"; outcome: Outcome }
  | { k: "qr" }
  | { k: "visitor" };

const STEP_TIMEOUT = 8000;
const GOOD_FRAMES_TO_START = 5;
const CAPTURE_FRAMES = 3;

function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}
function firstName(n: string) {
  return n.split(/\s+/)[0];
}

export default function Kiosk({
  kioskName,
  orgName,
  logoUrl,
  allowQr = true,
  voice = false,
  service,
}: {
  kioskName: string;
  orgName: string;
  logoUrl: string | null;
  allowQr?: boolean;
  voice?: boolean; // spoken greeting, set by an admin on the Kiosks page
  service?: string; // e.g. "Sunday Service · until 12:00"
}) {
  const { videoRef, state: cam } = useCamera(true);
  // Load the face engine while the camera permission prompt is up, not after.
  useEffect(() => warmFaceEngine(), []);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [phase, _setPhase] = useState<Phase>({ k: "loading", msg: "Starting…" });
  const phaseRef = useRef<Phase>(phase);
  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p;
    _setPhase(p);
  }, []);
  const [feed, setFeed] = useState<{ name: string; at: string; avatar: string | null }[]>([]);
  const [count, setCount] = useState(0);
  const voiceRef = useRef(false);
  useEffect(() => {
    voiceRef.current = voice;
  }, [voice]);
  const [now, setNow] = useState<Date>(() => new Date());
  const resultTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clock + screen wake lock (kiosks shouldn't doze off).
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    let lock: { release(): Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> } };
    nav.wakeLock?.request("screen").then((l) => (lock = l)).catch(() => {});
    return () => {
      clearInterval(t);
      lock?.release().catch(() => {});
    };
  }, []);

  const toIdle = useCallback(() => setPhase({ k: "idle", hint: "Step up to the camera" }), [setPhase]);

  const showResult = useCallback(
    (outcome: Outcome, holdMs?: number) => {
      setPhase({ k: "result", outcome });
      if ("person" in outcome) {
        chime("ok");
        if (outcome.result === "checked_in") {
          setCount((c) => c + 1);
          setFeed((f) => [{ name: firstName(outcome.person.full_name), at: outcome.at, avatar: outcome.person.avatar }, ...f].slice(0, 6));
        }
        if (voiceRef.current && "speechSynthesis" in window) {
          const u = new SpeechSynthesisUtterance(
            outcome.result === "already"
              ? `You're already checked in, ${firstName(outcome.person.full_name)}`
              : `${greeting()}, ${firstName(outcome.person.full_name)}`,
          );
          u.rate = 1.05;
          speechSynthesis.cancel();
          speechSynthesis.speak(u);
        }
      } else {
        chime(outcome.result === "unknown" || outcome.result === "ambiguous" ? "warn" : "error");
      }
      if (resultTimer.current) clearTimeout(resultTimer.current);
      resultTimer.current = setTimeout(() => {
        if (phaseRef.current.k === "result") toIdle();
      }, holdMs ?? ("person" in outcome ? 4200 : 6500));
    },
    [setPhase, toIdle],
  );

  // ── Face pipeline ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (cam !== "ready") return;
    let alive = true;
    const video = videoRef.current!;

    // Per-attempt state lives here, outside React, so the loop never sees stale values.
    let good = 0;
    let anchor: number[] | null = null;
    let token = "";
    let detector: StepDetector | null = null;
    let stepStart = 0;
    let lostSince = 0;
    let stepLog: { type: StepType; ms: number }[] = [];
    let captures: { d: number[]; q: number }[] = [];
    let captureStart = 0;
    let consistency = 0;

    const reset = () => {
      good = 0;
      anchor = null;
      detector = null;
      stepLog = [];
      captures = [];
      consistency = 0;
      lostSince = 0;
    };

    (async () => {
      try {
        await loadFaceApi((msg) => alive && setPhase({ k: "loading", msg }));
      } catch {
        if (alive) setPhase({ k: "loading", msg: "Couldn't load the face models. Check the connection and reload." });
        return;
      }
      if (!alive) return;
      toIdle();

      while (alive) {
        const p = phaseRef.current;
        if (p.k !== "idle" && p.k !== "challenge" && p.k !== "capturing") {
          drawOverlay(overlayRef.current, video, null);
          reset();
          await sleep(120);
          continue;
        }

        const faces = await observe(video);
        if (!alive) break;
        const face: FaceObservation | null = faces[0] ?? null;
        const multi = faces.length > 1;

        if (p.k === "idle") {
          if (!face) {
            drawOverlay(overlayRef.current, video, null);
            good = 0;
            if (p.hint !== "Step up to the camera") setPhase({ k: "idle", hint: "Step up to the camera" });
            await sleep(80);
            continue;
          }
          const q = assessQuality(video, face, { requireFrontal: true });
          const hint = multi ? "One person at a time, please" : q.ok ? "Hold still…" : q.issues[0];
          drawOverlay(overlayRef.current, video, face, q.ok && !multi ? "good" : "bad");
          good = q.ok && !multi ? good + 1 : 0;
          if (hint !== p.hint) setPhase({ k: "idle", hint });

          if (good >= GOOD_FRAMES_TO_START) {
            // Anchor descriptor: who started the challenge must be who finishes it.
            const snap = await describe(video);
            if (!snap?.descriptor) {
              good = 0;
              continue;
            }
            anchor = snap.descriptor;
            try {
              const res = await fetch("/api/kiosk/challenge", { cache: "no-store" });
              if (res.status === 409) {
                // The service closed while they were stepping up.
                const d = await res.json().catch(() => ({}));
                showResult({ result: "no_service", next: d.next ?? null });
                continue;
              }
              if (!res.ok) throw new Error();
              const ch = (await res.json()) as { token: string; steps: StepType[] };
              token = ch.token;
              detector = new StepDetector(ch.steps[0]);
              stepStart = performance.now();
              setPhase({ k: "challenge", steps: ch.steps, idx: 0 });
            } catch {
              showResult({ result: "error", reason: "Can't reach the server" });
            }
          }
          continue;
        }

        if (p.k === "challenge" && detector) {
          drawOverlay(overlayRef.current, video, face, "good");
          if (!face || multi) {
            lostSince ||= performance.now();
            if (performance.now() - lostSince > 1500) {
              showResult({ result: "liveness_failed", reason: multi ? "One person at a time, please" : "Lost you — let's start again" }, 3500);
            }
            continue;
          }
          lostSince = 0;
          if (detector.update(face)) {
            const ms = Math.round(performance.now() - stepStart);
            stepLog.push({ type: p.steps[p.idx], ms });
            const idx = p.idx + 1;
            if (idx >= p.steps.length) {
              captureStart = performance.now();
              setPhase({ k: "capturing" });
            } else {
              chime("ok");
              detector = new StepDetector(p.steps[idx]);
              stepStart = performance.now();
              setPhase({ ...p, idx });
            }
          } else if (performance.now() - stepStart > STEP_TIMEOUT) {
            showResult({ result: "liveness_failed", reason: "Took too long — let's try again" }, 3500);
          }
          continue;
        }

        if (p.k === "capturing") {
          if (!face || multi) {
            drawOverlay(overlayRef.current, video, face, "bad");
          } else {
            const q = assessQuality(video, face, { requireFrontal: true });
            drawOverlay(overlayRef.current, video, face, q.ok ? "good" : "bad");
            if (q.ok) {
              const snap = await describe(video);
              if (snap?.descriptor && anchor) {
                consistency = Math.max(consistency, distance(snap.descriptor, anchor));
                captures.push({ d: snap.descriptor, q: q.score });
              }
            }
          }
          if (captures.length >= CAPTURE_FRAMES) {
            setPhase({ k: "verifying" });
            const avg = mean(captures.map((c) => c.d));
            const quality = captures.reduce((s, c) => s + c.q, 0) / captures.length;
            const body = {
              token,
              descriptor: avg,
              liveness: { steps: stepLog, consistency: Math.min(2, consistency), frames: captures.length, quality },
            };
            try {
              const res = await fetch("/api/kiosk/checkin", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(body),
              });
              const data = await res.json();
              if (!res.ok) throw new Error(data.error);
              if (alive) showResult(data as Outcome);
            } catch (e) {
              if (alive) showResult({ result: "error", reason: (e as Error).message || "Network error" });
            }
          } else if (performance.now() - captureStart > 6000) {
            showResult({ result: "liveness_failed", reason: "Couldn't get a clear look — try again" }, 3500);
          }
          continue;
        }
        await nextFrame();
      }
    })();

    return () => {
      alive = false;
    };
  }, [cam, videoRef, setPhase, showResult, toIdle]);

  // ── QR pipeline ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase.k !== "qr" || cam !== "ready") return;
    let alive = true;
    const video = videoRef.current!;
    const c = document.createElement("canvas");
    const timeout = setTimeout(() => alive && phaseRef.current.k === "qr" && toIdle(), 30_000);
    (async () => {
      while (alive) {
        const scale = Math.min(1, 640 / video.videoWidth);
        c.width = video.videoWidth * scale;
        c.height = video.videoHeight * scale;
        const ctx = c.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(video, 0, 0, c.width, c.height);
        const img = ctx.getImageData(0, 0, c.width, c.height);
        const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" });
        if (code?.data) {
          setPhase({ k: "verifying" });
          try {
            const res = await fetch("/api/kiosk/qr", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ token: code.data }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            showResult(data as Outcome);
          } catch (e) {
            showResult({ result: "error", reason: (e as Error).message || "Network error" });
          }
          return;
        }
        await sleep(140);
      }
    })();
    return () => {
      alive = false;
      clearTimeout(timeout);
    };
  }, [phase.k, cam, videoRef, setPhase, showResult, toIdle]);

  // ── Render ────────────────────────────────────────────────────────────────
  const ring =
    phase.k === "challenge" || phase.k === "capturing" || phase.k === "verifying"
      ? "ring-good/60"
      : phase.k === "result" && "person" in phase.outcome
        ? "ring-good"
        : phase.k === "result"
          ? "ring-warn/70"
          : "ring-surface";

  return (
    <div className="grid-bg relative flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <OrgLogo src={logoUrl} name={orgName} size={44} />
          <div>
            <div className="text-lg font-semibold leading-tight tracking-tight">{orgName}</div>
            {service && <div className="text-sm text-good">{service}</div>}
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl tabular-nums tracking-tight">
            {now?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) ?? "—"}
          </div>
          <div className="text-xs text-muted">
            {now?.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })} · {kioskName}
          </div>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-6xl flex-1 gap-6 px-4 pb-6 lg:grid-cols-[1fr_280px]">
        <section className="flex flex-col items-center justify-center gap-5">
          <div className={cx("card-shadow relative aspect-[4/3] w-full max-w-3xl overflow-hidden rounded-[32px] bg-[#2b2d2f] ring-[6px] transition-all duration-500", ring)}>
            <video ref={videoRef} playsInline muted className="absolute inset-0 size-full -scale-x-100 object-cover" />
            <canvas ref={overlayRef} className="absolute inset-0 size-full -scale-x-100 object-cover" />
            {phase.k === "qr" && <QrFrame />}
            {(phase.k === "challenge" || phase.k === "capturing") && (
              <div className="pointer-events-none absolute inset-0 overflow-hidden">
                <div className="scanline absolute inset-x-0 h-1/3 bg-gradient-to-b from-transparent via-good/10 to-transparent" />
              </div>
            )}
            {cam !== "ready" && <CameraMessage state={cam} />}
            {phase.k === "result" && (
              <ResultCard outcome={phase.outcome} onQr={allowQr ? () => setPhase({ k: "qr" }) : undefined} onVisitor={() => setPhase({ k: "visitor" })} />
            )}
            {phase.k === "visitor" && <VisitorForm orgName={orgName} onCancel={toIdle} onDone={(o) => showResult(o, 6000)} />}
          </div>

          {cam === "ready" || cam === "starting" ? <Instruction phase={phase} /> : null}

          <div className="flex flex-wrap items-center justify-center gap-2">
            {phase.k === "qr" || phase.k === "visitor" ? (
              <Button variant="ghost" onClick={toIdle}>
                ← Back to face check-in
              </Button>
            ) : (
              <>
                {allowQr && (
                  <Button variant="ghost" onClick={() => setPhase({ k: "qr" })} disabled={cam !== "ready"}>
                    <QrIcon /> Use QR badge instead
                  </Button>
                )}
                <Button variant="ghost" onClick={() => setPhase({ k: "visitor" })}>
                  I&apos;m visiting
                </Button>
              </>
            )}
          </div>
        </section>

        <aside className="hidden flex-col gap-4 lg:flex">
          <div className="card-shadow rounded-2xl border border-line/70 bg-surface p-5">
            <div className="text-xs text-muted">Checked in here</div>
            <div className="mt-1 text-5xl font-normal tabular-nums tracking-tight">{count}</div>
          </div>
          {feed.length > 0 && (
            <div className="card-shadow flex-1 rounded-2xl border border-line/70 bg-surface p-5">
              <div className="mb-3 text-xs text-muted">Just arrived</div>
              <ul className="space-y-3">
                {feed.map((f, i) => (
                  <li key={f.at + i} className={cx("flex items-center gap-3", i === 0 && "pop")}>
                    <Avatar src={f.avatar} name={f.name} size={32} />
                    <span className="flex-1 truncate text-sm">{f.name}</span>
                    <span className="font-mono text-xs text-muted">
                      {new Date(f.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}

function Instruction({ phase }: { phase: Phase }) {
  if (phase.k === "loading")
    return (
      <p className="flex items-center gap-2 text-muted">
        <Spinner /> {phase.msg}
      </p>
    );
  if (phase.k === "idle")
    return <p className="rounded-full bg-surface px-5 py-2 text-xl font-medium tracking-tight card-shadow">{phase.hint}</p>;
  if (phase.k === "qr") return <p className="text-2xl font-medium tracking-tight">Hold your badge QR code up to the camera</p>;
  if (phase.k === "capturing") return <p className="text-2xl font-medium tracking-tight">Great smile — hold still…</p>;
  if (phase.k === "verifying")
    return (
      <p className="flex items-center gap-3 text-2xl font-medium tracking-tight">
        <Spinner className="size-6 text-good" /> Checking…
      </p>
    );
  if (phase.k === "challenge") {
    const step = phase.steps[phase.idx];
    const copy = STEP_COPY[step];
    return (
      <div className="flex items-center gap-5">
        <div className="pop flex size-16 items-center justify-center rounded-2xl bg-good/15 text-3xl text-good" key={step}>
          {copy.icon}
        </div>
        <div>
          <div className="text-2xl font-semibold tracking-tight">{copy.title}</div>
          <div className="text-sm text-muted">{copy.hint}</div>
        </div>
        <div className="ml-4 flex gap-1.5">
          {phase.steps.map((s, i) => (
            <span key={s} className={cx("h-1.5 w-8 rounded-full", i < phase.idx ? "bg-good" : i === phase.idx ? "bg-good/50" : "bg-line")} />
          ))}
        </div>
      </div>
    );
  }
  return <p className="text-2xl">&nbsp;</p>;
}

/** "I'm visiting": name, optional phone and who invited them — then they're checked in. */
function VisitorForm({ orgName, onCancel, onDone }: { orgName: string; onCancel: () => void; onDone: (o: Outcome) => void }) {
  const [f, setF] = useState({ full_name: "", phone: "", invited_by: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  // An abandoned form goes back to face check-in by itself.
  useEffect(() => {
    const t = setTimeout(onCancel, 90_000);
    return () => clearTimeout(t);
  }, [f, onCancel]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/kiosk/visitor", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(f) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong");
      onDone(data as Outcome);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  const input = "w-full rounded-2xl border border-line bg-surface px-4 py-3 text-lg outline-none focus:border-ink/40";
  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-y-auto bg-black/40 p-4 backdrop-blur-sm">
      <form onSubmit={submit} className="pop w-[min(100%,460px)] space-y-4 rounded-3xl bg-surface p-6 shadow-2xl">
        <div>
          <div className="text-2xl font-semibold tracking-tight">Welcome to {orgName}!</div>
          <p className="text-sm text-muted">Tell us your name and we&apos;ll check you in.</p>
        </div>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-muted">Your name</span>
          <input required autoFocus autoComplete="name" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} className={input} />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-muted">Phone (optional)</span>
          <input type="tel" inputMode="tel" autoComplete="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="024 123 4567" className={input} />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-muted">Who invited you? (optional)</span>
          <input value={f.invited_by} onChange={(e) => setF({ ...f, invited_by: e.target.value })} className={input} />
        </label>
        {err && <p className="text-sm text-danger">{err}</p>}
        <div className="flex gap-2">
          <Button type="button" variant="ghost" className="flex-1 py-3" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" className="flex-1 py-3" loading={busy}>
            Check me in
          </Button>
        </div>
      </form>
    </div>
  );
}

function ResultCard({ outcome, onQr, onVisitor }: { outcome: Outcome; onQr?: () => void; onVisitor?: () => void }) {
  if ("person" in outcome) {
    const p = outcome.person;
    const already = outcome.result === "already";
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm">
        <div className="pop w-[min(92%,440px)] rounded-3xl bg-surface p-7 text-center shadow-2xl">
          <div className="mx-auto mb-4 w-fit rounded-full ring-4 ring-good/50">
            <Avatar src={p.avatar} name={p.full_name} size={96} />
          </div>
          <div className="text-sm text-muted">{outcome.visitor ? "Welcome" : already ? "Welcome back" : greeting()}</div>
          <div className="text-3xl font-semibold tracking-tight">{p.full_name}</div>
          <div className="mt-1 text-sm text-muted">
            {outcome.visitor ? (
              (outcome.visits ?? 1) <= 1 ? "First visit — we're glad you came" : `Visit ${outcome.visits} — good to see you again`
            ) : (
              <>
                {p.code}
                {p.group_name ? ` · ${p.group_name}` : ""}
              </>
            )}
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-sm">
            <span className={already ? "text-muted" : "font-medium text-good"}>
              {already ? "Already checked in at " : "Checked in at "}
              {new Date(outcome.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
            {!already && outcome.late && <Chip tone="danger">Late</Chip>}
          </div>
        </div>
      </div>
    );
  }
  const copy: Record<string, { title: string; body: string }> = {
    unknown: {
      title: "We didn't recognise you",
      body: `If you're enrolled, try again with your face well lit${onQr ? " — or scan your QR badge" : ", or ask an admin"}.`,
    },
    ambiguous: {
      title: "Not quite sure it's you",
      body: `You look a lot like someone else. ${onQr ? "Please scan your QR badge to be safe." : "Please ask an admin to check you in."}`,
    },
    liveness_failed: { title: "Let's try that again", body: "" },
    bad_qr: { title: "Badge not accepted", body: "" },
    no_service: { title: "Check-in is closed", body: "next" in outcome && outcome.next ? `Next: ${outcome.next}` : "" },
    error: { title: "Something went wrong", body: "" },
  };
  const c = copy[outcome.result];
  const reason = "reason" in outcome ? outcome.reason : undefined;
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="shake w-[min(92%,440px)] rounded-3xl bg-surface p-7 text-center shadow-2xl">
        <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-full bg-warn/15 text-2xl text-warn">!</div>
        <div className="text-2xl font-semibold tracking-tight">{c.title}</div>
        <p className="mt-2 text-sm text-muted">{reason || c.body}</p>
        {(outcome.result === "unknown" || outcome.result === "ambiguous") && (
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {onQr && (
              <Button onClick={onQr}>
                <QrIcon /> Scan QR badge
              </Button>
            )}
            {onVisitor && outcome.result === "unknown" && (
              <Button variant="ghost" onClick={onVisitor}>
                First time here?
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Chip({ tone, children }: { tone: "accent" | "info" | "warn" | "danger" | "muted"; children: React.ReactNode }) {
  // Same language as the admin labels, a size up for the kiosk screen.
  const c = {
    accent: "bg-good/[0.11] text-[#2e7d4f]",
    info: "bg-info/[0.13] text-[#4458b8]",
    warn: "bg-warn/[0.13] text-[#9a5f0c]",
    danger: "bg-accent/[0.09] text-[#c4441a]",
    muted: "bg-surface-2 text-ink/65",
  }[tone];
  return <span className={cx("inline-flex items-center rounded-lg px-2.5 py-1 font-medium", c)}>{children}</span>;
}

function QrFrame() {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="relative size-[55%] max-h-[70%] max-w-[70%] rounded-3xl border-2 border-dashed border-good/70">
        <div className="scanline absolute inset-x-3 h-0.5 bg-good shadow-[0_0_20px_var(--good)]" />
      </div>
    </div>
  );
}

function CameraMessage({ state }: { state: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-8 text-center">
      {state === "starting" ? (
        <>
          <Spinner className="size-6 text-white" />
          <p className="text-white/70">Waiting for camera…</p>
        </>
      ) : state === "denied" ? (
        <>
          <p className="text-lg font-medium text-white">Camera access is blocked</p>
          <p className="max-w-sm text-sm text-muted">Allow camera access, then reload.</p>
        </>
      ) : (
        <>
          <p className="text-lg font-medium text-white">No camera available</p>
          <p className="max-w-sm text-sm text-muted">Connect a camera, then reload.</p>
        </>
      )}
    </div>
  );
}

export function QrIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 17h4v4" />
    </svg>
  );
}
