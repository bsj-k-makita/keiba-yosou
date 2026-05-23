import type { HorseScoreResult } from "./abilityTypes";
import type { RaceInfo, AiMarkSnapshot } from "../../lib/race-data/raceEvaluationTypes";

/** 発走何分前から印を固定するか（オッズ更新・backfill 後も印は変えない） */
export const MARK_FREEZE_MINUTES_BEFORE_POST = 30;

/** 1R 発走の推定（JST）。postTime 未登録時のフォールバック */
const ESTIMATED_FIRST_RACE_HOUR_JST = 10;
const ESTIMATED_FIRST_RACE_MINUTE_JST = 0;
const ESTIMATED_MINUTES_PER_RACE = 30;

export type RacePostTimeInput = Pick<RaceInfo, "date" | "raceNumber" | "postTime">;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** "HH:MM" → 分（0〜1439）。不正なら null */
export function parsePostTimeHm(value: string): { hour: number; minute: number } | null {
  const m = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hour = parseInt(m[1]!, 10);
  const minute = parseInt(m[2]!, 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

/** レース発走時刻（JST）を epoch ms で返す */
export function racePostTimeMs(
  input: RacePostTimeInput,
  postTimeOverride?: { hour: number; minute: number },
): number {
  const parsed =
    postTimeOverride ??
    (input.postTime ? parsePostTimeHm(input.postTime) : null) ??
    estimatePostTimeHm(input.raceNumber);
  const iso = `${input.date}T${pad2(parsed.hour)}:${pad2(parsed.minute)}:00+09:00`;
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) {
    throw new Error(`invalid post time: ${input.date} ${parsed.hour}:${parsed.minute}`);
  }
  return ms;
}

/** postTime 未設定時: 10:00 発 + (R-1)×30分（JRA 中央の目安） */
export function estimatePostTimeHm(raceNumber: number): { hour: number; minute: number } {
  const r = Math.max(1, Math.min(12, Math.round(raceNumber)));
  const totalMin =
    ESTIMATED_FIRST_RACE_HOUR_JST * 60 +
    ESTIMATED_FIRST_RACE_MINUTE_JST +
    (r - 1) * ESTIMATED_MINUTES_PER_RACE;
  return { hour: Math.floor(totalMin / 60) % 24, minute: totalMin % 60 };
}

/** 印固定開始時刻（発走30分前）の epoch ms */
export function markFreezeStartsAtMs(input: RacePostTimeInput): number {
  return racePostTimeMs(input) - MARK_FREEZE_MINUTES_BEFORE_POST * 60 * 1000;
}

/** いま印を固定すべきか（発走30分前を過ぎたら true） */
export function isMarkFrozen(input: RacePostTimeInput, now: Date = new Date()): boolean {
  return now.getTime() >= markFreezeStartsAtMs(input);
}

export function marksToSnapshot(
  results: readonly HorseScoreResult[],
  logicVersion?: number,
): AiMarkSnapshot {
  const marksByHorseId: Record<string, string> = {};
  for (const r of results) {
    if (r.mark) marksByHorseId[r.horseId] = r.mark;
  }
  return {
    frozenAt: new Date().toISOString(),
    marksByHorseId,
    ...(logicVersion != null ? { logicVersion } : {}),
  };
}

export function applyMarkSnapshot(
  results: readonly HorseScoreResult[],
  snapshot: AiMarkSnapshot | null | undefined,
): HorseScoreResult[] {
  if (snapshot?.marksByHorseId == null) return [...results];
  const map = snapshot.marksByHorseId;
  return results.map((r) => {
    const mark = map[r.horseId];
    return mark != null && mark !== "" ? { ...r, mark: mark as HorseScoreResult["mark"] } : { ...r, mark: "" };
  });
}

export function formatPostTimeLabel(input: RacePostTimeInput): string {
  if (input.postTime) return input.postTime;
  const est = estimatePostTimeHm(input.raceNumber);
  return `${pad2(est.hour)}:${pad2(est.minute)}（推定）`;
}
