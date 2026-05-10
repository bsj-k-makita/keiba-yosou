import type { HorseAbility, RaceCondition } from "./abilityTypes";
import {
  classifyLapStructure,
  LAP_STRUCTURE,
  type LapStructureKind,
} from "./lapStructure";
import type { PastRunRecord } from "./pastRunTypes";

/**
 * 第2層: 消耗戦耐性（底力フラグ）の根拠
 * - rpc: 前後傾差 (front3 - back3, 秒)。負ほど後傾、正ほど前傾消耗戦寄り
 * - fieldL1Decel: 全体ラップの L1 減速幅 (l1 - l2, 秒)
 * - horseMarginSec: 当該馬の勝ち馬からの着差
 * - resilient: フィールド減速幅に対し、当該馬の落伸び率が小さく耐えていたか
 */
export type StaminaResilienceEvidence = {
  raceId?: string;
  date?: string;
  rpc: number;
  fieldL1Decel: number;
  horseMarginSec: number;
  resilient: boolean;
};

export type StaminaResilienceResult = {
  /** 1走以上で耐性が確認できた */
  flag: boolean;
  /** 0〜1: 耐性の強度。複数走で確認できるほど高い */
  strength01: number;
  evidence: readonly StaminaResilienceEvidence[];
};

export type ShapeFitResult =
  | {
      reliable: true;
      score: number;
      sustainBonus: number;
      qualityBonus: number;
      lapProfile: "瞬発戦型" | "消耗戦型" | "一貫型";
      staminaResilience: StaminaResilienceResult;
    }
  | {
      reliable: false;
      sustainBonus: number;
      qualityBonus: number;
      lapProfile: "瞬発戦型" | "消耗戦型" | "一貫型";
      staminaResilience: StaminaResilienceResult;
    };

/** 非中間ラップ分類の最低必要サンプル数 */
const MIN_NON_NEUTRAL_RUNS = 2;

/** score の最大絶対値（一致率 100% or 0% のとき ±3） */
const SHAPE_FIT_MAX = 3;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function getRunShape(run: PastRunRecord): LapStructureKind | null {
  if (run.lapStructure != null) return run.lapStructure;
  const sec = run.section200mSec;
  if (sec != null && sec.length >= 4) {
    return classifyLapStructure(sec);
  }
  return null;
}

function inferLapProfile(horse: HorseAbility): "瞬発戦型" | "消耗戦型" | "一貫型" {
  if (horse.kick >= horse.sustain + 8) return "瞬発戦型";
  if (horse.sustain >= horse.kick + 6 || horse.stamina >= 60) return "消耗戦型";
  return "一貫型";
}

function isMiddleDistanceRun(run: PastRunRecord): boolean {
  const d = run.raceDistance;
  return d != null && d >= 1800 && d <= 2400;
}

function isGradedRun(run: PastRunRecord): boolean {
  return run.raceClass === "G1" || run.raceClass === "G2" || run.raceClass === "G3";
}

function computeLapQualityBonus(runs: readonly PastRunRecord[]): number {
  let bonus = 0;
  for (const run of runs.slice(0, 5)) {
    const rank = run.final3fRank ?? 99;
    const sec = run.final3fSec ?? 99;
    if (rank <= 2 && sec < 34.5 && (isMiddleDistanceRun(run) || isGradedRun(run))) {
      bonus += 0.9;
    } else if (rank <= 3 && sec < 35.0) {
      bonus += 0.4;
    }
  }
  return round1(clamp(bonus, 0, 2.5));
}

/**
 * 1走の前後傾差（早い3F合計 − 遅い3F合計, 秒）。
 * - 6 区間以上ある場合: front3 - back3
 * - 4〜5 区間: front2 - back2 を 1.5 倍に拡張（既存 contextualBonuses と同方針）
 * - データ不足のとき null
 */
export function computeRunRpcSec(run: PastRunRecord): number | null {
  const s = run.section200mSec;
  return computeRpcSecFromSections(s);
}

/**
 * 当日レース想定ラップ（200m×n）から前後傾差 RPC を算出。`computeRunRpcSec` と同式。
 */
export function computeRpcSecFromSections(s: readonly number[] | null | undefined): number | null {
  if (s == null || s.length < 4) return null;
  const n = s.length;
  if (n >= 6) {
    const front3 = s[0]! + s[1]! + s[2]!;
    const back3 = s[n - 3]! + s[n - 2]! + s[n - 1]!;
    return front3 - back3;
  }
  const front2 = s[0]! + s[1]!;
  const back2 = s[n - 2]! + s[n - 1]!;
  return (front2 - back2) * 1.5;
}

/**
 * `section200mSec` が無いとき、ペース設定から当日 RPC の粗い見込みを返す（秒スケール）。
 */
export function inferExpectedRpcSecFromPace(condition: RaceCondition): number | null {
  if (condition.pace === "high" || condition.pace === "many_front_runners") return 0.85;
  if (condition.pace === "slow" || condition.pace === "no_front_runner") return -0.85;
  return null;
}

export function inferTodayExpectedRpcSec(condition: RaceCondition): number | null {
  const fromSec = computeRpcSecFromSections(condition.section200mSec);
  if (fromSec != null) return fromSec;
  return inferExpectedRpcSecFromPace(condition);
}

function meanPastRpcSec(runs: readonly PastRunRecord[]): number | null {
  const vals: number[] = [];
  for (const run of runs.slice(0, 5)) {
    const v = computeRunRpcSec(run);
    if (v != null && Number.isFinite(v)) vals.push(v);
  }
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/**
 * 過去の平均 RPC と当日想定 RPC の乖離をペナルティ（≤0）で返す。展開不向きによる能力減衰。
 */
export function computeRpcPaceMismatchPenalty(horse: HorseAbility, condition: RaceCondition): number {
  const pastAvg = meanPastRpcSec(horse.pastRuns ?? []);
  const today = inferTodayExpectedRpcSec(condition);
  if (pastAvg == null || today == null) return 0;

  const diff = Math.abs(pastAvg - today);
  /** 閾値未満はペナルティなし（同系統の展開） */
  const threshold = 0.55;
  if (diff <= threshold) return 0;

  const raw = -((diff - threshold) * 1.25);
  return round1(clamp(raw, -2.8, 0));
}

/** 全体ラップの最終 200m での減速幅（l1 - l2, 秒）。 */
export function computeFieldL1DecelSec(run: PastRunRecord): number | null {
  const s = run.section200mSec;
  if (s == null || s.length < 2) return null;
  const n = s.length;
  const l1 = s[n - 1]!;
  const l2 = s[n - 2]!;
  if (!Number.isFinite(l1) || !Number.isFinite(l2)) return null;
  return l1 - l2;
}

/** 前傾消耗戦判定: 後ろが遅くなる (rpc が負大) かつ全体減速幅が大きい */
function isPaceFrontGrindRun(rpc: number, fieldL1Decel: number): boolean {
  return rpc <= -0.6 && fieldL1Decel >= 0.12;
}

/**
 * 全体減速幅に対し、当該馬の崩れが有意に小さかった = 耐性ありとみなす。
 * 当該馬個別の200m分割は通常持たないため、着差ベースで近似:
 *  - フィールド全体が大きく崩れる中で、勝ち馬から 0.5s 以内なら耐性あり
 *  - 0.7s 以内 + フィールド減速幅が 0.20 以上なら準耐性
 */
function judgeResilient(marginSec: number, fieldL1Decel: number): boolean {
  if (!Number.isFinite(marginSec)) return false;
  if (marginSec <= 0.5) return true;
  if (marginSec <= 0.7 && fieldL1Decel >= 0.2) return true;
  return false;
}

/**
 * 過去走から「消耗戦耐性（底力）フラグ」を抽出する。
 * - 直近 5 走のうち、前傾消耗戦と判定できる走で耐性を計測
 * - フィールド減速幅に対し当該馬の崩れが小さい走が 1 本以上あれば flag = true
 * - 強度 strength01 は耐性走数 / 必要本数 (3) で 0〜1
 */
export function detectStaminaResilience(horse: HorseAbility): StaminaResilienceResult {
  const runs = horse.pastRuns ?? [];
  const evidence: StaminaResilienceEvidence[] = [];
  for (const run of runs.slice(0, 5)) {
    const rpc = computeRunRpcSec(run);
    const fieldL1Decel = computeFieldL1DecelSec(run);
    if (rpc == null || fieldL1Decel == null) continue;
    if (!isPaceFrontGrindRun(rpc, fieldL1Decel)) continue;
    const margin = run.marginToWinnerSec;
    if (margin == null || !Number.isFinite(margin)) continue;
    const resilient = judgeResilient(margin, fieldL1Decel);
    evidence.push({
      raceId: run.raceId,
      date: run.date,
      rpc: round1(rpc),
      fieldL1Decel: round1(fieldL1Decel),
      horseMarginSec: round1(margin),
      resilient,
    });
  }
  const positiveCount = evidence.filter((e) => e.resilient).length;
  return {
    flag: positiveCount >= 1,
    strength01: clamp(positiveCount / 3, 0, 1),
    evidence,
  };
}

function computeLapSustainBonus(
  runs: readonly PastRunRecord[],
  todayShape: LapStructureKind,
  condition: RaceCondition,
): number {
  const todayIsGrind = todayShape === LAP_STRUCTURE.GRIND || condition.pace === "high" || condition.pace === "many_front_runners";
  if (!todayIsGrind) return 0;
  let bonus = 0;
  for (const run of runs.slice(0, 5)) {
    const shape = getRunShape(run);
    if (shape !== LAP_STRUCTURE.GRIND && shape !== LAP_STRUCTURE.SUSTAIN) continue;
    const rank = run.final3fRank ?? 99;
    if (rank <= 3) bonus += 0.7;
    if ((run.marginToWinnerSec ?? 9) <= 0.5) bonus += 0.5;
  }
  return round1(clamp(bonus, 0, 2.5));
}

/**
 * 今日のレースのラップ形状 vs 馬の過去走ラップ形状分布の一致度スコア。
 *
 * 判定条件:
 * - `condition.section200mSec` が 4 本以上必要
 * - 今日の分類が「中間」の場合: reliable: false
 * - 馬の非中間走が 2 本未満: reliable: false
 *
 * score: 一致率 1.0 → +3, 0.5 → 0, 0.0 → -3
 */
export function computeLapShapeFit(
  horse: HorseAbility,
  condition: RaceCondition,
): ShapeFitResult {
  const profile = inferLapProfile(horse);
  const staminaResilience = detectStaminaResilience(horse);
  // 今日のレース形状
  const sec = condition.section200mSec;
  if (sec == null || sec.length < 4) {
    return {
      reliable: false,
      sustainBonus: 0,
      qualityBonus: computeLapQualityBonus(horse.pastRuns ?? []),
      lapProfile: profile,
      staminaResilience,
    };
  }

  const todayShape = classifyLapStructure(sec);
  if (todayShape === LAP_STRUCTURE.NEUTRAL) {
    return {
      reliable: false,
      sustainBonus: 0,
      qualityBonus: computeLapQualityBonus(horse.pastRuns ?? []),
      lapProfile: profile,
      staminaResilience,
    };
  }

  // 馬の過去走形状
  if (!horse.pastRuns || horse.pastRuns.length === 0) {
    return {
      reliable: false,
      sustainBonus: 0,
      qualityBonus: 0,
      lapProfile: profile,
      staminaResilience,
    };
  }

  const shapes = horse.pastRuns
    .map(getRunShape)
    .filter((s): s is LapStructureKind => s !== null && s !== LAP_STRUCTURE.NEUTRAL);

  const sustainBonus = computeLapSustainBonus(horse.pastRuns, todayShape, condition);
  const qualityBonus = computeLapQualityBonus(horse.pastRuns);
  if (shapes.length < MIN_NON_NEUTRAL_RUNS) {
    return {
      reliable: false,
      sustainBonus,
      qualityBonus,
      lapProfile: profile,
      staminaResilience,
    };
  }

  const matchCount = shapes.filter((s) => s === todayShape).length;
  const matchRate = matchCount / shapes.length;

  // matchRate: 1.0 → +3, 0.5 → 0, 0.0 → -3
  const raw = (matchRate - 0.5) * (SHAPE_FIT_MAX * 2);
  const score = round1(raw);

  return {
    reliable: true,
    score,
    sustainBonus,
    qualityBonus,
    lapProfile: profile,
    staminaResilience,
  };
}
