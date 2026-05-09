import {
  ABILITY_KEYS,
  detectOddsDistortion,
  getFinalWeights,
  type AbilityKey,
  type HorseAbility,
  type HorseScoreResult,
  type RaceCondition,
} from "../domain/race-evaluation";

/**
 * 第4層: viewModel が UI / 投資配分に渡す「オッズの歪み」根拠サマリ。
 */
export type OddsDistortionViewModel = {
  flag: boolean;
  score01: number;
  probabilityBoost: number;
  reasons: string[];
};

/**
 * 第1〜3層の評価根拠。コンパクト表示でも耐性バフの有無等が読み取れるよう、
 * scoreCalculator が算出した値をそのまま受け渡す。
 */
export type LayerBreakdownViewModel = {
  /** 第1層: 展開不問のエンジン素点バイアス */
  enginePeakBonus: number;
  /** 第2層: 消耗戦耐性フラグ */
  staminaResilienceFlag: boolean;
  /** 第2層: 耐性の強度 0〜1 */
  staminaResilienceStrength01: number;
  /** 第3層: 今日のレース分類 */
  todayLapKind: "瞬発戦" | "持続戦" | "消耗戦" | null;
  /** 第3層: 消耗戦×耐性で適用された適性バフ */
  staminaResilienceBonus: number;
};

export type RaceEvaluationHorseViewModel = {
  horseId: string;
  weightedRadar: Record<AbilityKey, number>;
  /** softmax 由来の素確率（補正前） */
  baseAdjustedWinProbability: number;
  /** 第4層の歪みブースト適用後の確率（effectiveEv / kellyFraction の元） */
  adjustedWinProbability: number;
  /** 期待値: probability × odds − margin */
  effectiveEv: number | null;
  /** Kelly 比率（0〜0.4） */
  kellyFraction: number;
  /** EV >= 1.25 のホット指標 */
  evHot: boolean;
  /** 第1〜3層の評価根拠（コンパクト表示でも参照可能） */
  layerBreakdown: LayerBreakdownViewModel;
  /** 第4層: オッズの歪み（割安感） */
  oddsDistortion: OddsDistortionViewModel;
};

export type RaceEvaluationViewModel = {
  byHorseId: Map<string, RaceEvaluationHorseViewModel>;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
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
    const baseProbability = adjustedProbabilities.get(result.horseId) ?? 0;
    const odds = oddsOf(horse);

    // 第4層: オッズの歪み検知。確率を渡して再評価し、cheap01 の判定を確率ベースで行う。
    const distortion = detectOddsDistortion(horse, result, results, baseProbability);

    // 「不当な割安感」を確率に乗せる。multiplicative ブースト + 0.95 でクランプ。
    const boostedProbability = clamp(
      baseProbability * (1 + distortion.probabilityBoost),
      0,
      0.95,
    );

    const effectiveEv = odds == null ? null : round1(boostedProbability * odds - evMargin);
    const kellyFraction = kellyFractionFrom(boostedProbability, odds);

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
      baseAdjustedWinProbability: baseProbability,
      adjustedWinProbability: boostedProbability,
      effectiveEv,
      kellyFraction,
      evHot: effectiveEv != null && effectiveEv > 1.25,
      layerBreakdown,
      oddsDistortion: {
        flag: distortion.flag,
        score01: distortion.score01,
        probabilityBoost: distortion.probabilityBoost,
        reasons: distortion.reasons,
      },
    });
  }
  return { byHorseId };
}
