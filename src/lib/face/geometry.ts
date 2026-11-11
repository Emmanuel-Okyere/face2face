import type { FaceObservation, Pt } from "./engine";

const d = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Eye aspect ratio (Soukupová & Čech): ~0.3 open, <0.18 closed. */
function ear(p: Pt[]) {
  return (d(p[1], p[5]) + d(p[2], p[4])) / (2 * d(p[0], p[3]));
}

export type Pose = {
  /** 0.5 = frontal. In raw (un-mirrored) camera pixels the subject's own LEFT turn pushes this UP. */
  yaw: number;
  /** Head roll in degrees (eye-line tilt). */
  roll: number;
  /** Mean eye aspect ratio of both eyes. */
  ear: number;
  /** Mouth width / inter-ocular distance; rises when smiling. */
  mouth: number;
};

export function pose(f: FaceObservation): Pose {
  const L = f.landmarks;
  const jawL = L[0];
  const jawR = L[16];
  const nose = L[30];
  const yaw = (nose.x - jawL.x) / Math.max(1, jawR.x - jawL.x);
  const eyeL = centroid(L.slice(36, 42));
  const eyeR = centroid(L.slice(42, 48));
  const roll = (Math.atan2(eyeR.y - eyeL.y, eyeR.x - eyeL.x) * 180) / Math.PI;
  const e = (ear(L.slice(36, 42)) + ear(L.slice(42, 48))) / 2;
  const mouth = d(L[48], L[54]) / Math.max(1, d(eyeL, eyeR));
  return { yaw, roll, ear: e, mouth };
}

function centroid(pts: Pt[]): Pt {
  const s = pts.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 });
  return { x: s.x / pts.length, y: s.y / pts.length };
}
