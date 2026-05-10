import type { HorseAbility, RaceCondition } from "./abilityTypes";
import {
  resolveVenuePhysicalFactorKey,
  VENUE_PHYSICAL_FACTORS,
  type VenuePhysicalFactor,
} from "./venuePhysicalFactors";
import { FOURTH_CORNER_PREDICTION_WEIGHT } from "./evaluationBlendWeights";

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** 脚質の「前に付きやすさ」ベース（低いほど4角で先頭に近い想定） */
const STYLE_ANCHOR: Record<string, number> = {
  逃げ: 1.0,
  先行: 2.3,
  好位: 4.5,
  差し: 7.2,
  追込: 9.8,
  自在: 4.0,
};

function pacePressureOffset(pace: string): number {
  if (pace === "slow" || pace === "no_front_runner") {
    return -1.1;
  }
  if (pace === "high" || pace === "many_front_runners") {
    return 1.25;
  }
  return 0;
}

function paceStyleInteraction(pace: string, style: string): number {
  const slow = pace === "slow" || pace === "no_front_runner";
  const fast = pace === "high" || pace === "many_front_runners";
  if (slow) {
    if (style === "逃げ" || style === "先行") return -1.4;
    if (style === "差し" || style === "追込") return 1.6;
  }
  if (fast) {
    if (style === "逃げ" || style === "先行") return 1.1;
    if (style === "差し" || style === "追込") return -1.6;
  }
  return 0;
}

function resolvePhysicalFactor(condition: RaceCondition): VenuePhysicalFactor | null {
  const key = resolveVenuePhysicalFactorKey(condition);
  if (key == null) return null;
  return VENUE_PHYSICAL_FACTORS[key] ?? null;
}

/**
 * 福島・中山・小倉など小回りコース（仕様の場別バイアス強化対象）。
 */
export function isSmallTurnBiasCourse(condition: RaceCondition): boolean {
  const blob = `${condition.courseKey ?? ""} ${condition.venue} ${condition.raceName ?? ""}`;
  return /福島|中山|小倉/.test(blob);
}

/**
 * 開幕週を近似: 明示フラグ / レース名 / 小回り×クッション軟め
 */
export function isApproxOpeningWeekTrack(condition: RaceCondition): boolean {
  if (condition.meetingPhase === "mid" || condition.meetingPhase === "closing") return false;
  if (condition.meetingPhase === "opening") return true;
  if (condition.openingMeetingWeek === true) return true;
  const name = condition.raceName ?? "";
  if (/開幕|初日|１日目|1日目/.test(name)) return true;
  const c = condition.trackCushion01;
  if (c != null && c < 0.44 && isSmallTurnBiasCourse(condition)) return true;
  return false;
}

/**
 * 最終週・馬場がタフ寄りのとき後方脚質の前進余地を広げる用途。
 */
export function isApproxClosingWeekTrack(condition: RaceCondition): boolean {
  if (condition.meetingPhase === "opening" || condition.meetingPhase === "mid") return false;
  if (condition.meetingPhase === "closing") return true;
  if (condition.closingMeetingWeek === true) return true;
  const name = condition.raceName ?? "";
  if (/最終日|全日程終了|最終週/.test(name)) return true;
  return false;
}

function straightShortCourse(factor: VenuePhysicalFactor | null): boolean {
  if (factor == null) return false;
  return factor.straight < 330;
}

function frameForwardBias(
  horse: HorseAbility,
  fieldSize: number,
  factor: VenuePhysicalFactor | null,
  condition: RaceCondition,
): number {
  const frame = horse.frameNumber;
  if (frame == null || !Number.isFinite(frame) || frame <= 0) return 0;
  const maxFrame = Math.max(1, Math.min(8, Math.ceil(fieldSize / 2)));
  const inner01 = maxFrame <= 1 ? 1 : (maxFrame - frame) / (maxFrame - 1);

  let w = 0;
  if (straightShortCourse(factor)) {
    w -= inner01 * 2.1;
  } else {
    w -= inner01 * 1.1;
  }

  const bias = condition.bias;
  if (bias === "inside_favor" || bias === "front_favor") {
    w -= inner01 * 1.4;
  } else if (bias === "outside_favor" || bias === "closer_favor") {
    w += (1 - inner01) * 1.1;
  }

  const style = horse.runningStyle;
  if (style === "逃げ" || style === "先行") {
    w -= inner01 * 0.8;
  } else if (style === "差し" || style === "追込") {
    w += (1 - inner01) * 0.7;
  }
  return w;
}

function abilityForwardBias(horse: HorseAbility): number {
  const sp = horse.speed ?? 50;
  const pw = horse.power ?? 50;
  return -(sp - 50) * 0.045 - (pw - 50) * 0.018;
}

export type FourthCornerEstimate = {
  /** 1=最先行想定、数値が大きいほど後方 */
  positionScore: number;
  /** 1..fieldSize 通過順（同点は馬IDで安定ソート） */
  estimatedRank: number;
};

/**
 * 初角〜4角付近の「相対的な前後イメージ」を脚質・枠・ペース・コース物理からスコア化し、レース内順位を付ける。
 */
export function estimateFourthCornerRanking(
  horses: readonly HorseAbility[],
  condition: RaceCondition,
): Map<string, FourthCornerEstimate> {
  const fieldSize = Math.max(1, horses.length);
  const factor = resolvePhysicalFactor(condition);
  const pace = condition.pace ?? "middle";

  const rows: { id: string; score: number }[] = [];
  for (const h of horses) {
    const style = h.runningStyle ?? "好位";
    const anchor = STYLE_ANCHOR[style] ?? 5;
    let score =
      anchor +
      pacePressureOffset(pace) +
      paceStyleInteraction(pace, style) +
      frameForwardBias(h, fieldSize, factor, condition) +
      abilityForwardBias(h);

    if (isApproxClosingWeekTrack(condition)) {
      if (style === "差し" || style === "追込") score += 0.45;
      if (style === "逃げ" || style === "先行") score -= 0.22;
    }

    /** 開幕週・明示フェーズ: 内・前寄りの隊列になりやすい想定で 4 角位置を詰める（倍率系 `strongOpen` と整合） */
    if (isApproxOpeningWeekTrack(condition)) {
      if (style === "逃げ" || style === "先行") score -= 0.36;
      if (style === "好位") score -= 0.14;
      if (style === "差し" || style === "追込") score += 0.34;
    }

    if (factor?.cornerRadius === "tight") {
      if (style === "逃げ" || style === "先行") score -= 0.7;
      if (style === "追込") score += 0.9;
    }

    rows.push({ id: h.horseId, score });
  }

  const sorted = [...rows].sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    return a.id.localeCompare(b.id);
  });

  const out = new Map<string, FourthCornerEstimate>();
  sorted.forEach((row, idx) => {
    out.set(row.id, {
      positionScore: round1(row.score),
      estimatedRank: idx + 1,
    });
  });
  return out;
}

/**
 * 4角5番手以内想定に対する能力素点バイアス（×1.15 または ×1.30）。
 */
export function fourthCornerAbilityBiasMultiplier(
  estimatedRank: number,
  condition: RaceCondition,
): number {
  if (estimatedRank > 5) return 1;
  const strongOpen =
    isSmallTurnBiasCourse(condition) || isApproxOpeningWeekTrack(condition);
  if (strongOpen) return 1.3;
  if (isApproxClosingWeekTrack(condition)) return 1.22;
  return 1.15;
}

/**
 * 4角予測の明示ボーナス（weight 1.5 を乗じた加点レール）。
 */
export function fourthCornerPredictionBonus(estimatedRank: number): number {
  if (estimatedRank > 5) return 0;
  const depth = 6 - estimatedRank;
  const raw = depth * 0.38 * FOURTH_CORNER_PREDICTION_WEIGHT;
  return round1(Math.min(6.5, raw));
}
