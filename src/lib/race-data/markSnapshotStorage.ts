import { AI_MARK_LOGIC_VERSION } from "../pipeline/aiMarkAssignment";
import type { AiMarkSnapshot } from "./raceEvaluationTypes";

const LS_PREFIX = "ai-mark-snapshot:";

export function markSnapshotStorageKey(raceId: string): string {
  return `${LS_PREFIX}${raceId}`;
}

export function isValidMarkSnapshot(snapshot: AiMarkSnapshot | null | undefined): boolean {
  if (snapshot?.marksByHorseId == null || typeof snapshot.marksByHorseId !== "object") return false;
  if (typeof snapshot.frozenAt !== "string") return false;
  return snapshot.logicVersion === AI_MARK_LOGIC_VERSION;
}

export function loadMarkSnapshotFromLocalStorage(raceId: string): AiMarkSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(markSnapshotStorageKey(raceId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AiMarkSnapshot;
    return isValidMarkSnapshot(parsed) ? parsed : null;
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
  return isValidMarkSnapshot(snap) ? snap! : null;
}

export function resolveStoredMarkSnapshot(
  raceId: string,
  raceRaw: unknown,
): AiMarkSnapshot | null {
  return readMarkSnapshotFromRaceRaw(raceRaw) ?? loadMarkSnapshotFromLocalStorage(raceId);
}

/** 印ロジック変更前に保存された古いスナップショットのみ削除 */
export function clearStaleMarkSnapshotsFromLocalStorage(): number {
  if (typeof window === "undefined") return 0;
  let removed = 0;
  for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
    const key = window.localStorage.key(i);
    if (key == null || !key.startsWith(LS_PREFIX)) continue;
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as AiMarkSnapshot;
      if (!isValidMarkSnapshot(parsed)) {
        window.localStorage.removeItem(key);
        removed += 1;
      }
    } catch {
      window.localStorage.removeItem(key);
      removed += 1;
    }
  }
  return removed;
}
