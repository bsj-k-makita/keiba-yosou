import type { HorseAbility } from "../../domain/race-evaluation/abilityTypes";
import type { RaceEvaluationData } from "./raceEvaluationTypes";

export type EnrichedRaceHorse = HorseAbility & { gate: number; frameNumber: number };

/**
 * 評価 JSON の各エントリを evaluateRace 入力用 `HorseAbility` へ。馬番 = gate。
 */
export function raceDataToHorses(data: RaceEvaluationData): EnrichedRaceHorse[] {
  return data.entries.map((e) => ({
    horseId: e.horseId,
    horseName: e.horseName,
    runningStyle: e.runningStyle,
    sex: e.sex,
    age: e.age,
    jockey: e.jockey,
    trainer: e.trainer,
    bodyWeightKg: e.bodyWeightKg,
    speed: e.abilities.speed,
    stamina: e.abilities.stamina,
    kick: e.abilities.kick,
    sustain: e.abilities.sustain,
    power: e.abilities.power,
    pedigree: e.pedigree,
    gate: e.horseNumber,
    frameNumber: e.frameNumber,
    signals: e.evaluationSignals,
    investment: e.investment,
    pastRuns: e.pastRuns,
  }));
}
