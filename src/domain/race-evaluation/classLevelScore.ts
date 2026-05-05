import type { HorseAbility, RaceCondition } from "./abilityTypes";
import type { PastRunRecord } from "./pastRunTypes";

const CLASS_BASE_SCORE: Record<string, number> = {
  G1: 1.0,
  G2: 0.9,
  G3: 0.82,
  OP: 0.72,
  "3勝": 0.62,
  "2勝": 0.54,
  "1勝": 0.46,
  新馬: 0.38,
  未勝利: 0.32,
  その他: 0.52,
};

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function classScore01(run: PastRunRecord): number {
  const k = run.raceClass ?? "その他";
  return CLASS_BASE_SCORE[k] ?? CLASS_BASE_SCORE["その他"] ?? 0;
}

function placeScore01(run: PastRunRecord): number {
  if (run.place != null && run.place >= 1) {
    return clamp01((100 - (run.place - 1) * 7) / 100);
  }
  return 0.45;
}

function marginScore01(run: PastRunRecord): number {
  const m = run.marginToWinnerSec;
  if (m == null || !Number.isFinite(m)) return 0.5;
  return clamp01((100 - m * 30) / 100);
}

function isTennoShoSpring(condition: RaceCondition): boolean {
  const name = condition.raceName ?? "";
  const looksLikeName = name.includes("天皇賞") && name.includes("春");
  const looksLikeKey =
    (condition.courseKey ?? "").includes("天皇賞") &&
    ((condition.courseKey ?? "").includes("春") || (condition.distance ?? 0) >= 3000);
  return looksLikeName || looksLikeKey;
}

function runNameIncludes(run: PastRunRecord, keyword: string): boolean {
  return (run.raceName ?? "").includes(keyword);
}

function computeStepPatternBonus(horse: HorseAbility, condition: RaceCondition): number {
  const runs = horse.pastRuns ?? [];
  if (runs.length === 0) return 0;

  let bonus = 0;
  if (isTennoShoSpring(condition)) {
    const stepRun = runs.find(
      (run) => runNameIncludes(run, "阪神大賞典") || runNameIncludes(run, "日経賞"),
    );
    if (stepRun != null) {
      bonus += 0.8;
      if ((stepRun.place ?? 99) <= 3) bonus += 0.7;
      if ((stepRun.final3fRank ?? 99) <= 1) bonus += 1.2;
      else if ((stepRun.final3fRank ?? 99) <= 3) bonus += 0.6;
      if ((stepRun.final3fSec ?? 99) <= 35.0) bonus += 0.4;
    }
  }
  return Math.max(0, Math.min(2.4, bonus));
}

/**
 * クラス実績ボーナス。
 * 直近5走の「レース格 + 走破内容」を合成して、最終点へ加算する。
 */
export function computeClassLevelBonus(
  horse: HorseAbility,
  condition: RaceCondition,
): { classBonus: number; stepPatternBonus: number } {
  const runs = horse.pastRuns ?? [];
  if (runs.length === 0) {
    return { classBonus: 0, stepPatternBonus: 0 };
  }

  let weighted = 0;
  let weightSum = 0;

  for (let i = 0; i < runs.length && i < 5; i += 1) {
    const run = runs[i]!;
    const recencyWeight = Math.max(0.55, 1 - i * 0.1);
    const cls = classScore01(run);
    const perf = placeScore01(run) * 0.6 + marginScore01(run) * 0.4;
    weighted += recencyWeight * (cls * 0.7 + perf * 0.3);
    weightSum += recencyWeight;
  }

  if (weightSum <= 0) {
    return { classBonus: 0, stepPatternBonus: 0 };
  }
  const value01 = weighted / weightSum;
  // 実データでは 0.5 前後に分布しやすいため、中間点を 0.48 に寄せて加点も出るようにする。
  const centered = (value01 - 0.5) / 0.38;
  const classBonus = round1(Math.max(-3.5, Math.min(4.8, centered * 3.0)));
  const stepPatternBonus = round1(computeStepPatternBonus(horse, condition));
  return {
    classBonus,
    stepPatternBonus,
  };
}
