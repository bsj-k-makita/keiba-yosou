import type { HorseAbility, RaceCondition } from "./abilityTypes";
import type { PastRunRecord } from "./pastRunTypes";
import type { PaceFitToken } from "./lingoConstants";
import { PACE_FIT } from "./lingoConstants";

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function placesForStd(runs: readonly PastRunRecord[] | undefined): number[] {
  if (!runs?.length) return [];
  const out: number[] = [];
  for (let i = 0; i < Math.min(5, runs.length); i += 1) {
    const p = runs[i]!.place;
    if (p != null && Number.isFinite(p) && p >= 1) out.push(p);
  }
  return out;
}

function stddev(nums: number[]): number {
  if (nums.length <= 1) return 0;
  const m = nums.reduce((a, b) => a + b, 0) / nums.length;
  const v = nums.reduce((s, x) => s + (x - m) ** 2, 0) / (nums.length - 1);
  return Math.sqrt(v);
}

function runDistanceMeters(run: PastRunRecord): number | null {
  const d = run.raceDistance;
  if (d != null && Number.isFinite(d) && d > 0) return d;
  const sec = run.section200mSec;
  if (sec && sec.length >= 4) return sec.length * 200;
  return null;
}

function pastDistanceFit01(horse: HorseAbility, target: number): number {
  const runs = horse.pastRuns;
  if (!runs?.length) return 0.5;
  let wsum = 0;
  let acc = 0;
  for (const run of runs) {
    const dist = runDistanceMeters(run);
    if (dist == null) continue;
    const diff = Math.abs(dist - target);
    const fit = clamp01(1 - diff / 1400);
    wsum += 1;
    acc += fit;
  }
  if (wsum <= 0) return 0.5;
  return acc / wsum;
}

function paceToken01(token: PaceFitToken): number {
  if (token === PACE_FIT.PERFECT) return 1;
  if (token === PACE_FIT.FIT) return 0.75;
  if (token === PACE_FIT.MAYBE) return 0.5;
  return 0.25;
}

/**
 * 複勝安定度の近似指標（0〜100）。
 * - 近走着順ブレが小さい
 * - 今回距離での過去適合が高い
 * - `paceFitToken` が高いほど展開側の安定も加点
 */
export function computeStabilityScore(
  horse: HorseAbility,
  condition: RaceCondition,
  paceFitToken: PaceFitToken,
): number {
  const places = placesForStd(horse.pastRuns);
  const s = places.length >= 3 ? stddev(places) : places.length >= 2 ? stddev(places) : 2.8;
  const bro = clamp01(1 - s / 4.8);

  let dist01 = 0.55;
  const td = condition.distance;
  if (td != null && Number.isFinite(td) && td > 0) {
    dist01 = clamp01((pastDistanceFit01(horse, td) - 0.35) / 0.65);
  }

  const pace01 = paceToken01(paceFitToken);

  let score =
    bro * 40 +
    dist01 * 35 +
    pace01 * 25 +
    clamp01((horse.sustain ?? 50) / 110) * 5 +
    clamp01(((horse.stamina ?? 50) + (horse.power ?? 50)) / 220) * 5;

  if (horse.signals?.reproducibility01 != null) {
    score += clamp01(horse.signals.reproducibility01) * 8;
    score = Math.min(110, score);
  }

  return round1(Math.max(1, Math.min(100, score)));
}
