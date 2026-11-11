"use client";

import { useEffect, useRef, useState } from "react";
import type { FaceObservation } from "@/lib/face/engine";

export type CameraState = "starting" | "ready" | "denied" | "unavailable";

export function useCamera(enabled = true) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<CameraState>("starting");

  useEffect(() => {
    if (!enabled) return;
    let stream: MediaStream | null = null;
    let cancelled = false;
    (async () => {
      setState("starting");
      if (!navigator.mediaDevices?.getUserMedia) return setState("unavailable");
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: "user", width: { ideal: 960 }, height: { ideal: 720 } },
        });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        const v = videoRef.current!;
        v.srcObject = stream;
        await v.play().catch(() => {});
        if (v.readyState < 2) await new Promise((r) => v.addEventListener("loadeddata", r, { once: true }));
        setState("ready");
      } catch (e) {
        setState((e as DOMException)?.name === "NotAllowedError" ? "denied" : "unavailable");
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [enabled]);

  return { videoRef, state };
}

/**
 * Face-capture brackets (thick, rounded, white → green when the frame is good)
 * plus faint landmark dots. Coordinates are raw video pixels; the canvas is
 * mirrored with CSS together with the video.
 */
// Face guide (same for every organization): thick rounded corner brackets —
// white while finding the face, green when the frame is good, amber when the
// person should adjust — plus the 68 tracked landmarks as soft dots.
const GUIDE = {
  good: "#3f9d63",
  adjust: "#d98d1e",
  idle: "#ffffff",
};

export function drawOverlay(
  canvas: HTMLCanvasElement | null,
  video: HTMLVideoElement | null,
  face: FaceObservation | null,
  tone: "good" | "bad" | "idle" = "idle",
) {
  if (!canvas || !video) return;
  if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
  if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!face) return;
  const color = tone === "good" ? GUIDE.good : tone === "bad" ? GUIDE.adjust : GUIDE.idle;
  const { x, y, width: w, height: h } = face.box;
  const pad = w * 0.16;
  const X = x - pad, Y = y - pad * 1.5, W = w + pad * 2, H = h + pad * 2.4;
  const len = Math.min(W, H) * 0.26;
  const r = len * 0.55;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(5, canvas.width / 110);
  ctx.lineCap = "round";
  ctx.shadowColor = "rgba(0,0,0,.25)";
  ctx.shadowBlur = 8;
  const corner = (cx: number, cy: number, dx: number, dy: number) => {
    ctx.beginPath();
    ctx.moveTo(cx, cy + dy * len);
    ctx.arcTo(cx, cy, cx + dx * len, cy, r);
    ctx.lineTo(cx + dx * len, cy);
    ctx.stroke();
  };
  corner(X, Y, 1, 1);
  corner(X + W, Y, -1, 1);
  corner(X, Y + H, 1, -1);
  corner(X + W, Y + H, -1, -1);
  ctx.shadowBlur = 0;
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.45;
  const dot = Math.max(1.5, canvas.width / 520);
  for (const p of face.landmarks) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, dot, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Tiny WebAudio chime — no audio files to ship. */
export function chime(kind: "ok" | "warn" | "error") {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ac = new AC();
    const notes = kind === "ok" ? [660, 990] : kind === "warn" ? [520, 520] : [330, 220];
    notes.forEach((f, i) => {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = "sine";
      o.frequency.value = f;
      const t = ac.currentTime + i * 0.13;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.connect(g).connect(ac.destination);
      o.start(t);
      o.stop(t + 0.25);
    });
    setTimeout(() => ac.close(), 800);
  } catch {}
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
