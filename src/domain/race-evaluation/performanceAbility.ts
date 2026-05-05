import type { HorseAbility } from "./abilityTypes";
import type { PastRunRecord } from "./pastRunTypes";

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

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function runDistanceMeters(run: PastRunRecord): number {
  if (run.section200mSec != null && run.section200mSec.length >= 4) {
    return run.section200mSec.length * 200;
  }
  return 1800;
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

function class01(run: PastRunRecord): number {
  return CLASS_SCORE[run.raceClass ?? "その他"] ?? CLASS_SCORE["その他"] ?? 0.46;
}

type DerivedAxes = {
  speed: number;
  stamina: number;
  kick: number;
  sustain: number;
  power: number;
  confidence: number;
};

function deriveAxesFromRuns(runs: readonly PastRunRecord[] | undefined): DerivedAxes | null {
  if (!runs || runs.length === 0) return null;
  const target = runs.slice(0, 5);
  if (target.length === 0) return null;

  let wSum = 0;
  let speed = 0;
  let stamina = 0;
  let kick = 0;
  let sustain = 0;
  let power = 0;

  target.forEach((run, idx) => {
    const recency = Math.max(0.55, 1 - idx * 0.1);
    const perf = perf01(run);
    const cls = class01(run);
    const dist = runDistanceMeters(run);
    const lng = longness01(dist);
    const runScore = clamp(perf * 0.7 + cls * 0.3, 0, 1);
    const top3Boost = run.place != null && run.place <= 3 ? 0.06 : 0;
    const winBoost = run.place === 1 ? 0.08 : 0;

    speed += recency * runScore * (1.1 - lng * 0.7);
    stamina += recency * runScore * (0.45 + lng * 0.95);
    kick += recency * runScore * (0.55 + top3Boost + winBoost * 0.4);
    sustain += recency * runScore * (0.45 + lng * 0.75);
    power += recency * runScore * (0.55 + lng * 0.65);
    wSum += recency;
  });

  if (wSum <= 0) return null;
  const scale = 100 / wSum;
  return {
    speed: clamp(speed * scale, 20, 92),
    stamina: clamp(stamina * scale, 20, 95),
    kick: clamp(kick * scale, 20, 92),
    sustain: clamp(sustain * scale, 20, 95),
    power: clamp(power * scale, 20, 95),
    confidence: clamp(target.length / 5, 0.25, 1),
  };
}

/**
 * 既存能力値（hash由来を含む）に過去走実績由来の能力をブレンドし、
 * 実績の強さを横比較へ反映しやすくする。
 */
export function blendAbilityWithPastRuns(horse: HorseAbility): HorseAbility {
  const derived = deriveAxesFromRuns(horse.pastRuns);
  if (derived == null) return horse;

  const blend = 0.2 + derived.confidence * 0.55; // 0.34 〜 0.75
  const keep = 1 - blend;
  return {
    ...horse,
    speed: Math.round((horse.speed * keep + derived.speed * blend) * 10) / 10,
    stamina: Math.round((horse.stamina * keep + derived.stamina * blend) * 10) / 10,
    kick: Math.round((horse.kick * keep + derived.kick * blend) * 10) / 10,
    sustain: Math.round((horse.sustain * keep + derived.sustain * blend) * 10) / 10,
    power: Math.round((horse.power * keep + derived.power * blend) * 10) / 10,
  };
}
