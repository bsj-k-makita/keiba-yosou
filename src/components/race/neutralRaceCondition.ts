import type { RaceCondition } from "../../domain/race-evaluation";
import type { RaceEvaluationData } from "../../lib/race-data";

/**
 * 補正パネルの「デフォルト」相当。馬場フラット・標準時計・ゲート指定や重点項目を解除。
 * 会場・距離・コースキーなどレースメタは維持する。
 */
export function buildDefaultNeutralCondition(
  race: RaceEvaluationData,
  inferredSection200mSec: readonly number[] | undefined,
): RaceCondition {
  const base = race.condition;
  const ri = race.raceInfo;
  return {
    ...base,
    venue: ri.venue ?? base.venue,
    surface: (base.surface ?? ri.surface) as RaceCondition["surface"],
    distance: base.distance ?? ri.distance,
    raceName: base.raceName ?? ri.raceName,
    meetingDate: base.meetingDate ?? ri.date,
    ground: "good",
    trackSpeed: "standard",
    bias: "flat",
    pace: "middle",
    adjustmentStrength: "middle",
    paceInference: undefined,
    abilityFocus: undefined,
    abilityPriority: undefined,
    favoredHorseNumbers: undefined,
    disfavoredHorseNumbers: undefined,
    favoredGateNumbers: undefined,
    disfavoredGateNumbers: undefined,
    quickAdjustments: undefined,
    meetingPhase: undefined,
    openingMeetingWeek: undefined,
    closingMeetingWeek: undefined,
    trackCushion01: undefined,
    trackBiasStrength01: undefined,
    section200mSec: race.condition.section200mSec ?? inferredSection200mSec,
  };
}

/**
 * 条件補正を極力外した「能力寄り」のプレビュー用。
 * 上記デフォルトに加え、ラップ形状由来の層を外すため section200mSec を付けない。
 */
export function buildAbilityOnlyEvaluationCondition(
  race: RaceEvaluationData,
  inferredSection200mSec: readonly number[] | undefined,
): RaceCondition {
  const n = buildDefaultNeutralCondition(race, inferredSection200mSec);
  return {
    ...n,
    section200mSec: undefined,
    paceInference: "manual",
  };
}
