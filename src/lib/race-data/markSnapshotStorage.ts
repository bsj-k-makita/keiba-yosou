import type { AiMarkSnapshot } from "./raceEvaluationTypes";

const LS_PREFIX = "ai-mark-snapshot:";

export function markSnapshotStorageKey(raceId: string): string {
  return `${LS_PREFIX}${raceId}`;
}

export function loadMarkSnapshotFromLocalStorage(raceId: string): AiMarkSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(markSnapshotStorageKey(raceId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AiMarkSnapshot;
    if (parsed?.marksByHorseId == null || typeof parsed.marksByHorseId !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveMarkSnapshotToLocalStorage(raceId: string, snapshot: AiMarkSnapshot): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(markSnapshotStorageKey(raceId), JSON.stringify(snapshot));
  } catch {
    // ignore quota
  }
}

/** JSON meta の ai_mark_snapshot / aiMarkSnapshot を読む */
export function readMarkSnapshotFromRaceRaw(raw: unknown): AiMarkSnapshot | null {
  if (raw == null || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const meta = (o.meta ?? o) as Record<string, unknown>;
  const snap = (meta.ai_mark_snapshot ?? meta.aiMarkSnapshot) as AiMarkSnapshot | undefined;
  if (snap?.marksByHorseId == null || typeof snap.marksByHorseId !== "object") return null;
  if (typeof snap.frozenAt !== "string") return null;
  return snap;
}

export function resolveStoredMarkSnapshot(
  raceId: string,
  raceRaw: unknown,
): AiMarkSnapshot | null {
  return readMarkSnapshotFromRaceRaw(raceRaw) ?? loadMarkSnapshotFromLocalStorage(raceId);
}
