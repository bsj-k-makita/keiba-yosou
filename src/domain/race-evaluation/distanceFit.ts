import type { HorseAbility, RaceCondition } from "./abilityTypes";
import type { PastRunRecord } from "./pastRunTypes";

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function distanceToLongness(distance: number): number {
  if (distance <= 1400) return 0.28;
  if (distance <= 1800) return 0.4;
  if (distance <= 2200) return 0.52;
  if (distance <= 2800) return 0.66;
  return 0.78;
}

function runDistanceMeters(run: PastRunRecord): number | null {
  const sec = run.section200mSec;
  if (!sec || sec.length < 4) return null;
  return sec.length * 200;
}

function runPerformance01(run: PastRunRecord): number | null {
  const margin = run.marginToWinnerSec;
  if (margin != null && Number.isFinite(margin)) {
    return clamp01((100 - margin * 30) / 100);
  }
  const place = run.place;
  if (place != null && place >= 1) {
    return clamp01((100 - (place - 1) * 8) / 100);
  }
  return null;
}

function pastRunDistanceFit01(
  runs: readonly PastRunRecord[] | undefined,
  targetDistance: number,
): { value: number; sampleCount: number } {
  if (!runs || runs.length === 0) return { value: 0.5, sampleCount: 0 };

  let weighted = 0;
  let weightSum = 0;
  let count = 0;

  for (const run of runs) {
    const dist = runDistanceMeters(run);
    const perf = runPerformance01(run);
    if (dist == null || perf == null) continue;

    const diff = Math.abs(dist - targetDistance);
    const distanceMatch = clamp01(1 - diff / 1400);
    const runScore = distanceMatch * (0.55 + perf * 0.45);
    weighted += runScore;
    weightSum += 1;
    count += 1;
  }

  if (weightSum <= 0) return { value: 0.5, sampleCount: 0 };
  return { value: weighted / weightSum, sampleCount: count };
}

function profileDistanceFit01(horse: HorseAbility, targetDistance: number): number {
  // 血統データ未搭載のため、能力配分を「血統的な距離傾向」の代理特徴として扱う。
  const staminaSide = horse.stamina + horse.sustain + horse.power * 0.8;
  const speedSide = horse.speed + horse.kick;
  const sum = staminaSide + speedSide;
  if (sum <= 0) return 0.5;

  const profileLongness = staminaSide / sum;
  const targetLongness = distanceToLongness(targetDistance);
  const diff = Math.abs(profileLongness - targetLongness);
  return clamp01(1 - diff / 0.78);
}

/**
 * 距離適性ボーナス。
 * - 過去走から推定した「その距離で走れているか」
 * - 能力配分を代理にした「血統的な距離傾向」
 * を合成して最終点に加算する（おおむね -4.0 〜 +4.0）。
 */
export function computeDistanceFitBonus(
  horse: HorseAbility,
  condition: RaceCondition,
): number {
  const targetDistance = condition.distance;
  if (targetDistance == null || !Number.isFinite(targetDistance) || targetDistance <= 0) {
    return 0;
  }

  const past = pastRunDistanceFit01(horse.pastRuns, targetDistance);
  const profile = profileDistanceFit01(horse, targetDistance);

  const pastReliability = Math.min(1, past.sampleCount / 3);
  const pastCentered = (past.value - 0.5) * 2;
  const profileCentered = (profile - 0.5) * 2;

  const bonus = pastCentered * 2.5 * pastReliability + profileCentered * 1.5;
  return round1(Math.max(-4, Math.min(4, bonus)));
}
