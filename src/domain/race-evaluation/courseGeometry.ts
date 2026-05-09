import type { RaceCondition } from "./abilityTypes";
import { resolveCourseTraits } from "./courseTraitResolver";

/**
 * コースマスタの LONG_RUN_IN / SHORT_RUN_IN から「初角までの直線イメージ（m）」を推定。
 * 実寸ではなく加点閾値用の代表値。
 */
export function inferStartStraightDistM(condition: RaceCondition): number | null {
  const traits = resolveCourseTraits(condition);
  if (traits.includes("LONG_RUN_IN")) return 430;
  if (traits.includes("SHORT_RUN_IN")) return 175;
  return null;
}
