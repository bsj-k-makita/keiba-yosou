import type { HorseAbility, RaceCondition } from "./abilityTypes";
import type { CourseTraitHit } from "./courseTraitResolver";
import { resolveStrategicProfileKey } from "./strategicWeights";

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * 洋芝（北海道）× 馬体重によるパワー・馬格ボーナス（能力5軸外の直接加点）。
 */
export function computeStructuralPhysicalHits(
  horse: HorseAbility,
  _condition: RaceCondition,
): CourseTraitHit[] {
  const hits: CourseTraitHit[] = [];
  const profile = resolveStrategicProfileKey(_condition);
  const kg = horse.bodyWeightKg;
  if (
    (profile === "HOKKAIDO_TURF" || profile === "HOKKAIDO_DIRT") &&
    kg != null &&
    Number.isFinite(kg) &&
    kg >= 500
  ) {
    hits.push({
      label: "洋芝・馬格",
      reason: `馬体重${Math.round(kg)}kg・北海道コース（踏み込み・馬格）`,
      bonus: round1(Math.min(4.5, 2.8 + (kg - 500) * 0.018)),
    });
  }
  return hits;
}
