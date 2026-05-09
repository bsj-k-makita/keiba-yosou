import { ABILITY_KEYS, type HorseAbility, type RaceCondition, type WeightSet } from "./abilityTypes";
import { reproducibilityDelta, riskPenaltyPoints } from "./evaluationSignals";
import { getEffectiveEvaluationSignals } from "./resolveEvaluationSignals";
import {
  classifyLapStructure,
  LAP_STRUCTURE,
  type LapStructureKind,
} from "./lapStructure";
import type { PastRunRecord } from "./pastRunTypes";
import { calcHorseScore, meanAbilityScore } from "./weightResolver";
import type { MaxPerfResult } from "./maxPerformance";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * 5軸平均 × 0.75 + 上位2軸平均 × 0.25（言語定義の「基礎能力」用ブレンド）
 */
export function baseAbilityCore(horse: HorseAbility): number {
  const m = meanAbilityScore(horse);
  const vals = ABILITY_KEYS.map((k) => horse[k]).sort((a, b) => b - a);
  const top2 = (vals[0]! + vals[1]!) / 2;
  return m * 0.75 + top2 * 0.25;
}

// ────────────────────────────────────────────────────────────────
// 第1層: エンジン素点（展開不問の絶対的なエンジン出力）
// ────────────────────────────────────────────────────────────────

/**
 * 1走をエンジン出力（IDM 相当）に換算する。
 * 着差（秒）優先、未設定時は着順で代替。1着付近を 100 として 0〜100 に収める。
 */
function pastRunToEngineSignal(run: PastRunRecord): number | null {
  const margin = run.marginToWinnerSec;
  if (margin != null && Number.isFinite(margin)) {
    // 0秒=100, 0.5秒=85, 1.0秒=70, 2.0秒=40
    return clamp(100 - margin * 30, 0, 100);
  }
  const place = run.place;
  if (place != null && place >= 1) {
    return clamp(100 - (place - 1) * 8, 0, 100);
  }
  return null;
}

function getRunShape(run: PastRunRecord): LapStructureKind | null {
  if (run.lapStructure != null) return run.lapStructure;
  const sec = run.section200mSec;
  if (sec != null && sec.length >= 4) return classifyLapStructure(sec);
  return null;
}

/**
 * 過去走から「IDM 相当のピーク」と「スロー切れ負け（瞬発戦での僅差負け）」の本数を抽出。
 * - peak: 上位2走のエンジン信号（top1×0.7 + top2×0.3）
 * - smallMarginGoodCount: 着差 0.4 秒以内に粘った好走の本数
 * - slowKickLossCount: 瞬発戦でのキレ負け（1着差 0.6〜1.5秒、上がり順位は中位以上）
 */
function summarizePastEngine(runs: readonly PastRunRecord[]): {
  peakSignal: number | null;
  smallMarginGoodCount: number;
  slowKickLossCount: number;
} {
  const slice = runs.slice(0, 5);
  const signals = slice
    .map(pastRunToEngineSignal)
    .filter((s): s is number => s != null)
    .sort((a, b) => b - a);

  let peakSignal: number | null = null;
  if (signals.length >= 2) {
    peakSignal = signals[0]! * 0.7 + signals[1]! * 0.3;
  } else if (signals.length === 1) {
    // 単発は信頼性低めに減衰
    peakSignal = signals[0]! * 0.65;
  }

  let smallMarginGoodCount = 0;
  let slowKickLossCount = 0;
  for (const run of slice) {
    const margin = run.marginToWinnerSec;
    if (margin != null && Number.isFinite(margin) && margin <= 0.4) {
      smallMarginGoodCount += 1;
    }
    const shape = getRunShape(run);
    const kickRank = run.final3fRank ?? 99;
    if (
      shape === LAP_STRUCTURE.SPRINT &&
      margin != null &&
      Number.isFinite(margin) &&
      margin >= 0.6 &&
      margin <= 1.5 &&
      kickRank <= 4
    ) {
      slowKickLossCount += 1;
    }
  }

  return { peakSignal, smallMarginGoodCount, slowKickLossCount };
}

/**
 * 第1層: 展開不問のエンジン素点ボーナス。
 * - 過去走 IDM 相当のピークが平均（50）から離れるほど ±方向にバイアス（クランプ ±5）
 * - 着差 0.4 秒以内の好走 1 本につき +0.4（最大 +1.2）
 * - スロー（瞬発戦）での切れ負けはエンジン視点で減点しない: 1 本につき +0.4（最大 +1.2）
 *
 * 範囲: −3 〜 +5（baseAbilityCore を破壊しない控えめなバイアス）
 */
export function enginePeakAdjustment(horse: HorseAbility): number {
  const runs = horse.pastRuns ?? [];
  if (runs.length === 0) return 0;
  const { peakSignal, smallMarginGoodCount, slowKickLossCount } = summarizePastEngine(runs);
  let adj = 0;
  if (peakSignal != null) {
    adj += clamp((peakSignal - 50) * 0.06, -3, 5);
  }
  adj += clamp(smallMarginGoodCount * 0.4, 0, 1.2);
  adj += clamp(slowKickLossCount * 0.4, 0, 1.2);
  return round1(clamp(adj, -3, 5));
}

/**
 * 再現性・大敗ペナルティ適用後の「基礎能力」表示用スコア（0〜100 想定域に収める）
 *
 * 第1層リファイン: エンジン素点（過去走 IDM 相当ピーク・スロー切れ負け緩和）を加算する。
 */
export function intrinsicAbilityWithAdjustments(horse: HorseAbility): number {
  const base = baseAbilityCore(horse);
  const eff = getEffectiveEvaluationSignals(horse);
  const r = reproducibilityDelta(eff);
  const p = riskPenaltyPoints(eff);
  const engine = enginePeakAdjustment(horse);
  return base + r - p + engine;
}

/**
 * 条件に依存しない素点。weight は既に正規化済みを想定。
 */
export function conditionScore(horse: HorseAbility, finalWeights: WeightSet): number {
  return calcHorseScore(horse, finalWeights);
}

type MixWeights = {
  base: number;
  condition: number;
  maxPerf: number;
};

const MIX_BY_STRENGTH: Record<RaceCondition["adjustmentStrength"], { withoutMax: MixWeights; withMax: MixWeights }> = {
  weak: {
    withoutMax: { base: 0.45, condition: 0.55, maxPerf: 0 },
    withMax: { base: 0.35, condition: 0.45, maxPerf: 0.20 },
  },
  middle: {
    withoutMax: { base: 0.30, condition: 0.70, maxPerf: 0 },
    withMax: { base: 0.20, condition: 0.65, maxPerf: 0.15 },
  },
  strong: {
    withoutMax: { base: 0.10, condition: 0.90, maxPerf: 0 },
    // strongはユーザーの舞台設定を最優先し、Intrinsic:Condition=10:90を固定する。
    withMax: { base: 0.10, condition: 0.90, maxPerf: 0.00 },
  },
};

/**
 * レース内相対化の前の合成分。
 * 補正強度に応じて intrinsic と条件適性の比率を切り替える。
 */
export function raceAdjustedMix(
  basePortion: number,
  conditionPortion: number,
  strength: RaceCondition["adjustmentStrength"] = "middle",
): number {
  const mix = MIX_BY_STRENGTH[strength].withoutMax;
  return mix.base * basePortion + mix.condition * conditionPortion;
}

/**
 * 相対化の入力。precomputed な intrinsic と conditionScore を受け取る。
 * maxPerf が reliable の場合は強度別の withMax 配合を使い、
 * 非 reliable 時は withoutMax 配合を使う。
 */
export function raceAdjustedInput(
  intrinsicScore: number,
  conditionScoreValue: number,
  maxPerf?: MaxPerfResult,
  classLevelBonus: number = 0,
  strength: RaceCondition["adjustmentStrength"] = "middle",
): number {
  const classMix = classLevelBonus * 0.9;
  const profile = MIX_BY_STRENGTH[strength];
  if (maxPerf?.reliable) {
    const mix = profile.withMax;
    return (
      mix.base * intrinsicScore +
      mix.condition * conditionScoreValue +
      mix.maxPerf * maxPerf.score +
      classMix
    );
  }
  const mix = profile.withoutMax;
  return mix.base * intrinsicScore + mix.condition * conditionScoreValue + classMix;
}
