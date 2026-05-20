import type { HorseAbility, HorseScoreResult } from "../../domain/race-evaluation/abilityTypes";
import { PYTHON_EV_MARGIN } from "../../domain/race-evaluation/investmentEvConstants";

/** マージン控除後の理論上の床（勝率0%・オッズ任意） */
export const AI_EV_FLOOR = -PYTHON_EV_MARGIN;

/** 最高EVがこれ未満なら「全員儲からない」帯 */
export const EV_WORTHLESS_THRESHOLD = -0.10;

/** 印候補7頭のEV標準偏差がこれ未満なら横並び */
export const EV_STDEV_THRESHOLD = 0.01;

export const AI_MARK_CANDIDATE_COUNT = 7;

export type AiRaceRegime = "NORMAL_AI_REGIME" | "NO_EV_REGIME";

export const NO_EV_REGIME_BANNER_TEXT =
  "【投資判断：低期待値につき見送り推奨】出走馬全体の期待値が横並びで、EV推奨馬券は出しません（買い目0点）。";

/**
 * 全頭EVが床付近で横並び（オークス型）かを判定。
 * AI 印・EV 推奨を出さないレジームを検知する。
 */
export function resolveAiRaceRegime(horses: readonly HorseAbility[]): AiRaceRegime {
  const evs = horses
    .map((h) => h.aiEffectiveEv)
    .filter((v): v is number => v != null && Number.isFinite(v));
  if (evs.length === 0) return "NORMAL_AI_REGIME";

  const maxEv = Math.max(...evs);
  const topEvs = [...evs].sort((a, b) => b - a).slice(0, AI_MARK_CANDIDATE_COUNT);
  if (topEvs.length < 2) return "NORMAL_AI_REGIME";

  const avg = topEvs.reduce((sum, val) => sum + val, 0) / topEvs.length;
  const variance =
    topEvs.reduce((sum, val) => sum + (val - avg) ** 2, 0) / topEvs.length;
  const stdev = Math.sqrt(variance);

  if (maxEv < EV_WORTHLESS_THRESHOLD && stdev < EV_STDEV_THRESHOLD) {
    return "NO_EV_REGIME";
  }

  return "NORMAL_AI_REGIME";
}

/** @deprecated NO_EV でも印は applyAiMarksByEffectiveEv で保持。テスト・後方互換用 */
export function clearMarksOnResults(
  results: readonly HorseScoreResult[],
): HorseScoreResult[] {
  return results.map((r) => ({ ...r, mark: "" as HorseScoreResult["mark"] }));
}
