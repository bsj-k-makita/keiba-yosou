import type {
  HorseAbility,
  HorseScoreResult,
  RaceCondition,
} from "./abilityTypes";
import { assignBuyLabels } from "./buyLabel";
import { collectDismissIds } from "./dismissalRules";
import {
  assignCompleteMarks,
  assignHokkakeRoles,
  assignMarks,
  applyCornerLeadFavoritePromotion,
  applyStabilityRescueMarks,
} from "./markAssigner";
import { generateScoreReason } from "./reasonGenerator";
import {
  baseAbilityCore,
  enginePeakAdjustment,
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
  getFinalWeightsForHorse,
} from "./weightResolver";
import { extractStrongAbilities } from "./strongAbilities";
import { combineFinalEvaluationScore, computeRaceRelativeScores } from "./finalScoring";
import { computeDistanceFitBonus } from "./distanceFit";
import {
  classifyTodayLapKind,
  computeKickInTopFractionMap,
  computePaceFitEvaluation,
  computePaceScenarioAmplifier,
  computeStaminaResilienceBonus,
} from "./paceFit";
import { detectOddsDistortion } from "./oddsDistortion";
import { computeMaxPerformance, computeVariance, variancePenaltyPoints } from "./maxPerformance";
import { computeLapShapeFit, computeRpcPaceMismatchPenalty } from "./lapShapeFit";
import { computeAdjustedRiskPenalty } from "./lossClassifier";
import { classifyLapStructure, LAP_STRUCTURE } from "./lapStructure";
import { computeClassLevelBonus } from "./classLevelScore";
import {
  applyKickL2Emphasis,
  blendAbilityWithPastRuns,
  calibrateRaceAdjustedInputsForFieldClassTier,
  computeCourseProfileMatchBonus,
} from "./performanceAbility";
import { computeContextualBonuses } from "./contextualBonuses";
import { BUY_LABELS } from "./lingoConstants";
import { ADJUSTMENT_STRENGTH } from "./adjustments";
import { computeCourseTraitHits } from "./courseTraitResolver";
import { computeStructuralPhysicalHits } from "./structuralPhysicalBonuses";
import { computeRaceAnalysisBonus } from "./storedRaceAnalysisBonus";
import { inferPaceSeverityKind, resolveEffectiveRacePace } from "./paceSeverity";
import { computeJockeyRiderBonuses, sumJockeyRiderBonuses } from "./jockeyContext";
import { computeStabilityScore } from "./stabilityScore";
import {
  estimateFourthCornerRanking,
  fourthCornerAbilityBiasMultiplier,
  fourthCornerPredictionBonus,
} from "./estimatedFourthCorner";
import {
  COURSE_SHAPE_FIT_RATIO,
  FRAME_GATE_WEIGHT_RATIO,
} from "./evaluationBlendWeights";
import {
  resolveVenuePhysicalFactorKey,
  VENUE_PHYSICAL_FACTORS,
} from "./venuePhysicalFactors";

export { extractStrongAbilities } from "./strongAbilities";
export {
  applyAdjustments,
  amplifyWeightsForPaceSeverity,
  clampWeights,
  calcHorseScore,
  getBaseWeights,
  getFinalWeights,
  getFinalWeightsForHorse,
  normalizeWeights,
} from "./weightResolver";
export { baseAbilityCore, raceAdjustedInput, intrinsicAbilityWithAdjustments } from "./abilityCoreScoring";

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

const MAX_COURSE_TRAIT_TOTAL = 8.5;
const LAST_RUN_RESET_BONUS = 12.0;
const LAP_FOCUS_MAX_BONUS = 15.0;
/** 第3層 + ラップ系ボーナス（lapShapeFit/raceAnalysis/sustain/quality + staminaResilience）の合算上限。 */
const LAP_STACK_TOTAL_CAP = 16.8;
/**
 * コース特性最大 +8.5 と第3層耐性バフ（最大 +6）が重複ご褒美にならないよう、
 * 同方向の合算上限を設けて競合を整理する。
 */
const COURSE_TRAIT_PLUS_RESILIENCE_CAP = 12.0;
/** 前走トラックバイアス逆行（`was_bias_disadvantaged`）の次走補正。着順に依らず素点系へ反映 */
const BIAS_DISADVANTAGE_RECOVERY_BONUS = 7.0;
/**
 * 能力値を主軸にするため、最終評価の「適性起因の逆転幅」を制限する。
 * final = raceRelativeScore + clamp(finalRaw - raceRelativeScore, -MAX, +MAX)
 */
const MAX_APTITUDE_SWING_FINAL = 8.0;
const MAX_APTITUDE_SWING_BASELINE = 6.0;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function capAptitudeSwing(
  relativeScore: number,
  rawScore: number,
  maxSwing: number,
): number {
  const swing = rawScore - relativeScore;
  return round1(relativeScore + clamp(swing, -maxSwing, maxSwing));
}

function computeHeavyWeightPowerBonus(horse: HorseAbility, condition: RaceCondition): number {
  const kg = horse.bodyWeightKg;
  if (kg == null || !Number.isFinite(kg) || kg < 500) return 0;
  const venueText = `${condition.venue ?? ""} ${condition.courseKey ?? ""}`;
  const hokkaido = /札幌|函館/.test(venueText);
  const dirt = condition.surface === "ダート";
  if (!hokkaido && !dirt) return 0;
  const base = 1.4 + Math.max(0, (kg - 500) * 0.02);
  const powerAmp = Math.max(0, (horse.power - 50) * 0.02);
  return round1(clamp(base + powerAmp, 0, 3.8));
}

function computeStaminaTestBonus(horse: HorseAbility, condition: RaceCondition): number {
  const venueText = `${condition.venue ?? ""} ${condition.courseKey ?? ""}`;
  const dist = condition.distance ?? 0;
  const staminaTest =
    (/中山/.test(venueText) && dist >= 1800) ||
    (/中京/.test(venueText) && dist >= 1800) ||
    (/東京/.test(venueText) && dist >= 2300);
  if (!staminaTest) return 0;
  const raw = ((horse.stamina + horse.power + horse.sustain) / 3 - 48) * 0.08;
  return round1(clamp(raw, -2.2, 3.2));
}

function inferCourseL2Demand01(condition: RaceCondition): number {
  const key = `${condition.venue} ${condition.courseKey ?? ""}`.toLowerCase();
  const dist = condition.distance ?? 0;
  const turf = condition.surface !== "ダート";
  let base =
    key.includes("東京") || key.includes("阪神")
      ? 0.85
      : key.includes("京都")
        ? 0.8
        : key.includes("中京") || key.includes("新潟")
          ? 0.72
          : 0.62;
  if (condition.pace === "slow" || condition.pace === "no_front_runner") base += 0.08;
  if (condition.trackSpeed === "fast") base += 0.04;
  if (condition.trackSpeed === "slow") base -= 0.05;
  /** 東京芝 1400〜1600 の瞬発マイルは L2（残り400〜200m）負荷が相対的に高い */
  if (key.includes("東京") && turf && dist >= 1400 && dist <= 1600) base += 0.07;
  return clamp(base, 0.45, 0.95);
}

function inferLastRunDisadvantageFromPastRuns(horse: HorseAbility): boolean {
  const last = horse.pastRuns?.[0];
  if (last == null) return false;
  const fastCloserBeaten =
    last.final3fRank != null &&
    last.place != null &&
    last.final3fRank <= 3 &&
    last.place >= 8;
  const closeLossWithPoorOrder =
    last.marginToWinnerSec != null &&
    last.place != null &&
    last.marginToWinnerSec <= 0.7 &&
    last.place >= 6;
  return fastCloserBeaten || closeLossWithPoorOrder;
}

function hasBiasDisadvantage(horse: HorseAbility): boolean {
  return (
    horse.was_bias_disadvantaged === true ||
    horse.bias_mismatch === true ||
    inferLastRunDisadvantageFromPastRuns(horse)
  );
}

function normalizeStoredL2Top01(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  /** JSON が 0〜1 のときそのまま、旧データの 0〜100 も許容 */
  if (raw > 1.01) return clamp(raw / 100, 0, 1);
  return clamp(raw, 0, 1);
}

function resolveL2Metrics(horse: HorseAbility): {
  hasData: boolean;
  topSpeed01: number;
  sustain01: number;
} {
  const topFromField =
    horse.l2_top_speed != null && Number.isFinite(horse.l2_top_speed)
      ? normalizeStoredL2Top01(horse.l2_top_speed)
      : null;
  const sustainFromField =
    horse.l2_sustain_ratio != null && Number.isFinite(horse.l2_sustain_ratio)
      ? clamp(horse.l2_sustain_ratio, 0, 1)
      : null;

  let topDerived = 0;
  let sustainDerived = 0.5;
  let hasDerived = false;
  for (const run of horse.pastRuns ?? []) {
    const sec = run.section200mSec;
    if (sec == null || sec.length < 4) continue;
    const l2 = sec[sec.length - 2];
    const l1 = sec[sec.length - 1];
    if (l2 == null || l1 == null || l2 <= 0 || l1 <= 0) continue;
    hasDerived = true;
    const l2Perf = clamp((13.5 - l2) / 2.7, 0, 1);
    const sustain = clamp((l2 / l1 - 0.85) / 0.15, 0, 1);
    if (l2Perf > topDerived) {
      topDerived = l2Perf;
      sustainDerived = sustain;
    }
  }

  const topSpeed01 = topFromField ?? topDerived;
  const sustain01 = sustainFromField ?? (hasDerived ? sustainDerived : 0.5);
  return {
    hasData: topFromField != null || sustainFromField != null || hasDerived,
    topSpeed01,
    sustain01,
  };
}

function lapFocusBlendWeights(condition: RaceCondition): {
  topW: number;
  sustainW: number;
  demandShift: number;
  bonusCap: number;
} {
  const v = `${condition.venue ?? ""} ${condition.courseKey ?? ""}`;
  const dist = condition.distance ?? 0;
  const turf = condition.surface !== "ダート";
  const physKey = resolveVenuePhysicalFactorKey(condition);
  const straight = physKey ? VENUE_PHYSICAL_FACTORS[physKey]?.straight ?? null : null;
  /** 直線が長い（東京・新潟外など）→最高速（L2）寄り、短い小回り→粘り・持続寄り */
  if (straight != null && straight >= 520) {
    return { topW: 0.92, sustainW: 0.08, demandShift: 0.05, bonusCap: LAP_FOCUS_MAX_BONUS * 1.15 };
  }
  if (straight != null && straight <= 315) {
    return { topW: 0.28, sustainW: 0.72, demandShift: -0.05, bonusCap: LAP_FOCUS_MAX_BONUS * 1.18 };
  }
  if (v.includes("東京") && turf && dist >= 1400 && dist <= 1600) {
    return { topW: 0.9, sustainW: 0.1, demandShift: 0.04, bonusCap: LAP_FOCUS_MAX_BONUS * 1.12 };
  }
  if (v.includes("京都") && turf && dist >= 3000) {
    return { topW: 0.2, sustainW: 0.8, demandShift: -0.03, bonusCap: LAP_FOCUS_MAX_BONUS * 1.2 };
  }
  if (turf && dist >= 3200) {
    return { topW: 0.25, sustainW: 0.75, demandShift: -0.04, bonusCap: LAP_FOCUS_MAX_BONUS * 1.2 };
  }
  return { topW: 0.75, sustainW: 0.25, demandShift: 0, bonusCap: LAP_FOCUS_MAX_BONUS };
}

function computeLapFocusBonus(horse: HorseAbility, condition: RaceCondition): number {
  const metrics = resolveL2Metrics(horse);
  if (!metrics.hasData) return 0;
  const w = lapFocusBlendWeights(condition);
  const horseL2Profile = metrics.topSpeed01 * w.topW + metrics.sustain01 * w.sustainW;
  const demand = clamp(inferCourseL2Demand01(condition) + w.demandShift, 0.45, 0.95);
  const match = clamp(1 - Math.abs(horseL2Profile - demand), 0, 1);
  return round1(clamp(w.bonusCap * match * horseL2Profile, 0, w.bonusCap));
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
  const evalHorses = horses
    .map((h) => blendAbilityWithPastRuns(h, condition))
    .map((h) => applyKickL2Emphasis(h, condition));
  const effectivePace = resolveEffectiveRacePace(condition, evalHorses);
  const evalCondition: RaceCondition = { ...condition, pace: effectivePace };
  const paceSeverity = inferPaceSeverityKind(evalHorses, evalCondition);
  const fourthCornerByHorse = estimateFourthCornerRanking(evalHorses, evalCondition);
  const styleSignalFactor = computeStyleSignalFactor(evalHorses);
  const kickTopMap = computeKickInTopFractionMap(evalHorses);
  const paceScenarioAmp = computePaceScenarioAmplifier(evalCondition);
  const baseWeights = getBaseWeights(evalCondition);
  const strengthMult = ADJUSTMENT_STRENGTH[evalCondition.adjustmentStrength];

  // 今日のレースラップ形状（敗因分解・ラップ形状一致に使う）
  const raceLapShape =
    evalCondition.section200mSec != null && evalCondition.section200mSec.length >= 4
      ? classifyLapStructure(evalCondition.section200mSec)
      : null;
  const effectiveRaceLapShape =
    raceLapShape != null && raceLapShape !== LAP_STRUCTURE.NEUTRAL
      ? raceLapShape
      : null;

  // 第3層: 今日のレース分類（瞬発戦・持続戦・消耗戦）
  const todayLapKind = classifyTodayLapKind(evalCondition);

  const results: HorseScoreResult[] = evalHorses.map((h) => {
    const rawBase = calcHorseScore(h, baseWeights);
    const finalWeights = getFinalWeightsForHorse(evalCondition, h, paceSeverity);
    const rawAdj = calcHorseScore(h, finalWeights);
    const bCore = baseAbilityCore(h);
    const eff = getEffectiveEvaluationSignals(h);
    const repro = round1(reproducibilityDelta(eff));
    const classBreakdown = computeClassLevelBonus(h, evalCondition);

    // 敗因分解適用のリスクペナルティ
    const risk = round1(computeAdjustedRiskPenalty(h.pastRuns, effectiveRaceLapShape, eff));

    // 第1層: 展開不問のエンジン素点バイアス
    const enginePeak = round1(enginePeakAdjustment(h));
    const intrinsic = round1(bCore + repro - risk + enginePeak);

    // MAX性能
    const maxPerf = computeMaxPerformance(h.pastRuns);

    // raceAdjustedInput: precomputed intrinsic + conditionScore + maxPerf
    const cond = round1(conditionScore(h, finalWeights));
    const cornerRank = fourthCornerByHorse.get(h.horseId)?.estimatedRank ?? 99;
    const cornerAbilityBias = fourthCornerAbilityBiasMultiplier(cornerRank, evalCondition);
    const layer3ProfileBonus = round1(computeCourseProfileMatchBonus(h, evalCondition));
    const rAdj = round1(
      raceAdjustedInput(
        intrinsic,
        cond,
        maxPerf,
        classBreakdown.classBonus + classBreakdown.stepPatternBonus,
        evalCondition.adjustmentStrength,
      ) *
        cornerAbilityBias +
        layer3ProfileBonus,
    );

    const baseScore = round1(rawBase);
    const adjustedScore = round1(rawAdj);
    const conditionFitDelta = round1(adjustedScore - intrinsic);
    const scoreDiff = round1(rawAdj - rawBase);

    // 分散リスク
    const variance = computeVariance(h.pastRuns);

    // 第2層: ラップ形状一致 + staminaResilience フラグ
    const lapFit = computeLapShapeFit(h, evalCondition);
    const lapShapeFitBonus = lapFit.reliable ? lapFit.score : 0;
    const raceAnalysisBonus = computeRaceAnalysisBonus(h, evalCondition, lapFit.reliable);

    // 第3層: 消耗戦×耐性フラグの強力な適性バフ
    const staminaResilienceBonus = computeStaminaResilienceBonus(
      todayLapKind,
      lapFit.staminaResilience,
    );

    return {
      horseId: h.horseId,
      horseName: h.horseName,
      baseScore,
      adjustedScore,
      scoreDiff,
      baseAbilityCore: round1(bCore),
      intrinsicAbilityScore: intrinsic,
      raceAdjustedInput: rAdj,
      estimatedFourthCornerRank: cornerRank,
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
      jockeyRiderBonus: 0,
      jockeyAmbitionFlag: false,
      heavyWeightPowerBonus: 0,
      staminaTestBonus: 0,
      trendBonus: 0,
      paceBalanceBonus: 0,
      tripContextBonus: 0,
      courseTraitBonus: 0,
      courseTraitReasons: [],
      finalEvaluationScore: 0,
      evaluationBaselineScore: 0,
      evaluationAdjustmentDelta: 0,
      lastMinuteAdjustmentBonus: 0,
      lastRunResetBonus: 0,
      lapFocusBonus: 0,
      adjustmentBadges: [],
      lapShapeFitBonus: round1(lapShapeFitBonus),
      raceAnalysisBonus: round1(raceAnalysisBonus),
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
      enginePeakBonus: enginePeak,
      staminaResilienceFlag: lapFit.staminaResilience.flag,
      staminaResilienceStrength01: round1(lapFit.staminaResilience.strength01),
      todayLapKind,
      staminaResilienceBonus: round1(staminaResilienceBonus),
      oddsDistortionFlag: false,
      oddsDistortionScore01: 0,
      oddsDistortionReasons: [],
      stabilityScore: 0,
      paceSeverityKind: paceSeverity,
    };
  });

  calibrateRaceAdjustedInputsForFieldClassTier(evalHorses, results);

  const relativeMode =
    evalCondition.adjustmentStrength === "strong" ? "absolute_delta" : "normalized";
  const rel = computeRaceRelativeScores(
    results.map((r) => ({ horseId: r.horseId, raceAdjustedInput: r.raceAdjustedInput })),
    relativeMode,
  );
  for (const h of evalHorses) {
    const r = results.find((x) => x.horseId === h.horseId);
    if (!r) continue;
    const relScore = rel.get(h.horseId) ?? 0;
    const paceEval = computePaceFitEvaluation(h, evalCondition, {
      kickInTopFraction: kickTopMap.get(h.horseId),
    });
    const pBonus = round1(paceEval.bonus * styleSignalFactor * paceScenarioAmp);
    const dBonus = computeDistanceFitBonus(h, evalCondition);
    const cBonus = r.classLevelBonus;
    const vPenalty = variancePenaltyPoints(computeVariance(h.pastRuns));
    const contextual = computeContextualBonuses(
      h,
      evalCondition,
      evalHorses.length,
      styleSignalFactor,
    );
    const biasDisadvantageRecoveryBonus =
      h.was_bias_disadvantaged === true ? BIAS_DISADVANTAGE_RECOVERY_BONUS : 0;
    const jockeyBd = computeJockeyRiderBonuses(h, condition);
    const jockeySum = sumJockeyRiderBonuses(jockeyBd);
    const heavyWeightPowerBonus = computeHeavyWeightPowerBonus(h, evalCondition);
    const staminaTestBonus = computeStaminaTestBonus(h, evalCondition);
    r.jockeyRiderBonus = jockeySum;
    r.jockeyAmbitionFlag = jockeyBd.ambitionFlag;
    r.heavyWeightPowerBonus = heavyWeightPowerBonus;
    r.staminaTestBonus = staminaTestBonus;
    const contextualTotal =
      contextual.pedigreeBonus +
      contextual.gateBiasBonus * FRAME_GATE_WEIGHT_RATIO +
      contextual.gateStyleSynergyBonus * FRAME_GATE_WEIGHT_RATIO +
      contextual.connectionsBonus +
      contextual.trendBonus +
      contextual.paceBalanceBonus +
      contextual.tripContextBonus +
      jockeySum +
      heavyWeightPowerBonus +
      staminaTestBonus;
    let conditionImpactBonus = conditionImpactBonusFromDiff(r.scoreDiff, evalCondition.adjustmentStrength);
    const adjustmentBadges: string[] = [];
    let lastRunResetBonus = 0;
    let lapFocusBonus = 0;
    lapFocusBonus = computeLapFocusBonus(h, evalCondition);
    if (jockeyBd.reasons.length > 0) {
      for (const tx of jockeyBd.reasons.slice(0, 3)) adjustmentBadges.push(tx);
    }
    if (heavyWeightPowerBonus > 0.1) {
      adjustmentBadges.push(`HEAVY_WEIGHT_POWER_BONUS +${heavyWeightPowerBonus.toFixed(1)}`);
    }
    if (staminaTestBonus > 0.1) {
      adjustmentBadges.push(`STAMINA_TEST_BONUS +${staminaTestBonus.toFixed(1)}`);
    }
    conditionImpactBonus = round1(conditionImpactBonus + lapFocusBonus);
    if (lapFocusBonus > 0.1) {
      adjustmentBadges.push("ラップ適合");
    }
    if (evalCondition.quickAdjustments?.lastRunReset && hasBiasDisadvantage(h)) {
      lastRunResetBonus = LAST_RUN_RESET_BONUS;
      adjustmentBadges.push("前走不利解消");
    }
    if (biasDisadvantageRecoveryBonus > 0.1) {
      adjustmentBadges.push("バイアス逆行救済");
    }
    const weakTierImpact = weakTierImpactFromDiff(r.scoreDiff, evalCondition.adjustmentStrength);
    const dScaled = round1(dBonus * strengthMult);
    const contextualScaled = round1(contextualTotal * strengthMult);
    const traitHits = [...computeCourseTraitHits(h, evalCondition), ...computeStructuralPhysicalHits(h, evalCondition)];
    const traitSum = traitHits.reduce((sum, hit) => sum + hit.bonus, 0);
    const courseTraitBonusRaw = round1(clamp(traitSum, -MAX_COURSE_TRAIT_TOTAL, MAX_COURSE_TRAIT_TOTAL));
    const courseTraitReasons = traitHits.map((hit) => {
      const sign = hit.bonus >= 0 ? "+" : "";
      return `${hit.label}: ${hit.reason} (${sign}${hit.bonus.toFixed(1)})`;
    });
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
    // 第3層 + コース特性が同方向に重なる場合の合算上限（特性が正のときのみ耐性バフと競合抑制）。
    let cappedCourseTraitBonus: number;
    let cappedResilienceBonus: number;
    if (courseTraitBonusRaw >= 0) {
      const courseAndResilience = clamp(
        courseTraitBonusRaw + r.staminaResilienceBonus,
        0,
        COURSE_TRAIT_PLUS_RESILIENCE_CAP,
      );
      cappedCourseTraitBonus = round1(
        clamp(courseAndResilience - r.staminaResilienceBonus, 0, courseTraitBonusRaw),
      );
      cappedResilienceBonus = round1(courseAndResilience - cappedCourseTraitBonus);
    } else {
      cappedCourseTraitBonus = courseTraitBonusRaw;
      cappedResilienceBonus = round1(r.staminaResilienceBonus);
    }
    r.courseTraitBonus = round1(cappedCourseTraitBonus);
    r.courseTraitReasons = courseTraitReasons;
    if (cappedResilienceBonus > 0.1) {
      adjustmentBadges.push("耐性バフ");
    }
    const classCombined = round1(clamp(cBonus + r.stepPatternBonus, -4.5, 5.5));
    const cornerPredBonus = fourthCornerPredictionBonus(
      fourthCornerByHorse.get(h.horseId)?.estimatedRank ?? 99,
    );
    const rpcPaceMismatchPenalty = computeRpcPaceMismatchPenalty(h, evalCondition);
    const lapShapeScaled =
      (r.lapShapeFitBonus + r.raceAnalysisBonus) * COURSE_SHAPE_FIT_RATIO +
      r.lapSustainBonus +
      r.lapQualityBonus +
      rpcPaceMismatchPenalty;
    // 既存ラップ枠 +16.8 内に staminaResilienceBonus を合算しクランプ。
    const lapStack = clamp(
      lapShapeScaled + cappedResilienceBonus,
      -10,
      LAP_STACK_TOTAL_CAP,
    );
    const baselineRaw = combineFinalEvaluationScore(
      relScore,
      pBonus,
      lapStack,
      dBonus,
      classCombined,
      vPenalty,
      contextualTotal,
      weakTierImpact,
      cornerPredBonus,
    );
    const finalRaw = combineFinalEvaluationScore(
      relScore,
      pBonus,
      lapStack,
      dScaled,
      classCombined,
      vPenalty,
      contextualScaled,
      conditionImpactBonus,
      cornerPredBonus,
    );
    const baselineWithExtras = round1(
      baselineRaw + r.courseTraitBonus + lastRunResetBonus + biasDisadvantageRecoveryBonus,
    );
    const finalWithExtras = round1(
      finalRaw + r.courseTraitBonus + lastRunResetBonus + biasDisadvantageRecoveryBonus,
    );
    r.evaluationBaselineScore = capAptitudeSwing(
      relScore,
      baselineWithExtras,
      MAX_APTITUDE_SWING_BASELINE,
    );
    r.finalEvaluationScore = capAptitudeSwing(
      relScore,
      finalWithExtras,
      MAX_APTITUDE_SWING_FINAL,
    );
    r.lastRunResetBonus = round1(lastRunResetBonus);
    r.lapFocusBonus = round1(lapFocusBonus);
    r.lastMinuteAdjustmentBonus = round1(
      lastRunResetBonus + lapFocusBonus + biasDisadvantageRecoveryBonus,
    );
    r.adjustmentBadges = adjustmentBadges;
    r.evaluationAdjustmentDelta = round1(r.finalEvaluationScore - r.evaluationBaselineScore);
    r.stabilityScore = computeStabilityScore(h, evalCondition, paceEval.token);
  }

  assignRanksForScore(results, "baseScore", "baseRank");
  assignRanksForScore(results, "adjustedScore", "adjustedRank");
  assignRanksForScore(results, "finalEvaluationScore", "finalRank");

  // 第4層: 「オッズの歪み」検知（ANA 厳密化用）。
  // viewModel 側で確率ブーストの基準にもなる。確率はこの段階では未確定なので
  // 0 を渡し、能力 percentile + 近走展開不適合 + 割安オッズの組合せで flag を立てる。
  const horseById = new Map(evalHorses.map((h) => [h.horseId, h] as const));
  for (const r of results) {
    const horse = horseById.get(r.horseId);
    if (!horse) continue;
    const distortion = detectOddsDistortion(horse, r, results, 0);
    r.oddsDistortionFlag = distortion.flag;
    r.oddsDistortionScore01 = distortion.score01;
    r.oddsDistortionReasons = distortion.reasons;
  }

  assignMarks(results);
  const cornerRankMap = new Map(
    [...fourthCornerByHorse].map(([id, est]) => [id, est.estimatedRank] as const),
  );
  applyCornerLeadFavoritePromotion(results, evalHorses, cornerRankMap);
  applyLongshotMarkGuard(evalHorses, results);
  const dismissIds = collectDismissIds(evalHorses, results, evalCondition);
  assignBuyLabels(results, dismissIds, evalHorses);
  for (const r of results) {
    if (r.buyLabel === BUY_LABELS.DISMISS) {
      r.mark = "";
    }
  }
  applyStabilityRescueMarks(results);
  assignHokkakeRoles(results, evalHorses, paceSeverity);
  assignCompleteMarks(results, dismissIds);

  // 最終安全策: 構造的消し（dismissIds）のみ印・ヒモ役をクリア。6位以下の buyLabel DISMISS でも △ は残す。
  for (const r of results) {
    if (dismissIds.has(r.horseId)) {
      r.mark = "";
      r.hokkakeRole = undefined;
    }
  }

  // 条件変更で構造消し集合が変わったときも、◎〜△ と △ 複数が欠けないよう再割当（ヒモ役も構造消し後に付け直す）
  assignHokkakeRoles(results, evalHorses, paceSeverity);
  assignCompleteMarks(results, dismissIds);

  // △ は「連下（相手）」として扱う。消しラベルのまま残さない。
  for (const r of results) {
    if (r.mark === "△" && r.buyLabel === BUY_LABELS.DISMISS) {
      r.buyLabel = BUY_LABELS.GROUP;
    }
  }

  for (const r of results) {
    const h = horseById.get(r.horseId);
    const fw =
      h != null
        ? getFinalWeightsForHorse(evalCondition, h, paceSeverity)
        : undefined;
    r.reason =
      fw != null ? generateScoreReason(r, evalCondition, fw) : generateScoreReason(r, evalCondition, getBaseWeights(evalCondition));
  }

  return results;
}
