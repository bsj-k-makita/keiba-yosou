import type {
  HorseAbility,
  HorseScoreResult,
  RaceCondition,
} from "./abilityTypes";
import { assignBuyLabels } from "./buyLabel";
import { collectDismissIds } from "./dismissalRules";
import { assignMarks, fillRequiredMarks } from "./markAssigner";
import { generateScoreReason } from "./reasonGenerator";
import {
  baseAbilityCore,
  raceAdjustedInput,
  conditionScore,
} from "./abilityCoreScoring";
import { formatPastRunInsight } from "./pastRunDerivedSignals";
import { getEffectiveEvaluationSignals } from "./resolveEvaluationSignals";
import { reproducibilityDelta } from "./evaluationSignals";
import { applyLongshotMarkGuard } from "./longshotGuard";
import {
  calcHorseScore,
  getBaseWeights,
  getFinalWeights,
} from "./weightResolver";
import { extractStrongAbilities } from "./strongAbilities";
import {
  combineFinalEvaluationScore,
  computeRaceRelativeScores,
  paceFitToBonus,
} from "./finalScoring";
import { computeDistanceFitBonus } from "./distanceFit";
import { computePaceFitLevel } from "./paceFit";
import { computeMaxPerformance, computeVariance, variancePenaltyPoints } from "./maxPerformance";
import { computeLapShapeFit } from "./lapShapeFit";
import { computeAdjustedRiskPenalty } from "./lossClassifier";
import { classifyLapStructure, LAP_STRUCTURE } from "./lapStructure";
import { computeClassLevelBonus } from "./classLevelScore";
import { blendAbilityWithPastRuns } from "./performanceAbility";
import { computeContextualBonuses } from "./contextualBonuses";
import { BUY_LABELS } from "./lingoConstants";
import { ADJUSTMENT_STRENGTH } from "./adjustments";
import { computeCourseTraitHits } from "./courseTraitResolver";

export { extractStrongAbilities } from "./strongAbilities";
export {
  applyAdjustments,
  clampWeights,
  calcHorseScore,
  getBaseWeights,
  getFinalWeights,
  normalizeWeights,
} from "./weightResolver";
export { baseAbilityCore, raceAdjustedInput, intrinsicAbilityWithAdjustments } from "./abilityCoreScoring";

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

const MAX_COURSE_TRAIT_TOTAL = 8.5;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function conditionImpactBonusFromDiff(
  scoreDiff: number,
  strength: keyof typeof ADJUSTMENT_STRENGTH,
): number {
  if (strength === "weak") {
    return round1(clamp(scoreDiff * 1.8, -6, 6));
  }
  if (strength === "middle") {
    return round1(clamp(scoreDiff * 4.8, -22, 22));
  }
  return round1(clamp(scoreDiff * 8.0, -30, 30));
}

function weakTierImpactFromDiff(
  scoreDiff: number,
  strength: keyof typeof ADJUSTMENT_STRENGTH,
): number {
  if (strength === "weak") {
    return round1(clamp(scoreDiff * 1.8, -6, 6));
  }
  if (strength === "middle") {
    return round1(clamp(scoreDiff * 3.5, -12, 12));
  }
  return round1(clamp(scoreDiff * 6.0, -25, 25));
}

function computeStyleSignalFactor(horses: HorseAbility[]): number {
  if (horses.length <= 1) return 1;
  const counts = new Map<string, number>();
  for (const h of horses) {
    counts.set(h.runningStyle, (counts.get(h.runningStyle) ?? 0) + 1);
  }
  const distinctRatio = clamp((counts.size - 1) / 5, 0, 1);
  const topShare = Math.max(...[...counts.values()].map((c) => c / horses.length));
  const dominanceSpread = clamp(1 - topShare, 0, 1);
  const diversity = distinctRatio * 0.6 + dominanceSpread * 0.4;
  // 脚質分布が偏るレースでは脚質由来の同値加点を弱める。
  return round1(clamp(0.35 + diversity * 0.65, 0.35, 1));
}

function assignRanksForScore(
  items: HorseScoreResult[],
  scoreKey: "baseScore" | "adjustedScore" | "finalEvaluationScore",
  rankKey: "baseRank" | "adjustedRank" | "finalRank",
): void {
  const sorted = [...items].sort((a, b) => {
    const ds = b[scoreKey] - a[scoreKey];
    if (ds !== 0) return ds;
    return a.horseId.localeCompare(b.horseId);
  });
  sorted.forEach((row, idx) => {
    const target = items.find((r) => r.horseId === row.horseId);
    if (target) {
      target[rankKey] = idx + 1;
    }
  });
}

export function evaluateRace(
  horses: HorseAbility[],
  condition: RaceCondition,
): HorseScoreResult[] {
  const evalHorses = horses.map((h) => blendAbilityWithPastRuns(h));
  const styleSignalFactor = computeStyleSignalFactor(evalHorses);
  const baseWeights = getBaseWeights(condition);
  const finalWeights = getFinalWeights(condition);
  const strengthMult = ADJUSTMENT_STRENGTH[condition.adjustmentStrength];

  // 今日のレースラップ形状（敗因分解・ラップ形状一致に使う）
  const raceLapShape =
    condition.section200mSec != null && condition.section200mSec.length >= 4
      ? classifyLapStructure(condition.section200mSec)
      : null;
  const effectiveRaceLapShape =
    raceLapShape != null && raceLapShape !== LAP_STRUCTURE.NEUTRAL
      ? raceLapShape
      : null;

  const results: HorseScoreResult[] = evalHorses.map((h) => {
    const rawBase = calcHorseScore(h, baseWeights);
    const rawAdj = calcHorseScore(h, finalWeights);
    const bCore = baseAbilityCore(h);
    const eff = getEffectiveEvaluationSignals(h);
    const repro = round1(reproducibilityDelta(eff));
    const classBreakdown = computeClassLevelBonus(h, condition);

    // 敗因分解適用のリスクペナルティ
    const risk = round1(computeAdjustedRiskPenalty(h.pastRuns, effectiveRaceLapShape, eff));

    const intrinsic = round1(bCore + repro - risk);

    // MAX性能
    const maxPerf = computeMaxPerformance(h.pastRuns);

    // raceAdjustedInput: precomputed intrinsic + conditionScore + maxPerf
    const cond = round1(conditionScore(h, finalWeights));
    const rAdj = round1(
      raceAdjustedInput(
        intrinsic,
        cond,
        maxPerf,
        classBreakdown.classBonus + classBreakdown.stepPatternBonus,
        condition.adjustmentStrength,
      ),
    );

    const baseScore = round1(rawBase);
    const adjustedScore = round1(rawAdj);
    const conditionFitDelta = round1(adjustedScore - intrinsic);
    const scoreDiff = round1(rawAdj - rawBase);

    // 分散リスク
    const variance = computeVariance(h.pastRuns);

    // ラップ形状一致
    const lapFit = computeLapShapeFit(h, condition);
    const lapShapeFitBonus = lapFit.reliable ? lapFit.score : 0;

    return {
      horseId: h.horseId,
      horseName: h.horseName,
      baseScore,
      adjustedScore,
      scoreDiff,
      baseAbilityCore: round1(bCore),
      intrinsicAbilityScore: intrinsic,
      raceAdjustedInput: rAdj,
      conditionFitDelta,
      reproducibilityDelta: repro,
      riskPenalty: risk,
      raceRelativeScore: 0,
      paceFitBonus: 0,
      distanceFitBonus: 0,
      classLevelBonus: round1(classBreakdown.classBonus),
      pedigreeBonus: 0,
      gateBiasBonus: 0,
      gateStyleSynergyBonus: 0,
      connectionsBonus: 0,
      trendBonus: 0,
      paceBalanceBonus: 0,
      tripContextBonus: 0,
      courseTraitBonus: 0,
      courseTraitReasons: [],
      finalEvaluationScore: 0,
      evaluationBaselineScore: 0,
      evaluationAdjustmentDelta: 0,
      lapShapeFitBonus: round1(lapShapeFitBonus),
      lapSustainBonus: round1(lapFit.sustainBonus),
      lapQualityBonus: round1(lapFit.qualityBonus),
      stepPatternBonus: round1(classBreakdown.stepPatternBonus),
      lapProfile: lapFit.lapProfile,
      varianceScore: variance.varianceScore,
      roleHint: variance.roleHint,
      buyLabel: "相手" as const,
      reason: "",
      strongAbilities: extractStrongAbilities(h),
      pastRunInsight: formatPastRunInsight(h.pastRuns),
    };
  });

  const relativeMode =
    condition.adjustmentStrength === "strong" ? "absolute_delta" : "normalized";
  const rel = computeRaceRelativeScores(
    results.map((r) => ({ horseId: r.horseId, raceAdjustedInput: r.raceAdjustedInput })),
    relativeMode,
  );
  for (const h of evalHorses) {
    const r = results.find((x) => x.horseId === h.horseId);
    if (!r) continue;
    const relScore = rel.get(h.horseId) ?? 0;
    const pBonus = round1(paceFitToBonus(computePaceFitLevel(h, condition)) * styleSignalFactor);
    const dBonus = computeDistanceFitBonus(h, condition);
    const cBonus = r.classLevelBonus;
    const vPenalty = variancePenaltyPoints(computeVariance(h.pastRuns));
    const contextual = computeContextualBonuses(
      h,
      condition,
      evalHorses.length,
      styleSignalFactor,
    );
    const contextualTotal =
      contextual.pedigreeBonus +
      contextual.gateBiasBonus +
      contextual.gateStyleSynergyBonus +
      contextual.connectionsBonus +
      contextual.trendBonus +
      contextual.paceBalanceBonus +
      contextual.tripContextBonus;
    const conditionImpactBonus = conditionImpactBonusFromDiff(r.scoreDiff, condition.adjustmentStrength);
    const weakTierImpact = weakTierImpactFromDiff(r.scoreDiff, condition.adjustmentStrength);
    const dScaled = round1(dBonus * strengthMult);
    const contextualScaled = round1(contextualTotal * strengthMult);
    const traitHits = computeCourseTraitHits(h, condition);
    // コース特性は finalEvaluationScore へ直結するが、単独要因での暴走を防ぐため +8.5 に制限。
    const courseTraitBonus = round1(clamp(traitHits.reduce((sum, hit) => sum + hit.bonus, 0), 0, MAX_COURSE_TRAIT_TOTAL));
    const courseTraitReasons = traitHits.map((hit) => `${hit.label}: ${hit.reason} (+${hit.bonus.toFixed(1)})`);
    r.raceRelativeScore = relScore;
    r.paceFitBonus = pBonus;
    r.distanceFitBonus = dBonus;
    r.classLevelBonus = cBonus;
    r.pedigreeBonus = contextual.pedigreeBonus;
    r.gateBiasBonus = contextual.gateBiasBonus;
    r.gateStyleSynergyBonus = contextual.gateStyleSynergyBonus;
    r.connectionsBonus = contextual.connectionsBonus;
    r.trendBonus = contextual.trendBonus;
    r.paceBalanceBonus = contextual.paceBalanceBonus;
    r.tripContextBonus = contextual.tripContextBonus;
    r.courseTraitBonus = courseTraitBonus;
    r.courseTraitReasons = courseTraitReasons;
    const classCombined = round1(clamp(cBonus + r.stepPatternBonus, -4.5, 5.5));
    const lapStack = r.lapShapeFitBonus + r.lapSustainBonus + r.lapQualityBonus;
    r.evaluationBaselineScore = combineFinalEvaluationScore(
      relScore,
      pBonus,
      lapStack,
      dBonus,
      classCombined,
      vPenalty,
      contextualTotal,
      weakTierImpact,
    );
    r.finalEvaluationScore = combineFinalEvaluationScore(
      relScore,
      pBonus,
      lapStack,
      dScaled,
      classCombined,
      vPenalty,
      contextualScaled,
      conditionImpactBonus,
    );
    r.finalEvaluationScore = round1(r.finalEvaluationScore + courseTraitBonus);
    r.evaluationAdjustmentDelta = round1(r.finalEvaluationScore - r.evaluationBaselineScore);
  }

  assignRanksForScore(results, "baseScore", "baseRank");
  assignRanksForScore(results, "adjustedScore", "adjustedRank");
  assignRanksForScore(results, "finalEvaluationScore", "finalRank");

  assignMarks(results);
  applyLongshotMarkGuard(evalHorses, results);
  const dismissIds = collectDismissIds(evalHorses, results, condition);
  assignBuyLabels(results, dismissIds, evalHorses);
  for (const r of results) {
    if (r.buyLabel === BUY_LABELS.DISMISS) {
      r.mark = "";
    }
  }
  fillRequiredMarks(results);

  // 最終安全策: 消し馬には印を付けない。
  for (const r of results) {
    if (r.buyLabel === BUY_LABELS.DISMISS) {
      r.mark = "";
    }
  }

  for (const r of results) {
    r.reason = generateScoreReason(r, condition, finalWeights);
  }

  return results;
}
