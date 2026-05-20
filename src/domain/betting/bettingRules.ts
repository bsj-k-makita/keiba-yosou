import type { HorseAbility, HorseScoreResult } from "../race-evaluation/abilityTypes";
import {
  AI_EFFECTIVE_EV_THRESHOLD,
  EV_MAX_TICKETS_PER_TYPE,
  EV_MAX_WIDE_TICKETS_PER_TYPE,
  PYTHON_EV_MARGIN,
  REN_EV_THRESHOLD,
  WIDE_EV_THRESHOLD,
} from "../race-evaluation/investmentEvConstants";
import { getEffectiveEvaluationSignals } from "../race-evaluation/resolveEvaluationSignals";
import type { ProbabilityEngine } from "../../lib/pipeline/probabilityEngine";
import {
  type ClassTier,
  CLASS_TIER_RANK,
  isGradedOpenTier,
} from "../race-evaluation/resolveEffectiveRaceClass";
import type { RaceOfficialPayouts } from "../../lib/race-data/raceEvaluationTypes";
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
  /** 印付き馬（◎○▲☆△）を gate ベースで保持 */
  markedHorses?: {
    gate: number;
    mark: string;
    finalRank: number;
  }[];
  /** evaluatedHorses と同じ順序の Softmax 勝率 */
  winProbabilities: number[];
  /** 方針Bの◎（results.mark === "◎"）の枠番。複合馬券は◎軸に限定 */
  topMarkGate?: number;
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
export const WIDE_PARTNER_MIN_WIN_ODDS = 4.5;
export const TRI_EV_THRESHOLD = 1.5;
export const EV_MAX_TRI_TICKETS_PER_TYPE = 5;

/** @deprecated REN_EV_THRESHOLD を使用 */
export const PAIR_EV_THRESHOLD = REN_EV_THRESHOLD;
export {
  EV_MAX_TICKETS_PER_TYPE,
  EV_MAX_WIDE_TICKETS_PER_TYPE,
  REN_EV_THRESHOLD,
  WIDE_EV_THRESHOLD
} from "../race-evaluation/investmentEvConstants";

/** 理論確率→オッズ変換時の市場乖離係数（EV見送り判定用・単勝オッズ積より安定） */
const ESTIMATED_EXOTIC_MARKET_FACTOR_REN = 1.85;
const ESTIMATED_EXOTIC_MARKET_FACTOR_WIDE = 1.65;
const ESTIMATED_EXOTIC_MARKET_FACTOR_TRI = 2.0;

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

const EV_MAX_TICKETS_BY_TYPE: Record<EvTicketType, number> = {
  WIN: EV_MAX_TICKETS_PER_TYPE,
  REN: EV_MAX_TICKETS_PER_TYPE,
  WREN: EV_MAX_WIDE_TICKETS_PER_TYPE,
  TRI: EV_MAX_TRI_TICKETS_PER_TYPE,
};

function capEvTicketsByType(tickets: readonly EvTicket[]): EvTicket[] {
  const types: EvTicketType[] = ["WIN", "REN", "WREN", "TRI"];
  const out: EvTicket[] = [];
  for (const type of types) {
    const max = EV_MAX_TICKETS_BY_TYPE[type];
    const slice = tickets
      .filter((t) => t.type === type)
      .sort((a, b) => b.expectedValue - a.expectedValue)
      .slice(0, max);
    out.push(...slice);
  }
  return out;
}

function pairIncludesTopMark(gates: readonly number[], topMarkGate: number | undefined): boolean {
  return topMarkGate != null && gates.includes(topMarkGate);
}

function createFixedAiFormationTickets(context: RaceEvaluationContext): EvTicket[] {
  const topMarkGate = context.topMarkGate;
  if (topMarkGate == null) return [];

  const marked = (context.markedHorses ?? [])
    .filter((h) => h.gate !== topMarkGate)
    .sort((a, b) => a.finalRank - b.finalRank);
  const uniqueByGate = new Map<number, { gate: number; mark: string; finalRank: number }>();
  for (const h of marked) {
    if (!uniqueByGate.has(h.gate)) uniqueByGate.set(h.gate, h);
  }
  let markedUnique = [...uniqueByGate.values()];
  if (markedUnique.length === 0) {
    const fallbackMarks = ["○", "▲", "☆", "△", "△", "△"];
    markedUnique = context.evaluatedHorses
      .filter((h) => h.gate !== topMarkGate)
      .sort((a, b) => a.finalRank - b.finalRank)
      .slice(0, 6)
      .map((h, idx) => ({
        gate: h.gate,
        mark: fallbackMarks[idx] ?? "△",
        finalRank: h.finalRank,
      }));
  }

  const pickByMark = (mark: string): number[] =>
    markedUnique.filter((h) => h.mark === mark).map((h) => h.gate);
  const markMaru = pickByMark("○");
  const markSankaku = pickByMark("▲");
  const markHoshi = pickByMark("☆");
  const markDelta = pickByMark("△");

  const renPartners = [...markMaru, ...markSankaku, ...markHoshi].slice(0, 3);
  const widePartners = [...renPartners, ...markDelta].slice(0, 6);
  const triPartners = widePartners.slice(0, 6);

  const tickets: EvTicket[] = [
    {
      type: "WIN",
      gates: [topMarkGate],
      estimatedProbability: 0,
      expectedValue: 1,
    },
  ];

  for (const gate of renPartners) {
    const [g1, g2] = sortPair(topMarkGate, gate);
    tickets.push({
      type: "REN",
      gates: [g1, g2],
      estimatedProbability: 0,
      expectedValue: 1,
    });
  }

  for (const gate of widePartners) {
    const [g1, g2] = sortPair(topMarkGate, gate);
    tickets.push({
      type: "WREN",
      gates: [g1, g2],
      estimatedProbability: 0,
      expectedValue: 1,
    });
  }

  for (let i = 0; i < triPartners.length; i++) {
    for (let j = i + 1; j < triPartners.length; j++) {
      const [g1, g2, g3] = sortTriplet(topMarkGate, triPartners[i]!, triPartners[j]!);
      tickets.push({
        type: "TRI",
        gates: [g1, g2, g3],
        estimatedProbability: 0,
        expectedValue: 1,
      });
    }
  }

  return tickets;
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
  if (engine === "ai") {
    return createFixedAiFormationTickets(context);
  }
  const effectiveEvByGate = evOptions?.effectiveEvByGate;
  const winThreshold =
    engine === "ai"
      ? (evOptions?.thresholdEV ?? AI_EFFECTIVE_EV_THRESHOLD)
      : (evOptions?.thresholdEV ?? thresholdEV);
  const renThreshold = REN_EV_THRESHOLD;
  const wideThreshold = WIDE_EV_THRESHOLD;
  const margin = engine === "ai" ? PYTHON_EV_MARGIN : 0;
  const triThreshold = TRI_EV_THRESHOLD;
  const topMarkGate = context.topMarkGate;

  const validHorses = alignHorsesWithProbabilities(context);
  const tickets: EvTicket[] = [];

  for (const horse of validHorses) {
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

    const winOdds = positiveOdds(oddsMap.win[horse.gate]);
    if (winOdds == null) continue;

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

  if (topMarkGate != null) {
    for (let i = 0; i < validHorses.length; i++) {
      for (let j = i + 1; j < validHorses.length; j++) {
        const hA = validHorses[i]!;
        const hB = validHorses[j]!;
        if (!pairIncludesTopMark([hA.gate, hB.gate], topMarkGate)) continue;

        const key = pairKey(hA.gate, hB.gate);
        const estPairProb = estimatePairProbability(hA.prob, hB.prob);

        const renOdds = positiveOdds(oddsMap.ren?.[key]);
        if (renOdds != null) {
          const renEv = estPairProb * renOdds - margin;
          if (renEv >= renThreshold) {
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
          const partnerGate = hA.gate === topMarkGate ? hB.gate : hA.gate;
          const partnerWinOdds = positiveOdds(oddsMap.win[partnerGate]);
          if (partnerWinOdds == null || partnerWinOdds < WIDE_PARTNER_MIN_WIN_ODDS) {
            continue;
          }
          const wideEv = estPairProb * wideOdds - margin;
          if (wideEv >= wideThreshold) {
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

    for (let i = 0; i < validHorses.length; i++) {
      for (let j = i + 1; j < validHorses.length; j++) {
        for (let k = j + 1; k < validHorses.length; k++) {
          const hA = validHorses[i]!;
          const hB = validHorses[j]!;
          const hC = validHorses[k]!;
          if (!pairIncludesTopMark([hA.gate, hB.gate, hC.gate], topMarkGate)) continue;

          const key = triKey(hA.gate, hB.gate, hC.gate);
          const triOdds = positiveOdds(oddsMap.trifecta?.[key]);
          if (triOdds == null) continue;

          const estTriProb = estimateTrifectaProbability(hA.prob, hB.prob, hC.prob);
          const ev = estTriProb * triOdds - margin;
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

  return capEvTicketsByType(tickets);
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
  /** 単勝オッズ（ハイブリッド2列目補給の大穴判定に使用） */
  winOdds?: number;
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

export type FormationBetOptions = {
  /** ◎の単勝オッズ。1.5倍以下なら3連複フォーメを生成しない */
  favoriteWinOdds?: number;
  probabilityEngine?: ProbabilityEngine;
};

/** 軸◎がこの倍率以下のとき3連複フォーメを見送る（圧倒的1番人気のみ・ガミり対策） */
export const LOW_FAVORITE_TRIFECTA_SKIP_ODDS = 1.5;

/** results の ◎（方針B topMark）を枠番に解決 */
export function resolveTopMarkGate(
  results: readonly HorseScoreResult[],
  horseNumberById: ReadonlyMap<string, number>,
): number | undefined {
  const top = results.find((r) => r.mark === "◎");
  if (top == null) return undefined;
  return horseNumberById.get(top.horseId);
}

export function buildRaceEvaluationContext(input: GenerateTicketsInput): RaceEvaluationContext {
  const sorted = [...input.results].sort((a, b) => {
    const ra = a.finalRank ?? 99;
    const rb = b.finalRank ?? 99;
    if (ra !== rb) return ra - rb;
    return b.finalEvaluationScore - a.finalEvaluationScore;
  });

  const evaluatedHorses: HorseEvaluation[] = [];
  const winProbabilities: number[] = [];
  const markedHorses: { gate: number; mark: string; finalRank: number }[] = [];

  for (const r of sorted) {
    const gate = input.horseNumberById.get(r.horseId);
    if (gate == null) continue;
    evaluatedHorses.push({
      gate,
      finalRank: r.finalRank ?? 99,
      finalEvaluationScore: r.finalEvaluationScore,
    });
    winProbabilities.push(input.winProbabilities.get(r.horseId) ?? 0);
    if (r.mark != null && r.mark !== "") {
      markedHorses.push({ gate, mark: r.mark, finalRank: r.finalRank ?? 99 });
    }
  }

  return {
    isSkippableRace: input.isSkippableRace ?? false,
    classTier: input.classTier ?? "CONDITIONAL_LOWER",
    evaluatedHorses,
    markedHorses,
    winProbabilities,
    topMarkGate: resolveTopMarkGate(input.results, input.horseNumberById),
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

function fairOddsFromProbability(prob: number, marketFactor: number): number | undefined {
  if (prob <= 1e-9 || !Number.isFinite(prob)) return undefined;
  return (1 / prob) * marketFactor;
}

function appendEstimatedExoticOdds(
  win: Record<number, number>,
  probByGate?: ReadonlyMap<number, number>,
): Pick<OddsMap, "ren" | "wide" | "trifecta"> {
  const gates = Object.keys(win)
    .map(Number)
    .filter((g) => Number.isFinite(g));
  const ren: Record<string, number> = {};
  const wide: Record<string, number> = {};
  const trifecta: Record<string, number> = {};

  const prob = (gate: number): number => {
    const p = probByGate?.get(gate);
    if (p != null && p >= VALID_PROB_THRESHOLD) return p;
    const o = win[gate];
    if (o == null || o <= 0) return 0;
    return 1 / o;
  };

  for (let i = 0; i < gates.length; i++) {
    for (let j = i + 1; j < gates.length; j++) {
      const a = gates[i]!;
      const b = gates[j]!;
      const pa = prob(a);
      const pb = prob(b);
      if (pa < VALID_PROB_THRESHOLD || pb < VALID_PROB_THRESHOLD) continue;
      const key = pairKey(a, b);
      const pPair = estimatePairProbability(pa, pb);
      const renOdds = fairOddsFromProbability(pPair, ESTIMATED_EXOTIC_MARKET_FACTOR_REN);
      const wideOdds = fairOddsFromProbability(pPair, ESTIMATED_EXOTIC_MARKET_FACTOR_WIDE);
      if (renOdds != null) ren[key] = renOdds;
      if (wideOdds != null) wide[key] = wideOdds;
    }
  }

  for (let i = 0; i < gates.length; i++) {
    for (let j = i + 1; j < gates.length; j++) {
      for (let k = j + 1; k < gates.length; k++) {
        const a = gates[i]!;
        const b = gates[j]!;
        const c = gates[k]!;
        const pa = prob(a);
        const pb = prob(b);
        const pc = prob(c);
        if (
          pa < VALID_PROB_THRESHOLD ||
          pb < VALID_PROB_THRESHOLD ||
          pc < VALID_PROB_THRESHOLD
        ) {
          continue;
        }
        const pTri = estimateTrifectaProbability(pa, pb, pc);
        const triOdds = fairOddsFromProbability(pTri, ESTIMATED_EXOTIC_MARKET_FACTOR_TRI);
        if (triOdds != null) trifecta[triKey(a, b, c)] = triOdds;
      }
    }
  }

  return { ren, wide, trifecta };
}

/**
 * EV推奨券生成用オッズマップ。
 * 単勝は実オッズ。馬連・ワイド・3連複は既存マップがなければ単勝から近似（バックテスト見送り判定用）。
 */
function officialPayoutsToOddsMultipliers(
  payouts: RaceOfficialPayouts | undefined,
): Pick<OddsMap, "ren" | "wide" | "trifecta"> {
  const rowsToMap = (rows: readonly { numbers: number[]; dividend: number }[] | undefined) => {
    const out: Record<string, number> = {};
    for (const row of rows ?? []) {
      if (row.dividend <= 0) continue;
      const key =
        row.numbers.length >= 3
          ? triKey(row.numbers[0]!, row.numbers[1]!, row.numbers[2]!)
          : pairKey(row.numbers[0]!, row.numbers[1]!);
      out[key] = row.dividend / 100;
    }
    return out;
  };
  return {
    ren: rowsToMap(payouts?.REN),
    wide: rowsToMap(payouts?.WREN),
    trifecta: rowsToMap(payouts?.TRI),
  };
}

/** 払戻計算フォールバック用（推定オッズ＋確定配当をマージ） */
export function buildPayoutFallbackOddsMap(
  horses: readonly HorseAbility[],
  payouts: RaceOfficialPayouts | undefined,
  probByGate?: ReadonlyMap<number, number>,
): Pick<OddsMap, "ren" | "wide" | "trifecta"> {
  const estimated = buildOddsMapForEvEvaluation(horses, undefined, probByGate);
  const official = officialPayoutsToOddsMultipliers(payouts);
  return {
    ren: { ...estimated.ren, ...official.ren },
    wide: { ...estimated.wide, ...official.wide },
    trifecta: { ...estimated.trifecta, ...official.trifecta },
  };
}

export function buildOddsMapForEvEvaluation(
  horses: readonly HorseAbility[],
  base?: OddsMap,
  probByGate?: ReadonlyMap<number, number>,
): OddsMap {
  const fromHorses = buildOddsMapFromHorses(horses);
  const win = { ...fromHorses.win, ...base?.win };
  const hasRen = base?.ren != null && Object.keys(base.ren).length > 0;
  const hasWide = base?.wide != null && Object.keys(base.wide).length > 0;
  const hasTri = base?.trifecta != null && Object.keys(base.trifecta).length > 0;

  if (hasRen && hasWide && hasTri) {
    return { win, ren: base!.ren, wide: base!.wide, trifecta: base!.trifecta };
  }

  const estimated = appendEstimatedExoticOdds(win, probByGate);
  return {
    win,
    ren: hasRen ? base!.ren : estimated.ren,
    wide: hasWide ? base!.wide : estimated.wide,
    trifecta: hasTri ? base!.trifecta : estimated.trifecta,
  };
}

/** EV推奨馬券の総点数（全券種合計） */
export function countEvRecommendationPoints(tickets: readonly BetTicket[]): number {
  return tickets.reduce((s, t) => s + t.combinations.length, 0);
}

/**
 * AIバックテスト: 全券種でEV推奨が0点のときのみ定型フォーメを物理スキップ。
 */
export function shouldSkipAiFormationBets(
  engine: ProbabilityEngine,
  evBetPointCount: number,
): boolean {
  return engine === "ai" && evBetPointCount === 0;
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
  formationOptions?: FormationBetOptions,
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

  const favoriteOdds = formationOptions?.favoriteWinOdds;
  const skipTrifectaForLowFavorite =
    favoriteOdds != null &&
    Number.isFinite(favoriteOdds) &&
    favoriteOdds > 0 &&
    favoriteOdds <= LOW_FAVORITE_TRIFECTA_SKIP_ODDS;

  if (!skipTrifectaForLowFavorite) {
    const triCombs = buildOptimizedTrifectaCombinations(marks, {
      classTier,
      probabilityEngine: formationOptions?.probabilityEngine,
    });
    if (triCombs.length > 0) {
      tickets.push({ ticketType: "TRIFECTA_FORM", combinations: triCombs, betAmount });
    }
  }

  return tickets;
}

/** ユーザー向け見送り理由（投資・回収集計には影響しない） */
export function resolveBettingAdvisoryReason(params: {
  isSkippableRace: boolean;
  hasMarks: boolean;
  evBetPointCount: number;
  noAiEvRegime?: boolean;
  probabilityEngine?: ProbabilityEngine;
}): string | undefined {
  if (!params.hasMarks) return "no_marks";
  if (params.probabilityEngine !== "ai" && params.isSkippableRace) return "contradictory_marks";
  if (params.noAiEvRegime) return "no_ai_ev_regime";
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

/** AIハイブリッド2列目補給: 単勝がこの倍率以上の大穴のみ（人気馬のガミり防止） */
export const HYBRID_SECOND_ROW_MIN_WIN_ODDS = 10.0;

export function qualifiesAsHybridLongshotOdds(winOdds: number | undefined): boolean {
  return winOdds != null && Number.isFinite(winOdds) && winOdds >= HYBRID_SECOND_ROW_MIN_WIN_ODDS;
}

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

function addTsHybridSecondRowCandidates(
  marks: readonly MarkedHorseRef[],
  set: Set<number>,
): void {
  const longshotStar = marks.find(
    (h) =>
      h.mark === "☆" &&
      h.longshotReversalTrigger === true &&
      qualifiesAsHybridLongshotOdds(h.winOdds),
  )?.horseNumber;
  if (longshotStar != null) set.add(longshotStar);

  const tsLongshot = marks.find(
    (h) => h.longshotReversalTrigger && qualifiesAsHybridLongshotOdds(h.winOdds),
  )?.horseNumber;
  if (tsLongshot != null) set.add(tsLongshot);

  const connectionHorse = marks
    .filter(
      (h) =>
        h.mark !== "◎" &&
        (h.connectionsBonus ?? 0) >= CONNECTIONS_SECOND_ROW_MIN &&
        qualifiesAsHybridLongshotOdds(h.winOdds),
    )
    .sort((a, b) => (b.connectionsBonus ?? 0) - (a.connectionsBonus ?? 0))[0];
  if (connectionHorse != null) set.add(connectionHorse.horseNumber);
}

export function buildSecondRowNumbers(
  marks: readonly MarkedHorseRef[],
  classTier: ClassTier = "CONDITIONAL_LOWER",
  probabilityEngine: ProbabilityEngine = "ts",
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
    if (probabilityEngine === "ai") addTsHybridSecondRowCandidates(marks, set);
    return [...set];
  }
  if (taiko != null) set.add(taiko);
  if (ana != null) set.add(ana);
  if (probabilityEngine === "ai") {
    addTsHybridSecondRowCandidates(marks, set);
    return [...set];
  }
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
  const secondRow = buildSecondRowNumbers(
    marks,
    options?.classTier as ClassTier | undefined,
    options?.probabilityEngine,
  );
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
  winOddsByNumber?: ReadonlyMap<number, number>,
): MarkedHorseRef[] {
  const out: MarkedHorseRef[] = [];
  for (const r of results) {
    const mark = r.mark ?? "";
    if (!mark) continue;
    const horseNumber = horseNumberById.get(r.horseId);
    if (horseNumber == null || !Number.isFinite(horseNumber)) continue;
    const winOdds = positiveOdds(winOddsByNumber?.get(horseNumber));
    out.push({
      horseNumber,
      mark,
      hokkakeRole: r.hokkakeRole,
      longshotReversalTrigger: r.longshotReversalTrigger,
      finalRank: r.finalRank,
      connectionsBonus: r.connectionsBonus,
      winOdds,
    });
  }
  return out;
}
