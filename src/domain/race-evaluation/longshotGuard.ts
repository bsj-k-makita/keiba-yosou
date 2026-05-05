import type { HorseAbility, HorseScoreResult } from "./abilityTypes";
import { getEffectiveEvaluationSignals } from "./resolveEvaluationSignals";

/**
 * 単勝50倍超・基礎ブレンド5位外・直近大敗1回以上 → ◎/○ を付与しない
 */
export function applyLongshotMarkGuard(
  horses: readonly HorseAbility[],
  results: HorseScoreResult[],
): void {
  const resultById = new Map(results.map((r) => [r.horseId, r] as const));
  const sorted = [...results].sort((a, b) => b.baseAbilityCore - a.baseAbilityCore);

  for (const h of horses) {
    const sig = getEffectiveEvaluationSignals(h);
    if (sig == null || sig.winOdds == null) continue;
    if (sig.winOdds < 50) continue;
    if ((sig.heavyDefeatCountLast3 ?? 0) < 1) continue;

    const r = resultById.get(h.horseId);
    if (r == null) continue;

    const pos = sorted.findIndex((x) => x.horseId === h.horseId) + 1;
    if (pos <= 5) continue;
    if (r.mark === "◎" || r.mark === "○") {
      r.mark = "▲";
    }
  }
}
