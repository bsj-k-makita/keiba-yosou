import {
  computeAbilityLetterGrades,
  evaluateRace,
  getFinalWeights,
  type HorseAbility,
  type RaceCondition,
  weightsToDemand0to100,
} from "../../domain/race-evaluation";
import { computeFitScore, fitLevelFromScore } from "../../domain/race-evaluation/fitScore";
import { computePaceFitLevel } from "../../domain/race-evaluation/paceFit";
import type { EnrichedRaceHorse } from "./raceDataToHorses";
import type { RaceEntryEvaluation, RaceEvaluationData, RaceInfo } from "./raceEvaluationTypes";
import type { DisplayGrade } from "../../domain/race-evaluation/abilityGrades";

type BuildInput = {
  raceId: string;
  raceInfo: RaceInfo;
  condition: RaceCondition;
  /** `raceDataToHorses` 相当（馬番・枠含む） */
  entries: (HorseAbility & { gate: number; frameNumber: number })[];
};

/**
 * 正規化済みの出走と条件から、保存用 Evaluation JSON 相当のオブジェクトを組み立てる。
 * netkeiba 再取得なしで評価ロジックだけ差し替え再計算するときの入口。
 */
export function buildEvaluationData(input: BuildInput): RaceEvaluationData {
  const { raceId, raceInfo, condition, entries } = input;
  const baseHorses: HorseAbility[] = entries;
  const results = evaluateRace(baseHorses, condition);
  const rById = new Map(results.map((r) => [r.horseId, r] as const));
  const finalW = getFinalWeights(condition);
  const demand = weightsToDemand0to100(finalW);
  const relGrades = computeAbilityLetterGrades(baseHorses);

  return {
    raceId,
    raceInfo,
    condition,
    entries: entries.map((h): RaceEntryEvaluation => {
      const r = rById.get(h.horseId);
      if (r == null) {
        throw new Error(`buildEvaluationData: 結果に馬が存在しません: ${h.horseId}`);
      }
      const row = relGrades.get(h.horseId);
      if (row == null) {
        throw new Error(`buildEvaluationData: 等級が求まりません: ${h.horseId}`);
      }
      const fitRaw = computeFitScore(h, demand);
      return {
        horseId: h.horseId,
        horseName: h.horseName,
        horseNumber: h.gate,
        frameNumber: h.frameNumber,
        jockey: h.jockey,
        trainer: h.trainer,
        sex: h.sex,
        age: h.age,
        bodyWeightKg: h.bodyWeightKg,
        pedigree: h.pedigree,
        runningStyle: h.runningStyle,
        abilities: {
          speed: h.speed,
          stamina: h.stamina,
          kick: h.kick,
          sustain: h.sustain,
          power: h.power,
        },
        abilityGrades: {
          speed: row.speed as DisplayGrade,
          stamina: row.stamina as DisplayGrade,
          kick: row.kick as DisplayGrade,
          sustain: row.sustain as DisplayGrade,
          power: row.power as DisplayGrade,
        },
        evaluation: {
          baseScore: r.baseScore,
          adjustedScore: r.adjustedScore,
          scoreDiff: r.scoreDiff,
          baseAbilityCore: r.baseAbilityCore,
          intrinsicAbilityScore: r.intrinsicAbilityScore,
          raceAdjustedInput: r.raceAdjustedInput,
          conditionFitDelta: r.conditionFitDelta,
          reproducibilityDelta: r.reproducibilityDelta,
          riskPenalty: r.riskPenalty,
          raceRelativeScore: r.raceRelativeScore,
          paceFitBonus: r.paceFitBonus,
          distanceFitBonus: r.distanceFitBonus,
          classLevelBonus: r.classLevelBonus,
          pedigreeBonus: r.pedigreeBonus,
          gateBiasBonus: r.gateBiasBonus,
          gateStyleSynergyBonus: r.gateStyleSynergyBonus,
          connectionsBonus: r.connectionsBonus,
          trendBonus: r.trendBonus,
          paceBalanceBonus: r.paceBalanceBonus,
          tripContextBonus: r.tripContextBonus,
          finalEvaluationScore: r.finalEvaluationScore,
          lapShapeFitBonus: r.lapShapeFitBonus,
          lapSustainBonus: r.lapSustainBonus,
          lapQualityBonus: r.lapQualityBonus,
          stepPatternBonus: r.stepPatternBonus,
          lapProfile: r.lapProfile,
          varianceScore: r.varianceScore,
          roleHint: r.roleHint,
          pastRunInsight: r.pastRunInsight,
          fitLevel: fitLevelFromScore(fitRaw),
          paceFit: computePaceFitLevel(h, condition),
          buyLabel: r.buyLabel,
        },
        evaluationSignals: h.signals,
        investment: h.investment,
        pastRuns: h.pastRuns,
      };
    }),
  };
}

/** `RaceEvaluationData` から同じ手順で上書き再生成（ロジック変更テスト用）。 */
export function recomputeEvaluationData(data: RaceEvaluationData): RaceEvaluationData {
  const entries = data.entries.map(
    (e) =>
      ({
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
      }) as EnrichedRaceHorse,
  );
  return buildEvaluationData({
    raceId: data.raceId,
    raceInfo: data.raceInfo,
    condition: data.condition,
    entries,
  });
}
