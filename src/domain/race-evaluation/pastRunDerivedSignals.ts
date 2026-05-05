import type { HorseEvaluationSignals } from "./abilityTypes";
import { classifyLapStructure, type LapStructureKind } from "./lapStructure";
import type { PastRunRecord } from "./pastRunTypes";

const MARGIN_HEAVY_SEC = 1.5;
const MAX_RUNS = 5;

/**
 * 直近1走目が [0] の配列想定。着差・2桁着順・展開重視の分類再現性を推定。
 */
export function deriveEvaluationSignalsFromPastRuns(
  runs: readonly PastRunRecord[],
): HorseEvaluationSignals {
  const slice = runs.slice(0, MAX_RUNS);
  const top3 = slice.slice(0, 3);
  let heavyDefeatCountLast3 = 0;
  for (const r of top3) {
    const m = r.marginToWinnerSec;
    if (m != null && Number.isFinite(m) && m >= MARGIN_HEAVY_SEC) {
      heavyDefeatCountLast3 += 1;
    }
  }

  let doubleDigitPlaceCountLast5 = 0;
  let goodRunCountLast5 = 0;
  for (const r of slice) {
    const p = r.place;
    if (p != null && p >= 10) {
      doubleDigitPlaceCountLast5 += 1;
    }
    const m = r.marginToWinnerSec;
    const isGood =
      (p != null && p <= 3) ||
      (m != null && Number.isFinite(m) && m <= 0.5);
    if (isGood) {
      goodRunCountLast5 += 1;
    }
  }

  const kinds: LapStructureKind[] = [];
  for (const r of slice) {
    if (r.lapStructure != null) {
      kinds.push(r.lapStructure);
      continue;
    }
    const sec = r.section200mSec;
    if (sec != null && sec.length >= 4) {
      kinds.push(classifyLapStructure(sec));
    }
  }

  let reproducibility01: number | undefined;
  if (kinds.length >= 2) {
    const counts = new Map<string, number>();
    for (const k of kinds) {
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    let maxC = 0;
    for (const v of counts.values()) {
      if (v > maxC) maxC = v;
    }
    if (maxC >= 3) {
      reproducibility01 = 0.72;
    } else if (maxC === 2) {
      reproducibility01 = 0.52;
    } else if (kinds.length >= 3) {
      reproducibility01 = 0.36;
    } else {
      reproducibility01 = 0.45;
    }
  }

  return {
    heavyDefeatCountLast3,
    doubleDigitPlaceCountLast5,
    goodRunCountLast5,
    reproducibility01,
  };
}

/**
 * カード1行用（デバッグ向け。長すぎるときは切る） */
export function formatPastRunInsight(runs: readonly PastRunRecord[] | undefined): string {
  if (runs == null || runs.length === 0) return "";
  const eff = deriveEvaluationSignalsFromPastRuns(runs);
  const parts: string[] = [];
  if ((eff.heavyDefeatCountLast3 ?? 0) > 0) {
    const good = eff.goodRunCountLast5 ?? 0;
    const label = good >= 1 ? `大敗${eff.heavyDefeatCountLast3}回(好走${good}回あり)` : `大敗${eff.heavyDefeatCountLast3}回`;
    parts.push(`直近3走・${label}`);
  }
  if ((eff.doubleDigitPlaceCountLast5 ?? 0) > 0) {
    parts.push(`2桁着順${eff.doubleDigitPlaceCountLast5}回/5走`);
  }
  if (eff.reproducibility01 != null) {
    parts.push(`展開一貫性${(eff.reproducibility01 * 100).toFixed(0)}%相当`);
  }
  return parts.join(" · ");
}
