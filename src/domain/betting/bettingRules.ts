import type { HorseAbility, HorseScoreResult } from "../race-evaluation/abilityTypes";
import {
  AI_TRI_NOISE_EXCLUSION_ODDS,
  AI_TRI_PREFERRED_ODDS_MAX,
  AI_TRI_PREFERRED_ODDS_MIN,
  AI_TRI_SECOND_COLUMN_SIZE,
  AI_TRI_THIRD_COLUMN_SIZE,
  AI_TRI_ULTRA_LONGSHOT_MAX_COUNT,
  AI_TRI_ULTRA_LONGSHOT_ODDS_CAP,
  ANCHOR_MIN_PREDICTED_WIN_RATE,
  EV_MAX_TICKETS_PER_TYPE,
  EV_MAX_TRI_TICKETS_PER_TYPE,
  EV_MAX_WIDE_TICKETS_PER_TYPE,
  REN_EV_THRESHOLD,
  TRI_EV_THRESHOLD,
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
  /** 方針Bの◎（results.mark === "◎"）の枠番。UI表示・診断用 */
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
  /** オッズ（小数、100円あたり倍率） */
  decimalOdds?: number;
};

/** 勝率1%未満の馬は全券種から除外（ロングテール・ノイズ防止） */
export const VALID_PROB_THRESHOLD = 0.01;

const DEFAULT_EV_THRESHOLD = 1.3;
export const KELLY_BASE_BUDGET_PER_RACE = 10_000;
export const KELLY_FRACTION_BY_TICKET_TYPE: Readonly<Record<EvTicketType, number>> = {
  WIN: 0.25,
  REN: 0.25,
  WREN: 0.25,
  TRI: 0.15,
};
export const KELLY_MIN_BET_AMOUNT = 100;
export const KELLY_MAX_BET_AMOUNT = 3_000;
export const KELLY_BET_UNIT = 100;
export const MAX_INVESTMENT_PER_RACE = 8_000;
export const MAX_INVESTMENT_PER_RACE_ENV_KEY = "BETTING_MAX_INVESTMENT_PER_RACE";

/** @deprecated REN_EV_THRESHOLD を使用 */
export const PAIR_EV_THRESHOLD = REN_EV_THRESHOLD;
export {
  EV_MAX_TICKETS_PER_TYPE,
  EV_MAX_TRI_TICKETS_PER_TYPE,
  EV_MAX_WIDE_TICKETS_PER_TYPE,
  REN_EV_THRESHOLD,
  TRI_EV_THRESHOLD,
  WIDE_EV_THRESHOLD,
} from "../race-evaluation/investmentEvConstants";

/** 理論確率→オッズ変換時の市場乖離係数（EV見送り判定用・単勝オッズ積より安定） */
const ESTIMATED_EXOTIC_MARKET_FACTOR_REN = 1.85;
const ESTIMATED_EXOTIC_MARKET_FACTOR_WIDE = 1.65;
const ESTIMATED_EXOTIC_MARKET_FACTOR_TRI = 2.0;

export type GenerateTicketsEvOptions = {
  probabilityEngine?: ProbabilityEngine;
  thresholdEV?: number;
  /** 馬連EV推奨閾値（未指定時は REN_EV_THRESHOLD） */
  renEvThreshold?: number;
};

type ValidHorse = HorseEvaluation & { prob: number };
export type RunningStyleGroup = "front" | "mid" | "back" | "other";
export type RunningStyleDiversifyPattern = "A" | "B" | "C";

const DEFAULT_RUNNING_STYLE_DIVERSIFY_PATTERN: RunningStyleDiversifyPattern = "B";

export function resolveRunningStyleDiversifyPattern(
  envValue: string | undefined =
    typeof process !== "undefined" ? process.env.BETTING_STYLE_DIVERSIFY_PATTERN : undefined,
): RunningStyleDiversifyPattern {
  if (envValue === "A" || envValue === "B" || envValue === "C") return envValue;
  return DEFAULT_RUNNING_STYLE_DIVERSIFY_PATTERN;
}

export function resolveMaxInvestmentPerRace(
  envValue: string | undefined =
    typeof process !== "undefined" ? process.env[MAX_INVESTMENT_PER_RACE_ENV_KEY] : undefined,
): number {
  if (envValue == null) return MAX_INVESTMENT_PER_RACE;
  const parsed = Number(envValue);
  if (!Number.isFinite(parsed) || parsed < KELLY_MIN_BET_AMOUNT) {
    return MAX_INVESTMENT_PER_RACE;
  }
  return normalizeToBetUnit(parsed, KELLY_MIN_BET_AMOUNT, Number.MAX_SAFE_INTEGER, KELLY_BET_UNIT);
}

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

/** 3連複的中確率（Harville: 全6通りの順列確率を合算） */
export function estimateTrifectaProbability(probA: number, probB: number, probC: number): number {
  const probs = [probA, probB, probC];
  const permutations: [number, number, number][] = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ];
  let sum = 0;
  for (const [i, j, k] of permutations) {
    const pFirst = probs[i]!;
    const pSecond = probs[j]!;
    const pThird = probs[k]!;
    const denomSecond = 1 - pFirst;
    const denomThird = 1 - pFirst - pSecond;
    if (denomSecond <= 1e-9 || denomThird <= 1e-9) continue;
    sum += pFirst * (pSecond / denomSecond) * (pThird / denomThird);
  }
  return sum;
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

function normalizeToBetUnit(
  amount: number,
  minAmount = KELLY_MIN_BET_AMOUNT,
  maxAmount = KELLY_MAX_BET_AMOUNT,
  unit = KELLY_BET_UNIT,
): number {
  if (!Number.isFinite(amount) || amount <= 0) return minAmount;
  const rounded = Math.round(amount / unit) * unit;
  return Math.max(minAmount, Math.min(maxAmount, rounded));
}

function computeKellyFraction(probability: number, decimalOdds: number): number {
  if (!Number.isFinite(probability) || probability <= 0 || probability >= 1) return 0;
  if (!Number.isFinite(decimalOdds) || decimalOdds <= 1) return 0;
  const b = decimalOdds - 1;
  const q = 1 - probability;
  const fullKelly = (probability * b - q) / b;
  return Math.max(0, fullKelly);
}

function resolveKellyBetAmount(ticket: EvTicket, fallbackAmount: number): number {
  const odds = ticket.decimalOdds;
  const p = ticket.estimatedProbability;
  if (odds == null || !Number.isFinite(odds) || odds <= 1 || !Number.isFinite(p) || p <= 0) {
    return normalizeToBetUnit(fallbackAmount);
  }
  const kellyFraction = computeKellyFraction(p, odds) * KELLY_FRACTION_BY_TICKET_TYPE[ticket.type];
  const rawAmount = KELLY_BASE_BUDGET_PER_RACE * kellyFraction;
  return normalizeToBetUnit(rawAmount);
}

function applyRaceInvestmentCap(amounts: readonly number[]): number[] {
  if (amounts.length === 0) return [];
  const maxInvestmentPerRace = resolveMaxInvestmentPerRace();
  const normalized = amounts.map((a) =>
    normalizeToBetUnit(a, KELLY_MIN_BET_AMOUNT, KELLY_MAX_BET_AMOUNT, KELLY_BET_UNIT),
  );
  const total = normalized.reduce((s, a) => s + a, 0);
  if (total <= maxInvestmentPerRace) return normalized;

  const minTotal = KELLY_MIN_BET_AMOUNT * normalized.length;
  if (maxInvestmentPerRace <= minTotal) {
    return normalized.map(() => KELLY_MIN_BET_AMOUNT);
  }

  const distributable = normalized.map((a) => a - KELLY_MIN_BET_AMOUNT);
  const distributableTotal = distributable.reduce((s, d) => s + d, 0);
  if (distributableTotal <= 0) return normalized;
  const targetDistributable = maxInvestmentPerRace - minTotal;
  const scale = targetDistributable / distributableTotal;

  const scaled = distributable.map((d) =>
    normalizeToBetUnit(
      KELLY_MIN_BET_AMOUNT + d * scale,
      KELLY_MIN_BET_AMOUNT,
      KELLY_MAX_BET_AMOUNT,
      KELLY_BET_UNIT,
    ),
  );

  let capped = [...scaled];
  let cappedTotal = capped.reduce((s, a) => s + a, 0);
  while (cappedTotal > maxInvestmentPerRace) {
    let idx = -1;
    let maxAmount = -1;
    for (let i = 0; i < capped.length; i += 1) {
      const amount = capped[i]!;
      if (amount > KELLY_MIN_BET_AMOUNT && amount > maxAmount) {
        maxAmount = amount;
        idx = i;
      }
    }
    if (idx < 0) break;
    capped[idx] = capped[idx]! - KELLY_BET_UNIT;
    cappedTotal -= KELLY_BET_UNIT;
  }

  return capped;
}

export function classifyRunningStyleForDiversification(
  runningStyle: string | undefined,
  pattern: RunningStyleDiversifyPattern = resolveRunningStyleDiversifyPattern(),
): RunningStyleGroup {
  const style = runningStyle ?? "";
  const isFront = style.includes("逃げ") || style.includes("先行");
  const isBack = style.includes("差し") || style.includes("追込") || style.includes("追い込");
  const isMidCandidate = style.includes("好位") || style.includes("自在");
  if (pattern === "A") {
    if (isFront || style.includes("好位")) return "front";
    if (isBack) return "back";
    return "mid";
  }
  if (pattern === "B") {
    if (isFront) return "front";
    if (isBack || style.includes("好位")) return "back";
    return "mid";
  }
  if (isFront) return "front";
  if (isBack) return "back";
  if (isMidCandidate || style.length > 0) return "mid";
  return "other";
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
 * 全組み合わせ期待値（EV）判定。
 * 勝率 >= VALID_PROB_THRESHOLD の全馬から組み合わせを生成し、Harville 合成確率 × オッズで EV を算出する。
 * 単勝は ◎（topMarkGate）のみ。複勝券オッズ欠損時は単勝・勝率から推定したオッズを使用する。
 */
export function generateTicketsFromEvaluation(
  context: RaceEvaluationContext,
  oddsMap: OddsMap,
  thresholdEV: number = DEFAULT_EV_THRESHOLD,
  evOptions?: GenerateTicketsEvOptions,
): EvTicket[] {
  if (context.isSkippableRace) return [];

  const winThreshold = evOptions?.thresholdEV ?? thresholdEV;
  const renThreshold = evOptions?.renEvThreshold ?? REN_EV_THRESHOLD;
  const wideThreshold = WIDE_EV_THRESHOLD;
  const triThreshold = TRI_EV_THRESHOLD;

  const validHorses = alignHorsesWithProbabilities(context);
  const probByGate = new Map(validHorses.map((h) => [h.gate, h.prob]));
  const enrichedOdds = buildOddsMapForEvEvaluation([], oddsMap, probByGate);
  const tickets: EvTicket[] = [];
  const topMarkGate = context.topMarkGate;

  if (topMarkGate != null) {
    const anchor = validHorses.find((h) => h.gate === topMarkGate);
    if (anchor != null) {
      const winOdds = positiveOdds(enrichedOdds.win[anchor.gate]);
      if (winOdds != null) {
        const ev = anchor.prob * winOdds;
        if (ev >= winThreshold) {
          tickets.push({
            type: "WIN",
            gates: [anchor.gate],
            estimatedProbability: anchor.prob,
            expectedValue: ev,
            decimalOdds: winOdds,
          });
        }
      }
    }
  }

  for (let i = 0; i < validHorses.length; i++) {
    for (let j = i + 1; j < validHorses.length; j++) {
      const hA = validHorses[i]!;
      const hB = validHorses[j]!;
      const [g1, g2] = sortPair(hA.gate, hB.gate);
      const key = pairKey(g1, g2);
      const estPairProb = estimatePairProbability(hA.prob, hB.prob);

      const renOdds = positiveOdds(enrichedOdds.ren?.[key]);
      if (renOdds != null) {
        const renEv = estPairProb * renOdds;
        if (renEv >= renThreshold) {
          tickets.push({
            type: "REN",
            gates: [g1, g2],
            estimatedProbability: estPairProb,
            expectedValue: renEv,
            decimalOdds: renOdds,
          });
        }
      }

      const wideOdds = positiveOdds(enrichedOdds.wide?.[key]);
      if (wideOdds != null) {
        const wideEv = estPairProb * wideOdds;
        if (wideEv >= wideThreshold) {
          tickets.push({
            type: "WREN",
            gates: [g1, g2],
            estimatedProbability: estPairProb,
            expectedValue: wideEv,
            decimalOdds: wideOdds,
          });
        }
      }
    }
  }

  const triTickets =
    evOptions?.probabilityEngine === "ai"
      ? generateAiTrifectaEvTickets(context, validHorses, enrichedOdds, triThreshold)
      : generateAllCombinationsTrifectaEvTickets(validHorses, enrichedOdds, triThreshold);
  tickets.push(...triTickets);

  return capEvTicketsByType(tickets);
}

const AI_TRI_SECOND_ROW_MARKS = new Set(["○", "▲", "☆"]);

function isAiTriNoiseExclusionProtected(
  gate: number,
  context: RaceEvaluationContext,
  secondRowGates: ReadonlySet<number>,
): boolean {
  if (context.topMarkGate === gate) return true;
  if (secondRowGates.has(gate)) return true;
  const mark = context.markedHorses?.find((m) => m.gate === gate)?.mark;
  return mark != null && AI_TRI_SECOND_ROW_MARKS.has(mark);
}

function markedRefsFromContext(
  context: RaceEvaluationContext,
  winOdds: Record<number, number>,
): MarkedHorseRef[] {
  return (context.markedHorses ?? []).map((m) => ({
    horseNumber: m.gate,
    mark: m.mark,
    finalRank: m.finalRank,
    winOdds: positiveOdds(winOdds[m.gate]),
  }));
}

function compareAiTriThirdColumnCandidate(
  a: { gate: number; prob: number; winOdds?: number },
  b: { gate: number; prob: number; winOdds?: number },
): number {
  const aPreferred =
    a.winOdds != null &&
    a.winOdds >= AI_TRI_PREFERRED_ODDS_MIN &&
    a.winOdds <= AI_TRI_PREFERRED_ODDS_MAX;
  const bPreferred =
    b.winOdds != null &&
    b.winOdds >= AI_TRI_PREFERRED_ODDS_MIN &&
    b.winOdds <= AI_TRI_PREFERRED_ODDS_MAX;
  if (aPreferred !== bPreferred) return aPreferred ? -1 : 1;
  const evA = a.prob * (a.winOdds ?? 0);
  const evB = b.prob * (b.winOdds ?? 0);
  return evB - evA;
}

/**
 * AI 3連複の3列目候補（上位8頭）。
 * 10〜80倍を優先し、100倍以上は最大2頭、150倍以上の無印は除外。
 */
export function buildAiTrifectaThirdColumnGates(
  context: RaceEvaluationContext,
  validHorses: readonly ValidHorse[],
  winOdds: Record<number, number>,
  classTier: ClassTier,
): number[] {
  const marks = markedRefsFromContext(context, winOdds);
  const secondRowGates = new Set(
    buildSecondRowNumbers(marks, classTier, "ai").slice(0, AI_TRI_SECOND_COLUMN_SIZE),
  );
  const markByGate = new Map(marks.map((m) => [m.horseNumber, m.mark]));

  const ranked = [...validHorses]
    .map((h) => ({
      gate: h.gate,
      prob: h.prob,
      winOdds: positiveOdds(winOdds[h.gate]),
      mark: markByGate.get(h.gate) ?? "",
    }))
    .filter((h) => {
      if (isAiTriNoiseExclusionProtected(h.gate, context, secondRowGates)) return true;
      if (
        h.winOdds != null &&
        h.winOdds >= AI_TRI_NOISE_EXCLUSION_ODDS &&
        h.mark === ""
      ) {
        return false;
      }
      return true;
    })
    .sort(compareAiTriThirdColumnCandidate);

  const selected: number[] = [];
  let ultraLongshotCount = 0;
  for (const h of ranked) {
    if (selected.length >= AI_TRI_THIRD_COLUMN_SIZE) break;
    const isUltra =
      h.winOdds != null && h.winOdds >= AI_TRI_ULTRA_LONGSHOT_ODDS_CAP;
    if (isUltra && ultraLongshotCount >= AI_TRI_ULTRA_LONGSHOT_MAX_COUNT) continue;
    selected.push(h.gate);
    if (isUltra) ultraLongshotCount += 1;
  }
  return selected;
}

function buildAiTrifectaSecondColumnGates(
  context: RaceEvaluationContext,
  validHorses: readonly ValidHorse[],
  winOdds: Record<number, number>,
  classTier: ClassTier,
): number[] {
  const marks = markedRefsFromContext(context, winOdds);
  const secondRow = buildSecondRowNumbers(marks, classTier, "ai");
  const probByGate = new Map(validHorses.map((h) => [h.gate, h.prob]));
  return [...secondRow]
    .sort((a, b) => {
      const evA = (probByGate.get(a) ?? 0) * (positiveOdds(winOdds[a]) ?? 0);
      const evB = (probByGate.get(b) ?? 0) * (positiveOdds(winOdds[b]) ?? 0);
      return evB - evA;
    })
    .slice(0, AI_TRI_SECOND_COLUMN_SIZE);
}

function pushTrifectaTicketIfQualified(
  tickets: EvTicket[],
  horses: [ValidHorse, ValidHorse, ValidHorse],
  enrichedOdds: OddsMap,
  triThreshold: number,
): void {
  const [hA, hB, hC] = horses;
  const [g1, g2, g3] = sortTriplet(hA.gate, hB.gate, hC.gate);
  const key = triKey(g1, g2, g3);
  const triOdds = positiveOdds(enrichedOdds.trifecta?.[key]);
  if (triOdds == null) return;

  const estTriProb = estimateTrifectaProbability(hA.prob, hB.prob, hC.prob);
  const ev = estTriProb * triOdds;
  if (ev >= triThreshold) {
    tickets.push({
      type: "TRI",
      gates: [g1, g2, g3],
      estimatedProbability: estTriProb,
      expectedValue: ev,
      decimalOdds: triOdds,
    });
  }
}

function generateAllCombinationsTrifectaEvTickets(
  validHorses: readonly ValidHorse[],
  enrichedOdds: OddsMap,
  triThreshold: number,
): EvTicket[] {
  const tickets: EvTicket[] = [];
  for (let i = 0; i < validHorses.length; i++) {
    for (let j = i + 1; j < validHorses.length; j++) {
      for (let k = j + 1; k < validHorses.length; k++) {
        pushTrifectaTicketIfQualified(
          tickets,
          [validHorses[i]!, validHorses[j]!, validHorses[k]!],
          enrichedOdds,
          triThreshold,
        );
      }
    }
  }
  return tickets;
}

/** AI: 2列目上位3 × 3列目上位8（オッズ帯・超大穴制限付き）で3連複EV券を生成 */
function generateAiTrifectaEvTickets(
  context: RaceEvaluationContext,
  validHorses: readonly ValidHorse[],
  enrichedOdds: OddsMap,
  triThreshold: number,
): EvTicket[] {
  const classTier = (context.classTier as ClassTier) ?? "CONDITIONAL_LOWER";
  const horseByGate = new Map(validHorses.map((h) => [h.gate, h]));
  const secondGates = buildAiTrifectaSecondColumnGates(
    context,
    validHorses,
    enrichedOdds.win,
    classTier,
  );
  const thirdGates = buildAiTrifectaThirdColumnGates(
    context,
    validHorses,
    enrichedOdds.win,
    classTier,
  );
  if (secondGates.length === 0 || thirdGates.length === 0) {
    return generateAllCombinationsTrifectaEvTickets(validHorses, enrichedOdds, triThreshold);
  }

  const anchorGate =
    context.topMarkGate ??
    [...validHorses].sort((a, b) => b.prob - a.prob)[0]?.gate;
  if (anchorGate == null) {
    return generateAllCombinationsTrifectaEvTickets(validHorses, enrichedOdds, triThreshold);
  }
  const anchor = horseByGate.get(anchorGate);
  if (anchor == null) {
    return generateAllCombinationsTrifectaEvTickets(validHorses, enrichedOdds, triThreshold);
  }

  const tickets: EvTicket[] = [];
  const seen = new Set<string>();
  for (const secondGate of secondGates) {
    const second = horseByGate.get(secondGate);
    if (second == null || second.gate === anchor.gate) continue;
    for (const thirdGate of thirdGates) {
      const third = horseByGate.get(thirdGate);
      if (third == null || third.gate === anchor.gate || third.gate === second.gate) continue;
      const combKey = triKey(anchor.gate, second.gate, third.gate);
      if (seen.has(combKey)) continue;
      seen.add(combKey);
      pushTrifectaTicketIfQualified(tickets, [anchor, second, third], enrichedOdds, triThreshold);
    }
  }
  return tickets;
}

/** EvTicket を既存の BetTicket 形式に変換（UI・バックテスト・払戻計算用） */
export function evTicketsToBetTickets(evTickets: readonly EvTicket[], betAmount = 100): BetTicket[] {
  const rawAmounts = evTickets.map((t) => resolveKellyBetAmount(t, betAmount));
  const cappedAmounts = applyRaceInvestmentCap(rawAmounts);
  const bucket = new Map<string, BetTicket>();
  const ticketTypeMap: Record<EvTicketType, BetTicket["ticketType"]> = {
    WIN: "WIN",
    REN: "MAIN_LINE",
    WREN: "WIDE",
    TRI: "TRIFECTA_FORM",
  };
  for (let i = 0; i < evTickets.length; i += 1) {
    const t = evTickets[i]!;
    const amount = cappedAmounts[i] ?? KELLY_MIN_BET_AMOUNT;
    const ticketType = ticketTypeMap[t.type];
    const key = `${ticketType}:${amount}`;
    const existing = bucket.get(key);
    if (existing != null) {
      existing.combinations.push([...t.gates]);
      continue;
    }
    bucket.set(key, {
      ticketType,
      combinations: [[...t.gates]],
      betAmount: amount,
    });
  }
  return [...bucket.values()];
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
  /** ◎軸の8%足切りに使う勝率（未指定時は winProbabilities と同じ） */
  anchorGateWinRateProbabilities?: ReadonlyMap<string, number>;
};

export type GenerateTicketsOptions = {
  classTier?: ClassTier;
  thresholdEV?: number;
  probabilityEngine?: ProbabilityEngine;
  renEvThreshold?: number;
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
  const winProbabilityByGate = new Map<number, number>();
  const markedHorses: { gate: number; mark: string; finalRank: number }[] = [];

  for (const r of sorted) {
    const gate = input.horseNumberById.get(r.horseId);
    if (gate == null) continue;
    evaluatedHorses.push({
      gate,
      finalRank: r.finalRank ?? 99,
      finalEvaluationScore: r.finalEvaluationScore,
    });
    const predicted = input.winProbabilities.get(r.horseId) ?? 0;
    winProbabilities.push(predicted);
    winProbabilityByGate.set(gate, predicted);
    if (r.mark != null && r.mark !== "") {
      markedHorses.push({ gate, mark: r.mark, finalRank: r.finalRank ?? 99 });
    }
  }
  const resolvedTopMarkGate = resolveTopMarkGate(input.results, input.horseNumberById);
  const anchorGateProbs = input.anchorGateWinRateProbabilities ?? input.winProbabilities;
  const topHorseId = input.results.find((r) => r.mark === "◎")?.horseId;
  const topProb =
    topHorseId != null
      ? (anchorGateProbs.get(topHorseId) ?? 0)
      : resolvedTopMarkGate != null
        ? (winProbabilityByGate.get(resolvedTopMarkGate) ?? 0)
        : 0;
  const topMarkGate =
    resolvedTopMarkGate != null && topProb >= ANCHOR_MIN_PREDICTED_WIN_RATE
      ? resolvedTopMarkGate
      : undefined;

  return {
    isSkippableRace: input.isSkippableRace ?? false,
    classTier: input.classTier ?? "CONDITIONAL_LOWER",
    evaluatedHorses,
    markedHorses,
    winProbabilities,
    topMarkGate,
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
    thresholdEV: options?.thresholdEV,
    renEvThreshold: options?.renEvThreshold,
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
