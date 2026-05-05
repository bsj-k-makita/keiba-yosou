import type { HorseScoreResult } from "./abilityTypes";
import { BUY_LABELS } from "./lingoConstants";

const STAR_MIN_RANK_JUMP = 3;
const STAR_MIN_ADJUSTED_RANK = 6;
const STAR_MIN_SCORE_DIFF = 0.5;

type MarkChar = "◎" | "○" | "▲" | "△" | "☆" | "";

function rankBasedMark(finalRank: number): Exclude<MarkChar, "☆"> {
  if (finalRank === 1) return "◎";
  if (finalRank === 2) return "○";
  if (finalRank === 3) return "▲";
  if (finalRank === 4 || finalRank === 5) return "△";
  return "";
}

/**
 * 最終スコア（レース内相対＋展開）順に印を付与。
 * 6位以下で順位が大きく上がった馬に ☆（◎〜△と重複しない）。
 */
export function assignMarks(results: HorseScoreResult[]): void {
  for (const r of results) {
    const fr = r.finalRank ?? r.adjustedRank ?? 99;
    const br = r.baseRank ?? 99;
    let mark: MarkChar = rankBasedMark(fr);

    if (
      !mark &&
      fr >= STAR_MIN_ADJUSTED_RANK &&
      br - fr >= STAR_MIN_RANK_JUMP &&
      r.scoreDiff >= STAR_MIN_SCORE_DIFF
    ) {
      mark = "☆";
    }

    r.mark = mark;
  }
}

const REQUIRED_MARKS: Exclude<MarkChar, "">[] = ["◎", "○", "▲", "☆", "△"];

function sortByFinalRank(a: HorseScoreResult, b: HorseScoreResult): number {
  const ra = a.finalRank ?? a.adjustedRank ?? 99;
  const rb = b.finalRank ?? b.adjustedRank ?? 99;
  if (ra !== rb) return ra - rb;
  return b.finalEvaluationScore - a.finalEvaluationScore;
}

function pickStarCandidate(candidates: HorseScoreResult[]): HorseScoreResult | undefined {
  const preferred = candidates
    .filter((r) => {
      const fr = r.finalRank ?? r.adjustedRank ?? 99;
      const br = r.baseRank ?? 99;
      return (
        fr >= STAR_MIN_ADJUSTED_RANK &&
        br - fr >= STAR_MIN_RANK_JUMP &&
        r.scoreDiff >= STAR_MIN_SCORE_DIFF
      );
    })
    .sort((a, b) => {
      const aj = (a.baseRank ?? 99) - (a.finalRank ?? a.adjustedRank ?? 99);
      const bj = (b.baseRank ?? 99) - (b.finalRank ?? b.adjustedRank ?? 99);
      if (bj !== aj) return bj - aj;
      return b.scoreDiff - a.scoreDiff;
    });
  return preferred[0] ?? candidates[0];
}

/**
 * 必須印（◎○▲☆△）が欠けないように補完する。
 * - 消し馬は対象外
 * - 既存印は可能な限り維持
 * - 重複印は先着1頭のみ維持して残りを再割当
 */
export function fillRequiredMarks(results: HorseScoreResult[]): void {
  const eligible = [...results]
    .filter((r) => r.buyLabel !== BUY_LABELS.DISMISS)
    .sort(sortByFinalRank);
  if (eligible.length === 0) return;

  const reservedHorseIds = new Set<string>();
  const markOwners = new Map<Exclude<MarkChar, "">, HorseScoreResult>();

  for (const r of eligible) {
    const m = r.mark as MarkChar;
    if (!REQUIRED_MARKS.includes(m as Exclude<MarkChar, "">)) continue;
    const mark = m as Exclude<MarkChar, "">;
    if (!markOwners.has(mark) && !reservedHorseIds.has(r.horseId)) {
      markOwners.set(mark, r);
      reservedHorseIds.add(r.horseId);
      continue;
    }
    r.mark = "";
  }

  for (const required of REQUIRED_MARKS) {
    if (markOwners.has(required)) continue;
    const available = eligible.filter((r) => !reservedHorseIds.has(r.horseId));
    if (available.length === 0) break;
    const picked = required === "☆" ? pickStarCandidate(available) : available[0];
    if (!picked) continue;
    picked.mark = required;
    markOwners.set(required, picked);
    reservedHorseIds.add(picked.horseId);
  }
}
