import {
  ABILITY_KEYS,
  getFinalWeights,
  type AbilityKey,
  type HorseAbility,
  type HorseScoreResult,
  type RaceCondition,
} from "../domain/race-evaluation";

export type RaceEvaluationHorseViewModel = {
  horseId: string;
  weightedRadar: Record<AbilityKey, number>;
  adjustedWinProbability: number;
  effectiveEv: number | null;
  kellyFraction: number;
  evHot: boolean;
};

export type RaceEvaluationViewModel = {
  byHorseId: Map<string, RaceEvaluationHorseViewModel>;
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

export function buildRaceEvaluationViewModel(
  horses: readonly HorseAbility[],
  results: readonly HorseScoreResult[],
  condition: RaceCondition,
  adjustedProbabilities: ReadonlyMap<string, number>,
): RaceEvaluationViewModel {
  const weights = getFinalWeights(condition);
  const fieldSize = Math.max(1, horses.length);
  const evMargin = fieldSize >= 16 ? 0.2 : 0.15;
  const byHorseId = new Map<string, RaceEvaluationHorseViewModel>();
  const horseMap = new Map(horses.map((horse) => [horse.horseId, horse] as const));
  for (const result of results) {
    const horse = horseMap.get(result.horseId);
    if (!horse) continue;
    const probability = adjustedProbabilities.get(result.horseId) ?? 0;
    const odds = oddsOf(horse);
    const effectiveEv = odds == null ? null : round1(probability * odds - evMargin);
    const kellyFraction = kellyFractionFrom(probability, odds);
    byHorseId.set(result.horseId, {
      horseId: result.horseId,
      weightedRadar: toWeightedRadar(horse, weights),
      adjustedWinProbability: probability,
      effectiveEv,
      kellyFraction,
      evHot: effectiveEv != null && effectiveEv > 1.25,
    });
  }
  return { byHorseId };
}
