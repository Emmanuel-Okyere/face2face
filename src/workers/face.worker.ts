/// <reference lib="webworker" />
// Face engine, off the main thread. The page sends ImageBitmaps of camera
// frames; this worker runs TF.js (WebGL on an OffscreenCanvas) and returns plain
// numbers. Model download, shader compilation and every inference happen here,
// so the camera preview and UI never freeze.
//
// Staged loading:
//   stage 1 (~0.9 MB): tiny face detector + 68 landmarks + expressions
//                      → live tracking, quality hints and liveness work
//   stage 2 (~6.4 MB): recognition net → 128-d face signatures
import * as faceapi from "@vladmandic/face-api";
import { modelFiles, modelUrl } from "@/lib/face/models";

declare const self: DedicatedWorkerGlobalScope;

type Req =
  | { id: number; type: "init" }
  | { id: number; type: "observe"; bitmap: ImageBitmap; scale: number; maxFaces: number }
  | { id: number; type: "describe"; bitmap: ImageBitmap; scale: number };

type TF = {
  setBackend(b: string): Promise<boolean>;
  ready(): Promise<void>;
  getBackend(): string;
  browser: { fromPixels(src: ImageBitmap | OffscreenCanvas): { dispose(): void } };
  tidy<T>(fn: () => T): T;
};
const tf = faceapi.tf as unknown as TF;

let stage1: Promise<void> | null = null;
let stage2: Promise<void> | null = null;

// ── Model weights ───────────────────────────────────────────────────────────
// We fetch the weight files ourselves (rather than face-api's loadFromUri) so
// that every file starts downloading the moment the worker starts, in parallel
// with TF.js/WebGL setup — tracking models first, the big recognition model at
// low priority — and through versioned, long-cached URLs.
const downloads = new Map<string, Promise<ArrayBuffer>>();

function download(file: string, low: boolean) {
  const url = modelUrl(file);
  let p = downloads.get(url);
  if (!p) {
    p = fetch(url, { priority: low ? "low" : "high" } as RequestInit).then((r) => {
      if (!r.ok) throw new Error(`${r.status} loading ${file}`);
      return r.arrayBuffer();
    });
    p.catch(() => downloads.delete(url)); // a later retry starts over
    downloads.set(url, p);
  }
  return p;
}

type Manifest = { paths: string[]; weights: Parameters<typeof faceapi.tf.io.decodeWeights>[1] }[];

/** Start downloading a model's files now; resolves to its decoded weights (call after the backend is ready). */
function fetchModel(name: string, low = false) {
  const [manifestFile] = modelFiles(name);
  const manifest = download(manifestFile, low).then((b) => JSON.parse(new TextDecoder().decode(b)) as Manifest);
  const data = manifest.then((m) => Promise.all(m.flatMap((g) => g.paths).map((f) => download(f, low))));
  // Also prefetch the .bin before the manifest arrives (its name is known).
  download(modelFiles(name)[1], low).catch(() => {});
  return async () => {
    const [m, bufs] = await Promise.all([manifest, data]);
    const joined = new Uint8Array(bufs.reduce((n, b) => n + b.byteLength, 0));
    let o = 0;
    for (const b of bufs) {
      joined.set(new Uint8Array(b), o);
      o += b.byteLength;
    }
    return faceapi.tf.io.decodeWeights(joined.buffer, m.flatMap((g) => g.weights));
  };
}

function post(msg: unknown) {
  self.postMessage(msg);
}

/** face-api's environment check looks for `document`; give it a worker-safe one. */
function setWorkerEnv() {
  class Unused {}
  faceapi.env.setEnv({
    Canvas: OffscreenCanvas as unknown as typeof HTMLCanvasElement,
    CanvasRenderingContext2D: OffscreenCanvasRenderingContext2D as unknown as typeof CanvasRenderingContext2D,
    Image: Unused as unknown as typeof HTMLImageElement,
    ImageData,
    Video: Unused as unknown as typeof HTMLVideoElement,
    createCanvasElement: () => new OffscreenCanvas(1, 1) as unknown as HTMLCanvasElement,
    createImageElement: () => {
      throw new Error("no images in worker");
    },
    createVideoElement: () => {
      throw new Error("no video in worker");
    },
    fetch: (url: string, init?: RequestInit) => fetch(url, init),
    readFile: () => {
      throw new Error("readFile not available");
    },
  } as unknown as Parameters<typeof faceapi.env.setEnv>[0]);
}

async function init() {
  if (stage1) return stage1;
  stage1 = (async () => {
    // Downloads begin before anything else, overlapping with backend setup.
    const detector = fetchModel("tiny_face_detector_model");
    const landmarks = fetchModel("face_landmark_68_model");
    const expressions = fetchModel("face_expression_model");
    const recognition = fetchModel("face_recognition_model", true);
    setWorkerEnv();
    let backend = "webgl";
    try {
      if (!(await tf.setBackend("webgl"))) throw new Error();
    } catch {
      backend = "cpu";
      await tf.setBackend("cpu");
    }
    await tf.ready();
    post({ type: "status", msg: "Loading face tracker…" });
    const [d, l, x] = await Promise.all([detector(), landmarks(), expressions()]);
    faceapi.nets.tinyFaceDetector.loadFromWeightMap(d);
    faceapi.nets.faceLandmark68Net.loadFromWeightMap(l);
    faceapi.nets.faceExpressionNet.loadFromWeightMap(x);
    // Compile shaders now (in the worker) instead of on the first real frame.
    const warm = new OffscreenCanvas(160, 160);
    const t = tf.browser.fromPixels(warm);
    await faceapi.detectAllFaces(t as never, new faceapi.TinyFaceDetectorOptions({ inputSize: 160 })).withFaceLandmarks();
    t.dispose();
    post({ type: "stage", stage: 1, backend: tf.getBackend() || backend });

    stage2 = (async () => {
      faceapi.nets.faceRecognitionNet.loadFromWeightMap(await recognition());
      post({ type: "stage", stage: 2 });
    })();
    stage2.catch((e) => post({ type: "fatal", error: String(e) }));
  })();
  return stage1;
}

// Pixel statistics for the quality gate, computed here so the page never calls getImageData.
const statCanvas = new OffscreenCanvas(96, 96);
const statCtx = statCanvas.getContext("2d", { willReadFrequently: true })!;
function pixelStats(bitmap: ImageBitmap, box: { x: number; y: number; width: number; height: number }) {
  const N = 96;
  statCtx.drawImage(bitmap, box.x, box.y, box.width, box.height, 0, 0, N, N);
  const { data } = statCtx.getImageData(0, 0, N, N);
  const g = new Float32Array(N * N);
  let sum = 0;
  for (let i = 0; i < N * N; i++) {
    const v = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    g[i] = v;
    sum += v;
  }
  let ls = 0;
  let lq = 0;
  let n = 0;
  for (let y = 1; y < N - 1; y++)
    for (let x = 1; x < N - 1; x++) {
      const i = y * N + x;
      const l = g[i - 1] + g[i + 1] + g[i - N] + g[i + N] - 4 * g[i];
      ls += l;
      lq += l * l;
      n++;
    }
  const m = ls / n;
  return { brightness: sum / (N * N), sharpness: lq / n - m * m };
}

type Det = {
  detection: { box: { x: number; y: number; width: number; height: number }; score: number };
  landmarks: { positions: { x: number; y: number }[] };
  expressions: Record<string, number>;
  descriptor?: Float32Array;
};

function serialize(r: Det, bitmap: ImageBitmap, scale: number) {
  const b = r.detection.box;
  const box = { x: b.x, y: b.y, width: b.width, height: b.height };
  return {
    // Back to the caller's (unscaled) pixel coordinates.
    box: { x: box.x / scale, y: box.y / scale, width: box.width / scale, height: box.height / scale },
    score: r.detection.score,
    landmarks: r.landmarks.positions.map((p) => ({ x: p.x / scale, y: p.y / scale })),
    expressions: { ...r.expressions },
    pixel: pixelStats(bitmap, box),
    descriptor: r.descriptor ? Array.from(r.descriptor) : undefined,
  };
}

// One inference at a time; requests queue in order.
let queue: Promise<unknown> = Promise.resolve();

self.onmessage = (e: MessageEvent<Req>) => {
  const req = e.data;
  queue = queue.then(async () => {
    try {
      if (req.type === "init") {
        await init();
        return post({ id: req.id, ok: true });
      }
      await init();
      const input = tf.browser.fromPixels(req.bitmap);
      try {
        if (req.type === "observe") {
          const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.45 });
          // 1. Cheap: just boxes, to count faces ("one person at a time").
          const boxes = (await faceapi.detectAllFaces(input as never, opts)) as unknown as Det["detection"][];
          if (!boxes.length) return post({ id: req.id, ok: true, faces: [] });
          // 2. Landmarks + expressions only for the most prominent face.
          const main = (await faceapi
            .detectSingleFace(input as never, opts)
            .withFaceLandmarks()
            .withFaceExpressions()) as unknown as Det | undefined;
          const faces = main ? [serialize(main, req.bitmap, req.scale)] : [];
          // Other faces: box only (enough for the multi-person warning).
          for (const b of boxes
            .filter((b) => !main || Math.abs(b.box.x - main.detection.box.x) > 4 || Math.abs(b.box.y - main.detection.box.y) > 4)
            .slice(0, req.maxFaces - faces.length)) {
            const { x, y, width, height } = b.box;
            faces.push({
              box: { x: x / req.scale, y: y / req.scale, width: width / req.scale, height: height / req.scale },
              score: b.score,
              landmarks: [],
              expressions: {},
              pixel: undefined as never,
              descriptor: undefined,
            });
          }
          post({ id: req.id, ok: true, faces });
        } else {
          await stage2;
          const r = (await faceapi
            .detectSingleFace(input as never, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.45 }))
            .withFaceLandmarks()
            .withFaceExpressions()
            .withFaceDescriptor()) as unknown as Det | undefined;
          post({ id: req.id, ok: true, face: r ? serialize(r, req.bitmap, req.scale) : null });
        }
      } finally {
        input.dispose();
        req.bitmap.close();
      }
    } catch (err) {
      post({ id: req.id, ok: false, error: String((err as Error)?.message || err) });
    }
  });
};
