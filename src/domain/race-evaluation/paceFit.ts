import type { HorseAbility, RaceCondition } from "./abilityTypes";
import { classifyLapStructure, LAP_STRUCTURE } from "./lapStructure";
import { PACE_FIT, type PaceFitToken, type RunningStyle } from "./lingoConstants";

const P_TOK = PACE_FIT;

/** API pace key → 脚質照合用の3段階 */
function paceTier(pace: string): "slow" | "middle" | "high" {
  if (pace === "slow" || pace === "no_front_runner") return "slow";
  if (pace === "high" || pace === "many_front_runners") return "high";
  return "middle";
}

function tokenToN(t: PaceFitToken): number {
  if (t === P_TOK.PERFECT) return 3;
  if (t === P_TOK.FIT) return 2;
  if (t === P_TOK.MAYBE) return 1;
  return 0;
}

function nToToken(n: number): PaceFitToken {
  if (n >= 3) return P_TOK.PERFECT;
  if (n >= 2) return P_TOK.FIT;
  if (n >= 1) return P_TOK.MAYBE;
  return P_TOK.BAD;
}

const PACE: Record<"slow" | "middle" | "high", Record<RunningStyle, PaceFitToken>> = {
  slow: {
    逃げ: P_TOK.PERFECT,
    先行: P_TOK.PERFECT,
    好位: P_TOK.FIT,
    差し: P_TOK.MAYBE,
    追込: P_TOK.BAD,
    自在: P_TOK.FIT,
  },
  middle: {
    逃げ: P_TOK.FIT,
    先行: P_TOK.FIT,
    好位: P_TOK.PERFECT,
    差し: P_TOK.FIT,
    追込: P_TOK.MAYBE,
    自在: P_TOK.FIT,
  },
  high: {
    逃げ: P_TOK.MAYBE,
    先行: P_TOK.MAYBE,
    好位: P_TOK.FIT,
    差し: P_TOK.FIT,
    追込: P_TOK.PERFECT,
    自在: P_TOK.FIT,
  },
};

const BIAS: Record<string, Record<RunningStyle, PaceFitToken>> = {
  flat: {
    逃げ: P_TOK.FIT,
    先行: P_TOK.FIT,
    好位: P_TOK.FIT,
    差し: P_TOK.FIT,
    追込: P_TOK.FIT,
    自在: P_TOK.FIT,
  },
  front_favor: {
    逃げ: P_TOK.PERFECT,
    先行: P_TOK.PERFECT,
    好位: P_TOK.FIT,
    差し: P_TOK.MAYBE,
    追込: P_TOK.BAD,
    自在: P_TOK.FIT,
  },
  closer_favor: {
    逃げ: P_TOK.MAYBE,
    先行: P_TOK.MAYBE,
    好位: P_TOK.FIT,
    差し: P_TOK.PERFECT,
    追込: P_TOK.PERFECT,
    自在: P_TOK.FIT,
  },
  inside_favor: {
    逃げ: P_TOK.PERFECT,
    先行: P_TOK.FIT,
    好位: P_TOK.FIT,
    差し: P_TOK.MAYBE,
    追込: P_TOK.BAD,
    自在: P_TOK.FIT,
  },
  outside_favor: {
    逃げ: P_TOK.MAYBE,
    先行: P_TOK.MAYBE,
    好位: P_TOK.FIT,
    差し: P_TOK.FIT,
    追込: P_TOK.FIT,
    自在: P_TOK.FIT,
  },
};

/**
 * 脚質 × 今回条件（ペース＋バイアス）に基づく展開適合。能力値は変更しない。
 */
export function computePaceFitLevel(horse: HorseAbility, condition: RaceCondition): PaceFitToken {
  const rs = horse.runningStyle;
  const pt = paceTier(condition.pace);
  const p = PACE[pt]?.[rs] ?? P_TOK.FIT;
  const b = (BIAS[condition.bias] ?? BIAS.flat)?.[rs] ?? P_TOK.FIT;
  return nToToken(Math.min(tokenToN(p), tokenToN(b)));
}

// ────────────────────────────────────────────────────────────────
// 第3層: 今日のレース分類（瞬発戦・持続戦・消耗戦）と適性バフ
// ────────────────────────────────────────────────────────────────

export type TodayLapKind = "瞬発戦" | "持続戦" | "消耗戦";

/**
 * 今日のレースを「瞬発戦・持続戦・消耗戦」のいずれかに事前分類する。
 * 200m 通過が 4 本以上揃うときはラップ分類器、そうでなければ pace ヒントから推定。
 * 判定不能の場合は null。
 */
export function classifyTodayLapKind(condition: RaceCondition): TodayLapKind | null {
  const sec = condition.section200mSec;
  if (sec != null && sec.length >= 4) {
    const k = classifyLapStructure(sec);
    if (k === LAP_STRUCTURE.GRIND) return "消耗戦";
    if (k === LAP_STRUCTURE.SUSTAIN) return "持続戦";
    if (k === LAP_STRUCTURE.SPRINT) return "瞬発戦";
    if (k === LAP_STRUCTURE.CRUISE) return "持続戦";
    return null;
  }
  if (condition.pace === "high" || condition.pace === "many_front_runners") return "消耗戦";
  if (condition.pace === "slow" || condition.pace === "no_front_runner") return "瞬発戦";
  return null;
}

/** 第2層 staminaResilience が立っている馬への第3層バフの最大値（既存ラップ枠 +16.8 に収める前提）。 */
export const STAMINA_RESILIENCE_BONUS_MAX = 6.0;

/**
 * 今日が「消耗戦」かつ第2層の `staminaResilience` フラグを持つ馬に強力な適性バフを与える。
 * - 消耗戦 + flag: +6.0 × strength01（最大 +6.0）
 * - 持続戦 + flag: +3.0 × strength01（最大 +3.0）
 * - 瞬発戦 / 判定不能: 0
 *
 * `strength01` は `lapShapeFit.detectStaminaResilience` の結果に紐づく 0〜1 の強度。
 * 既存のラップ適合ボーナス（lapShapeFit / raceAnalysis / sustain / quality）枠と
 * 合算され、scoreCalculator 側で +16.8 にクランプされる。
 */
export function computeStaminaResilienceBonus(
  todayLapKind: TodayLapKind | null,
  staminaResilience: { flag: boolean; strength01: number },
): number {
  if (!staminaResilience.flag || todayLapKind == null) return 0;
  const s = Math.max(0, Math.min(1, staminaResilience.strength01));
  if (todayLapKind === "消耗戦") {
    return Math.round(STAMINA_RESILIENCE_BONUS_MAX * Math.max(s, 0.6) * 10) / 10;
  }
  if (todayLapKind === "持続戦") {
    return Math.round(3.0 * Math.max(s, 0.6) * 10) / 10;
  }
  return 0;
}
