"use client";

import { useEffect, useRef, useState } from "react";
import { drawOverlay, nextFrame, sleep, useCamera } from "@/components/camera";
import { api, Avatar, Button, cx, Spinner } from "@/components/ui";
import { describe, faceThumbnail, grabFrame, loadFaceApi, observe, warmFaceEngine, type FaceObservation } from "@/lib/face/engine";
import { pose } from "@/lib/face/geometry";
import { assessQuality } from "@/lib/face/quality";

export type Sample = { descriptor: number[]; quality: number; pose: string; thumb: string };

// Guided poses give the matcher a little angular and expression variety.
// Yaw is in raw camera pixels: the subject's own left turn pushes it UP.
const POSES = [
  { key: "front", title: "Look straight ahead", test: (f: FaceObservation) => Math.abs(pose(f).yaw - 0.5) < 0.07 },
  { key: "left", title: "Turn slightly to your left", test: (f: FaceObservation) => pose(f).yaw > 0.58 && pose(f).yaw < 0.72 },
  { key: "right", title: "Turn slightly to your right", test: (f: FaceObservation) => pose(f).yaw < 0.42 && pose(f).yaw > 0.28 },
  { key: "smile", title: "Now a smile", test: (f: FaceObservation) => Math.abs(pose(f).yaw - 0.5) < 0.1 && (f.expressions.happy ?? 0) > 0.7 },
  { key: "front2", title: "Straight ahead, relaxed face", test: (f: FaceObservation) => Math.abs(pose(f).yaw - 0.5) < 0.07 && (f.expressions.happy ?? 0) < 0.5 },
] as const;

const HOLD_FRAMES = 4;
export const MIN_SAMPLES = 3;

type Dup = { id: string; code: string; full_name: string; avatar: string | null; distance: number };

export default function EnrollCapture({ personId, personName, onDone }: { personId: string; personName: string; onDone: () => void }) {
  useEffect(() => warmFaceEngine(), []);
  const [mode, setMode] = useState<"camera" | "upload">("camera");
  const [samples, setSamples] = useState<(Sample | null)[]>(Array(POSES.length).fill(null));
  const [consent, setConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [dup, setDup] = useState<Dup | null>(null);
  const [avatar, setAvatar] = useState<string | null>(null);

  const filled = samples.filter(Boolean) as Sample[];

  const save = async (force = false) => {
    setSaving(true);
    setErr("");
    try {
      await api(`/api/admin/people/${personId}/enroll`, {
        method: "POST",
        json: {
          samples: filled.map(({ descriptor, quality, pose }) => ({ descriptor, quality: Math.min(1, quality), pose })),
          avatar: avatar ?? undefined,
          consent: true,
          force,
        },
      });
      onDone();
    } catch (e) {
      const data = (e as { data?: { duplicate?: Dup } }).data;
      if (data?.duplicate) setDup(data.duplicate);
      else setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="inline-flex rounded-full border border-line bg-surface p-1 text-sm">
        {(["camera", "upload"] as const).map((m) => (
          <button
            key={m}
            onClick={() => {
              setMode(m);
              setSamples(Array(POSES.length).fill(null));
              setAvatar(null);
            }}
            className={cx("rounded-full px-4 py-1.5 transition", mode === m ? "bg-ink text-white" : "text-muted hover:text-ink")}
          >
            {m === "camera" ? "Live camera" : "Upload photos"}
          </button>
        ))}
      </div>

      {mode === "camera" ? (
        <CameraCapture
          samples={samples}
          onCapture={(i, s, thumb) => {
            setSamples((prev) => prev.map((x, j) => (j === i ? s : x)));
            if (i === 0 || !avatar) setAvatar(thumb);
          }}
        />
      ) : (
        <UploadCapture
          onSamples={(list, thumb) => {
            setSamples([...list, ...Array(Math.max(0, POSES.length - list.length)).fill(null)].slice(0, POSES.length));
            setAvatar(thumb);
          }}
        />
      )}

      {/* Captured strip */}
      <div className="flex flex-wrap gap-2">
        {samples.map((s, i) => (
          <div key={i} className="relative">
            <div className={cx("size-16 overflow-hidden rounded-xl border", s ? "border-good" : "hatch border-dashed border-line bg-surface-2")}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {s && <img src={s.thumb} alt="" className={cx("size-full object-cover", s.pose !== "upload" && "-scale-x-100")} />}
            </div>
            {s && (
              <button
                onClick={() => setSamples((prev) => prev.map((x, j) => (j === i ? null : x)))}
                className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-ink text-[10px] text-white"
                aria-label="Retake"
              >
                ✕
              </button>
            )}
            <div className="mt-1 text-center text-[10px] text-muted">{mode === "camera" ? POSES[i].key : `#${i + 1}`}</div>
          </div>
        ))}
      </div>

      <label className="flex items-start gap-2.5 text-sm">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 size-4 accent-[var(--ink)]" />
        <span>
          {personName} agrees to their face being used for attendance.
        </span>
      </label>

      {err && <p className="text-sm text-danger">{err}</p>}

      {dup && (
        <div className="rounded-2xl border border-accent/30 bg-accent/5 p-4">
          <div className="flex items-center gap-3">
            <Avatar src={dup.avatar} name={dup.full_name} size={44} />
            <div className="flex-1 text-sm">
              <div className="font-medium">This face looks like {dup.full_name} ({dup.code})</div>
              <div className="text-muted">
                Distance {dup.distance.toFixed(3)}. Enrolling both may cause mix-ups — they&apos;ll be asked to use a QR badge if the
                kiosk can&apos;t tell them apart.
              </div>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Button variant="ghost" onClick={() => setDup(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={saving} onClick={() => save(true)}>
              They&apos;re different people — enroll anyway
            </Button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={() => save(false)} loading={saving} disabled={!consent || filled.length < MIN_SAMPLES || !!dup}>
          Save {filled.length} photo{filled.length === 1 ? "" : "s"}
        </Button>
        <span className="text-xs text-muted">
          {filled.length < MIN_SAMPLES ? `At least ${MIN_SAMPLES} photos` : ""}
        </span>
      </div>
    </div>
  );
}

function CameraCapture({ samples, onCapture }: { samples: (Sample | null)[]; onCapture: (i: number, s: Sample, thumb: string) => void }) {
  const { videoRef, state } = useCamera(true);
  const overlay = useRef<HTMLCanvasElement>(null);
  const [hint, setHint] = useState("Loading face models…");
  const [ready, setReady] = useState(false);
  const [flash, setFlash] = useState(false);
  const samplesRef = useRef(samples);
  const onCaptureRef = useRef(onCapture);
  useEffect(() => {
    samplesRef.current = samples;
    onCaptureRef.current = onCapture;
  }, [samples, onCapture]);

  const current = samples.findIndex((s) => !s);

  useEffect(() => {
    if (state !== "ready") return;
    let alive = true;
    const video = videoRef.current!;
    const canvas = document.createElement("canvas");
    let hold = 0;
    let lastIdx = -1;
    (async () => {
      await loadFaceApi(setHint);
      if (!alive) return;
      setReady(true);
      while (alive) {
        const idx = samplesRef.current.findIndex((s) => !s);
        if (idx === -1) {
          drawOverlay(overlay.current, video, null);
          setHint("All set — review and save below");
          await sleep(300);
          continue;
        }
        if (idx !== lastIdx) {
          hold = 0;
          lastIdx = idx;
        }
        const faces = await observe(video);
        if (!alive) return;
        const f = faces[0];
        if (!f) {
          drawOverlay(overlay.current, video, null);
          setHint("Step into the frame");
          hold = 0;
          await nextFrame();
          continue;
        }
        const q = assessQuality(video, f, { minSize: 0.2 });
        const poseOk = POSES[idx].test(f);
        const ok = q.ok && poseOk && faces.length === 1;
        drawOverlay(overlay.current, video, f, ok ? "good" : "bad");
        setHint(faces.length > 1 ? "Only one person in frame" : !q.ok ? q.issues[0] : poseOk ? "Hold it…" : POSES[idx].title);
        hold = ok ? hold + 1 : 0;
        if (hold >= HOLD_FRAMES) {
          hold = 0;
          const frame = grabFrame(video, canvas);
          const d = await describe(frame);
          if (d?.descriptor) {
            const thumb = faceThumbnail(frame, d.box);
            setFlash(true);
            setTimeout(() => setFlash(false), 180);
            onCaptureRef.current(idx, { descriptor: d.descriptor, quality: q.score, pose: POSES[idx].key, thumb }, thumb);
            await sleep(500);
          }
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [state, videoRef]);

  return (
    <div className="grid gap-4 md:grid-cols-[1fr_220px]">
      <div className="relative aspect-[4/3] overflow-hidden rounded-3xl bg-[#2b2d2f]">
        <video ref={videoRef} playsInline muted className="absolute inset-0 size-full -scale-x-100 object-cover" />
        <canvas ref={overlay} className="absolute inset-0 size-full -scale-x-100 object-cover" />
        <div className={cx("pointer-events-none absolute inset-0 bg-white transition-opacity duration-150", flash ? "opacity-70" : "opacity-0")} />
        <div className="absolute inset-x-0 bottom-0 flex justify-center p-4">
          <span className="flex items-center gap-2 rounded-full bg-surface px-4 py-2 text-sm font-medium shadow-lg">
            {!ready && state !== "denied" && state !== "unavailable" && <Spinner className="size-3.5" />}
            {state === "denied" ? "Camera access is blocked" : state === "unavailable" ? "No camera available" : hint}
          </span>
        </div>
      </div>
      <ol className="space-y-1.5 text-sm">
        {POSES.map((p, i) => (
          <li
            key={p.key}
            className={cx(
              "flex items-center gap-2.5 rounded-xl px-3 py-2",
              i === current ? "bg-ink text-white" : samples[i] ? "text-good" : "text-muted",
            )}
          >
            <span className={cx("flex size-5 items-center justify-center rounded-full text-[10px]", samples[i] ? "bg-good text-white" : i === current ? "bg-white/20" : "border border-line")}>
              {samples[i] ? "✓" : i + 1}
            </span>
            {p.title}
          </li>
        ))}
      </ol>
    </div>
  );
}

function UploadCapture({ onSamples }: { onSamples: (s: Sample[], thumb: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    const out: Sample[] = [];
    const msgs: string[] = [];
    await loadFaceApi();
    for (const file of Array.from(files).slice(0, 5)) {
      const r = await analysePhoto(file);
      if ("error" in r) msgs.push(`${file.name}: ${r.error}`);
      else out.push(r);
    }
    setNotes(msgs);
    onSamples(out, out[0]?.thumb ?? null);
    setBusy(false);
  };

  return (
    <div className="rounded-3xl border border-dashed border-line bg-surface p-6 text-center">
      <p className="text-sm text-muted">3–5 photos of one person</p>
      <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm text-white">
        {busy && <Spinner className="size-3.5" />}
        Choose photos
        <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />
      </label>
      {notes.length > 0 && (
        <ul className="mt-3 space-y-1 text-left text-xs text-danger">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Shared with bulk import: decode, check, describe one photo. */
export async function analysePhoto(file: Blob): Promise<Sample | { error: string }> {
  if (file.size > 15 * 1024 * 1024) return { error: "file too large" };
  try {
    // createImageBitmap decodes off the main thread (and honours EXIF rotation).
    const img = await createImageBitmap(file, { imageOrientation: "from-image" });
    // Downscale huge photos: faster and the detector doesn't need 12 MP.
    const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    img.close();
    const faces = await observe(c);
    if (faces.length === 0) return { error: "no face found" };
    if (faces.length > 1) return { error: "more than one face" };
    const q = assessQuality(c, faces[0], { minSize: 0.08 });
    const blocking = q.issues.filter((i) => !/closer|Center/.test(i));
    if (blocking.length) return { error: blocking[0].toLowerCase() };
    const d = await describe(c);
    if (!d?.descriptor) return { error: "couldn't read the face" };
    return { descriptor: d.descriptor, quality: q.score, pose: "upload", thumb: faceThumbnail(c, d.box) };
  } catch {
    return { error: "not a readable image" };
  }
}
