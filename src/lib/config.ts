import "server-only";

function num(name: string, fallback: number) {
  const v = process.env[name];
  const n = v === undefined || v === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  /** Max L2 distance between descriptors to count as the same person. */
  matchThreshold: num("MATCH_THRESHOLD", 0.5),
  /** Best person must beat the runner-up by at least this much (ambiguity guard). */
  matchMargin: num("MATCH_MARGIN", 0.05),
  /** Enrollment: warn if the new face is this close to someone already enrolled. */
  duplicateThreshold: num("DUPLICATE_THRESHOLD", 0.42),
  /** IANA zone that defines "today" for attendance. */
  timeZone: process.env.ATTENDANCE_TZ || "UTC",
  /** Local HH:MM after which a check-in is flagged late. Empty = never late. */
  lateAfter: process.env.LATE_AFTER ?? "09:00",
  /** Liveness challenge validity window (seconds). */
  challengeTtl: num("CHALLENGE_TTL", 45),
};
