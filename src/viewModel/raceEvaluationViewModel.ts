import {
  ABILITY_KEYS,
  getFinalWeights,
  type AbilityKey,
  type HorseAbility,
  type HorseScoreResult,
  type RaceCondition,
} from "../domain/race-evaluation";
import { FINAL_EXPECTED_RECOMMEND_THRESHOLD } from "../domain/race-evaluation/investmentEvConstants";
import type { ProbabilityEngine } from "../lib/pipeline/probabilityEngine";

/**
 * 旧第4層（オッズ歪みブースト）は廃止。
 * 単勝確率は `finalEvaluationScore` 由来の softmax（adjustedProbabilities）のみ。
 * 期待値は JSON の final_expected_value を表示用とする（フロントで再計算しない）。
 */
export type OddsDistortionViewModel = {
  flag: boolean;
  score01: number;
  probabilityBoost: number;
  reasons: string[];
};

export type LayerBreakdownViewModel = {
  enginePeakBonus: number;
  staminaResilienceFlag: boolean;
  staminaResilienceStrength01: number;
  todayLapKind: "瞬発戦" | "持続戦" | "消耗戦" | null;
  staminaResilienceBonus: number;
};

export type RaceEvaluationHorseViewModel = {
  horseId: string;
  weightedRadar: Record<AbilityKey, number>;
  /** 単勝勝率 P（`finalEvaluationScore` → softmax のみ） */
  baseAdjustedWinProbability: number;
  adjustedWinProbability: number;
  /** JSON final_expected_value のみ。未 enrich 時は null（歪みブースト・別マージンでは再計算しない） */
  effectiveEv: number | null;
  kellyFraction: number;
  /** final_expected_value が閾値超え */
  evHot: boolean;
  layerBreakdown: LayerBreakdownViewModel;
  oddsDistortion: OddsDistortionViewModel;
};

export type RaceEvaluationViewModel = {
  byHorseId: Map<string, RaceEvaluationHorseViewModel>;
  /** 勝率・期待値表示に使ったソース */
  probabilityEngine: ProbabilityEngine;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function oddsOf(horse: HorseAbility): number | null {
  const fromInvestment = horse.investment?.actualOdds;
  if (fromInvestment != null && Number.isFinite(fromInvestment) && fromInvestment > 1) {
    return fromInvestment;
  }
  const fromSignal = horse.signals?.winOdds;
  if (fromSignal != null && Number.isFinite(fromSignal) && fromSignal > 1) {
    return fromSignal;
  }
  return null;
}

function toWeightedRadar(horse: HorseAbility, weights: Record<AbilityKey, number>): Record<AbilityKey, number> {
  const weighted = ABILITY_KEYS.map((key) => horse[key] * weights[key]);
  const max = Math.max(...weighted, 1);
  const out = {} as Record<AbilityKey, number>;
  for (let i = 0; i < ABILITY_KEYS.length; i += 1) {
    const key = ABILITY_KEYS[i]!;
    out[key] = round1(((weighted[i] ?? 0) / max) * 100);
  }
  return out;
}

function kellyFractionFrom(probability: number, odds: number | null): number {
  if (odds == null || odds <= 1) return 0;
  const b = odds - 1;
  const q = 1 - probability;
  const f = (b * probability - q) / b;
  return Math.max(0, Math.min(0.4, f));
}

const NEUTRAL_DISTORTION: OddsDistortionViewModel = {
  flag: false,
  score01: 0,
  probabilityBoost: 0,
  reasons: [],
};

export type BuildRaceEvaluationViewModelOptions = {
  probabilityEngine?: ProbabilityEngine;
};

export function buildRaceEvaluationViewModel(
  horses: readonly HorseAbility[],
  results: readonly HorseScoreResult[],
  condition: RaceCondition,
  adjustedProbabilities: ReadonlyMap<string, number>,
  options?: BuildRaceEvaluationViewModelOptions,
): RaceEvaluationViewModel {
  const probabilityEngine = options?.probabilityEngine ?? "ts";
  const weights = getFinalWeights(condition);
  const byHorseId = new Map<string, RaceEvaluationHorseViewModel>();
  const horseMap = new Map(horses.map((horse) => [horse.horseId, horse] as const));

  for (const result of results) {
    const horse = horseMap.get(result.horseId);
    if (!horse) continue;

    const mapP = adjustedProbabilities.get(result.horseId) ?? 0;
    const useAi =
      probabilityEngine === "ai" &&
      horse.aiPredictedWinRate != null &&
      Number.isFinite(horse.aiPredictedWinRate);
    const unifiedP = useAi ? horse.aiPredictedWinRate! : mapP;

    const odds = oddsOf(horse);
    const jsonEv = horse.investment?.finalExpectedValue;
    const aiEv = horse.aiEffectiveEv;
    const effectiveEv = useAi
      ? aiEv != null && Number.isFinite(aiEv)
        ? round1(aiEv)
        : null
      : jsonEv != null && Number.isFinite(jsonEv)
        ? round1(jsonEv)
        : null;

    const kw = horse.investment?.kellyWeight;
    const kellyFraction =
      kw != null && Number.isFinite(kw) ? Math.min(0.4, kw) : kellyFractionFrom(unifiedP, odds);

    const layerBreakdown: LayerBreakdownViewModel = {
      enginePeakBonus: result.enginePeakBonus,
      staminaResilienceFlag: result.staminaResilienceFlag,
      staminaResilienceStrength01: result.staminaResilienceStrength01,
      todayLapKind: result.todayLapKind,
      staminaResilienceBonus: result.staminaResilienceBonus,
    };

    byHorseId.set(result.horseId, {
      horseId: result.horseId,
      weightedRadar: toWeightedRadar(horse, weights),
      baseAdjustedWinProbability: unifiedP,
      adjustedWinProbability: unifiedP,
      effectiveEv,
      kellyFraction,
      evHot: effectiveEv != null && effectiveEv > FINAL_EXPECTED_RECOMMEND_THRESHOLD,
      layerBreakdown,
      oddsDistortion: NEUTRAL_DISTORTION,
    });
  }
  return { byHorseId, probabilityEngine };
}
