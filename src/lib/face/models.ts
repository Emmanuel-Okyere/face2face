// Face model weights: where they live and how they're cached. Shared by the
// worker (which loads them) and pages (which warm the browser cache early).
//
// The files are served with `Cache-Control: immutable` for a year, so each
// URL carries the face-api version: a new version means new URLs, and browsers
// never mix old weights with new code. Bump this when upgrading @vladmandic/face-api.
export const MODEL_VERSION = "1.7.15";
export const MODEL_BASE = "/models";

/** Needed for live tracking and liveness (~0.9 MB). */
export const STAGE1_MODELS = ["tiny_face_detector_model", "face_landmark_68_model", "face_expression_model"];
/** Needed to recognise who it is (~6.4 MB). */
export const STAGE2_MODELS = ["face_recognition_model"];

export const modelFiles = (name: string) => [`${name}-weights_manifest.json`, `${name}.bin`];
export const modelUrl = (file: string) => `${MODEL_BASE}/${file}?v=${MODEL_VERSION}`;

/** Every model URL, most urgent first. */
export function allModelUrls() {
  return [...STAGE1_MODELS, ...STAGE2_MODELS].flatMap(modelFiles).map(modelUrl);
}

let prefetched = false;

/**
 * Download the weights into the browser's HTTP cache while the browser is idle,
 * so the camera pages start instantly later. Skipped on data-saver / slow 2G.
 */
export function prefetchFaceModels() {
  if (prefetched || typeof window === "undefined") return;
  prefetched = true;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (conn?.saveData || /2g/.test(conn?.effectiveType ?? "")) return;
  const run = () => {
    for (const url of allModelUrls()) fetch(url, { priority: "low" } as RequestInit).catch(() => {});
  };
  if ("requestIdleCallback" in window) requestIdleCallback(run, { timeout: 4000 });
  else setTimeout(run, 1500);
}
