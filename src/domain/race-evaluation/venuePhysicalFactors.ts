import {
  ABILITY_KEYS,
  MAX_WEIGHT,
  MIN_WEIGHT,
  type RaceCondition,
  type WeightSet,
} from "./abilityTypes";

/**
 * 競馬場の物理特性（直線長・ゴール前坂・コーナー半径の目安）。
 * 数値は実装案に基づき、重み調整の相対比較用。
 */
export type VenuePhysicalFactor = {
  straight: number;
  uphill: number;
  cornerRadius: "tight" | "medium" | "wide";
};

export const VENUE_PHYSICAL_FACTORS: Record<string, VenuePhysicalFactor> = {
  東京: { straight: 525.9, uphill: 2.1, cornerRadius: "wide" },
  中山: { straight: 310.0, uphill: 2.2, cornerRadius: "tight" },
  京都外: { straight: 403.7, uphill: 0.0, cornerRadius: "wide" },
  京都内: { straight: 328.0, uphill: 0.0, cornerRadius: "medium" },
  阪神外: { straight: 473.6, uphill: 1.9, cornerRadius: "wide" },
  中京: { straight: 412.5, uphill: 2.0, cornerRadius: "medium" },
  福島: { straight: 292.0, uphill: 1.2, cornerRadius: "tight" },
  新潟外: { straight: 658.7, uphill: 0.0, cornerRadius: "wide" },
  小倉: { straight: 291.0, uphill: 0.0, cornerRadius: "tight" },
  札幌: { straight: 266.0, uphill: 0.0, cornerRadius: "wide" },
  函館: { straight: 262.0, uphill: 0.0, cornerRadius: "tight" },
};

function clampWeightsLocal(weights: WeightSet): WeightSet {
  const out = { ...weights };
  for (const key of ABILITY_KEYS) {
    const v = out[key];
    out[key] = Math.min(MAX_WEIGHT, Math.max(MIN_WEIGHT, v));
  }
  return out;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function normalizeWeightsLocal(weights: WeightSet): WeightSet {
  let sum = 0;
  for (const key of ABILITY_KEYS) {
    sum += weights[key];
  }
  if (sum <= 0) {
    const uniform = 1 / ABILITY_KEYS.length;
    return {
      speed: uniform,
      stamina: uniform,
      kick: uniform,
      sustain: uniform,
      power: uniform,
    };
  }
  const out: WeightSet = { ...weights };
  for (const key of ABILITY_KEYS) {
    out[key] = out[key] / sum;
  }
  return out;
}

/**
 * `courseKey` / `venue` / `raceName` から物理特性テーブルのキーを解決する。
 * アプリ側の会場キー（例: 阪神外・札幌函館）との対応をここで吸収する。
 */
export function resolveVenuePhysicalFactorKey(condition: RaceCondition): string | null {
  const venue = condition.courseKey ?? condition.venue;
  const blob = `${condition.courseKey ?? ""} ${condition.venue} ${condition.raceName ?? ""}`;

  if (/京都内/.test(blob) || condition.courseKey === "京都内") {
    return "京都内";
  }
  if (/京都/.test(blob) || venue.includes("京都")) {
    return "京都外";
  }

  if (venue === "阪神外" || /阪神外/.test(blob) || venue.includes("阪神")) {
    return "阪神外";
  }

  if (venue.includes("新潟")) {
    return "新潟外";
  }

  if (venue === "札幌函館") {
    if (/函館/.test(blob)) {
      return "函館";
    }
    return "札幌";
  }
  if (venue.includes("函館")) {
    return "函館";
  }
  if (venue.includes("札幌")) {
    return "札幌";
  }

  if (venue in VENUE_PHYSICAL_FACTORS) {
    return venue;
  }

  return null;
}

/**
 * 戦略ベースウェイト（`strategicWeights`）を出発点にし、直線・坂・コーナー・距離・芝ダの案ロジックで補正した後、正規化する。
 * 未定義会場は入力ベースをそのまま返す。
 */
export function applyVenuePhysicalFactorAdjustments(base: WeightSet, condition: RaceCondition): WeightSet {
  const key = resolveVenuePhysicalFactorKey(condition);
  if (key == null) {
    return { ...base };
  }
  const factor = VENUE_PHYSICAL_FACTORS[key];
  if (factor == null) {
    return { ...base };
  }

  const weights: WeightSet = { ...base };
  const distance = condition.distance ?? 1600;
  const surface = condition.surface ?? "芝";
  const cushion = condition.trackCushion01;
  const hasCushion = cushion != null && Number.isFinite(cushion);
  const firm = hasCushion ? clamp01(cushion) : null;
  /**
   * 柔らかい馬場ほど坂・踏み込み負荷を増幅。急坂コースでは係数を上げ、柔軟時は最大 ~1.5 相当まで。
   */
  let hillMult = 1;
  if (firm != null) {
    const softAmp = factor.uphill >= 1.8 ? 0.65 : 0.5;
    hillMult = 1 + (1 - firm) * softAmp;
  }

  if (factor.straight > 500) {
    weights.kick += 0.15;
    weights.sustain += 0.05;
    weights.speed -= 0.1;
  } else if (factor.straight < 320) {
    weights.speed += 0.15;
    weights.kick -= 0.15;
  }

  if (factor.uphill >= 1.8) {
    let pAdd = 0.15 * hillMult;
    let sAdd = 0.05 * hillMult;
    let spSub = 0.1 * (firm != null && firm > 0.62 ? 0.65 : 1);
    if (firm != null && firm > 0.62) {
      pAdd *= 0.72;
      sAdd *= 0.72;
    }
    weights.power += pAdd;
    weights.sustain += sAdd;
    weights.speed -= spSub;
  } else {
    let spBoost = 0.05;
    let kBoost = 0.05;
    if (firm != null && firm > 0.62) {
      spBoost += 0.06;
      kBoost += 0.04;
      weights.power -= 0.05;
    }
    weights.speed += spBoost;
    weights.kick += kBoost;
  }

  if (factor.cornerRadius === "tight") {
    weights.speed += 0.1;
    weights.power += 0.05;
    weights.kick -= 0.05;
  }

  if (distance >= 2400) {
    const longDistanceFactor = (distance - 2400) / 1000;
    weights.stamina += 0.15 + longDistanceFactor * 0.2;
    weights.sustain += 0.1;
    weights.speed -= 0.15;
    weights.kick -= 0.1;
  } else if (distance <= 1400) {
    weights.speed += 0.15;
    weights.stamina -= 0.15;
  }

  if (surface === "ダート") {
    weights.power += 0.1;
    weights.kick -= 0.1;
  }

  if (firm != null) {
    if (firm < 0.42) {
      weights.power += 0.08 * (1 - firm);
      weights.stamina += 0.06 * (1 - firm);
      weights.speed -= 0.04 * (1 - firm);
    }
    if (firm > 0.68) {
      weights.speed += 0.07 * firm;
      weights.power -= 0.05 * firm;
      weights.kick += 0.03 * firm;
    }
  }

  return normalizeWeightsLocal(clampWeightsLocal(weights));
}
