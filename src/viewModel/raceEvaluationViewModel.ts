import {
  ABILITY_KEYS,
  getFinalWeights,
  resolveHorseEffectiveEv,
  type AbilityKey,
  type EffectiveEvSource,
  type HorseAbility,
  type HorseScoreResult,
  type RaceCondition,
} from "../domain/race-evaluation";
import { FINAL_EXPECTED_RECOMMEND_THRESHOLD } from "../domain/race-evaluation/investmentEvConstants";
import type { ProbabilityEngine } from "../lib/pipeline/probabilityEngine";

/**
 * 旧第4層（オッズ歪みブースト）は廃止。
 * 単勝確率は `finalEvaluationScore` 由来の softmax（adjustedProbabilities）のみ。
 * 期待値は ai_effective_ev を最優先。無いときのみ JSON の final_expected_value（フロントで再計算しない）。
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
  /** ai_effective_ev 優先、無いとき final_expected_value。未 enrich 時は null */
  effectiveEv: number | null;
  /** 表示に使った期待値の由来（AI / Node 簡易） */
  effectiveEvSource: EffectiveEvSource | null;
  kellyFraction: number;
  /** effectiveEv が閾値超え */
  evHot: boolean;
  /** EV推奨券（evTickets）に実際に含まれる馬番 */
  isEvRecommended: boolean;
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
    const { effectiveEv: rawEv, source: effectiveEvSource } = resolveHorseEffectiveEv(horse);
    const effectiveEv = rawEv != null ? round1(rawEv) : null;

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
      effectiveEvSource,
      kellyFraction,
      evHot: effectiveEv != null && effectiveEv > FINAL_EXPECTED_RECOMMEND_THRESHOLD,
      isEvRecommended: false,
      layerBreakdown,
      oddsDistortion: NEUTRAL_DISTORTION,
    });
  }
  return { byHorseId, probabilityEngine };
}

export function applyEvRecommendedFlags(
  viewModel: RaceEvaluationViewModel,
  horses: readonly HorseAbility[],
  evRecommendedGateNumbers: ReadonlySet<number>,
): RaceEvaluationViewModel {
  if (evRecommendedGateNumbers.size === 0) return viewModel;

  const nextByHorseId = new Map(viewModel.byHorseId);
  for (const horse of horses) {
    const gate = (horse as HorseAbility & { gate?: number }).gate;
    if (gate == null || !Number.isFinite(gate)) continue;
    const vm = nextByHorseId.get(horse.horseId);
    if (vm == null) continue;
    if (!evRecommendedGateNumbers.has(Math.round(gate))) continue;
    if (vm.isEvRecommended) continue;
    nextByHorseId.set(horse.horseId, { ...vm, isEvRecommended: true });
  }
  return { ...viewModel, byHorseId: nextByHorseId };
}
