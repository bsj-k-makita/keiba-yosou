import type { HorseAbility, HorseScoreResult } from "../race-evaluation/abilityTypes";
import {
  AI_EFFECTIVE_EV_THRESHOLD,
  PYTHON_EV_MARGIN,
} from "../race-evaluation/investmentEvConstants";
import { getEffectiveEvaluationSignals } from "../race-evaluation/resolveEvaluationSignals";
import type { ProbabilityEngine } from "../../lib/pipeline/probabilityEngine";
import {
  type ClassTier,
  CLASS_TIER_RANK,
  isGradedOpenTier,
} from "../race-evaluation/resolveEffectiveRaceClass";
import type { BetTicket } from "./types";

// ---------------------------------------------------------------------------
// コア EV 判定 API（テスト・裁定取引ロジックの単一ソース）
// ---------------------------------------------------------------------------

export type HorseEvaluation = {
  gate: number;
  finalRank: number;
  finalEvaluationScore: number;
};

export type RaceEvaluationContext = {
  isSkippableRace: boolean;
  classTier: string;
  /** finalRank 昇順（1位が先頭） */
  evaluatedHorses: HorseEvaluation[];
  /** evaluatedHorses と同じ順序の Softmax 勝率 */
  winProbabilities: number[];
};

/** 直前オッズのみ。欠損券種は購入しない（確定配当は使用禁止） */
export type OddsMap = {
  win: Record<number, number>;
  ren?: Record<string, number>;
  wide?: Record<string, number>;
  trifecta?: Record<string, number>;
};

export type EvTicketType = "WIN" | "REN" | "WREN" | "TRI";

export type EvTicket = {
  type: EvTicketType;
  gates: number[];
  estimatedProbability: number;
  expectedValue: number;
};

/** 勝率1%未満の馬は全券種から除外（ロングテール・ノイズ防止） */
export const VALID_PROB_THRESHOLD = 0.01;

const DEFAULT_EV_THRESHOLD = 1.3;
const DEFAULT_TRI_EV_THRESHOLD = 1.5;

export type GenerateTicketsEvOptions = {
  /** TS: prob×odds。AI: ai_effective_ev（単勝） */
  probabilityEngine?: ProbabilityEngine;
  /** gate → ai_effective_ev（AI モード単勝用） */
  effectiveEvByGate?: ReadonlyMap<number, number>;
  thresholdEV?: number;
};

type ValidHorse = HorseEvaluation & { prob: number };

function sortPair(a: number, b: number): [number, number] {
  return a < b ? [a, b] : [b, a];
}

function sortTriplet(a: number, b: number, c: number): [number, number, number] {
  return [a, b, c].sort((x, y) => x - y) as [number, number, number];
}

function pairKey(a: number, b: number): string {
  const [x, y] = sortPair(a, b);
  return `${x}-${y}`;
}

function triKey(a: number, b: number, c: number): string {
  return sortTriplet(a, b, c).join("-");
}

function positiveOdds(value: number | undefined): number | undefined {
  if (value == null || !Number.isFinite(value) || value <= 0) return undefined;
  return value;
}

/**
 * ハルヴィル・シュミット型による2頭ペア的中確率近似（馬連・ワイド共通）
 */
export function estimatePairProbability(probA: number, probB: number): number {
  if (probA >= 1 || probB >= 1) return 0;
  if (probA >= 1 - 1e-9 || probB >= 1 - 1e-9) return 0;
  return probA * probB / (1 - probA) + probB * probA / (1 - probB);
}

/** @deprecated estimatePairProbability を使用 */
export const estimateWideProbability = estimatePairProbability;

/** @deprecated estimatePairProbability を使用 */
export const estimateQuinellaProbability = estimatePairProbability;

/** 3連複的中確率の近似 */
export function estimateTrifectaProbability(probA: number, probB: number, probC: number): number {
  const d1 = (1 - probA) * (1 - probA - probB);
  const d2 = (1 - probB) * (1 - probB - probA);
  if (d1 <= 1e-9 || d2 <= 1e-9) {
    return probA * probB * probC * 6;
  }
  return (
    probA *
    probB *
    probC *
    (1 / d1 + 1 / d2)
  );
}

function alignHorsesWithProbabilities(context: RaceEvaluationContext): ValidHorse[] {
  const { evaluatedHorses, winProbabilities } = context;
  if (evaluatedHorses.length !== winProbabilities.length) {
    throw new Error(
      `evaluatedHorses.length (${evaluatedHorses.length}) must match winProbabilities.length (${winProbabilities.length})`,
    );
  }
  return evaluatedHorses
    .map((horse, idx) => ({
      ...horse,
      prob: winProbabilities[idx] ?? 0,
    }))
    .filter((h) => h.prob >= VALID_PROB_THRESHOLD);
}

/**
 * 全組み合わせ期待値（EV）判定。実オッズのみ使用し、欠損時は推定しない。
 */
export function generateTicketsFromEvaluation(
  context: RaceEvaluationContext,
  oddsMap: OddsMap,
  thresholdEV: number = DEFAULT_EV_THRESHOLD,
  evOptions?: GenerateTicketsEvOptions,
): EvTicket[] {
  if (context.isSkippableRace) return [];

  const engine = evOptions?.probabilityEngine ?? "ts";
  const effectiveEvByGate = evOptions?.effectiveEvByGate;
  const winThreshold =
    engine === "ai"
      ? (evOptions?.thresholdEV ?? AI_EFFECTIVE_EV_THRESHOLD)
      : (evOptions?.thresholdEV ?? thresholdEV);
  const exoticsThreshold = winThreshold;
  const margin = engine === "ai" ? PYTHON_EV_MARGIN : 0;

  const validHorses = alignHorsesWithProbabilities(context);
  const tickets: EvTicket[] = [];

  for (const horse of validHorses) {
    const winOdds = positiveOdds(oddsMap.win[horse.gate]);
    if (winOdds == null) continue;

    if (engine === "ai") {
      const effectiveEv = effectiveEvByGate?.get(horse.gate);
      if (effectiveEv == null || !Number.isFinite(effectiveEv)) continue;
      if (effectiveEv >= winThreshold) {
        tickets.push({
          type: "WIN",
          gates: [horse.gate],
          estimatedProbability: horse.prob,
          expectedValue: effectiveEv,
        });
      }
      continue;
    }

    const ev = horse.prob * winOdds;
    if (ev >= winThreshold) {
      tickets.push({
        type: "WIN",
        gates: [horse.gate],
        estimatedProbability: horse.prob,
        expectedValue: ev,
      });
    }
  }

  for (let i = 0; i < validHorses.length; i++) {
    for (let j = i + 1; j < validHorses.length; j++) {
      const hA = validHorses[i]!;
      const hB = validHorses[j]!;
      const key = pairKey(hA.gate, hB.gate);
      const estPairProb = estimatePairProbability(hA.prob, hB.prob);

      const renOdds = positiveOdds(oddsMap.ren?.[key]);
      if (renOdds != null) {
        const renEv = estPairProb * renOdds - margin;
        if (renEv >= exoticsThreshold) {
          const [g1, g2] = sortPair(hA.gate, hB.gate);
          tickets.push({
            type: "REN",
            gates: [g1, g2],
            estimatedProbability: estPairProb,
            expectedValue: renEv,
          });
        }
      }

      const wideOdds = positiveOdds(oddsMap.wide?.[key]);
      if (wideOdds != null) {
        const wideEv = estPairProb * wideOdds - margin;
        if (wideEv >= exoticsThreshold) {
          const [g1, g2] = sortPair(hA.gate, hB.gate);
          tickets.push({
            type: "WREN",
            gates: [g1, g2],
            estimatedProbability: estPairProb,
            expectedValue: wideEv,
          });
        }
      }
    }
  }

  if (context.classTier !== "MAIDEN_NEW") {
    for (let i = 0; i < validHorses.length; i++) {
      for (let j = i + 1; j < validHorses.length; j++) {
        for (let k = j + 1; k < validHorses.length; k++) {
          const hA = validHorses[i]!;
          const hB = validHorses[j]!;
          const hC = validHorses[k]!;
          const key = triKey(hA.gate, hB.gate, hC.gate);
          const triOdds = positiveOdds(oddsMap.trifecta?.[key]);
          if (triOdds == null) continue;

          const estTriProb = estimateTrifectaProbability(hA.prob, hB.prob, hC.prob);
          const ev = estTriProb * triOdds - margin;
          const triThreshold =
            engine === "ai"
              ? Math.max(exoticsThreshold, DEFAULT_TRI_EV_THRESHOLD - margin)
              : DEFAULT_TRI_EV_THRESHOLD;
          if (ev >= triThreshold) {
            const [g1, g2, g3] = sortTriplet(hA.gate, hB.gate, hC.gate);
            tickets.push({
              type: "TRI",
              gates: [g1, g2, g3],
              estimatedProbability: estTriProb,
              expectedValue: ev,
            });
          }
        }
      }
    }
  }

  return tickets;
}

/** EvTicket を既存の BetTicket 形式に変換（UI・バックテスト・払戻計算用） */
export function evTicketsToBetTickets(evTickets: readonly EvTicket[], betAmount = 100): BetTicket[] {
  const byType: Record<EvTicketType, number[][]> = {
    WIN: [],
    REN: [],
    WREN: [],
    TRI: [],
  };

  for (const t of evTickets) {
    byType[t.type].push([...t.gates]);
  }

  const out: BetTicket[] = [];
  if (byType.WIN.length > 0) {
    out.push({ ticketType: "WIN", combinations: byType.WIN, betAmount });
  }
  if (byType.REN.length > 0) {
    out.push({ ticketType: "MAIN_LINE", combinations: byType.REN, betAmount });
  }
  if (byType.WREN.length > 0) {
    out.push({ ticketType: "WIDE", combinations: byType.WREN, betAmount });
  }
  if (byType.TRI.length > 0) {
    out.push({ ticketType: "TRIFECTA_FORM", combinations: byType.TRI, betAmount });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 既存パイプライン連携（HorseScoreResult → RaceEvaluationContext）
// ---------------------------------------------------------------------------

export type MarkedHorseRef = {
  horseNumber: number;
  mark: string;
  hokkakeRole?: HorseScoreResult["hokkakeRole"];
  longshotReversalTrigger?: boolean;
  finalRank?: number;
  connectionsBonus?: number;
};

export type GenerateTicketsInput = {
  results: readonly HorseScoreResult[];
  winProbabilities: ReadonlyMap<string, number>;
  horseNumberById: ReadonlyMap<string, number>;
  oddsMap: OddsMap;
  isSkippableRace?: boolean;
  classTier?: ClassTier;
};

export type GenerateTicketsOptions = {
  classTier?: ClassTier;
  thresholdEV?: number;
  probabilityEngine?: ProbabilityEngine;
  effectiveEvByGate?: ReadonlyMap<number, number>;
};

export function buildRaceEvaluationContext(input: GenerateTicketsInput): RaceEvaluationContext {
  const sorted = [...input.results].sort((a, b) => {
    const ra = a.finalRank ?? 99;
    const rb = b.finalRank ?? 99;
    if (ra !== rb) return ra - rb;
    return b.finalEvaluationScore - a.finalEvaluationScore;
  });

  const evaluatedHorses: HorseEvaluation[] = [];
  const winProbabilities: number[] = [];

  for (const r of sorted) {
    const gate = input.horseNumberById.get(r.horseId);
    if (gate == null) continue;
    evaluatedHorses.push({
      gate,
      finalRank: r.finalRank ?? 99,
      finalEvaluationScore: r.finalEvaluationScore,
    });
    winProbabilities.push(input.winProbabilities.get(r.horseId) ?? 0);
  }

  return {
    isSkippableRace: input.isSkippableRace ?? false,
    classTier: input.classTier ?? "CONDITIONAL_LOWER",
    evaluatedHorses,
    winProbabilities,
  };
}

/** 単勝オッズのみ取り込み。馬連・ワイド・3連複は直前オッズパイプ結合後に流入 */
export function buildOddsMapFromHorses(horses: readonly HorseAbility[]): OddsMap {
  const win: Record<number, number> = {};
  for (const h of horses) {
    const gate = (h as HorseAbility & { gate?: number }).gate;
    if (gate == null || !Number.isFinite(gate)) continue;
    const num = Math.round(gate);
    const winOdds = positiveOdds(getEffectiveEvaluationSignals(h)?.winOdds);
    if (winOdds != null) win[num] = winOdds;
  }
  return { win };
}

export function generateBetTicketsFromEvaluation(
  input: GenerateTicketsInput,
  betAmount = 100,
  options?: GenerateTicketsOptions,
): BetTicket[] {
  const context = buildRaceEvaluationContext(input);
  const threshold = options?.thresholdEV ?? DEFAULT_EV_THRESHOLD;
  const evTickets = generateTicketsFromEvaluation(context, input.oddsMap, threshold, {
    probabilityEngine: options?.probabilityEngine,
    effectiveEvByGate: options?.effectiveEvByGate,
    thresholdEV: options?.thresholdEV,
  });
  return evTicketsToBetTickets(evTickets, betAmount);
}

/**
 * 印フォーメーション定型買い目（◎単勝・◎○馬連・ワイド・3連複1-M-N）。
 * バックテスト・回収率集計は常にこちらを使用。見送り判定とは独立。
 */
export function generateFormationBetTickets(
  marks: readonly MarkedHorseRef[],
  classTier: ClassTier = "CONDITIONAL_LOWER",
  betAmount = 100,
): BetTicket[] {
  const omaru = resolvePostProcessFavoriteNumber(marks);
  if (omaru == null) return [];

  const tickets: BetTicket[] = [
    { ticketType: "WIN", combinations: [[omaru]], betAmount },
  ];

  const maru = marks.find((m) => m.mark === "○")?.horseNumber;
  if (maru != null) {
    const [g1, g2] = sortPair(omaru, maru);
    tickets.push({ ticketType: "MAIN_LINE", combinations: [[g1, g2]], betAmount });
  }

  const wideCombs = buildWideCombinations(marks, omaru);
  if (wideCombs.length > 0) {
    tickets.push({ ticketType: "WIDE", combinations: wideCombs, betAmount });
  }

  const triCombs = buildOptimizedTrifectaCombinations(marks, { classTier });
  if (triCombs.length > 0) {
    tickets.push({ ticketType: "TRIFECTA_FORM", combinations: triCombs, betAmount });
  }

  return tickets;
}

/** ユーザー向け見送り理由（投資・回収集計には影響しない） */
export function resolveBettingAdvisoryReason(params: {
  isSkippableRace: boolean;
  hasMarks: boolean;
  evBetPointCount: number;
}): string | undefined {
  if (!params.hasMarks) return "no_marks";
  if (params.isSkippableRace) return "contradictory_marks";
  if (params.evBetPointCount === 0) return "no_ev_recommendation";
  return undefined;
}

/** @deprecated generateBetTicketsFromEvaluation を使用 */
export function generateTickets(
  marks: readonly MarkedHorseRef[],
  betAmount = 100,
  _options?: GenerateTicketsOptions,
): BetTicket[] {
  const omaru = resolvePostProcessFavoriteNumber(marks);
  if (omaru == null) return [];
  return [{ ticketType: "WIN", combinations: [[omaru]], betAmount }];
}

// ---------------------------------------------------------------------------
// 表示・診断用ヘルパー（印ベース UI）
// ---------------------------------------------------------------------------

const HIMOE_ROLES = new Set<HorseScoreResult["hokkakeRole"]>([
  "△1安定",
  "△2物理",
  "△3狙い",
]);

const CONNECTIONS_SECOND_ROW_MIN = 2.5;

export function resolvePostProcessFavoriteNumber(
  marks: readonly MarkedHorseRef[],
): number | undefined {
  return marks.find((h) => h.mark === "◎")?.horseNumber;
}

export function buildThirdRowNumbers(
  marks: readonly MarkedHorseRef[],
  longshotStar?: number,
): number[] {
  const nums = new Set<number>();
  for (const h of marks) {
    if (h.mark === "○" || h.mark === "▲") {
      nums.add(h.horseNumber);
      continue;
    }
    if (h.mark === "☆") {
      if (longshotStar != null && h.horseNumber === longshotStar) continue;
      nums.add(h.horseNumber);
      continue;
    }
    if (h.mark !== "△") continue;
    if (h.hokkakeRole != null && HIMOE_ROLES.has(h.hokkakeRole)) {
      nums.add(h.horseNumber);
      continue;
    }
    if ((h.finalRank ?? 99) <= 5) nums.add(h.horseNumber);
  }
  return [...nums];
}

export function buildSecondRowNumbers(
  marks: readonly MarkedHorseRef[],
  classTier: ClassTier = "CONDITIONAL_LOWER",
): number[] {
  const taiko = marks.find((h) => h.mark === "○")?.horseNumber;
  const ana = marks.find((h) => h.mark === "▲")?.horseNumber;
  const stabilityTop = marks.find((h) => h.hokkakeRole === "△1安定")?.horseNumber;
  const longshotStar = marks.find(
    (h) => h.mark === "☆" && h.longshotReversalTrigger === true,
  )?.horseNumber;

  const set = new Set<number>();
  if (classTier === "MAIDEN_NEW") {
    if (taiko != null) set.add(taiko);
    if (ana != null) set.add(ana);
    return [...set];
  }
  if (taiko != null) set.add(taiko);
  if (ana != null) set.add(ana);
  if (isGradedOpenTier(classTier)) {
    if (stabilityTop != null) set.add(stabilityTop);
    if (longshotStar != null) set.add(longshotStar);
    const backup = marks
      .filter((h) => h.mark !== "◎" && (h.connectionsBonus ?? 0) >= CONNECTIONS_SECOND_ROW_MIN)
      .sort((a, b) => (b.connectionsBonus ?? 0) - (a.connectionsBonus ?? 0))[0];
    if (backup != null) set.add(backup.horseNumber);
  } else if (CLASS_TIER_RANK[classTier] <= CLASS_TIER_RANK.CONDITIONAL_UPPER) {
    if (stabilityTop != null) set.add(stabilityTop);
  }
  return [...set];
}

export function buildOptimizedTrifectaCombinations(
  marks: readonly MarkedHorseRef[],
  options?: GenerateTicketsOptions,
): number[][] {
  const omaru = resolvePostProcessFavoriteNumber(marks);
  if (omaru == null) return [];
  const thirdRow = buildThirdRowNumbers(marks);
  const secondRow = buildSecondRowNumbers(marks, options?.classTier as ClassTier | undefined);
  const uniq = new Map<string, number[]>();
  for (const second of secondRow) {
    if (second === omaru) continue;
    for (const third of thirdRow) {
      if (third === omaru || third === second) continue;
      const comb = sortTriplet(omaru, second, third);
      uniq.set(comb.join("-"), [...comb]);
    }
  }
  return [...uniq.values()];
}

const WIDE_PARTNER_MARKS = new Set(["○", "▲", "☆", "△"]);

export function buildWideCombinations(
  marks: readonly MarkedHorseRef[],
  omaru: number,
): number[][] {
  const uniq = new Map<string, number[]>();
  for (const h of marks) {
    if (h.horseNumber === omaru) continue;
    if (!WIDE_PARTNER_MARKS.has(h.mark)) continue;
    const [g1, g2] = sortPair(omaru, h.horseNumber);
    uniq.set(`${g1}-${g2}`, [g1, g2]);
  }
  return [...uniq.values()];
}

export function marksFromResults(
  results: readonly HorseScoreResult[],
  horseNumberById: Map<string, number>,
): MarkedHorseRef[] {
  const out: MarkedHorseRef[] = [];
  for (const r of results) {
    const mark = r.mark ?? "";
    if (!mark) continue;
    const horseNumber = horseNumberById.get(r.horseId);
    if (horseNumber == null || !Number.isFinite(horseNumber)) continue;
    out.push({
      horseNumber,
      mark,
      hokkakeRole: r.hokkakeRole,
      longshotReversalTrigger: r.longshotReversalTrigger,
      finalRank: r.finalRank,
      connectionsBonus: r.connectionsBonus,
    });
  }
  return out;
}
