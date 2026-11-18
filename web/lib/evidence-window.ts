export const DEFAULT_EVIDENCE_MAX_HOURS = 72;
export const MIN_EVIDENCE_MAX_HOURS = 1;
export const MAX_EVIDENCE_MAX_HOURS = 720;

type EvidenceWindowEnv = Record<string, string | undefined>;

/** Invalid settings fail closed to the 72-hour default. */
export function evidenceMaxHoursFrom(env: EvidenceWindowEnv): number {
  const raw = env.EVENT_REC_EVIDENCE_MAX_HOURS?.trim();
  if (!raw || !/^\d+$/.test(raw)) return DEFAULT_EVIDENCE_MAX_HOURS;
  const hours = Number(raw);
  return hours >= MIN_EVIDENCE_MAX_HOURS && hours <= MAX_EVIDENCE_MAX_HOURS
    ? hours
    : DEFAULT_EVIDENCE_MAX_HOURS;
}

export function evidenceMaxAgeMs(env: EvidenceWindowEnv = process.env): number {
  return evidenceMaxHoursFrom(env) * 60 * 60 * 1000;
}
