import type { PastRunRecord } from "./pastRunTypes";

/**
 * 過去走1本あたりのパフォーマンス換算。0〜100。
 * 着差（秒）優先、未設定のとき着順で補完。
 */
function runToScore(run: PastRunRecord): number | null {
  const margin = run.marginToWinnerSec;
  if (margin != null && Number.isFinite(margin)) {
    // 0秒=100, 1.0秒=70, 1.5秒=55, 2.0秒=40, 3.3秒超=0
    return Math.max(0, Math.min(100, 100 - margin * 30));
  }
  const place = run.place;
  if (place != null && place >= 1) {
    // 1着=100, 2着=92, 5着=68, 10着=28
    return Math.max(0, Math.min(100, 100 - (place - 1) * 8));
  }
  return null;
}

// ────────────────────────────────────────────────────────────────
// MAX性能
// ────────────────────────────────────────────────────────────────

export type MaxPerfResult =
  | { reliable: true; score: number }
  | { reliable: false };

/** 有効サンプルが揃うまで信頼係数を下げる閾値 */
const CONFIDENCE_MIN_RUNS = 3;
/** top1 - top2 がこれを超えたら突出1走とみなして均等化 */
const OUTLIER_GAP_THRESHOLD = 25;

/**
 * 過去走の天井性能スコア（0〜100）。
 * - サンプル不足（< 3走）: 信頼係数で減衰
 * - top1 が突出している場合（gap > 25）: top1/top2 を均等化してから加重
 */
export function computeMaxPerformance(
  runs: readonly PastRunRecord[] | undefined,
): MaxPerfResult {
  if (!runs || runs.length === 0) return { reliable: false };

  const scores = runs
    .map(runToScore)
    .filter((s): s is number => s !== null);

  if (scores.length === 0) return { reliable: false };

  scores.sort((a, b) => b - a); // 降順

  const top1 = scores[0]!;
  const top2 = scores.length >= 2 ? scores[1]! : null;

  // 信頼係数: 1走=0.33, 2走=0.67, 3走以上=1.0
  const confidenceFactor = Math.min(1.0, scores.length / CONFIDENCE_MIN_RUNS);

  let rawScore: number;
  if (top2 == null) {
    rawScore = top1;
  } else if (top1 - top2 > OUTLIER_GAP_THRESHOLD) {
    // 突出1走は均等化して信頼性を下げる
    rawScore = top1 * 0.5 + top2 * 0.5;
  } else {
    rawScore = top1 * 0.7 + top2 * 0.3;
  }

  const score = Math.round(rawScore * confidenceFactor * 10) / 10;
  return { reliable: true, score };
}

// ────────────────────────────────────────────────────────────────
// 分散リスク
// ────────────────────────────────────────────────────────────────

export type RoleHint = "頭" | "軸" | "判定不能";

export type VarianceResult = {
  /** 過去走スコアの標準偏差（0〜）*/
  varianceScore: number;
  /** 軸向き / 頭向き / データ不足で判定不能 */
  roleHint: RoleHint;
  sampleCount: number;
};

/** stddev がこの値以上なら「頭向き」 */
const HIGH_VARIANCE_THRESHOLD = 20;
/** 分散判定に必要な最低サンプル数 */
const VARIANCE_MIN_RUNS = 3;

/**
 * パフォーマンス分散を計算し、軸/頭のロールヒントを付与。
 * サンプル < 3 の場合は「判定不能」とし、直接ペナルティは発生しない。
 */
export function computeVariance(
  runs: readonly PastRunRecord[] | undefined,
): VarianceResult {
  if (!runs || runs.length === 0) {
    return { varianceScore: 0, roleHint: "判定不能", sampleCount: 0 };
  }

  const scores = runs
    .map(runToScore)
    .filter((s): s is number => s !== null);

  if (scores.length < VARIANCE_MIN_RUNS) {
    return { varianceScore: 0, roleHint: "判定不能", sampleCount: scores.length };
  }

  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance =
    scores.reduce((s, x) => s + (x - mean) ** 2, 0) / (scores.length - 1);
  const stddev = Math.round(Math.sqrt(variance) * 10) / 10;

  const roleHint: RoleHint = stddev >= HIGH_VARIANCE_THRESHOLD ? "頭" : "軸";

  return { varianceScore: stddev, roleHint, sampleCount: scores.length };
}

/** finalEvaluationScore への分散ペナルティ（控えめ）。判定不能は 0。 */
const VARIANCE_PENALTY_FACTOR = 0.05;

export function variancePenaltyPoints(result: VarianceResult): number {
  if (result.roleHint === "判定不能") return 0;
  return Math.round(result.varianceScore * VARIANCE_PENALTY_FACTOR * 10) / 10;
}
