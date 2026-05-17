import type { HorseAbility, RaceCondition } from "./abilityTypes";
import { enginePeakAdjustment } from "./abilityCoreScoring";
import { getEffectiveEvaluationSignals } from "./resolveEvaluationSignals";

const LONGSHOT_ODDS_MIN = 50;

function horseGate(horse: HorseAbility): number | null {
  const g = (horse as HorseAbility & { gate?: number }).gate;
  return g != null && Number.isFinite(g) && g >= 1 ? Math.round(g) : null;
}

function distanceJumpMeters(current: number, past: number): number {
  return Math.abs(current - past);
}

/**
 * 爆穴ハント：条件を満たす馬の intrinsic へ加算（前走着差リセット相当のブースト）。
 */
export function longshotReversalIntrinsicBoost(
  horse: HorseAbility,
  condition: RaceCondition,
): number {
  const sig = getEffectiveEvaluationSignals(horse);
  const odds = sig?.winOdds;
  if (odds == null || odds < LONGSHOT_ODDS_MIN) return 0;

  const last = horse.pastRuns?.[0];
  if (!last) return 0;

  const dist = condition.distance ?? 0;
  let boost = 0;

  const lastDistRaw = last.raceDistance;
  if (dist > 0 && lastDistRaw != null && distanceJumpMeters(dist, lastDistRaw) >= 400) {
    const engine = enginePeakAdjustment(horse);
    if (engine >= 2) boost += 4;
  }

  const heavyDefeat =
    (sig?.heavyDefeatCountLast3 ?? 0) >= 1 ||
    (last.place != null && last.place >= 8 && (last.marginToWinnerSec ?? 0) >= 1.2);
  const biasFlip =
    horse.was_bias_disadvantaged === true &&
    (condition.bias === "inside_favor" || condition.bias === "flat");
  const gate = horseGate(horse);
  const innerGate = gate != null && gate <= 4;

  if (heavyDefeat && biasFlip && innerGate) {
    boost += 6;
  }

  if (heavyDefeat && (last.marginToWinnerSec ?? 0) >= 1.5) {
    boost += 3;
  }

  return boost;
}
