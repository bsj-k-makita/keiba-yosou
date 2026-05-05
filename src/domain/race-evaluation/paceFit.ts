import type { HorseAbility, RaceCondition } from "./abilityTypes";
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
