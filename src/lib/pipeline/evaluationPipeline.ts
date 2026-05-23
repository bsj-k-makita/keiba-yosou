import { evaluateRace, type HorseAbility, type RaceCondition, type HorseScoreResult } from "../../domain/race-evaluation";
import { ensureFrontendDisplayMarks } from "../race-display/ensureFrontendDisplayMarks";
import {
  buildRaceEvaluationViewModel,
  type RaceEvaluationViewModel,
} from "../../viewModel/raceEvaluationViewModel";
import { effectiveSoftmaxTemperature, softmaxDistribution } from "./normalization";
import { applyAiMarksByEffectiveEv } from "./aiMarkAssignment";
import {
  DEFAULT_PROBABILITY_ENGINE,
  raceHasFullAiBackfill,
  type ProbabilityEngine,
  resolveAdjustedProbabilities,
} from "./probabilityEngine";
import { resolveAiRaceRegime, type AiRaceRegime } from "./aiEvRegime";
import { applyAiMarksWithFreeze } from "./applyAiMarksWithFreeze";
import type { AiMarkSnapshot, RaceInfo } from "../race-data/raceEvaluationTypes";

export type EvaluationPipelineOptions = {
  probabilityEngine?: ProbabilityEngine;
  raceInfo?: RaceInfo;
  markSnapshot?: AiMarkSnapshot | null;
  now?: Date;
};

export type EvaluationPipelineResult = {
  results: HorseScoreResult[];
  viewModel: RaceEvaluationViewModel;
  adjustedProbabilities: Map<string, number>;
  /** 実際に勝率表示・馬券 EV に使ったエンジン（ai 要求時データ無しなら ts） */
  probabilityEngine: ProbabilityEngine;
  /** AI モード時の EV レジーム（横並びなら NO_EV_REGIME・警告表示） */
  aiRaceRegime: AiRaceRegime;
  /** TS 印付き（能力スコア基準・内部参照用） */
  tsReferenceResults: HorseScoreResult[];
  /** 数学的1位と表示◎が不一致のとき true（馬券生成をスキップ） */
  isSkippableRace: boolean;
  mathFirstHorseId?: string;
  displayFavoriteHorseId?: string;
  /** 発走30分前以降で印を固定表示している */
  marksFrozen: boolean;
  /** 固定前に保存すべき最新印（localStorage / JSON 用） */
  pendingMarkSnapshot: AiMarkSnapshot | null;
};

function mathFirstByFinalRank(results: readonly HorseScoreResult[]): HorseScoreResult | undefined {
  return [...results].sort((a, b) => {
    const ra = a.finalRank ?? 99;
    const rb = b.finalRank ?? 99;
    if (ra !== rb) return ra - rb;
    return b.finalEvaluationScore - a.finalEvaluationScore;
  })[0];
}

export function runRaceEvaluationPipeline(
  horses: readonly HorseAbility[],
  condition: RaceCondition,
  options?: EvaluationPipelineOptions,
): EvaluationPipelineResult {
  const raw = evaluateRace([...horses], condition);
  const tsMarked = ensureFrontendDisplayMarks(raw, horses, condition);
  const temperature = effectiveSoftmaxTemperature(
    condition.softmaxTemperature,
    condition.adjustmentStrength,
  );
  const tsProbabilities = softmaxDistribution(
    tsMarked.map((row) => ({ horseId: row.horseId, score: row.finalEvaluationScore })),
    temperature,
  );

  const requestedEngine = options?.probabilityEngine ?? DEFAULT_PROBABILITY_ENGINE;
  const { probabilities: adjustedProbabilities, engineUsed: probabilityEngine } =
    resolveAdjustedProbabilities(horses, tsProbabilities, requestedEngine);

  const aiRaceRegime: AiRaceRegime =
    probabilityEngine === "ai" ? resolveAiRaceRegime(horses) : "NORMAL_AI_REGIME";

  let marksFrozen = false;
  let pendingMarkSnapshot: AiMarkSnapshot | null = null;
  let results: HorseScoreResult[] = tsMarked;

  if (probabilityEngine === "ai" && raceHasFullAiBackfill(horses) && options?.raceInfo != null) {
    const applied = applyAiMarksWithFreeze(tsMarked, horses, condition, {
      raceInfo: options.raceInfo,
      storedSnapshot: options.markSnapshot ?? options.raceInfo.aiMarkSnapshot ?? null,
      now: options.now,
    });
    results = applied.results;
    marksFrozen = applied.marksFrozen;
    if (applied.createdSnapshot != null) {
      pendingMarkSnapshot = applied.createdSnapshot;
    }
  } else if (probabilityEngine === "ai" && raceHasFullAiBackfill(horses)) {
    results = applyAiMarksByEffectiveEv(tsMarked, horses, condition);
    if (!results.some((r) => r.mark === "◎")) {
      results = applyAiMarksByEffectiveEv(tsMarked, horses, condition);
    }
  }

  const mathFirst = mathFirstByFinalRank(results);
  const displayFavorite = results.find((r) => r.mark === "◎");
  // AIモード: TSの「数学1位≠◎」強制見送りは無効（ai_effective_ev 閾値に統一）
  const isSkippableRace =
    probabilityEngine === "ts" &&
    mathFirst != null &&
    displayFavorite != null &&
    mathFirst.horseId !== displayFavorite.horseId;

  const viewModel = buildRaceEvaluationViewModel(
    horses,
    results,
    condition,
    adjustedProbabilities,
    { probabilityEngine },
  );
  return {
    results,
    viewModel,
    adjustedProbabilities,
    probabilityEngine,
    aiRaceRegime,
    tsReferenceResults: tsMarked,
    isSkippableRace,
    mathFirstHorseId: mathFirst?.horseId,
    displayFavoriteHorseId: displayFavorite?.horseId,
    marksFrozen,
    pendingMarkSnapshot,
  };
}
