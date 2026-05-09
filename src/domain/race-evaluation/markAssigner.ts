import type { HorseAbility, HorseScoreResult } from "./abilityTypes";
import { BUY_LABELS } from "./lingoConstants";
import type { PaceSeverityKind } from "./paceSeverity";

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
const FORWARD_STYLES_CORNER_PROMO = new Set<string>(["逃げ", "先行", "好位"]);

/**
 * 能力トップが4角極後方想定かつ、上位3頭に先行グループで4角先頭付近がいるとき、
 * ◎を「勝ち筋の位置」に寄せる（能力1位は○または▲へ）。
 */
export function applyCornerLeadFavoritePromotion(
  results: HorseScoreResult[],
  horses: readonly HorseAbility[],
  fourthCornerRankById: ReadonlyMap<string, number>,
): void {
  const horseById = new Map(horses.map((h) => [h.horseId, h] as const));
  const base1 = results.find((r) => r.baseRank === 1);
  if (!base1) return;
  const r1 = fourthCornerRankById.get(base1.horseId) ?? 99;
  if (r1 < 10) return;

  const inTop3 = results.filter((r) => (r.baseRank ?? 99) <= 3);
  const promoted = inTop3
    .filter((r) => {
      const cr = fourthCornerRankById.get(r.horseId) ?? 99;
      const h = horseById.get(r.horseId);
      if (!h) return false;
      return cr <= 5 && FORWARD_STYLES_CORNER_PROMO.has(h.runningStyle);
    })
    .sort((a, b) => {
      const ar = a.baseRank ?? 99;
      const br = b.baseRank ?? 99;
      if (ar !== br) return ar - br;
      return (b.finalEvaluationScore ?? 0) - (a.finalEvaluationScore ?? 0);
    })[0];

  if (!promoted || promoted.horseId === base1.horseId) return;

  for (const r of results) {
    if (r.mark === "◎") {
      r.mark = "";
    }
  }
  promoted.mark = "◎";
  const fr = base1.finalRank ?? 99;
  base1.mark = fr <= 2 ? "○" : "▲";
}

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

/**
 * 安定度トップ帯がスコア順で潰れているとき、○▲の座を「粘り」で一部差し替える。
 * 既存の ◎ は維持し、激しい入替は stability 差が一定以上のときのみ行う。
 */
export function applyStabilityRescueMarks(results: HorseScoreResult[]): void {
  const pool = results.filter((r) => r.buyLabel !== BUY_LABELS.DISMISS);
  if (pool.length === 0) return;

  const sorted = [...pool].sort((a, b) => (b.stabilityScore ?? 0) - (a.stabilityScore ?? 0));
  const topBand = sorted.slice(0, Math.min(3, sorted.length));

  const trySwap = (target: HorseScoreResult, mark: "▲" | "○", margin: number): boolean => {
    if (target.mark === "◎") return false;
    const incumbent = results.find((r) => r.mark === mark && r.buyLabel !== BUY_LABELS.DISMISS);
    const tSt = target.stabilityScore ?? 0;
    if (!incumbent) {
      target.mark = mark;
      return true;
    }
    const iSt = incumbent.stabilityScore ?? 0;
    const tRank = target.finalRank ?? 99;
    const iRank = incumbent.finalRank ?? 99;
    if (tSt - iSt >= margin && tRank > 3 && (iRank < tRank || tSt - iSt >= margin + 4)) {
      if (incumbent.mark === "☆") {
        incumbent.mark = "";
      } else {
        incumbent.mark = "△";
      }
      target.mark = mark;
      return true;
    }
    return false;
  };

  // 安定1位→▲を優先的に確保
  const anchor = topBand.find((r) => (r.finalRank ?? 99) >= 5);
  if (anchor) trySwap(anchor, "▲", 5);

  // 安定2位→○を試験的に確保（▲とは別頭前提）
  const second = topBand.find((r) => r !== anchor && (r.finalRank ?? 99) >= 6);
  if (second && second.mark !== "▲") trySwap(second, "○", 5);
}

/**
 * △ヒモ穴の三相（安定・物理・狙い）をフラグだけ付ける。本命印 (`mark`) は従来ロジックのまま。
 */
export function assignHokkakeRoles(
  results: HorseScoreResult[],
  horses: readonly HorseAbility[],
  paceSeverity: PaceSeverityKind,
): void {
  for (const r of results) {
    r.hokkakeRole = undefined;
  }
  const horseById = new Map(horses.map((h) => [h.horseId, h] as const));
  const pool = [...results].filter((r) => r.buyLabel !== BUY_LABELS.DISMISS);

  if (pool.length === 0) return;

  const avgLast3Final3f = (h: HorseAbility): number | null => {
    const runs = h.pastRuns ?? [];
    const vals: number[] = [];
    for (let i = 0; i < Math.min(3, runs.length); i += 1) {
      const sec = runs[i]?.final3fSec;
      if (sec != null && Number.isFinite(sec)) vals.push(sec);
    }
    if (vals.length === 0) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  };

  const sniperRaw = (h: HorseAbility): number => {
    const rs = h.runningStyle === "差し" || h.runningStyle === "追込" ? 8 : h.runningStyle === "好位" ? 3 : 0;
    const paceBoost = paceSeverity === "high" ? 18 : paceSeverity === "neutral" ? 6 : -4;
    const last = h.pastRuns?.[0];
    let up = 0;
    const rk = last?.final3fRank;
    if (rk != null && Number.isFinite(rk) && rk >= 1) {
      up = Math.max(0, 12 - rk) * 2.8;
    } else if (last?.final3fSec != null) {
      up = Math.max(0, 38 - last.final3fSec) * 0.85;
    }
    return (h.kick ?? 0) * 0.52 + rs + paceBoost + up;
  };

  const r1 = [...pool].sort((a, b) => {
    const ds = (b.stabilityScore ?? 0) - (a.stabilityScore ?? 0);
    if (ds !== 0) return ds;
    return a.horseId.localeCompare(b.horseId);
  })[0]!;
  r1.hokkakeRole = "△1安定";

  const rest1 = pool.filter((r) => r.horseId !== r1.horseId);
  if (rest1.length === 0) return;
  const maxTrait = Math.max(...rest1.map((r) => r.courseTraitBonus ?? Number.NEGATIVE_INFINITY));
  const maxPower = Math.max(
    ...rest1.map((r) => {
      const h = horseById.get(r.horseId);
      return h?.power ?? Number.NEGATIVE_INFINITY;
    }),
  );
  const physicalPure = rest1
    .filter((r) => {
      const h = horseById.get(r.horseId);
      if (!h) return false;
      return (r.courseTraitBonus ?? Number.NEGATIVE_INFINITY) === maxTrait || h.power === maxPower;
    })
    .sort((a, b) => {
      const as = (a.finalRank ?? 99) - (b.finalRank ?? 99);
      if (as !== 0) return -as; // 総合順位が低い馬を優先（ヒモ穴純度）
      const ta = (b.courseTraitBonus ?? 0) - (a.courseTraitBonus ?? 0);
      if (ta !== 0) return ta;
      return a.horseId.localeCompare(b.horseId);
    });
  const r2 =
    physicalPure[0] ??
    [...rest1].sort((a, b) => {
      const da = (b.courseTraitBonus ?? 0) - (a.courseTraitBonus ?? 0);
      if (da !== 0) return da;
      return a.horseId.localeCompare(b.horseId);
    })[0]!;
  r2.hokkakeRole = "△2物理";

  const rest2 = pool.filter((r) => r.horseId !== r1.horseId && r.horseId !== r2.horseId);
  if (rest2.length === 0) return;
  let r3 = rest2[0]!;
  if (paceSeverity === "high") {
    let bestAvg = Number.POSITIVE_INFINITY;
    let found = false;
    for (const r of rest2) {
      const h = horseById.get(r.horseId);
      if (!h) continue;
      const avg = avgLast3Final3f(h);
      if (avg == null) continue;
      if (avg < bestAvg) {
        bestAvg = avg;
        r3 = r;
        found = true;
      }
    }
    if (!found) {
      const hFirst = horseById.get(r3.horseId);
      let bestSnap = hFirst ? sniperRaw(hFirst) : Number.NEGATIVE_INFINITY;
      for (const r of rest2) {
        const h = horseById.get(r.horseId);
        const raw = h ? sniperRaw(h) : Number.NEGATIVE_INFINITY;
        if (raw > bestSnap) {
          bestSnap = raw;
          r3 = r;
        }
      }
    }
  } else {
    const hFirst = horseById.get(r3.horseId);
    let bestSnap = hFirst ? sniperRaw(hFirst) : Number.NEGATIVE_INFINITY;
    for (const r of rest2) {
      const h = horseById.get(r.horseId);
      const raw = h ? sniperRaw(h) : Number.NEGATIVE_INFINITY;
      if (raw > bestSnap) {
        bestSnap = raw;
        r3 = r;
      }
    }
  }
  r3.hokkakeRole = "△3狙い";
}

function hokkakeOrder(role: HorseScoreResult["hokkakeRole"]): number {
  if (role === "△1安定") return 0;
  if (role === "△2物理") return 1;
  if (role === "△3狙い") return 2;
  return 3;
}

/**
 * 3連系向けに △ を複数頭（既定4頭）確保する。
 * ◎○▲☆ は保持し、空印の中から △ を追加する。
 *
 * 6位以下は `assignBuyLabels` で buyLabel が DISMISS になるが、それは「本命買いの対象外」であり
 * 構造的な消し馬（collectDismissIds）とは限らない。ヒモの △ は後方馬にも付けるため、
 * 対象から buyLabel は見ず、`structuralDismissIds` のみ除外する。
 */
/**
 * 構造消しを除いた出走可能頭数から、△ を付けたい総数（◎〜☆に使った4頭以外で埋める上限込み）を決める。
 * 例: 頭数8 → △最大4、頭数7 → △最大3（◎○▲☆で4頭を埋めたうえでの余り）。
 */
export function computeTriangleTarget(eligibleNonStructuralCount: number): number {
  if (eligibleNonStructuralCount <= 0) return 0;
  return Math.min(4, Math.max(1, eligibleNonStructuralCount - 4));
}

/**
 * ◎○▲☆△ を未出走・構造消し以外で埋め、続けて △ を `computeTriangleTarget` まで増やす。
 * 構造消しループの後でも再度呼び、印欠けを防ぐ。
 */
export function assignCompleteMarks(
  results: HorseScoreResult[],
  structuralDismissIds: ReadonlySet<string>,
): void {
  const eligibleCount = results.filter((r) => !structuralDismissIds.has(r.horseId)).length;
  fillRequiredMarks(results);
  ensureTriangleMarks(results, computeTriangleTarget(eligibleCount), structuralDismissIds);
}

export function ensureTriangleMarks(
  results: HorseScoreResult[],
  targetTriangleCount: number = 4,
  structuralDismissIds: ReadonlySet<string> = new Set(),
): void {
  const eligible = results.filter((r) => !structuralDismissIds.has(r.horseId));
  if (eligible.length === 0) return;

  let current = eligible.filter((r) => r.mark === "△").length;
  if (current >= targetTriangleCount) return;

  const candidates = [...eligible]
    .filter((r) => r.mark === "")
    .sort((a, b) => {
      const ha = hokkakeOrder(a.hokkakeRole);
      const hb = hokkakeOrder(b.hokkakeRole);
      if (ha !== hb) return ha - hb;
      const ra = a.finalRank ?? a.adjustedRank ?? 99;
      const rb = b.finalRank ?? b.adjustedRank ?? 99;
      if (ra !== rb) return ra - rb;
      return b.finalEvaluationScore - a.finalEvaluationScore;
    });

  for (const c of candidates) {
    if (current >= targetTriangleCount) break;
    c.mark = "△";
    current += 1;
  }
}

