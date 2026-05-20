import type { HorseAbility } from "../../domain/race-evaluation/abilityTypes";
import { filterPastRunsForCurrentRace } from "./filterPastRuns";
import type { RaceEntryEvaluation, RaceEvaluationData } from "./raceEvaluationTypes";

export type EnrichedRaceHorse = HorseAbility & { gate: number; frameNumber: number };

function n(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function entryAiWinRate(entry: RaceEntryEvaluation): number | undefined {
  const ext = entry as RaceEntryEvaluation & { ai_predicted_win_rate?: number };
  return n(entry.aiPredictedWinRate) ?? n(ext.ai_predicted_win_rate);
}

function entryAiEffectiveEv(entry: RaceEntryEvaluation): number | undefined {
  const ext = entry as RaceEntryEvaluation & { ai_effective_ev?: number };
  return n(entry.aiEffectiveEv) ?? n(ext.ai_effective_ev);
}

/** JRA 標準: 馬番 n → 枠 ceil(n/2)（1〜2→1枠 … 17〜18→8枠） */
export function inferFrameNumberFromGate(gate: number): number {
  return Math.max(1, Math.min(8, Math.ceil(gate / 2)));
}

function clampHorseNumber(n: number): number {
  return Math.max(1, Math.min(36, Math.round(n)));
}

/**
 * 欠番があっても効く「全頭 +1」補正: 馬番がすべて 2 以上かつ -1 すると 1 始まりで重複なし、かつ明らかにズレが大きいとき。
 */
function shouldUniformShiftHorseNumbersDownOne(entries: readonly RaceEntryEvaluation[]): boolean {
  const n = entries.length;
  if (n < 6) return false;
  const nums = entries.map((e) => e.horseNumber).filter((x) => Number.isFinite(x));
  if (nums.length !== n) return false;
  if (nums.some((x) => x < 2)) return false;
  if (Math.min(...nums) !== 2) return false;
  const shifted = nums.map((x) => x - 1);
  if (new Set(shifted).size !== n) return false;
  if (Math.min(...shifted) !== 1) return false;
  const maxN = Math.max(...nums);
  // 取消しで欠番があっても「全体が +1」なら max が頭数に対して大きすぎるか 18 番台に乗る
  if (maxN >= 18) return true;
  if (maxN > n + 2) return true;
  return false;
}

/** 同一枠は最大 2 頭のため、3 頭以上で全員同じ枠はデータ壊れ → 馬番から枠を付け直す */
function shouldReassignFramesWhenSameForAll(entries: readonly RaceEntryEvaluation[]): boolean {
  if (entries.length <= 2) return false;
  const frames = entries.map((e) => e.frameNumber).filter((f) => Number.isFinite(f));
  if (frames.length !== entries.length) return false;
  return new Set(frames).size === 1;
}

/**
 * 読み込み後の出走表メタの救済（馬番 +1・枠が全頭同一の壊れ JSON）。
 * `normalizeRaceEvaluationDataForUi` / `raceDataToHorses` / チップ用の共通処理。
 */
export function sanitizeRaceEntriesForUi(entries: readonly RaceEntryEvaluation[]): RaceEntryEvaluation[] {
  const list: RaceEntryEvaluation[] = entries.map((e) => ({ ...e }));
  let changed = false;
  if (shouldUniformShiftHorseNumbersDownOne(list)) {
    for (let i = 0; i < list.length; i += 1) {
      const cur = list[i];
      if (cur == null) continue;
      list[i] = { ...cur, horseNumber: clampHorseNumber(cur.horseNumber - 1) };
    }
    changed = true;
  }
  if (shouldReassignFramesWhenSameForAll(list)) {
    for (let i = 0; i < list.length; i += 1) {
      const cur = list[i];
      if (cur == null) continue;
      list[i] = { ...cur, frameNumber: inferFrameNumberFromGate(cur.horseNumber) };
    }
    changed = true;
  }
  if (!changed) return entries as RaceEntryEvaluation[];
  return list;
}

/**
 * 主観加点・馬番ピン用。出馬表と同じ「枠順（1枠→8枠）→枠内馬番」の並び。
 * `frameNumber` は JSON を優先し、欠損時のみ馬番から上記 JRA 標準で復元する。
 */
export type RaceEntryGateRow = {
  horseId: string;
  horseName: string;
  frameNumber: number;
  horseNumber: number;
};

export function getSortedRaceEntryGateRows(data: RaceEvaluationData): RaceEntryGateRow[] {
  const entries = sanitizeRaceEntriesForUi(data.entries);
  return entries
    .map((e) => {
      const horseNumber =
        Number.isFinite(e.horseNumber) && e.horseNumber >= 1 ? Math.round(e.horseNumber) : 0;
      if (horseNumber < 1) return null;
      const frameNumber =
        Number.isFinite(e.frameNumber) && e.frameNumber >= 1 && e.frameNumber <= 8
          ? Math.round(e.frameNumber)
          : inferFrameNumberFromGate(horseNumber);
      return {
        horseId: e.horseId,
        horseName: e.horseName,
        frameNumber,
        horseNumber,
      };
    })
    .filter((row): row is RaceEntryGateRow => row != null)
    .sort((a, b) => {
      if (a.frameNumber !== b.frameNumber) return a.frameNumber - b.frameNumber;
      return a.horseNumber - b.horseNumber;
    });
}

/**
 * 評価 JSON の各エントリを evaluateRace 入力用 `HorseAbility` へ。馬番 = gate。
 */
export function raceDataToHorses(data: RaceEvaluationData): EnrichedRaceHorse[] {
  const entries = sanitizeRaceEntriesForUi(data.entries);
  const raceId = data.raceId;
  return entries.map((e) => ({
    // 生JSONの欠損に備え、gate/frameNumber は必ず埋める。
    gate: Number.isFinite(e.horseNumber) ? e.horseNumber : 1,
    frameNumber:
      Number.isFinite(e.frameNumber) && e.frameNumber >= 1 && e.frameNumber <= 8
        ? Math.round(e.frameNumber)
        : inferFrameNumberFromGate(Number.isFinite(e.horseNumber) ? e.horseNumber : 1),
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
    signals: e.evaluationSignals,
    investment: e.investment,
    was_bias_disadvantaged: e.was_bias_disadvantaged,
    l2_top_speed: e.l2_top_speed,
    bias_mismatch: e.bias_mismatch,
    pace_mismatch: e.pace_mismatch,
    l2_sustain_ratio: e.l2_sustain_ratio,
    pastRuns: filterPastRunsForCurrentRace(e.pastRuns, raceId),
    ...(e.position_x != null && Number.isFinite(e.position_x) ? { position_x: e.position_x } : {}),
    ...(e.abilityIndex != null && Number.isFinite(e.abilityIndex) ? { abilityIndex: e.abilityIndex } : {}),
    ...(e.suitabilityFlags != null && e.suitabilityFlags.length > 0
      ? { suitabilityFlags: e.suitabilityFlags }
      : {}),
    ...(e.abilities_source === "past_runs_estimated" ? { abilitiesPrecomputedFromPastRuns: true as const } : {}),
    ...(entryAiWinRate(e) != null ? { aiPredictedWinRate: entryAiWinRate(e) } : {}),
    ...(entryAiEffectiveEv(e) != null ? { aiEffectiveEv: entryAiEffectiveEv(e) } : {}),
  }));
}
