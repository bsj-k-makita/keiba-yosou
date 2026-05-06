import type { HorseAbility, RaceAnalysisSnapshot, RaceCondition, RaceStoredLapType } from "./abilityTypes";
import type { PastRunRecord } from "./pastRunTypes";

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

function n(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function median(nums: number[]): number | null {
  const arr = nums.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (arr.length === 0) return null;
  const m = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[m]! : (arr[m - 1]! + arr[m]!) / 2;
}

/** raceFeatureEngineering.paceFrontBackSkewEarlyMinusLate と同一式 */
function paceFrontBackSkewEarlyMinusLate(
  section200mSec: readonly number[] | undefined,
  final3fSec: number | undefined,
): number | null {
  const sec = Array.isArray(section200mSec) ? [...section200mSec].map(Number) : [];
  const sum = sec.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  const late = Number(final3fSec);
  if (!Number.isFinite(sum) || sum <= 0 || !Number.isFinite(late)) return null;
  const early = sum - late;
  return early - late;
}

function inferHorsePaceTendencyFromPast(pastRuns: PastRunRecord[] | undefined): "front_loaded" | "late_kick" | "neutral" | null {
  const skews: number[] = [];
  for (const run of pastRuns ?? []) {
    const sk = paceFrontBackSkewEarlyMinusLate(run.section200mSec, run.final3fSec);
    if (sk != null) skews.push(sk);
  }
  const med = median(skews);
  if (med == null) return null;
  if (med > 2.5) return "front_loaded";
  if (med < -2.5) return "late_kick";
  return "neutral";
}

function isFrontStyle(style: string): boolean {
  return /逃げ|先行/.test(style);
}

function isCloserStyle(style: string): boolean {
  return /差し|追込/.test(style);
}

/**
 * 蓄積されたレースの lapType と、過去走から推定した前後傾の適性一致ボーナス。
 * `lapShapeFit` が reliable のときは二重計上を避け 0（ラップ形状一致に委ねる）。
 */
function lapTypeBonus(
  horse: HorseAbility,
  lapType: RaceStoredLapType | undefined,
  skipBecauseLapShapeFit: boolean,
): number {
  if (skipBecauseLapShapeFit || lapType == null || lapType === "neutral") return 0;
  const tendency = inferHorsePaceTendencyFromPast(horse.pastRuns);
  if (tendency == null) return 0;
  if (lapType === "even_pace" && tendency === "neutral") return 3;
  if (lapType === "early_pressured" && tendency === "front_loaded") return 5;
  if (lapType === "late_accelerated" && tendency === "late_kick") return 5;
  if (lapType === "early_pressured" && tendency === "neutral") return 1.5;
  if (lapType === "late_accelerated" && tendency === "neutral") return 1.5;
  if (lapType === "even_pace") return 1;
  return -0.5;
}

/**
 * 枠・脚質が当日の bias スナップショットと揃うときの小加点（最大約 4）。
 */
function biasAlignmentBonus(horse: HorseAbility, snap: RaceAnalysisSnapshot): number {
  const b = snap.bias;
  if (b == null) return 0;
  const io = n(b.innerOuter);
  const fc = n(b.frontCloser);
  const frame = horse.frameNumber;
  const style = horse.runningStyle ?? "";
  let pts = 0;

  if (io != null) {
    if (io >= 0.35 && frame != null && frame <= 3) pts += 2 * clamp(io / 1.5, 0.4, 1);
    if (io <= -0.35 && frame != null && frame >= 7) pts += 2 * clamp(-io / 1.5, 0.4, 1);
  }

  if (fc != null) {
    if (fc >= 0.35 && isFrontStyle(style)) pts += 2 * clamp(fc / 1.5, 0.4, 1);
    if (fc <= -0.35 && isCloserStyle(style)) pts += 2 * clamp(-fc / 1.5, 0.4, 1);
  }

  return round1(clamp(pts, 0, 4.5));
}

export function computeRaceAnalysisBonus(
  horse: HorseAbility,
  condition: RaceCondition,
  lapShapeFitReliable: boolean,
): number {
  const ra: RaceAnalysisSnapshot | undefined = condition.raceAnalysis;
  if (ra == null) return 0;

  const lt = lapTypeBonus(horse, ra.lapType, lapShapeFitReliable);
  const bias = biasAlignmentBonus(horse, ra);
  return round1(clamp(lt + bias, -2, 10));
}
