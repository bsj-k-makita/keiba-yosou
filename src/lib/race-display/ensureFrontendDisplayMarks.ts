import type { HorseAbility, HorseScoreResult, RaceCondition } from "../../domain/race-evaluation/abilityTypes";
import {
  assignHokkakeRoles,
  computeTriangleTarget,
  ensureTriangleMarks,
} from "../../domain/race-evaluation/markAssigner";
import { inferPaceSeverityKind } from "../../domain/race-evaluation/paceSeverity";

const REQUIRED_SINGLE_MARKS = ["◎", "○", "▲", "☆", "△"] as const;
type RequiredSingleMark = (typeof REQUIRED_SINGLE_MARKS)[number];

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
      return fr >= 6 && br - fr >= 3 && r.scoreDiff >= 0.5;
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
 * 表示用: buyLabel・構造消しを理由に印を欠かさない。
 * domain の fillRequiredMarks は DISMISS 除外のため、フロント専用で全頭から再割当する。
 */
function fillAllRequiredMarksForDisplay(results: HorseScoreResult[]): void {
  const eligible = [...results].sort(sortByFinalRank);
  if (eligible.length === 0) return;

  const reservedHorseIds = new Set<string>();
  const markOwners = new Map<RequiredSingleMark, HorseScoreResult>();

  for (const r of eligible) {
    const m = r.mark;
    if (!REQUIRED_SINGLE_MARKS.includes(m as RequiredSingleMark)) continue;
    const mark = m as RequiredSingleMark;
    if (!markOwners.has(mark) && !reservedHorseIds.has(r.horseId)) {
      markOwners.set(mark, r);
      reservedHorseIds.add(r.horseId);
      continue;
    }
    r.mark = "";
  }

  for (const required of REQUIRED_SINGLE_MARKS) {
    if (markOwners.has(required)) continue;
    const available = eligible.filter((r) => !reservedHorseIds.has(r.horseId));
    if (available.length === 0) {
      const fallback =
        eligible.find((r) => r.mark === "" || r.mark === "△") ?? eligible[eligible.length - 1];
      if (!fallback) break;
      reservedHorseIds.delete(fallback.horseId);
      fallback.mark = required;
      markOwners.set(required, fallback);
      reservedHorseIds.add(fallback.horseId);
      continue;
    }
    const picked = required === "☆" ? pickStarCandidate(available) : available[0];
    if (!picked) continue;
    picked.mark = required;
    markOwners.set(required, picked);
    reservedHorseIds.add(picked.horseId);
  }
}

function hasAllSingleMarks(results: readonly HorseScoreResult[]): boolean {
  return REQUIRED_SINGLE_MARKS.every((mark) => results.some((r) => r.mark === mark));
}

/**
 * ブラウザ表示用に印（◎○▲☆△＋複数△）を必ず埋める。evaluateRace の結果をコピーして返す。
 */
export function ensureFrontendDisplayMarks(
  results: readonly HorseScoreResult[],
  horses: readonly HorseAbility[],
  condition: RaceCondition,
): HorseScoreResult[] {
  if (results.length === 0) return [];

  const copy = results.map((r) => ({ ...r }));
  const paceSeverity = inferPaceSeverityKind(horses, condition);
  const triangleTarget = computeTriangleTarget(copy.length);

  assignHokkakeRoles(copy, horses, paceSeverity);
  fillAllRequiredMarksForDisplay(copy);
  ensureTriangleMarks(copy, triangleTarget, new Set());

  if (!hasAllSingleMarks(copy) || copy.filter((r) => r.mark === "△").length < 1) {
    fillAllRequiredMarksForDisplay(copy);
    ensureTriangleMarks(copy, triangleTarget, new Set());
  }

  return copy;
}
