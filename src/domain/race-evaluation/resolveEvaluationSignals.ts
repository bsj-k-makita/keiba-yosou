import type { HorseAbility, HorseEvaluationSignals } from "./abilityTypes";
import { deriveEvaluationSignalsFromPastRuns } from "./pastRunDerivedSignals";

/**
 * `signals` に値があるキーは手動を優先。未設定分だけ過去走から補完。
 */
export function getEffectiveEvaluationSignals(horse: HorseAbility): HorseEvaluationSignals | undefined {
  const manual = horse.signals;
  const fromPast =
    horse.pastRuns != null && horse.pastRuns.length > 0
      ? deriveEvaluationSignalsFromPastRuns(horse.pastRuns)
      : undefined;
  if (fromPast == null) return manual;
  if (manual == null) return fromPast;
  return {
    winOdds: manual.winOdds ?? fromPast.winOdds,
    heavyDefeatCountLast3: manual.heavyDefeatCountLast3 ?? fromPast.heavyDefeatCountLast3,
    doubleDigitPlaceCountLast5: manual.doubleDigitPlaceCountLast5 ?? fromPast.doubleDigitPlaceCountLast5,
    goodRunCountLast5: manual.goodRunCountLast5 ?? fromPast.goodRunCountLast5,
    reproducibility01: manual.reproducibility01 ?? fromPast.reproducibility01,
    gradedRaceTier: manual.gradedRaceTier ?? fromPast.gradedRaceTier,
    temperamentConcern01: manual.temperamentConcern01,
    temperamentRisk: manual.temperamentRisk,
  };
}
