// Page-side facade for the face engine. All TF.js work happens in
// src/workers/face.worker.ts; this file only ships camera frames there (as
// transferable, downscaled ImageBitmaps) and gets plain numbers back, so the
// main thread — and the live camera preview — never stalls.

export type Pt = { x: number; y: number };
export type FaceObservation = {
  box: { x: number; y: number; width: number; height: number };
  score: number;
  landmarks: Pt[]; // 68 points, in source pixel coordinates
  expressions: Record<string, number>;
  pixel?: { brightness: number; sharpness: number }; // computed in the worker
  descriptor?: number[];
};

export type EngineState = { stage: 0 | 1 | 2; backend?: string; error?: string; status: string };

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: never) => void; reject: (e: Error) => void }>();
let state: EngineState = { stage: 0, status: "Starting vision engine…" };
const listeners = new Set<(s: EngineState) => void>();
let stage1: Promise<void> | null = null;
let stage2Resolve: () => void;
const stage2 = new Promise<void>((r) => (stage2Resolve = r));

function setState(patch: Partial<EngineState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l(state));
}

/** Subscribe to loading progress (for progress UI). Returns an unsubscribe fn. */
export function onEngineState(fn: (s: EngineState) => void) {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("../../workers/face.worker.ts", import.meta.url), { type: "module", name: "face-engine" });
  worker.onmessage = (e: MessageEvent) => {
    const m = e.data;
    if (m.type === "status") return setState({ status: m.msg });
    if (m.type === "stage") {
      setState({ stage: m.stage, backend: m.backend ?? state.backend, status: m.stage === 2 ? "Ready" : "Loading face recognition…" });
      if (m.stage === 2) stage2Resolve();
      return;
    }
    if (m.type === "fatal") return setState({ error: m.error, status: "Couldn't load the face models" });
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.ok) p.resolve(m as never);
    else p.reject(new Error(m.error));
  };
  worker.onerror = (e) => {
    setState({ error: e.message || "Face engine crashed", status: "This browser can't run the face engine. Try an up-to-date Chrome, Edge, Safari or Firefox." });
    pending.forEach((p) => p.reject(new Error("Face engine crashed")));
    pending.clear();
  };
  return worker;
}

function call<T>(msg: Record<string, unknown>, transfer: Transferable[] = []): Promise<T> {
  const w = getWorker();
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: never) => void, reject });
    w.postMessage({ ...msg, id }, transfer);
  });
}

/**
 * Start the engine (idempotent; the worker survives client-side navigation).
 * Resolves once live tracking works (stage 1, ~0.9 MB); recognition keeps
 * loading in the background and `describe()` waits for it automatically.
 */
export function loadFaceApi(onStatus?: (s: string) => void): Promise<void> {
  const unsub = onStatus ? onEngineState((s) => onStatus(s.status)) : null;
  stage1 ??= call<void>({ type: "init" }).catch((e) => {
    stage1 = null;
    throw e;
  });
  return stage1.finally(() => unsub?.());
}

/**
 * Start loading as soon as a camera page opens — in parallel with the camera
 * permission prompt, instead of after it. Safe to call any number of times.
 */
export function warmFaceEngine() {
  if (typeof window === "undefined") return;
  loadFaceApi().catch(() => {}); // errors resurface when the page awaits loadFaceApi()
}

/** Resolves when face signatures (recognition) are available too. */
export function whenRecognitionReady() {
  return stage2;
}

type Input = HTMLVideoElement | HTMLCanvasElement | HTMLImageElement;
function dims(input: Input) {
  if (input instanceof HTMLVideoElement) return { w: input.videoWidth, h: input.videoHeight };
  if (input instanceof HTMLImageElement) return { w: input.naturalWidth, h: input.naturalHeight };
  return { w: input.width, h: input.height };
}

async function snapshot(input: Input, maxWidth: number, quality: ResizeQuality) {
  const { w, h } = dims(input);
  if (!w || !h) throw new Error("No frame yet");
  const scale = Math.min(1, maxWidth / w);
  const bitmap = await createImageBitmap(
    input,
    scale < 1 ? { resizeWidth: Math.round(w * scale), resizeHeight: Math.round(h * scale), resizeQuality: quality } : {},
  );
  return { bitmap, scale };
}

// Cap tracking at ~20 fps: plenty for blink/turn/smile, and it leaves GPU
// headroom so the camera preview (also GPU-composited) never stutters.
const MIN_FRAME_MS = 50;
let lastObserve = 0;

/**
 * Faces in a frame, most prominent first. The first has landmarks, expressions
 * and pixel stats; any others are boxes only (for the "one at a time" warning).
 */
export async function observe(input: Input): Promise<FaceObservation[]> {
  await loadFaceApi();
  const wait = lastObserve + MIN_FRAME_MS - performance.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastObserve = performance.now();
  const { bitmap, scale } = await snapshot(input, 640, "low");
  const r = await call<{ faces: FaceObservation[] }>({ type: "observe", bitmap, scale, maxFaces: 3 }, [bitmap]);
  return r.faces;
}

/** The most prominent face, with its 128-d signature (waits for stage 2 if needed). */
export async function describe(input: Input): Promise<FaceObservation | null> {
  await loadFaceApi();
  const { bitmap, scale } = await snapshot(input, 960, "high");
  const r = await call<{ face: FaceObservation | null }>({ type: "describe", bitmap, scale }, [bitmap]);
  return r.face;
}

export function distance(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s);
}

export function mean(vectors: number[][]): number[] {
  const out = new Array(vectors[0].length).fill(0);
  for (const v of vectors) for (let i = 0; i < v.length; i++) out[i] += v[i] / vectors.length;
  return out;
}

/** Snapshot the current video frame (un-mirrored) onto a canvas — only for thumbnails. */
export function grabFrame(video: HTMLVideoElement, canvas = document.createElement("canvas")) {
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d")!.drawImage(video, 0, 0);
  return canvas;
}

/** Square JPEG thumbnail of a face for the admin UI (≈4–6 KB). */
export function faceThumbnail(source: HTMLCanvasElement | HTMLImageElement, box: FaceObservation["box"], size = 112) {
  const pad = box.width * 0.35;
  const side = Math.max(box.width, box.height) + pad * 2;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  c.getContext("2d")!.drawImage(source, cx - side / 2, cy - side / 2, side, side, 0, 0, size, size);
  return c.toDataURL("image/jpeg", 0.72);
}
