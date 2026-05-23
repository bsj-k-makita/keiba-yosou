import type { HorseAbility, HorseScoreResult, RaceCondition } from "../../domain/race-evaluation/abilityTypes";
import {
  applyMarkSnapshot,
  isMarkFrozen,
  marksToSnapshot,
} from "../../domain/race-evaluation/markFreeze";
import type { AiMarkSnapshot, RaceInfo } from "../race-data/raceEvaluationTypes";
import { applyAiMarksByEffectiveEv } from "./aiMarkAssignment";

export type ApplyAiMarksWithFreezeResult = {
  results: HorseScoreResult[];
  marksFrozen: boolean;
  /** 保存済みスナップショットを適用した */
  usedStoredSnapshot: boolean;
  /** 新規にスナップショットを生成した（固定開始後の初回など） */
  createdSnapshot: AiMarkSnapshot | null;
};

export type ApplyAiMarksWithFreezeOptions = {
  raceInfo: RaceInfo;
  storedSnapshot?: AiMarkSnapshot | null;
  now?: Date;
};

/**
 * AI 印付与。発走30分前以降は storedSnapshot を優先し、EV 再計算で印を変えない。
 * 固定開始後にスナップショットが無い場合は1回だけ現行 EV で付与し、スナップショットを返す。
 */
export function applyAiMarksWithFreeze(
  tsMarked: readonly HorseScoreResult[],
  horses: readonly HorseAbility[],
  condition: RaceCondition | undefined,
  options: ApplyAiMarksWithFreezeOptions,
): ApplyAiMarksWithFreezeResult {
  const now = options.now ?? new Date();
  const frozen = isMarkFrozen(options.raceInfo, now);

  if (!frozen) {
    const results = applyAiMarksByEffectiveEv(tsMarked, horses, condition);
    return {
      results,
      marksFrozen: false,
      usedStoredSnapshot: false,
      /** 固定前は印を毎回再計算。スナップショット保存は固定開始時のみ。 */
      createdSnapshot: null,
    };
  }

  const snap = options.storedSnapshot;
  if (snap != null && Object.keys(snap.marksByHorseId).length > 0) {
    return {
      results: applyMarkSnapshot(tsMarked, snap),
      marksFrozen: true,
      usedStoredSnapshot: true,
      createdSnapshot: null,
    };
  }

  const results = applyAiMarksByEffectiveEv(tsMarked, horses, condition);
  const createdSnapshot = marksToSnapshot(results);
  return {
    results,
    marksFrozen: true,
    usedStoredSnapshot: false,
    createdSnapshot,
  };
}
