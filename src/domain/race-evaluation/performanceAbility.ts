import type { HorseAbility, HorseScoreResult, RaceCondition } from "./abilityTypes";
import type { PastRunRecord } from "./pastRunTypes";
import { classifyLapStructure, LAP_STRUCTURE, type LapStructureKind } from "./lapStructure";
import {
  resolvePastRunVenueFactorKey,
  resolveVenuePhysicalFactorKey,
  VENUE_PHYSICAL_FACTORS,
} from "./venuePhysicalFactors";

const CLASS_SCORE: Record<string, number> = {
  G1: 1.0,
  G2: 0.88,
  G3: 0.78,
  OP: 0.66,
  "3勝": 0.56,
  "2勝": 0.48,
  "1勝": 0.4,
  新馬: 0.34,
  未勝利: 0.28,
  その他: 0.46,
};

/** レイヤ1: A_adj = A × W_class + B_class（設計書の格補正） */
const LAYER1_CLASS_WEIGHT: Record<string, number> = {
  G1: 1.12,
  G2: 1.09,
  G3: 1.06,
  OP: 1.02,
  "3勝": 0.98,
  "2勝": 0.95,
  "1勝": 0.92,
  新馬: 0.9,
  未勝利: 0.87,
  その他: 0.95,
};

const LAYER1_CLASS_BASE: Record<string, number> = {
  G1: 5,
  G2: 4,
  G3: 3,
  OP: 2,
  "3勝": 1,
  "2勝": 0,
  "1勝": -0.5,
  新馬: -1.5,
  未勝利: -3,
  その他: 0,
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function runDistanceMeters(run: PastRunRecord): number {
  if (run.section200mSec != null && run.section200mSec.length >= 4) {
    return run.section200mSec.length * 200;
  }
  return run.raceDistance ?? 1800;
}

function perf01(run: PastRunRecord): number {
  if (run.marginToWinnerSec != null && Number.isFinite(run.marginToWinnerSec)) {
    return clamp((100 - run.marginToWinnerSec * 30) / 100, 0, 1);
  }
  if (run.place != null && run.place >= 1) {
    return clamp((100 - (run.place - 1) * 7) / 100, 0, 1);
  }
  return 0.45;
}

function longness01(distance: number): number {
  if (distance <= 1400) return 0.18;
  if (distance <= 1800) return 0.35;
  if (distance <= 2200) return 0.5;
  if (distance <= 2800) return 0.7;
  return 0.84;
}

export function pastRunRaceClassWeight01(run: PastRunRecord): number {
  return CLASS_SCORE[run.raceClass ?? "その他"] ?? CLASS_SCORE["その他"] ?? 0.46;
}

function class01(run: PastRunRecord): number {
  return pastRunRaceClassWeight01(run);
}

/** キャリアで最も格の高かったレースのクラスキー */
function dominantPastTierKey(runs: readonly PastRunRecord[] | undefined): keyof typeof LAYER1_CLASS_WEIGHT {
  if (!runs?.length) return "その他";
  let best = runs[0]!;
  let bestC = class01(runs[0]!);
  for (const r of runs.slice(0, 8)) {
    const c = class01(r);
    if (c > bestC) {
      bestC = c;
      best = r;
    }
  }
  const k = best.raceClass ?? "その他";
  return k in LAYER1_CLASS_WEIGHT ? (k as keyof typeof LAYER1_CLASS_WEIGHT) : "その他";
}

/**
 * レイヤ1: 5軸をクラス別 W/B で補正（絶対能力の適正化）。
 */
function applyLayer1ClassCorrection(horse: HorseAbility): HorseAbility {
  const tier = dominantPastTierKey(horse.pastRuns);
  const W = LAYER1_CLASS_WEIGHT[tier] ?? LAYER1_CLASS_WEIGHT["その他"] ?? 1;
  const B = LAYER1_CLASS_BASE[tier] ?? LAYER1_CLASS_BASE["その他"] ?? 0;
  const adjAxis = (v: number) => clamp(v * W + B, 12, 99);
  return {
    ...horse,
    speed: round1(adjAxis(horse.speed)),
    stamina: round1(adjAxis(horse.stamina)),
    kick: round1(adjAxis(horse.kick)),
    sustain: round1(adjAxis(horse.sustain)),
    power: round1(adjAxis(horse.power)),
  };
}

/** 過去走（最大8走）で踏んだ最高クラスを 0〜1 スケールで表す（実績の天井）。 */
export function maxHistoricalRaceClass01(runs: readonly PastRunRecord[] | undefined): number {
  if (!runs?.length) return 0.46;
  let m = 0;
  for (const r of runs.slice(0, 8)) {
    m = Math.max(m, class01(r));
  }
  return m;
}

type DerivedAxes = {
  speed: number;
  stamina: number;
  kick: number;
  sustain: number;
  power: number;
  confidence: number;
};

function inferCornerRankApprox(run: PastRunRecord): number | null {
  const cp = run.corner_positions;
  if (cp && cp.length > 0) {
    const last = cp[cp.length - 1];
    if (last != null && Number.isFinite(last)) return last;
  }
  const po = run.passingOrder ?? run.cornerPassing;
  if (po && /\d/.test(po)) {
    const parts = po.split(/[-\s]+/).filter(Boolean);
    const lastTok = parts[parts.length - 1];
    if (lastTok) {
      const n = Number.parseInt(lastTok, 10);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

/** L2 の秒がレース内最速区間より遅い幅（秒）。展開不利・詰まりの目安。 */
function l2SlowdownVsMinSection(run: PastRunRecord): number | null {
  const sec = run.section200mSec;
  if (!sec || sec.length < 4) return null;
  const l2 = sec[sec.length - 2];
  if (l2 == null || !Number.isFinite(l2)) return null;
  const nums = sec.filter((x): x is number => x != null && Number.isFinite(x));
  if (nums.length === 0) return null;
  const best = Math.min(...nums);
  return l2 - best;
}

/**
 * 4角前後にいて上がりだけ崩れたパターン（設計書の度外視条件の近似）。
 */
export function expansionTripMismatchForgive(run: PastRunRecord): boolean {
  const cr = inferCornerRankApprox(run);
  const f3 = run.final3fRank;
  const slow = l2SlowdownVsMinSection(run);
  if (cr != null && cr <= 3 && f3 != null && f3 >= 10 && slow != null && slow > 1.0) {
    return true;
  }
  return false;
}

function resolveRunLapKind(run: PastRunRecord): LapStructureKind | null {
  if (run.lapStructure != null && run.lapStructure !== LAP_STRUCTURE.NEUTRAL) {
    return run.lapStructure;
  }
  if (run.section200mSec != null && run.section200mSec.length >= 4) {
    return classifyLapStructure(run.section200mSec);
  }
  return null;
}

/** ハイペース・消耗ラップで先行が煮詰まった可能性 — 能力だけでは説明しにくい敗戦として緩和 */
function paceCollapseForgive(run: PastRunRecord, runningStyle: HorseAbility["runningStyle"]): boolean {
  const lk = resolveRunLapKind(run);
  if (lk !== LAP_STRUCTURE.GRIND && lk !== LAP_STRUCTURE.SUSTAIN) return false;
  const front = runningStyle === "逃げ" || runningStyle === "先行";
  if (!front) return false;
  return perf01(run) < 0.42 && (run.marginToWinnerSec ?? 0) >= 1.2;
}

/**
 * 今日のコース形状と過去走のコース形状が「タイト vs ワイド」で噛み合わず負けた走への緩和。
 */
function courseMismatchForgiveRun(run: PastRunRecord, condition: RaceCondition): boolean {
  const rk = resolvePastRunVenueFactorKey(run.venue);
  const ck = resolveVenuePhysicalFactorKey(condition);
  if (!rk || !ck) return false;
  const rf = VENUE_PHYSICAL_FACTORS[rk];
  const cf = VENUE_PHYSICAL_FACTORS[ck];
  if (!rf || !cf) return false;
  if (perf01(run) >= 0.42) return false;
  const runWide = rf.cornerRadius === "wide";
  const condTight = cf.cornerRadius === "tight";
  const runTight = rf.cornerRadius === "tight";
  const condWide = cf.cornerRadius === "wide";
  return (runWide && condTight) || (runTight && condWide);
}

function physicsVectorFromVenueKey(key: string | null, surface: PastRunRecord["surface"]): number[] {
  const f = key ? VENUE_PHYSICAL_FACTORS[key] : null;
  if (!f) return [0.5, 0.5, 0.5, 0.5];
  const rad =
    f.cornerRadius === "tight" ? 0 : f.cornerRadius === "wide" ? 1 : 0.55;
  const dirt = surface === "ダート" ? 1 : 0;
  return [
    clamp(f.straight / 700, 0, 1),
    clamp(f.uphill / 3, 0, 1),
    rad,
    dirt,
  ];
}

function physicsVectorFromCondition(condition: RaceCondition): number[] {
  const key = resolveVenuePhysicalFactorKey(condition);
  const surf = condition.surface ?? "芝";
  return physicsVectorFromVenueKey(key, surf === "ダート" ? "ダート" : "芝");
}

function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d < 1e-9 ? 0 : dot / d;
}

/**
 * レイヤ3: 今回コースの物理プロファイルと、過去好走時の開催の類似度から加点（0〜上限）。
 */
export function computeCourseProfileMatchBonus(horse: HorseAbility, condition: RaceCondition): number {
  const v0 = physicsVectorFromCondition(condition);
  let best = 0;
  for (const run of horse.pastRuns?.slice(0, 8) ?? []) {
    const vk = resolvePastRunVenueFactorKey(run.venue);
    if (!vk) continue;
    const vr = physicsVectorFromVenueKey(vk, run.surface);
    const sim = cosineSimilarity(v0, vr);
    const perf = perf01(run) * 0.55 + class01(run) * 0.45;
    best = Math.max(best, sim * perf);
  }
  return round1(clamp(best * 12, 0, 7));
}

/**
 * 過去走の L2（ラスト400〜200m 相当＝倒数第2の200m）の最速区間からキレ指数を推定。
 * 上がり3F 順位には依存しない。
 */
export function deriveKickScoreFromL2Runs(runs: readonly PastRunRecord[] | undefined): number | null {
  if (!runs?.length) return null;
  let minL2 = Infinity;
  let bestRun: PastRunRecord | null = null;
  for (const run of runs.slice(0, 5)) {
    const sec = run.section200mSec;
    if (sec == null || sec.length < 4) continue;
    const l2 = sec[sec.length - 2];
    if (l2 == null || !Number.isFinite(l2)) continue;
    if (l2 < minL2) {
      minL2 = l2;
      bestRun = run;
    }
  }
  if (bestRun == null || !Number.isFinite(minL2)) return null;
  const l2Perf01 = clamp((13.5 - minL2) / 2.7, 0, 1);
  const cls = class01(bestRun);
  return clamp(34 + l2Perf01 * 56 * (0.5 + cls * 0.5), 26, 94);
}

/** 直線が長いコースほど L2 由来キレの比重を上げる（東京・新潟外など）。 */
export function kickL2BlendAlpha(condition: RaceCondition): number {
  const key = resolveVenuePhysicalFactorKey(condition);
  if (key != null) {
    const f = VENUE_PHYSICAL_FACTORS[key];
    if (f != null && f.straight >= 520) return 0.82;
    if (f != null && f.straight >= 480) return 0.68;
  }
  const blob = `${condition.courseKey ?? ""} ${condition.venue}`.toLowerCase();
  if (blob.includes("東京") || blob.includes("新潟")) return 0.78;
  return 0.44;
}

/**
 * ブレンド後能力に対し、コースに応じた L2 キレを再合成（重みは `kickL2BlendAlpha`）。
 */
export function applyKickL2Emphasis(horse: HorseAbility, condition: RaceCondition): HorseAbility {
  const l2 = deriveKickScoreFromL2Runs(horse.pastRuns);
  if (l2 == null) return horse;
  const alpha = kickL2BlendAlpha(condition);
  const merged = horse.kick * (1 - alpha) + l2 * alpha;
  return { ...horse, kick: Math.round(merged * 10) / 10 };
}

type ScoredRun = {
  run: PastRunRecord;
  idx: number;
  recency: number;
  quality: number;
  unreliable: boolean;
  forgiven: boolean;
};

function scoreRunQuality(
  run: PastRunRecord,
  idx: number,
  condition: RaceCondition | undefined,
  runningStyle: HorseAbility["runningStyle"],
): ScoredRun {
  const recency = Math.max(0.55, 1 - idx * 0.1);
  const perf = perf01(run);
  const cls = class01(run);
  const badBeat =
    run.marginToWinnerSec != null &&
    run.marginToWinnerSec >= 2.2 &&
    run.place != null &&
    run.place >= 10;
  const trouble = run.tripTrouble01 ?? 0;
  const benefit = run.tripBenefit01 ?? 0;

  const forgiveTrip =
    expansionTripMismatchForgive(run) ||
    (condition != null && courseMismatchForgiveRun(run, condition)) ||
    paceCollapseForgive(run, runningStyle);

  let unreliable = badBeat && trouble < 0.38 && benefit < 0.42 && !forgiveTrip;
  let forgiven = forgiveTrip;

  if (forgiveTrip) {
    unreliable = false;
  }

  let quality = perf * 0.72 + cls * 0.28;
  if (unreliable) quality -= 0.28;
  if (forgiven) quality = Math.max(quality, 0.52);

  return {
    run,
    idx,
    recency,
    quality: Math.max(0.06, quality),
    unreliable,
    forgiven,
  };
}

function pickRunsForDerivedAxes(
  target: readonly PastRunRecord[],
  condition: RaceCondition | undefined,
  runningStyle: HorseAbility["runningStyle"],
): ScoredRun[] {
  const scored = target.map((run, idx) => scoreRunQuality(run, idx, condition, runningStyle));
  scored.sort((a, b) => b.quality - a.quality);
  const reliable = scored.filter((s) => !s.unreliable);
  if (reliable.length >= 2) return reliable.slice(0, 2);
  if (reliable.length === 1) return [reliable[0]!];
  return scored.slice(0, Math.min(2, scored.length));
}

function deriveAxesFromRuns(
  runs: readonly PastRunRecord[] | undefined,
  runningStyle: HorseAbility["runningStyle"],
  condition: RaceCondition | undefined,
): DerivedAxes | null {
  if (!runs || runs.length === 0) return null;
  const target = runs.slice(0, 6);
  if (target.length === 0) return null;

  const picks = pickRunsForDerivedAxes(target, condition, runningStyle);
  if (picks.length === 0) return null;

  let wSum = 0;
  let speed = 0;
  let stamina = 0;
  let kickAcc = 0;
  let sustain = 0;
  let power = 0;

  picks.forEach((s) => {
    const { run, recency } = s;
    const perf = perf01(run);
    const cls = class01(run);
    const dist = runDistanceMeters(run);
    const lng = longness01(dist);
    const runScore = clamp(perf * 0.7 + cls * 0.3, 0, 1);
    const top3Boost = run.place != null && run.place <= 3 ? 0.06 : 0;
    const winBoost = run.place === 1 ? 0.08 : 0;

    speed += recency * runScore * (1.1 - lng * 0.7);
    stamina += recency * runScore * (0.45 + lng * 0.95);
    kickAcc += recency * runScore * (0.55 + top3Boost + winBoost * 0.4);
    sustain += recency * runScore * (0.45 + lng * 0.75);
    power += recency * runScore * (0.55 + lng * 0.65);
    wSum += recency;
  });

  if (wSum <= 0) return null;
  const scale = 100 / wSum;
  const kickFromL2 = deriveKickScoreFromL2Runs(target);
  const kick = kickFromL2 ?? clamp(kickAcc * scale, 20, 92);

  return {
    speed: clamp(speed * scale, 20, 92),
    stamina: clamp(stamina * scale, 20, 95),
    kick,
    sustain: clamp(sustain * scale, 20, 95),
    power: clamp(power * scale, 20, 95),
    confidence: clamp(target.length / 5, 0.25, 1),
  };
}

/**
 * 既存能力値に過去走実績をブレンドし、レイヤ1クラス補正を適用する。
 * `condition` があるときコース不一致・展開不利の度外視を近走品質に反映。
 */
export function blendAbilityWithPastRuns(
  horse: HorseAbility,
  condition?: RaceCondition,
): HorseAbility {
  const derived = deriveAxesFromRuns(horse.pastRuns, horse.runningStyle, condition);
  if (derived == null) return applyLayer1ClassCorrection(horse);

  const blend = 0.2 + derived.confidence * 0.55;
  const keep = 1 - blend;
  const merged: HorseAbility = {
    ...horse,
    speed: Math.round((horse.speed * keep + derived.speed * blend) * 10) / 10,
    stamina: Math.round((horse.stamina * keep + derived.stamina * blend) * 10) / 10,
    kick: Math.round((horse.kick * keep + derived.kick * blend) * 10) / 10,
    sustain: Math.round((horse.sustain * keep + derived.sustain * blend) * 10) / 10,
    power: Math.round((horse.power * keep + derived.power * blend) * 10) / 10,
  };
  return applyLayer1ClassCorrection(merged);
}

const FIELD_CLASS_TIER_CALIBRATION = 22;

/**
 * 相対化の直前に、各馬のキャリア最高クラスがフィールド平均からどれだけ外れるかを補正。
 */
export function calibrateRaceAdjustedInputsForFieldClassTier(
  horses: readonly HorseAbility[],
  results: HorseScoreResult[],
): void {
  if (horses.length === 0 || results.length === 0) return;
  const byId = new Map(results.map((r) => [r.horseId, r] as const));
  const tiers = horses.map((h) => maxHistoricalRaceClass01(h.pastRuns));
  const mu = tiers.reduce((a, b) => a + b, 0) / tiers.length;
  for (let i = 0; i < horses.length; i++) {
    const h = horses[i]!;
    const r = byId.get(h.horseId);
    if (!r) continue;
    const delta = (tiers[i]! - mu) * FIELD_CLASS_TIER_CALIBRATION;
    r.raceAdjustedInput = round1(r.raceAdjustedInput + delta);
  }
}
