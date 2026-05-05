import type { HorseScoreResult, RaceTargetingSignals } from "./abilityTypes";

/**
 * レース狙い度（将来実装）— 現状はシグナル抽出のみ。
 */
export function describeTargetingPlaceholder(): string {
  return "レース狙い度は今後、補正での浮上幅・人気とのズレ・同型の厚みなどから算出予定です。";
}

export function collectTargetingSignals(
  _results: HorseScoreResult[],
): RaceTargetingSignals {
  return {
    largeUpsideExists: false,
    favoriteMisalignmentWithTopMark: false,
    multipleSameTypePeers: false,
    dismissibleFavoriteExists: false,
  };
}
