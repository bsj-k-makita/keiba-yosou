import type { HorseAbility, RaceCondition } from "./abilityTypes";
import { PACE_FIT_EXTREME_BAD_BONUS, paceFitToBonus } from "./finalScoring";
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

function computeBasePaceFitToken(horse: HorseAbility, condition: RaceCondition): PaceFitToken {
  const rs = horse.runningStyle;
  const pt = paceTier(condition.pace);
  const p = PACE[pt]?.[rs] ?? P_TOK.FIT;
  const b = (BIAS[condition.bias] ?? BIAS.flat)?.[rs] ?? P_TOK.FIT;
  return nToToken(Math.min(tokenToN(p), tokenToN(b)));
}

export type PaceFitComputeContext = {
  /**
   * true = kick がフィールド上位割合内。false のとき「前残り×差し/追込」末脚ゲートで × へ落とす。
   * 未指定時は末脚ゲートを適用しない（単頭評価・JSON 部分更新との互換）。
   */
  kickInTopFraction?: boolean;
};

/**
 * 脚質×ペース×バイアスに加え、(1) 前残り×スローの合成厳格化、(2) 末脚レース内順位ゲート、(3) × の極端ペナルティを反映した展開適合。
 */
export function computePaceFitEvaluation(
  horse: HorseAbility,
  condition: RaceCondition,
  context?: PaceFitComputeContext,
): { token: PaceFitToken; bonus: number } {
  const rs = horse.runningStyle;
  let token = computeBasePaceFitToken(horse, condition);
  let compoundExtreme = false;

  const pt = paceTier(condition.pace);
  if (condition.bias === "front_favor" && pt === "slow") {
    if (rs === "差し") {
      token = P_TOK.BAD;
    }
    if (rs === "追込") {
      token = P_TOK.BAD;
      compoundExtreme = true;
    }
  }

  if (
    condition.bias === "front_favor" &&
    (rs === "差し" || rs === "追込") &&
    context?.kickInTopFraction === false
  ) {
    token = P_TOK.BAD;
  }

  let bonus = paceFitToBonus(token);
  if (compoundExtreme) {
    bonus = PACE_FIT_EXTREME_BAD_BONUS;
  }
  return { token, bonus };
}

/**
 * 脚質 × 今回条件（ペース＋バイアス）に基づく展開適合記号（◎〜×）。`context` があるとき末脚ゲートを適用。
 */
export function computePaceFitLevel(
  horse: HorseAbility,
  condition: RaceCondition,
  context?: PaceFitComputeContext,
): PaceFitToken {
  return computePaceFitEvaluation(horse, condition, context).token;
}

/**
 * kick でソートし、上位 `topFraction`（既定 0.2）に入る馬を true とするマップ。同一レース内でのみ意味を持つ。
 */
export function computeKickInTopFractionMap(
  horses: readonly HorseAbility[],
  topFraction: number = 0.2,
): Map<string, boolean> {
  const n = horses.length;
  const out = new Map<string, boolean>();
  if (n === 0) return out;
  const sorted = [...horses].sort((a, b) => b.kick - a.kick || a.horseId.localeCompare(b.horseId));
  const topCount = Math.max(1, Math.ceil(n * topFraction));
  const topIds = new Set(sorted.slice(0, topCount).map((h) => h.horseId));
  for (const h of horses) {
    out.set(h.horseId, topIds.has(h.horseId));
  }
  return out;
}

/** strong かつ前残り指定時、展開ペナルティ／加点のレバレッジを上げる。 */
export function computePaceScenarioAmplifier(condition: RaceCondition): number {
  if (condition.adjustmentStrength === "strong" && condition.bias === "front_favor") {
    return 1.6;
  }
  return 1.0;
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
