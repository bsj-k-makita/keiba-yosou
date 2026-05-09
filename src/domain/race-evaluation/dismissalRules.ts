import type { HorseAbility, HorseScoreResult, RaceCondition } from "./abilityTypes";
import { FIT_TENDENCY, PACE_FIT } from "./lingoConstants";
import { computeKickInTopFractionMap, computePaceFitLevel } from "./paceFit";
import {
  type FitLevel,
  computeFitScore,
  fitLevelFromScore,
  weightsToDemand0to100,
} from "./fitScore";
import { getFinalWeights } from "./weightResolver";
import { venueRepeaterDismissRescue } from "./venueRepeater";

const SCORE_DIFF_NEG_THRESHOLD = 1.0;

/**
 * 消し候補: 4条件のうち原則2件以上。買い判断用。
 */
export function countDismissConditions(
  _horse: HorseAbility,
  result: HorseScoreResult,
  fieldSize: number,
  fitLevel: FitLevel,
  paceBad: boolean,
): number {
  let c = 0;
  if ((result.finalRank ?? result.adjustedRank ?? 99) > fieldSize - 2) c++;
  if (fitLevel === FIT_TENDENCY.LO) c++;
  if (paceBad) c++;
  if (result.scoreDiff <= -SCORE_DIFF_NEG_THRESHOLD) c++;
  return c;
}

/** 既存 result に後から一括で消しセットするための補助（最終重み必須） */
export function collectDismissIds(
  horses: HorseAbility[],
  results: HorseScoreResult[],
  condition: RaceCondition,
): Set<string> {
  const w = getFinalWeights(condition);
  const demand0to100 = weightsToDemand0to100(w);
  const n = horses.length;
  const kickTopMap = computeKickInTopFractionMap(horses);
  const set = new Set<string>();
  for (const h of horses) {
    const r = results.find((x) => x.horseId === h.horseId);
    if (!r) continue;
    const fit = computeFitScore(h, demand0to100);
    const fitLevel = fitLevelFromScore(fit);
    const paceFit = computePaceFitLevel(h, condition, {
      kickInTopFraction: kickTopMap.get(h.horseId),
    });
    const paceBad = paceFit === PACE_FIT.BAD;
    let sig = countDismissConditions(h, r, n, fitLevel, paceBad);
    if (venueRepeaterDismissRescue(h, condition)) {
      sig -= 1;
    }
    if (sig >= 2) set.add(h.horseId);
  }
  return set;
}
