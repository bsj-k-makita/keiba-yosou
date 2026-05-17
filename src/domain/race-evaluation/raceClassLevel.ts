import type { RaceCondition } from "./abilityTypes";
import {
  type ClassTier,
  isGradedOpenTier,
  resolveEffectiveRaceClass,
  type RaceClassSource,
} from "./resolveEffectiveRaceClass";

/** バックテスト集計用の粗いクラス区分（後方互換） */
export type RaceClassBucket = "MAIDEN_NEW" | "OPEN_GRADE" | "OTHER";

export function raceClassSourceFromCondition(condition: RaceCondition): RaceClassSource {
  return {
    raceName: condition.raceName,
    raceGrade: condition.raceGrade,
    netkeibaGradeType: condition.netkeibaGradeType,
  };
}

export function resolveClassTier(condition: RaceCondition): ClassTier {
  return resolveEffectiveRaceClass(raceClassSourceFromCondition(condition));
}

export function isOpenOrGradedRace(condition: RaceCondition): boolean {
  return isGradedOpenTier(resolveClassTier(condition));
}

export function classTierToBucket(tier: ClassTier): RaceClassBucket {
  if (tier === "MAIDEN_NEW") return "MAIDEN_NEW";
  if (isGradedOpenTier(tier)) return "OPEN_GRADE";
  return "OTHER";
}

export function inferRaceClassBucket(condition: RaceCondition): RaceClassBucket {
  return classTierToBucket(resolveClassTier(condition));
}
