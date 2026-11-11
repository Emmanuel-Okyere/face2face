import type { FaceObservation } from "./engine";
import { pose, type Pose } from "./geometry";

export type Quality = {
  ok: boolean;
  score: number; // 0..1 composite
  issues: string[]; // human-friendly, most important first
  metrics: { size: number; offset: number; brightness: number; sharpness: number; detection: number } & Pose;
};

export type QualityOptions = {
  requireFrontal?: boolean;
  minSize?: number; // face width / frame width
};

const SHARPNESS_MIN = 28;

const scratch = typeof document !== "undefined" ? document.createElement("canvas") : null;

/**
 * Cheap capture-quality gate run on every frame: detector confidence, face size,
 * centring, exposure, blur (variance of Laplacian on the face crop) and pose.
 * Only frames that pass are ever turned into descriptors.
 */
export function assessQuality(
  frame: HTMLCanvasElement | HTMLVideoElement | HTMLImageElement,
  face: FaceObservation,
  opts: QualityOptions = {},
): Quality {
  const fw = "videoWidth" in frame ? frame.videoWidth : "naturalWidth" in frame ? frame.naturalWidth : frame.width;
  const fh = "videoHeight" in frame ? frame.videoHeight : "naturalHeight" in frame ? frame.naturalHeight : frame.height;
  const { box } = face;
  const size = box.width / fw;
  const cx = (box.x + box.width / 2) / fw - 0.5;
  const cy = (box.y + box.height / 2) / fh - 0.5;
  const offset = Math.hypot(cx, cy);
  // The worker sends these with each observation; compute locally only as a fallback.
  const { brightness, sharpness } = face.pixel ?? pixelStats(frame, box);
  const p = pose(face);

  const issues: string[] = [];
  const minSize = opts.minSize ?? 0.18;
  if (face.score < 0.7) issues.push("Face not clear — look at the camera");
  if (size < minSize) issues.push("Move a little closer");
  if (size > 0.75) issues.push("Move back a little");
  if (offset > 0.22) issues.push("Center your face in the frame");
  if (brightness < 55) issues.push("Too dark — find more light");
  if (brightness > 215) issues.push("Too bright — avoid direct light");
  if (sharpness < SHARPNESS_MIN) issues.push("Hold still — image is blurry");
  if (Math.abs(p.roll) > 16) issues.push("Keep your head level");
  if (opts.requireFrontal && Math.abs(p.yaw - 0.5) > 0.1) issues.push("Look straight at the camera");

  const clamp = (x: number) => Math.max(0, Math.min(1, x));
  const score =
    0.25 * clamp((face.score - 0.5) / 0.5) +
    0.2 * clamp(size / 0.35) +
    0.15 * clamp(1 - offset / 0.3) +
    0.15 * clamp(1 - Math.abs(brightness - 130) / 110) +
    0.15 * clamp(sharpness / 120) +
    0.1 * clamp(1 - Math.abs(p.yaw - 0.5) / 0.3);

  return {
    ok: issues.length === 0,
    score: Math.round(score * 1000) / 1000,
    issues,
    metrics: { size, offset, brightness, sharpness, detection: face.score, ...p },
  };
}

function pixelStats(frame: CanvasImageSource, box: FaceObservation["box"]) {
  if (!scratch) return { brightness: 128, sharpness: 100 };
  const N = 96;
  scratch.width = scratch.height = N;
  const ctx = scratch.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(frame, box.x, box.y, box.width, box.height, 0, 0, N, N);
  const { data } = ctx.getImageData(0, 0, N, N);
  const g = new Float32Array(N * N);
  let sum = 0;
  for (let i = 0; i < N * N; i++) {
    const v = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    g[i] = v;
    sum += v;
  }
  const brightness = sum / (N * N);
  // Variance of the 4-neighbour Laplacian — low means blurry (or a flat, re-photographed print).
  let lsum = 0;
  let lsq = 0;
  let n = 0;
  for (let y = 1; y < N - 1; y++) {
    for (let x = 1; x < N - 1; x++) {
      const i = y * N + x;
      const l = g[i - 1] + g[i + 1] + g[i - N] + g[i + N] - 4 * g[i];
      lsum += l;
      lsq += l * l;
      n++;
    }
  }
  const m = lsum / n;
  return { brightness, sharpness: lsq / n - m * m };
}
