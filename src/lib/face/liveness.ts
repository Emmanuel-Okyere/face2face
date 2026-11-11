import type { FaceObservation } from "./engine";
import { pose } from "./geometry";

export type StepType = "blink" | "turn_left" | "turn_right" | "smile";

export const STEP_COPY: Record<StepType, { title: string; hint: string; icon: string }> = {
  blink: { title: "Blink slowly", hint: "Close both eyes, then open them", icon: "◉‿◉" },
  turn_left: { title: "Turn to your left", hint: "Then come back to the centre", icon: "←" },
  turn_right: { title: "Turn to your right", hint: "Then come back to the centre", icon: "→" },
  smile: { title: "Now give us a smile", hint: "Start with a relaxed face, then smile", icon: "☺" },
};

/**
 * Active liveness: each step is a tiny state machine that needs a *transition*
 * (open→closed→open, frontal→turned, neutral→smiling). A printed photo or a
 * frozen screen can't produce one, and the server picks the random order.
 */
export class StepDetector {
  private phase = 0;
  private baselineEar = 0;
  private samples = 0;
  private hold = 0;
  constructor(public readonly type: StepType) {}

  /** Feed one observation; returns true once the step is satisfied. */
  update(f: FaceObservation): boolean {
    const p = pose(f);
    const happy = f.expressions.happy ?? 0;
    this.samples++;
    switch (this.type) {
      case "blink": {
        // Learn the open-eye baseline, then look for a dip and a recovery.
        if (this.phase === 0) {
          this.baselineEar = this.baselineEar ? this.baselineEar * 0.8 + p.ear * 0.2 : p.ear;
          if (this.samples >= 3 && p.ear < this.baselineEar * 0.68) this.phase = 1;
        } else if (this.phase === 1 && p.ear > this.baselineEar * 0.85) {
          return true;
        }
        return false;
      }
      case "turn_left":
      case "turn_right": {
        // Must start roughly frontal, then cross the turn threshold for 2 frames.
        const turned = this.type === "turn_left" ? p.yaw > 0.66 : p.yaw < 0.34;
        if (this.phase === 0) {
          if (Math.abs(p.yaw - 0.5) < 0.12) this.phase = 1;
          return false;
        }
        this.hold = turned ? this.hold + 1 : 0;
        return this.hold >= 2;
      }
      case "smile": {
        if (this.phase === 0) {
          if (happy < 0.5) this.phase = 1; // saw a neutral face first
          return false;
        }
        this.hold = happy > 0.8 ? this.hold + 1 : 0;
        return this.hold >= 2;
      }
    }
  }
}
