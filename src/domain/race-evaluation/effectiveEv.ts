import type { RaceEntryEvaluation } from "../../lib/race-data/raceEvaluationTypes";
import { PYTHON_EV_MARGIN } from "./investmentEvConstants";

function n(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** エントリから単勝オッズを解決（JSON / investment 由来） */
export function pickEntryWinOdds(entry: RaceEntryEvaluation): number | undefined {
  const ext = entry as RaceEntryEvaluation & {
    market_win_odds?: number;
    marketWinOdds?: number;
    estimated_actual_odds?: number;
  };
  const fromSignals = entry.evaluationSignals?.winOdds;
  const candidates = [
    ext.market_win_odds,
    ext.marketWinOdds,
    ext.estimated_actual_odds,
    entry.investment?.actualOdds,
    fromSignals,
  ];
  for (const v of candidates) {
    const o = n(v);
    if (o != null && o > 0) return o;
  }
  return undefined;
}

export function pickEntryAiWinRate(entry: RaceEntryEvaluation): number | undefined {
  const ext = entry as RaceEntryEvaluation & { ai_predicted_win_rate?: number };
  return n(entry.aiPredictedWinRate) ?? n(ext.ai_predicted_win_rate);
}

/** バックフィル保存値（Python AI印 ◎ の判定基準） */
export function pickEntryStoredAiEffectiveEv(entry: RaceEntryEvaluation): number | undefined {
  const ext = entry as RaceEntryEvaluation & { ai_effective_ev?: number };
  return n(entry.aiEffectiveEv) ?? n(ext.ai_effective_ev);
}

/** 実質 EV = 勝率 × 単勝オッズ − マージン（オッズ欠損時は −margin） */
export function computeEffectiveEvFromParts(
  rate: number | undefined,
  odds: number | undefined,
  margin = PYTHON_EV_MARGIN,
): number | undefined {
  if (rate == null || !Number.isFinite(rate) || rate < 0) return undefined;
  if (odds == null || !Number.isFinite(odds) || odds <= 0) return -margin;
  return rate * odds - margin;
}

/**
 * エントリの実質EV。rate×odds が取れるときは再計算を優先（保存値が床 -0.15 のままのケース対策）。
 */
export function resolveEntryEffectiveEv(
  entry: RaceEntryEvaluation,
  margin = PYTHON_EV_MARGIN,
): number | undefined {
  const rate = pickEntryAiWinRate(entry);
  const odds = pickEntryWinOdds(entry);
  const recalc = computeEffectiveEvFromParts(rate, odds, margin);
  if (rate != null && odds != null && odds > 0 && recalc != null) return recalc;

  const stored =
    n(entry.aiEffectiveEv) ??
    n((entry as RaceEntryEvaluation & { ai_effective_ev?: number }).ai_effective_ev);
  if (stored != null) return stored;

  if (rate != null) return computeEffectiveEvFromParts(rate, undefined, margin);
  return undefined;
}
