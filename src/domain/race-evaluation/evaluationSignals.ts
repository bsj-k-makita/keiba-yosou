import type { HorseEvaluationSignals } from "./abilityTypes";

/** 再現性 0.5=中立。スケール外はクリップ。 */
export function reproducibilityDelta(signals: HorseEvaluationSignals | undefined): number {
  if (signals?.reproducibility01 == null) return 0;
  const x = Math.max(0, Math.min(1, signals.reproducibility01));
  return (x - 0.5) * 4;
}

/**
 * 大敗系の素点減点（1頭あたり合計点）。
 *
 * 好走実績（goodRunCountLast5）があれば「状況依存の大敗」とみなしてペナルティを軽減。
 * 好走ゼロの場合は一貫した低パフォーマンスとして維持。
 *
 * | パターン                        | 減点 |
 * |---------------------------------|------|
 * | 大敗2回以上 + 好走あり          | -2  |
 * | 大敗2回以上 + 好走なし          | -4  |
 * | 大敗1回    + 好走なし           | -1  |
 * | 2桁着順3回以上 + 好走あり       | -1  |
 * | 2桁着順3回以上 + 好走なし       | -2  |
 */
export function riskPenaltyPoints(signals: HorseEvaluationSignals | undefined): number {
  if (signals == null) return 0;
  const heavy = signals.heavyDefeatCountLast3 ?? 0;
  const twoDigit = signals.doubleDigitPlaceCountLast5 ?? 0;
  const goodRuns = signals.goodRunCountLast5 ?? 0;
  let p = 0;

  if (heavy >= 2) {
    // 好走実績があれば状況依存とみなして半減
    p += goodRuns >= 1 ? 2 : 4;
  } else if (heavy === 1 && goodRuns === 0) {
    // 1回大敗でも好走なしなら軽微ペナ
    p += 1;
  }

  if (twoDigit >= 3) {
    p += goodRuns >= 1 ? 1 : 2;
  }

  return p;
}

export function shouldBlockHondeCandidate(signals: HorseEvaluationSignals | undefined): boolean {
  if ((signals?.doubleDigitPlaceCountLast5 ?? 0) < 3) return false;
  // 好走実績があれば本命候補ブロックしない（状況依存の可能性）
  return (signals?.goodRunCountLast5 ?? 0) === 0;
}

/** 任意。重賞ブースト等は将来拡張。 */
export function shouldProhibitSGrade(signals: HorseEvaluationSignals | undefined): boolean {
  if (signals == null) return false;
  if ((signals.gradedRaceTier ?? 0) >= 2) return false;
  if ((signals.heavyDefeatCountLast3 ?? 0) < 2) return false;
  // 好走実績があれば禁止しない（状況依存の大敗）
  return (signals.goodRunCountLast5 ?? 0) === 0;
}
