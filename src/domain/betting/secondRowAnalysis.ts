import type { ClassTier } from "../race-evaluation/resolveEffectiveRaceClass";
import type { ProbabilityEngine } from "../../lib/pipeline/probabilityEngine";
import {
  buildSecondRowNumbers,
  type MarkedHorseRef,
  resolvePostProcessFavoriteNumber,
} from "./bettingRules";

export type SecondRowStatus = {
  isAnchorHit: boolean;
  isSecondRowHit: boolean;
  isSecondRowDead: boolean;
};

export function analyzeSecondRowStatus(
  marks: readonly MarkedHorseRef[],
  classTier: ClassTier,
  actualTop3: readonly number[],
  favoriteNumber?: number,
  probabilityEngine: ProbabilityEngine = "ts",
): SecondRowStatus {
  const omaru = favoriteNumber ?? resolvePostProcessFavoriteNumber(marks);
  const top3 = actualTop3.slice(0, 3);
  const isAnchorHit = omaru != null && top3.includes(omaru);
  const secondRow = buildSecondRowNumbers(marks, classTier, probabilityEngine);
  const isSecondRowHit = secondRow.some((n) => top3.includes(n));

  return {
    isAnchorHit,
    isSecondRowHit,
    isSecondRowDead: isAnchorHit && !isSecondRowHit,
  };
}

export type SecondRowDeadAggregate = {
  anchorSurvivedRaces: number;
  secondRowDeadCount: number;
  secondRowDeadRate: number;
};

export function aggregateSecondRowDead(details: readonly { isAnchorHit: boolean; isSecondRowDead: boolean }[]): SecondRowDeadAggregate {
  let anchorSurvivedRaces = 0;
  let secondRowDeadCount = 0;
  for (const d of details) {
    if (!d.isAnchorHit) continue;
    anchorSurvivedRaces += 1;
    if (d.isSecondRowDead) secondRowDeadCount += 1;
  }
  const secondRowDeadRate =
    anchorSurvivedRaces > 0
      ? Math.round((secondRowDeadCount / anchorSurvivedRaces) * 1000) / 10
      : 0;
  return { anchorSurvivedRaces, secondRowDeadCount, secondRowDeadRate };
}
