// Copies the face-api model weights into /public/models so they are served
// from the same origin (and cached by Vercel's CDN). Runs on postinstall.
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules/@vladmandic/face-api/model");
const dest = join(root, "public/models");
const wanted = [
  "tiny_face_detector_model", // 190 KB detector (replaces the 5.6 MB SSD one)
  "face_landmark_68_model",
  "face_recognition_model",
  "face_expression_model",
];

if (!existsSync(src)) {
  console.warn("[copy-models] face-api not installed yet, skipping");
  process.exit(0);
}
mkdirSync(dest, { recursive: true });
let n = 0;
for (const f of readdirSync(src)) {
  if (wanted.some((w) => f.startsWith(w))) {
    cpSync(join(src, f), join(dest, f));
    n++;
  }
}
console.log(`[copy-models] copied ${n} files to public/models`);
