import type { HorseEvaluationSignals } from "./abilityTypes";
import {
  classifyLapStructure,
  LAP_STRUCTURE,
  type LapStructureKind,
} from "./lapStructure";
import type { PastRunRecord } from "./pastRunTypes";

export type LossClassification = "展開不利" | "能力不足" | "判定不能";

const HEAVY_DEFEAT_SEC = 1.5;

/**
 * 1走の大敗について敗因を分類する。
 * - 大敗ではない（margin < 1.5）: 判定不能
 * - run のラップ形状が不明 or 中間: 判定不能
 * - 今日の形状が不明 or 中間: 判定不能
 * - lap 形状が不一致: 展開不利
 * - lap 形状が一致: 能力不足（同じ条件で負けた）
 */
function classifyRunLoss(
  run: PastRunRecord,
  raceLapShape: LapStructureKind,
): LossClassification {
  const margin = run.marginToWinnerSec;
  if (margin == null || !Number.isFinite(margin) || margin < HEAVY_DEFEAT_SEC) {
    return "判定不能";
  }

  let runShape: LapStructureKind | null = run.lapStructure ?? null;
  if (runShape == null && run.section200mSec != null && run.section200mSec.length >= 4) {
    runShape = classifyLapStructure(run.section200mSec);
  }

  if (runShape == null || runShape === LAP_STRUCTURE.NEUTRAL) return "判定不能";

  return runShape !== raceLapShape ? "展開不利" : "能力不足";
}

/**
 * 敗因分解を適用した大敗ペナルティ計算。
 *
 * 設計方針:
 * - 「積極的にラップ不一致を確認できた場合のみ展開不利として軽減」
 * - データ不足 or 判定不能が多い場合は従来ロジック（fallbackPenalty）を使う
 * - 能力不足と認定された大敗は従来より重くペナルティ
 */
export function computeAdjustedRiskPenalty(
  pastRuns: readonly PastRunRecord[] | undefined,
  raceLapShape: LapStructureKind | null,
  signals: HorseEvaluationSignals | undefined,
): number {
  // 判定不能ケース → 従来ロジックにフォールバック
  if (
    !pastRuns ||
    pastRuns.length === 0 ||
    raceLapShape == null ||
    raceLapShape === LAP_STRUCTURE.NEUTRAL
  ) {
    return fallbackPenalty(signals);
  }

  const last3 = pastRuns.slice(0, 3);
  const heavyRuns = last3.filter(
    (r) =>
      r.marginToWinnerSec != null &&
      Number.isFinite(r.marginToWinnerSec) &&
      r.marginToWinnerSec >= HEAVY_DEFEAT_SEC,
  );

  // 大敗ゼロ → ペナルティなし（2桁着順のみ後述）
  if (heavyRuns.length === 0) {
    return fallbackPenalty(signals);
  }

  const classifications = heavyRuns.map((r) => classifyRunLoss(r, raceLapShape));
  const unfavorableCount = classifications.filter((c) => c === "展開不利").length;
  const abilityLackCount = classifications.filter((c) => c === "能力不足").length;
  const unknownCount = classifications.filter((c) => c === "判定不能").length;

  // 全大敗が判定不能 → フォールバック
  if (heavyRuns.length > 0 && heavyRuns.length === unknownCount) {
    return fallbackPenalty(signals);
  }

  const goodRuns = signals?.goodRunCountLast5 ?? 0;
  let penalty = 0;

  // 能力不足認定の大敗（従来より重め）
  if (abilityLackCount >= 2) {
    penalty += goodRuns >= 1 ? 3 : 5;
  } else if (abilityLackCount === 1 && goodRuns === 0) {
    penalty += 2;
  } else if (abilityLackCount === 1 && goodRuns >= 1) {
    penalty += 1;
  }

  // 展開不利認定の大敗（軽減。好走ありなら無視）
  if (unfavorableCount >= 2) {
    penalty += goodRuns >= 1 ? 0 : 0.5;
  } else if (unfavorableCount === 1 && goodRuns === 0) {
    penalty += 0.5;
  }

  // 2桁着順は変わらず（signals 依存）
  const twoDigit = signals?.doubleDigitPlaceCountLast5 ?? 0;
  if (twoDigit >= 3) {
    penalty += goodRuns >= 1 ? 1 : 2;
  }

  return penalty;
}

/** 従来の riskPenaltyPoints 相当（フォールバック用） */
function fallbackPenalty(signals: HorseEvaluationSignals | undefined): number {
  if (signals == null) return 0;
  const heavy = signals.heavyDefeatCountLast3 ?? 0;
  const twoDigit = signals.doubleDigitPlaceCountLast5 ?? 0;
  const goodRuns = signals.goodRunCountLast5 ?? 0;
  let p = 0;
  if (heavy >= 2) {
    p += goodRuns >= 1 ? 2 : 4;
  } else if (heavy === 1 && goodRuns === 0) {
    p += 1;
  }
  if (twoDigit >= 3) {
    p += goodRuns >= 1 ? 1 : 2;
  }
  return p;
}
