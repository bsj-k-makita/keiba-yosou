import type { HorseAbility, RaceCondition } from "./abilityTypes";
import { lookupBiasMasterTrackBias } from "./biasMasterLookup";
import type { PastRunRecord } from "./pastRunTypes";

type ContextualBonusBreakdown = {
  pedigreeBonus: number;
  gateBiasBonus: number;
  gateStyleSynergyBonus: number;
  connectionsBonus: number;
  trendBonus: number;
  paceBalanceBonus: number;
  tripContextBonus: number;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function centered01(v: number | undefined): number {
  if (v == null || !Number.isFinite(v)) return 0;
  return clamp((v - 0.5) * 2, -1, 1);
}

function inferSireBiasByName(horse: HorseAbility, condition: RaceCondition): number {
  const sire = horse.pedigree?.sireName;
  if (sire == null || sire.length === 0) return 0;

  let bonus = 0;
  const distance = condition.distance ?? 0;
  const venueKey = condition.courseKey ?? condition.venue;

  if (sire.includes("ルーラーシップ")) {
    if (venueKey.includes("京都")) bonus += 0.6;
    if (distance >= 2200) bonus += 0.8;
  }
  if (sire.includes("スワーヴリチャード")) {
    if (horse.sex === "牡" && distance >= 2200) bonus += 1.0;
    if (horse.sex === "牝" && distance > 0 && distance <= 2000) bonus += 1.0;
  }

  return bonus;
}

function inferCourseTopology(condition: RaceCondition): "flat" | "uphill" | "downhill_to_flat" {
  if (condition.courseTopology != null) return condition.courseTopology;
  const key = `${condition.courseKey ?? ""} ${condition.venue}`.toLowerCase();
  if (key.includes("京都")) return "downhill_to_flat";
  if (key.includes("阪神") || key.includes("中山")) return "uphill";
  return "flat";
}

function inferSlopePedigreeByName(horse: HorseAbility, topology: "flat" | "uphill" | "downhill_to_flat"): number {
  const joined = `${horse.pedigree?.sireName ?? ""} ${horse.pedigree?.damSireName ?? ""}`;
  if (joined.length === 0) return 0;
  let bonus = 0;
  if (topology === "downhill_to_flat") {
    if (joined.includes("プリンスリーギフト")) bonus += 0.8;
    if (joined.includes("グレイソヴリン") || joined.includes("グレイソブリン")) bonus += 0.8;
  }
  if (topology === "uphill" && joined.includes("ブランドフォード")) {
    bonus += 1.0;
  }
  return bonus;
}

function computePedigreeBonus(horse: HorseAbility, condition: RaceCondition): number {
  const p = horse.pedigree;
  if (p == null) return 0;

  const distance = condition.distance ?? 0;
  let bonus =
    centered01(p.courseFit01) * 1.8 +
    centered01(p.distanceFit01) * 2.2;

  if (horse.sex === "牡" && distance >= 2200) {
    bonus += centered01(p.maleStayerFit01) * 1.2;
  }
  if (horse.sex === "牝" && distance > 0 && distance <= 2000) {
    bonus += centered01(p.femaleMiddleFit01) * 1.2;
  }

  const topology = inferCourseTopology(condition);
  if (topology === "flat") {
    bonus += centered01(p.flatTrackFit01) * 1.2;
  } else if (topology === "uphill") {
    bonus += centered01(p.uphillTrackFit01) * 1.4;
  } else {
    bonus += centered01(p.downhillToFlatFit01) * 1.4;
  }
  bonus += inferSlopePedigreeByName(horse, topology);
  bonus += inferSireBiasByName(horse, condition);
  return round1(clamp(bonus, -4, 4));
}

/** ピンポイント指定（馬番／旧枠）の加点／減点。馬場傾向チャップによるグラデーションに加算。 */
const PINPOINT_FAV_GATE_BONUS = 8;
const PINPOINT_DIS_GATE_PENALTY = -8;

function horseGateNumber(horse: HorseAbility): number | null {
  // 馬番: ドメイン拡張の gate を優先し、無ければ JSON 由来の horseNumber（一覧・評価JSONの揺れ対応）
  const ex = horse as HorseAbility & { gate?: number; horseNumber?: number };
  const g = ex.gate ?? ex.horseNumber;
  if (g != null && Number.isFinite(g) && g >= 1 && g <= 36) return Math.round(g);
  return null;
}

function computePinpointGateBonus(horse: HorseAbility, condition: RaceCondition): number {
  const hn = horseGateNumber(horse);
  const favH = condition.favoredHorseNumbers ?? [];
  const disH = condition.disfavoredHorseNumbers ?? [];
  if (hn != null) {
    if (favH.includes(hn)) return PINPOINT_FAV_GATE_BONUS;
    if (disH.includes(hn)) return PINPOINT_DIS_GATE_PENALTY;
  }
  const frame = horse.frameNumber;
  if (frame == null || !Number.isFinite(frame) || frame <= 0) return 0;
  const fi = Math.round(frame);
  const fav = condition.favoredGateNumbers ?? [];
  const dis = condition.disfavoredGateNumbers ?? [];
  if (fav.includes(fi)) return PINPOINT_FAV_GATE_BONUS;
  if (dis.includes(fi)) return PINPOINT_DIS_GATE_PENALTY;
  return 0;
}

function defaultTrackBiasStrength01(condition: RaceCondition): number {
  if (condition.bias === "inside_favor" || condition.bias === "outside_favor") return 0.65;
  return 0;
}

/**
 * UI の馬場プリセットのみ（`bias_master.json` とは別系統）。
 */
function resolveManualTrackBias(condition: RaceCondition): {
  direction: number;
  strength01: number;
  isManualNeutral: boolean;
} {
  if (condition.bias === "inside_favor") {
    return {
      direction: 1,
      strength01: clamp(condition.trackBiasStrength01 ?? defaultTrackBiasStrength01(condition), 0, 1),
      isManualNeutral: false,
    };
  }
  if (condition.bias === "outside_favor") {
    return {
      direction: -1,
      strength01: clamp(condition.trackBiasStrength01 ?? defaultTrackBiasStrength01(condition), 0, 1),
      isManualNeutral: false,
    };
  }
  return {
    direction: 0,
    strength01: 0,
    /** 「フラット」のときだけ枠×脚質を物理寄りに（内外プリセット無しの意図） */
    isManualNeutral: condition.bias === "flat",
  };
}

/**
 * 手動プリセットに、`bias_master.json`（当日・当場・芝ダ）の内外・外差し傾向を合成する。
 */
function resolveTrackBias(condition: RaceCondition): { direction: number; strength01: number; isManualNeutral: boolean } {
  const manual = resolveManualTrackBias(condition);
  const overlay = lookupBiasMasterTrackBias(condition);
  if (overlay == null || overlay.strength01 < 0.06) {
    return manual;
  }

  if (condition.bias === "inside_favor" || condition.bias === "outside_favor") {
    return {
      ...manual,
      strength01: clamp(Math.max(manual.strength01, overlay.strength01 * 0.85), 0, 1),
    };
  }

  return {
    direction: overlay.direction,
    strength01: overlay.strength01,
    isManualNeutral: false,
  };
}

function computeGateBiasBonus(horse: HorseAbility, condition: RaceCondition, fieldSize: number): number {
  const pinpoint = computePinpointGateBonus(horse, condition);
  const maxAbs = 38;

  const frame = horse.frameNumber;
  if (frame == null || !Number.isFinite(frame) || frame <= 0) {
    return round1(clamp(pinpoint, -maxAbs, maxAbs));
  }

  const maxFrame = Math.max(1, Math.min(8, Math.ceil(fieldSize / 2)));
  const frame01 = maxFrame <= 1 ? 0.5 : clamp((frame - 1) / (maxFrame - 1), 0, 1);
  const insideAdv = (1 - frame01 - 0.5) * 2; // 内枠 +1, 外枠 -1
  const trackBias = resolveTrackBias(condition);
  // 馬場傾向がフラット等でグラデーションが無いときでも、馬番／枠ピンポイントは必ず効かせる
  if (trackBias.strength01 <= 0) {
    return round1(clamp(pinpoint, -maxAbs, maxAbs));
  }
  const turnAmp = clamp(1 + Math.max(0, (condition.turnCount ?? 2) - 2) * 0.15, 1, 1.6);

  // 内外バイアス指定時の効きを明確化するため、レンジ上限を引き上げる。
  const biasSyncMultiplier = 5;
  const sliderBonus = insideAdv * trackBias.direction * 3.6 * trackBias.strength01 * turnAmp * biasSyncMultiplier;
  return round1(clamp(sliderBonus + pinpoint, -maxAbs, maxAbs));
}

function computeGateStyleSynergyBonus(
  horse: HorseAbility,
  condition: RaceCondition,
  fieldSize: number,
  styleSignalFactor: number = 1,
): number {
  const frame = horse.frameNumber;
  if (frame == null || !Number.isFinite(frame) || frame <= 0) return 0;
  const maxFrame = Math.max(1, Math.min(8, Math.ceil(fieldSize / 2)));
  const frame01 = maxFrame <= 1 ? 0.5 : clamp((frame - 1) / (maxFrame - 1), 0, 1);
  const insideAdv = (1 - frame01 - 0.5) * 2; // 内 +1, 外 -1
  const turnAmp = clamp(1 + Math.max(0, (condition.turnCount ?? 2) - 2) * 0.18, 1, 1.7);
  const trackBias = resolveTrackBias(condition);
  let bonus = 0;

  if (trackBias.isManualNeutral) {
    // ユーザーがフラット指定した場合は、枠有利不利を抑えて物理ロスのみ残す。
    const physicalAmp = Math.max(0, turnAmp - 1);
    if (horse.runningStyle === "逃げ" || horse.runningStyle === "先行") {
      bonus = insideAdv * 1.2 * physicalAmp;
    } else if (horse.runningStyle === "差し" || horse.runningStyle === "追込") {
      bonus = -insideAdv * 0.6 * physicalAmp;
    } else {
      bonus = insideAdv * 0.5 * physicalAmp;
    }
    return round1(clamp(bonus * styleSignalFactor, -1.6, 1.6));
  }

  if (horse.runningStyle === "逃げ" || horse.runningStyle === "先行") {
    const biasAmp = trackBias.strength01 > 0 ? (1 + 0.6 * trackBias.direction) : 1;
    bonus = insideAdv * 2.6 * turnAmp * biasAmp;
    if (frame01 >= 0.75) bonus -= 0.8;
  } else if (horse.runningStyle === "差し" || horse.runningStyle === "追込") {
    const biasAmp = trackBias.strength01 > 0 ? (1 - 0.5 * trackBias.direction) : 1;
    bonus = (-insideAdv * 1.0) * biasAmp;
    if (frame01 <= 0.25) bonus -= 0.5;
  } else {
    bonus = insideAdv * 0.6;
  }
  return round1(clamp(bonus * styleSignalFactor, -4, 4));
}

function inferConnectionNameBonus(horse: HorseAbility, condition: RaceCondition): number {
  const distance = condition.distance ?? 0;
  const venueKey = condition.courseKey ?? condition.venue;
  if (!(venueKey.includes("京都") && distance >= 3000)) return 0;

  let bonus = 0;
  const jockey = horse.jockey ?? "";
  const trainer = horse.trainer ?? "";
  if (jockey.includes("ルメール")) bonus += 0.8;
  if (jockey.includes("レーン")) bonus += 0.8;
  if (trainer.includes("木村哲也")) bonus += 1.0;
  return bonus;
}

function computeConnectionsBonus(horse: HorseAbility): number {
  const s = horse.signals;
  if (s == null) return 0;

  const byRate =
    ((s.jockeyCourseWinRate01 ?? 0.08) - 0.08) * 16 +
    ((s.jockeyCoursePlaceRate01 ?? 0.24) - 0.24) * 8 +
    ((s.trainerCourseWinRate01 ?? 0.08) - 0.08) * 14 +
    ((s.trainerCoursePlaceRate01 ?? 0.24) - 0.24) * 7;
  return round1(clamp(byRate, -4, 4));
}

function computeTrendBonus(horse: HorseAbility, condition: RaceCondition): number {
  const distance = condition.distance ?? 0;
  let bonus = 0;

  if (horse.age != null) {
    if (distance >= 3000) {
      if (horse.age === 4 || horse.age === 5) bonus += 1.4;
      else if (horse.age === 6) bonus -= 1.0;
      else if (horse.age >= 7) bonus -= 2.0;
      else if (horse.age <= 3) bonus -= 0.8;
    } else if (distance <= 2000) {
      if (horse.age === 3) bonus += 0.4;
      if (horse.age >= 7) bonus -= 1.0;
    }
  }

  if (horse.bodyWeightKg != null) {
    if (distance >= 3000) {
      if (horse.bodyWeightKg < 460 && horse.bodyWeightKg >= 430) bonus += 0.8;
      if (horse.bodyWeightKg < 430) bonus -= 0.8;
      if (horse.bodyWeightKg > 520) bonus -= 0.6;
    }
  }

  // 長距離では折り合い不安を強めに減点（道中ロスの再現性が下がる）
  const temperament01 = clamp(horse.signals?.temperamentConcern01 ?? 0, 0, 1);
  const temperamentRisk = horse.signals?.temperamentRisk === true;
  if (temperament01 > 0 || temperamentRisk) {
    const risk = Math.max(temperament01, temperamentRisk ? 0.7 : 0);
    const distanceAmp = distance >= 3000 ? 1.3 : distance >= 2400 ? 1.0 : 0.7;
    bonus -= risk * 1.8 * distanceAmp;
  }

  return round1(clamp(bonus, -3, 3));
}

function runPerformance01(run: PastRunRecord): number | null {
  if (run.marginToWinnerSec != null && Number.isFinite(run.marginToWinnerSec)) {
    return clamp((1.5 - run.marginToWinnerSec) / 1.5, 0, 1);
  }
  if (run.place != null && run.place >= 1) {
    return clamp((8 - run.place) / 7, 0, 1);
  }
  return null;
}

function runPaceDeltaSec(run: PastRunRecord): number | null {
  const s = run.section200mSec;
  if (s == null || s.length < 4) return null;
  if (s.length >= 6) {
    const front3 = s[0]! + s[1]! + s[2]!;
    const n = s.length;
    const last3 = s[n - 1]! + s[n - 2]! + s[n - 3]!;
    return front3 - last3;
  }
  const front2 = s[0]! + s[1]!;
  const n = s.length;
  const last2 = s[n - 1]! + s[n - 2]!;
  return (front2 - last2) * 1.5;
}

function raceTargetPaceDelta(condition: RaceCondition): number {
  const s = condition.section200mSec;
  if (s != null && s.length >= 6) {
    const front3 = s[0]! + s[1]! + s[2]!;
    const n = s.length;
    const last3 = s[n - 1]! + s[n - 2]! + s[n - 3]!;
    return front3 - last3;
  }
  if (condition.pace === "high" || condition.pace === "many_front_runners") return 1.2;
  if (condition.pace === "slow" || condition.pace === "no_front_runner") return -1.2;
  return 0;
}

function computePaceBalanceBonus(horse: HorseAbility, condition: RaceCondition): number {
  const runs = horse.pastRuns;
  if (runs == null || runs.length === 0) return 0;

  let weightedDelta = 0;
  let weightSum = 0;
  for (let i = 0; i < Math.min(5, runs.length); i += 1) {
    const run = runs[i]!;
    const delta = runPaceDeltaSec(run);
    const perf = runPerformance01(run);
    if (delta == null || perf == null) continue;
    const recency = 1 - i * 0.15;
    const w = recency * (0.5 + perf * 0.5);
    weightedDelta += delta * w;
    weightSum += w;
  }
  if (weightSum <= 0) return 0;

  const horseDelta = weightedDelta / weightSum;
  const target = raceTargetPaceDelta(condition);
  const horseNorm = clamp(horseDelta / 2.4, -1, 1);
  const targetNorm = clamp(target / 2.4, -1, 1);
  const fit01 = clamp(1 - Math.abs(horseNorm - targetNorm), 0, 1);
  const bonus = (fit01 - 0.5) * 2 * 2.6;
  return round1(clamp(bonus, -3, 3));
}

function computeTripContextBonus(horse: HorseAbility): number {
  const runs = horse.pastRuns;
  if (runs == null || runs.length === 0) return 0;

  let trouble = 0;
  let benefit = 0;
  let weightSum = 0;
  for (let i = 0; i < Math.min(3, runs.length); i += 1) {
    const run = runs[i]!;
    const w = 1 - i * 0.25;
    trouble += clamp(run.tripTrouble01 ?? 0, 0, 1) * w;
    benefit += clamp(run.tripBenefit01 ?? 0, 0, 1) * w;
    weightSum += w;
  }
  if (weightSum <= 0) return 0;

  const trouble01 = trouble / weightSum;
  const benefit01 = benefit / weightSum;
  const bonus = (trouble01 - benefit01) * 2.6;
  return round1(clamp(bonus, -2.5, 2.5));
}

export function computeContextualBonuses(
  horse: HorseAbility,
  condition: RaceCondition,
  fieldSize: number,
  styleSignalFactor: number = 1,
): ContextualBonusBreakdown {
  const pedigreeBonus = computePedigreeBonus(horse, condition);
  const gateBiasBonus = computeGateBiasBonus(horse, condition, fieldSize);
  const gateStyleSynergyBonus = computeGateStyleSynergyBonus(
    horse,
    condition,
    fieldSize,
    clamp(styleSignalFactor, 0.35, 1),
  );
  const connectionsBonus = round1(
    clamp(computeConnectionsBonus(horse) + inferConnectionNameBonus(horse, condition), -4, 4),
  );
  const trendBonus = computeTrendBonus(horse, condition);
  const paceBalanceBonus = computePaceBalanceBonus(horse, condition);
  const tripContextBonus = computeTripContextBonus(horse);

  return {
    pedigreeBonus,
    gateBiasBonus,
    gateStyleSynergyBonus,
    connectionsBonus,
    trendBonus,
    paceBalanceBonus,
    tripContextBonus,
  };
}
