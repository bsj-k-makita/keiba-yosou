import type { HorseAbility, RaceCondition } from "./abilityTypes";
import {
  classifyLapStructure,
  LAP_STRUCTURE,
  type LapStructureKind,
} from "./lapStructure";
import type { PastRunRecord } from "./pastRunTypes";

export type ShapeFitResult =
  | {
      reliable: true;
      score: number;
      sustainBonus: number;
      qualityBonus: number;
      lapProfile: "瞬発戦型" | "消耗戦型" | "一貫型";
    }
  | { reliable: false; sustainBonus: number; qualityBonus: number; lapProfile: "瞬発戦型" | "消耗戦型" | "一貫型" };

/** 非中間ラップ分類の最低必要サンプル数 */
const MIN_NON_NEUTRAL_RUNS = 2;

/** score の最大絶対値（一致率 100% or 0% のとき ±3） */
const SHAPE_FIT_MAX = 3;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function getRunShape(run: PastRunRecord): LapStructureKind | null {
  if (run.lapStructure != null) return run.lapStructure;
  const sec = run.section200mSec;
  if (sec != null && sec.length >= 4) {
    return classifyLapStructure(sec);
  }
  return null;
}

function inferLapProfile(horse: HorseAbility): "瞬発戦型" | "消耗戦型" | "一貫型" {
  if (horse.kick >= horse.sustain + 8) return "瞬発戦型";
  if (horse.sustain >= horse.kick + 6 || horse.stamina >= 60) return "消耗戦型";
  return "一貫型";
}

function isMiddleDistanceRun(run: PastRunRecord): boolean {
  const d = run.raceDistance;
  return d != null && d >= 1800 && d <= 2400;
}

function isGradedRun(run: PastRunRecord): boolean {
  return run.raceClass === "G1" || run.raceClass === "G2" || run.raceClass === "G3";
}

function computeLapQualityBonus(runs: readonly PastRunRecord[]): number {
  let bonus = 0;
  for (const run of runs.slice(0, 5)) {
    const rank = run.final3fRank ?? 99;
    const sec = run.final3fSec ?? 99;
    if (rank <= 2 && sec < 34.5 && (isMiddleDistanceRun(run) || isGradedRun(run))) {
      bonus += 0.9;
    } else if (rank <= 3 && sec < 35.0) {
      bonus += 0.4;
    }
  }
  return round1(clamp(bonus, 0, 2.5));
}

function computeLapSustainBonus(
  runs: readonly PastRunRecord[],
  todayShape: LapStructureKind,
  condition: RaceCondition,
): number {
  const todayIsGrind = todayShape === LAP_STRUCTURE.GRIND || condition.pace === "high" || condition.pace === "many_front_runners";
  if (!todayIsGrind) return 0;
  let bonus = 0;
  for (const run of runs.slice(0, 5)) {
    const shape = getRunShape(run);
    if (shape !== LAP_STRUCTURE.GRIND && shape !== LAP_STRUCTURE.SUSTAIN) continue;
    const rank = run.final3fRank ?? 99;
    if (rank <= 3) bonus += 0.7;
    if ((run.marginToWinnerSec ?? 9) <= 0.5) bonus += 0.5;
  }
  return round1(clamp(bonus, 0, 2.5));
}

/**
 * 今日のレースのラップ形状 vs 馬の過去走ラップ形状分布の一致度スコア。
 *
 * 判定条件:
 * - `condition.section200mSec` が 4 本以上必要
 * - 今日の分類が「中間」の場合: reliable: false
 * - 馬の非中間走が 2 本未満: reliable: false
 *
 * score: 一致率 1.0 → +3, 0.5 → 0, 0.0 → -3
 */
export function computeLapShapeFit(
  horse: HorseAbility,
  condition: RaceCondition,
): ShapeFitResult {
  const profile = inferLapProfile(horse);
  // 今日のレース形状
  const sec = condition.section200mSec;
  if (sec == null || sec.length < 4) {
    return {
      reliable: false,
      sustainBonus: 0,
      qualityBonus: computeLapQualityBonus(horse.pastRuns ?? []),
      lapProfile: profile,
    };
  }

  const todayShape = classifyLapStructure(sec);
  if (todayShape === LAP_STRUCTURE.NEUTRAL) {
    return {
      reliable: false,
      sustainBonus: 0,
      qualityBonus: computeLapQualityBonus(horse.pastRuns ?? []),
      lapProfile: profile,
    };
  }

  // 馬の過去走形状
  if (!horse.pastRuns || horse.pastRuns.length === 0) {
    return {
      reliable: false,
      sustainBonus: 0,
      qualityBonus: 0,
      lapProfile: profile,
    };
  }

  const shapes = horse.pastRuns
    .map(getRunShape)
    .filter((s): s is LapStructureKind => s !== null && s !== LAP_STRUCTURE.NEUTRAL);

  const sustainBonus = computeLapSustainBonus(horse.pastRuns, todayShape, condition);
  const qualityBonus = computeLapQualityBonus(horse.pastRuns);
  if (shapes.length < MIN_NON_NEUTRAL_RUNS) {
    return {
      reliable: false,
      sustainBonus,
      qualityBonus,
      lapProfile: profile,
    };
  }

  const matchCount = shapes.filter((s) => s === todayShape).length;
  const matchRate = matchCount / shapes.length;

  // matchRate: 1.0 → +3, 0.5 → 0, 0.0 → -3
  const raw = (matchRate - 0.5) * (SHAPE_FIT_MAX * 2);
  const score = round1(raw);

  return {
    reliable: true,
    score,
    sustainBonus,
    qualityBonus,
    lapProfile: profile,
  };
}
