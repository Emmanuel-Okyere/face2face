import "server-only";
import { z } from "zod";
import { db } from "./db";

/**
 * Check-in liveness is two quick moments: (1) look at the camera — the client
 * captures an "anchor" face — then (2) smile. The smile must start from a
 * neutral face (a static photo can't change expression), and every capture
 * after it must match the anchor (no swapping faces mid-check).
 * The detectors for blink / turn_left / turn_right remain available if an
 * organization ever needs a stricter check.
 */
export function pickSteps(): string[] {
  return ["smile"];
}

export const livenessSchema = z.object({
  steps: z.array(z.object({ type: z.string().max(20), ms: z.number().int().min(0).max(60_000) })).max(4),
  consistency: z.number().min(0).max(2), // max distance of any capture frame to the pre-challenge anchor
  frames: z.number().int().min(1).max(10),
  quality: z.number().min(0).max(1),
});
export type LivenessReport = z.infer<typeof livenessSchema>;

/** Returns a reason string when the client's liveness report doesn't satisfy the signed challenge. */
export function checkLiveness(expected: string[], l: LivenessReport): string | null {
  const sameSteps = l.steps.length === expected.length && l.steps.every((s, i) => s.type === expected[i]);
  // Humans need a beat to react; instant completions are scripted.
  if (!sameSteps || l.steps.some((s) => s.ms < 150)) return "Challenge not completed";
  if (l.consistency > 0.45) return "Face changed during the check — one person at a time";
  return null;
}

/** One-time nonce: a captured request can't be replayed. Outside any tenant tx. */
export async function useNonce(nonce: string): Promise<boolean> {
  const used = await db()`insert into kiosk_nonces (nonce) values (${nonce}) on conflict do nothing returning nonce`;
  if (Math.random() < 0.02) await db()`delete from kiosk_nonces where used_at < now() - interval '1 day'`;
  return used.length > 0;
}
