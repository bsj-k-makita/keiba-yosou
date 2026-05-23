import { GROUND_ADJUSTMENTS } from "../../domain/race-evaluation/adjustments";
import type {
  InvestmentCommentInput,
  RaceAnalysisSnapshot,
  RaceCondition,
  RacePeerBaselineSummary,
  RaceStoredLapType,
  SuitabilityFlag,
} from "../../domain/race-evaluation/abilityTypes";
import type { DisplayGrade } from "../../domain/race-evaluation/abilityGrades";
import { calcHorseScore, getFinalWeights, type HorseAbility, weightsToDemand0to100 } from "../../domain/race-evaluation";
import {
  baseAbilityCore,
  intrinsicAbilityWithAdjustments,
  raceAdjustedInput,
} from "../../domain/race-evaluation/abilityCoreScoring";
import { reproducibilityDelta, riskPenaltyPoints } from "../../domain/race-evaluation/evaluationSignals";
import { getEffectiveEvaluationSignals } from "../../domain/race-evaluation/resolveEvaluationSignals";
import { computeFitScore, fitLevelFromScore } from "../../domain/race-evaluation/fitScore";
import {
  BUY_LABELS,
  PACE_FIT,
  FIT_TENDENCY,
  type BuyLabelLingo,
  type FitTendency,
  type PaceFitToken,
} from "../../domain/race-evaluation/lingoConstants";
import { computePaceFitLevel } from "../../domain/race-evaluation/paceFit";
import { RUNNING_STYLES, RUNNING_STYLE_DEFAULT, type RunningStyle } from "../../domain/race-evaluation/lingoConstants";
import { buildEvaluationData, recomputeEvaluationData } from "./buildEvaluationData";
import { isRaceEvaluationDataShape, assertIsRaceEvaluationData } from "./raceEvaluationGuards";
import type { RaceEntryEvaluation, RaceEvaluationData, RaceInfo } from "./raceEvaluationTypes";
import type { AnalysisHorseEntry, AnalysisJsonRoot, AnalysisRaceMeta } from "./analysisJsonTypes";
import { sanitizeRaceEntriesForUi, type EnrichedRaceHorse } from "./raceDataToHorses";
import { evaluateRace } from "../../domain/race-evaluation/scoreCalculator";
import type { HorseScoreResult } from "../../domain/race-evaluation/abilityTypes";
import type { HorseEvaluationSignals } from "../../domain/race-evaluation/abilityTypes";

const BUY_SET = new Set<string>(Object.values(BUY_LABELS) as string[]);
const PACE_TOK: readonly PaceFitToken[] = [PACE_FIT.PERFECT, PACE_FIT.FIT, PACE_FIT.MAYBE, PACE_FIT.BAD];
const FIT_LVL: readonly FitTendency[] = [FIT_TENDENCY.HI, FIT_TENDENCY.MID, FIT_TENDENCY.LO];

function n(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function b(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

function parseNumArrayInRange(v: unknown, max: number): readonly number[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const gates = v
    .map((x) => (typeof x === "number" ? x : Number(String(x))))
    .filter((n) => Number.isFinite(n))
    .map((n) => Math.round(n as number))
    .filter((n) => n >= 1 && n <= max);
  const uniq = [...new Set(gates)].sort((a, b) => a - b);
  return uniq.length > 0 ? uniq : undefined;
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

function clampInt(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(v)));
}

function inferFrameNumberFromHorseNumber(horseNumber: number): number {
  // 18頭標準: 馬番 n の枠は ceil(n/2)（1〜2→1枠 … 17〜18→8枠）
  return clampInt(Math.ceil(horseNumber / 2), 1, 8);
}

function parseSuitabilityFlags(raw: unknown): SuitabilityFlag[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: SuitabilityFlag[] = [];
  for (const item of raw) {
    if (item == null || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const label = o.label;
    const code = o.code;
    if (typeof label !== "string" || label.trim().length === 0) continue;
    const flag: SuitabilityFlag = {
      code: typeof code === "string" && code.length > 0 ? code : "unknown",
      label: label.trim(),
    };
    const pct = n(o.impactApproxPct);
    if (pct != null) flag.impactApproxPct = pct;
    out.push(flag);
  }
  return out.length > 0 ? out : undefined;
}

const STORED_LAP_TYPES = new Set<RaceStoredLapType>(["late_accelerated", "early_pressured", "even_pace", "neutral"]);

function parseStoredLapType(v: unknown): RaceStoredLapType | undefined {
  if (typeof v !== "string" || !STORED_LAP_TYPES.has(v as RaceStoredLapType)) return undefined;
  return v as RaceStoredLapType;
}

function raceAnalysisFromUnknown(o: Record<string, unknown> | null | undefined): RaceAnalysisSnapshot | undefined {
  if (o == null) return undefined;
  const biasRaw = o["bias"] as Record<string, unknown> | undefined;
  let bias: RaceAnalysisSnapshot["bias"];
  if (biasRaw != null) {
    bias = {
      innerOuter: n(biasRaw["innerOuter"]),
      frontCloser: n(biasRaw["frontCloser"]),
      innerShare: n(biasRaw["innerShare"]),
      outerSashiShare: n(biasRaw["outerSashiShare"]),
    };
  }
  const lapType = parseStoredLapType(o["lapType"]);
  const lapStructureLabel =
    typeof o["lapStructure"] === "string"
      ? o["lapStructure"]
      : typeof o["lapStructureLabel"] === "string"
        ? o["lapStructureLabel"]
        : undefined;
  const peerRaw = o["peerBaseline"];
  let peerBaseline: RacePeerBaselineSummary | undefined;
  if (peerRaw != null && typeof peerRaw === "object") {
    const p = peerRaw as Record<string, unknown>;
    peerBaseline = {
      peerRaceCount: n(p["peerRaceCount"]),
      avgPaceBalancePeer: n(p["avgPaceBalancePeer"]),
      avgMedianFinal3fPeer: n(p["avgMedianFinal3fPeer"]),
      avgMeanMarginPeer: n(p["avgMeanMarginPeer"]),
      fallbackFromFile: typeof p["fallbackFromFile"] === "boolean" ? p["fallbackFromFile"] : undefined,
      savedDayRaceCount: n(p["savedDayRaceCount"]),
      savedAvgPaceBalance: n(p["savedAvgPaceBalance"]),
    };
  }
  const snap: RaceAnalysisSnapshot = {
    ...(bias != null ? { bias } : {}),
    ...(lapType != null ? { lapType } : {}),
    paceBalance: n(o["paceBalance"]),
    medianFinal3fSec: n(o["medianFinal3fSec"]),
    meanMarginFieldSec: n(o["meanMarginFieldSec"]),
    ...(lapStructureLabel != null ? { lapStructureLabel } : {}),
    ...(peerBaseline != null ? { peerBaseline } : {}),
    source: typeof o["source"] === "string" ? o["source"] : undefined,
    computedAt: typeof o["computedAt"] === "string" ? o["computedAt"] : undefined,
  };
  if (
    snap.bias == null &&
    snap.lapType == null &&
    snap.paceBalance == null &&
    snap.medianFinal3fSec == null &&
    snap.meanMarginFieldSec == null &&
    snap.lapStructureLabel == null &&
    snap.peerBaseline == null &&
    snap.source == null &&
    snap.computedAt == null
  ) {
    return undefined;
  }
  return snap;
}

function mergeRaceAnalysisFromDoc(doc: Record<string, unknown>): RaceAnalysisSnapshot | undefined {
  const cond = doc["condition"] as Record<string, unknown> | undefined;
  const fromCondRa = cond?.["raceAnalysis"];
  if (fromCondRa != null && typeof fromCondRa === "object") {
    const a = raceAnalysisFromUnknown(fromCondRa as Record<string, unknown>);
    if (a != null) return a;
  }
  const root = doc["analysis"];
  if (root != null && typeof root === "object") {
    return raceAnalysisFromUnknown(root as Record<string, unknown>);
  }
  return undefined;
}

/**
 * 保存JSONルート配下の `analysisJson` / `analysis` を畳み込み、変換器が扱う1オブジェクトにまとめる。
 *
 * `attachRaceAnalysisOrLeave`（出馬表取得）がルートに付ける `analysis` はレース分析スナップショットのみで、
 * `entries` を含まない。旧ロジックがこれを丸ごと `analysis` として返すと `unwrap` がその小オブジェクトだけを返し、
 * 本来の出馬表ルート（`meta` + `entries`）が捨てられて変換に失敗する。
 * ルートに出走表 `entries` があるときは常にルートをそのまま使う。
 */
export function unwrapAnalysisPayload(root: unknown): unknown {
  if (root == null || typeof root !== "object") return root;
  const o = root as Record<string, unknown>;
  if (isRaceEvaluationDataShape(o)) return root;
  if (Array.isArray(o.entries) && o.entries.length > 0) return root;
  if (o.analysisJson != null) return o.analysisJson;
  if (o.analysis != null) return o.analysis;
  return root;
}

function mapGroundLabelToKey(label: string | undefined): string {
  if (label == null || label.length === 0) return "good";
  for (const [k, d] of Object.entries(GROUND_ADJUSTMENTS)) {
    if (d.label === label) return k;
  }
  if (label.includes("稍")) return "yielding";
  if (label === "重") return "heavy";
  if (label.includes("不良") || label === "不") return "bad";
  if (label.includes("良") || label === "良") return "good";
  return "good";
}

function inferSurface(rough: string | undefined): "芝" | "ダート" {
  if (rough == null) return "芝";
  if (rough.includes("ダ") || rough.toLowerCase() === "dirt") return "ダート";
  return "芝";
}

function toRunningStyle(s: string | undefined | null): RunningStyle {
  if (s == null) return RUNNING_STYLE_DEFAULT;
  const t = s.trim();
  /** DB設計練習移行等の4文字表記。`"追込".includes` では「追い込み」にマッチしない */
  if (t === "追い込み" || t.startsWith("追い込")) return "追込";
  for (const st of RUNNING_STYLES) {
    if (t === st || t.includes(st)) return st;
  }
  return RUNNING_STYLE_DEFAULT;
}

function normalizeDisplayGradeString(s: string | undefined | null): DisplayGrade {
  if (s == null) return "C";
  if (s === "S" || s === "A+" || s === "A" || s === "B" || s === "C") return s;
  if (s === "D") return "C";
  return "C";
}

function normalizeBuyLabel(s: string | undefined): BuyLabelLingo {
  if (s && BUY_SET.has(s)) return s as BuyLabelLingo;
  return BUY_LABELS.GROUP;
}

function normPaceFit(s: string | undefined): PaceFitToken {
  if (s && (PACE_TOK as readonly string[]).includes(s)) return s as PaceFitToken;
  return PACE_FIT.FIT;
}

function normFitLevel(s: string | undefined): FitTendency {
  if (s && (FIT_LVL as readonly string[]).includes(s)) return s as FitTendency;
  return FIT_TENDENCY.MID;
}

function toAbilities(e: AnalysisHorseEntry): { speed: number; stamina: number; kick: number; sustain: number; power: number } {
  const a = e.abilities;
  return {
    speed: n(a.speed) ?? 50,
    stamina: n(a.stamina) ?? 50,
    kick: n(a.kick) ?? 50,
    sustain: n(a.sustain) ?? 50,
    power: n(a.power) ?? 50,
  };
}

type EntryWithMarketOdds = RaceEntryEvaluation & {
  market_win_odds?: number;
  marketWinOdds?: number;
  estimated_actual_odds?: number;
  estimatedActualOdds?: number;
};

/** UI形式JSONで evaluationSignals が欠けていても market_win_odds を単勝オッズへ反映 */
function enrichEntryEvaluationSignals(entries: readonly RaceEntryEvaluation[]): RaceEntryEvaluation[] {
  let touched = false;
  const out = entries.map((entry) => {
    const ext = entry as EntryWithMarketOdds;
    const marketWinOdds =
      n(ext.market_win_odds) ??
      n(ext.marketWinOdds) ??
      n(ext.estimated_actual_odds) ??
      n(ext.estimatedActualOdds);
    if (marketWinOdds == null || marketWinOdds <= 0) return entry;
    if (entry.evaluationSignals?.winOdds != null && entry.evaluationSignals.winOdds > 0) {
      return entry;
    }
    touched = true;
    return {
      ...entry,
      evaluationSignals: {
        ...entry.evaluationSignals,
        winOdds: entry.evaluationSignals?.winOdds ?? marketWinOdds,
      },
    };
  });
  return touched ? out : [...entries];
}

function toEvaluationSignals(e: AnalysisHorseEntry): HorseEvaluationSignals | undefined {
  const base = e.evaluationSignals;
  const marketWinOdds = n(e.market_win_odds) ?? n(e.marketWinOdds);
  const temperamentConcern01 = n(e.temperamentConcern01);
  const temperamentRisk = typeof e.temperamentRisk === "boolean" ? e.temperamentRisk : undefined;
  if (base == null && marketWinOdds == null && temperamentConcern01 == null && temperamentRisk == null) {
    return undefined;
  }
  return {
    ...base,
    winOdds: base?.winOdds ?? marketWinOdds,
    temperamentConcern01: base?.temperamentConcern01 ?? temperamentConcern01,
    temperamentRisk: base?.temperamentRisk ?? temperamentRisk,
  };
}

function toInvestmentInput(e: AnalysisHorseEntry): InvestmentCommentInput | undefined {
  const predictedProbability = n(e.predicted_probability) ?? n(e.predictedProbability);
  const predictedWinRate = n(e.predicted_win_rate) ?? n(e.predictedWinRate);
  const finalExpectedValueRaw =
    n(e.final_expected_value) ??
    n(e.finalExpectedValue) ??
    n(e.value_score) ??
    n(e.valueScore);
  const expectedValue = n(e.expected_value) ?? n(e.expectedValue);
  const marketWinOdds = n(e.market_win_odds) ?? n(e.marketWinOdds);
  const marketWinOddsSourceRaw = e.market_win_odds_source ?? e.marketWinOddsSource;
  const actualOdds =
    marketWinOdds ??
    n(e.actual_odds) ??
    n(e.actualOdds) ??
    n(e.estimated_actual_odds) ??
    n(e.estimatedActualOdds);
  const valueRankRaw = (e.value_rank ?? e.valueRank) as string | undefined;
  const betTypeRaw = (e.bet_type ?? e.betType) as string | undefined;
  const valueChangeRaw = (e.value_change ?? e.valueChange) as string | undefined;
  const keyFactorsRaw = Array.isArray(e.key_factors)
    ? e.key_factors
    : Array.isArray(e.keyFactors)
      ? e.keyFactors
      : [];
  const riskFactorsRaw = Array.isArray(e.risk_factors)
    ? e.risk_factors
    : Array.isArray(e.riskFactors)
      ? e.riskFactors
      : [];
  if (predictedProbability == null || actualOdds == null) return undefined;
  if (valueRankRaw == null || !["S", "A", "B", "C", "D"].includes(valueRankRaw)) return undefined;
  if (betTypeRaw == null || !["軸", "相手", "ヒモ穴", "見送り"].includes(betTypeRaw)) return undefined;
  if (valueChangeRaw == null || !["UP", "DOWN", "STABLE"].includes(valueChangeRaw)) return undefined;
  return {
    predictedProbability,
    predictedWinRate: predictedWinRate ?? undefined,
    finalExpectedValue: finalExpectedValueRaw ?? undefined,
    expectedValue: expectedValue ?? undefined,
    actualOdds,
    oddsSource:
      marketWinOddsSourceRaw === "actual" || marketWinOddsSourceRaw === "estimated"
        ? marketWinOddsSourceRaw
        : (e.odds_source ?? e.oddsSource) === "actual" || (e.odds_source ?? e.oddsSource) === "estimated"
          ? (e.odds_source ?? e.oddsSource)
        : n(e.estimated_actual_odds) != null || n(e.estimatedActualOdds) != null
          ? "estimated"
          : undefined,
    valueScore: n(e.value_score) ?? n(e.valueScore),
    valueRank: valueRankRaw as InvestmentCommentInput["valueRank"],
    confidenceRank: (e.confidence_rank ?? e.confidenceRank) as InvestmentCommentInput["confidenceRank"] | undefined,
    betType: betTypeRaw as InvestmentCommentInput["betType"],
    valueChange: valueChangeRaw as InvestmentCommentInput["valueChange"],
    keyFactors: keyFactorsRaw.filter((v): v is string => typeof v === "string" && v.trim().length > 0).slice(0, 3),
    riskFactors: riskFactorsRaw.filter((v): v is string => typeof v === "string" && v.trim().length > 0).slice(0, 3),
    kellyWeight: n(e.kelly_weight) ?? n(e.kellyWeight),
  };
}

function toEnrichedHorse(e: AnalysisHorseEntry): EnrichedRaceHorse {
  // `horseNumber` を優先（RaceEvaluationData 側の馬番と揃える。旧 analysis の umaban だけ +1 揺れがある）
  const um = n(e.horseNumber) ?? n(e.umaban) ?? 1;
  const wk = n(e.waku) ?? n(e.wakuNo) ?? n(e.frameNumber) ?? 1;
  const ab = toAbilities(e);
  const pd = e.pedigree;
  return {
    horseId: e.horseId,
    horseName: e.horseName,
    runningStyle: toRunningStyle(e.runningStyle),
    sex: e.sex,
    age: n(e.age),
    jockey: e.jockeyName ?? e.jockey,
    trainer: e.trainerName ?? e.trainer,
    bodyWeightKg: n(e.bodyWeightKg) ?? n(e.bodyWeight),
    speed: ab.speed,
    stamina: ab.stamina,
    kick: ab.kick,
    sustain: ab.sustain,
    power: ab.power,
    pedigree: {
      sireId: pd?.sireId,
      sireName: pd?.sireName ?? e.sireName ?? e.sire,
      damSireId: pd?.damSireId,
      damSireName: pd?.damSireName ?? e.damSireName ?? e.damsire,
      sireLineName: pd?.sireLineName,
      courseFit01: n(pd?.courseFit01),
      distanceFit01: n(pd?.distanceFit01),
      flatTrackFit01: n(pd?.flatTrackFit01),
      uphillTrackFit01: n(pd?.uphillTrackFit01),
      downhillToFlatFit01: n(pd?.downhillToFlatFit01),
      maleStayerFit01: n(pd?.maleStayerFit01),
      femaleMiddleFit01: n(pd?.femaleMiddleFit01),
    },
    gate: um,
    frameNumber: wk,
    pastRuns: e.pastRuns,
    was_bias_disadvantaged: b(e.was_bias_disadvantaged) ?? b(e.wasBiasDisadvantaged),
    l2_top_speed: n(e.l2_top_speed) ?? n(e.l2TopSpeed),
    bias_mismatch: b(e.bias_mismatch),
    pace_mismatch: b(e.pace_mismatch),
    l2_sustain_ratio: n(e.l2_sustain_ratio) ?? n(e.l2SustainRatio),
    signals: toEvaluationSignals(e),
    investment: toInvestmentInput(e),
    aiPredictedWinRate: n(e.ai_predicted_win_rate) ?? n(e.aiPredictedWinRate) ?? undefined,
    aiEffectiveEv: n(e.ai_effective_ev) ?? n(e.aiEffectiveEv) ?? undefined,
    position_x: n(e.position_x) ?? n(e.positionX),
    abilityIndex: n(e.ability_index) ?? n(e.abilityIndex),
    suitabilityFlags: parseSuitabilityFlags(e.suitability_flags ?? e.suitabilityFlags),
    ...(e.abilities_source === "past_runs_estimated" ? { abilitiesPrecomputedFromPastRuns: true as const } : {}),
  };
}

const RACE_GRADE_SET = new Set<string>(["G1", "G2", "G3", "L", "S"]);

function mergeMeta(root: Record<string, unknown>, meta: AnalysisRaceMeta | undefined | null) {
  const m = (meta ?? {}) as Partial<AnalysisRaceMeta>;
  const rg =
    typeof m.raceGrade === "string" && RACE_GRADE_SET.has(m.raceGrade)
      ? m.raceGrade
      : typeof root.raceGrade === "string" && RACE_GRADE_SET.has(root.raceGrade)
        ? (root.raceGrade as "G1" | "G2" | "G3" | "L" | "S")
        : undefined;
  const ngt = n(m.netkeibaGradeType) ?? n(root.netkeibaGradeType);
  return {
    date: (typeof m.date === "string" && m.date.length > 0 ? m.date : (root.date as string)) ?? "2000-01-01",
    venue: (typeof m.venue === "string" && m.venue.length > 0 ? m.venue : (root.venue as string)) ?? "東京",
    raceNumber: n(m.raceNumber) ?? n(root.raceNumber) ?? 1,
    raceName: (typeof m.raceName === "string" ? m.raceName : (root.raceName as string | undefined)) as string | undefined,
    surface: (typeof m.surface === "string" && m.surface.length > 0 ? m.surface : (root.surface as string | undefined)) ?? "芝",
    distance: n(m.distance) ?? n(root.distance) ?? 1600,
    groundLabel: m.groundLabel ?? (root.groundLabel as string | undefined),
    weather: m.weather ?? (root.weather as string | undefined),
    raceGrade: rg,
    netkeibaGradeType: Number.isFinite(ngt) ? ngt : undefined,
    postTime:
      typeof m.postTime === "string" && m.postTime.length > 0
        ? m.postTime
        : typeof root.postTime === "string" && root.postTime.length > 0
          ? (root.postTime as string)
          : undefined,
  };
}

function readAiMarkSnapshot(
  root: Record<string, unknown>,
  meta: AnalysisRaceMeta | undefined | null,
): RaceInfo["aiMarkSnapshot"] {
  const m = (meta ?? {}) as Record<string, unknown>;
  const snap = (m.ai_mark_snapshot ?? m.aiMarkSnapshot ?? root.ai_mark_snapshot ?? root.aiMarkSnapshot) as
    | RaceInfo["aiMarkSnapshot"]
    | undefined;
  if (snap?.marksByHorseId == null || typeof snap.marksByHorseId !== "object") return undefined;
  if (typeof snap.frozenAt !== "string") return undefined;
  return snap;
}

function toRaceInfo(raceId: string, pack: ReturnType<typeof mergeMeta>, root: Record<string, unknown>, meta: AnalysisRaceMeta | undefined | null): RaceInfo {
  const aiMarkSnapshot = readAiMarkSnapshot(root, meta);
  return {
    raceId,
    date: pack.date,
    venue: pack.venue,
    raceNumber: pack.raceNumber,
    raceName: pack.raceName,
    surface: inferSurface(pack.surface),
    distance: pack.distance,
    groundLabel: pack.groundLabel,
    weather: pack.weather,
    ...(pack.postTime != null ? { postTime: pack.postTime } : {}),
    ...(pack.raceGrade != null ? { raceGrade: pack.raceGrade } : {}),
    ...(pack.netkeibaGradeType != null ? { netkeibaGradeType: pack.netkeibaGradeType } : {}),
    ...(aiMarkSnapshot != null ? { aiMarkSnapshot } : {}),
  };
}

function toCondition(doc: Record<string, unknown>, pack: ReturnType<typeof mergeMeta>): RaceCondition {
  const mergedRa = mergeRaceAnalysisFromDoc(doc);
  const raw = (doc["condition"] ?? null) as Record<string, unknown> | null;
  if (raw != null) {
    return {
      meetingDate:
        typeof raw["meetingDate"] === "string" && String(raw["meetingDate"]).length >= 8
          ? String(raw["meetingDate"])
          : pack.date,
      venue: typeof raw["venue"] === "string" && raw["venue"] ? raw["venue"] : pack.venue,
      courseKey: typeof raw["courseKey"] === "string" && raw["courseKey"] ? raw["courseKey"] : undefined,
      raceName:
        typeof raw["raceName"] === "string" && raw["raceName"]
          ? raw["raceName"]
          : pack.raceName,
      ...(pack.raceGrade != null ? { raceGrade: pack.raceGrade } : {}),
      ...(pack.netkeibaGradeType != null ? { netkeibaGradeType: pack.netkeibaGradeType } : {}),
      surface:
        raw["surface"] === "ダート" || raw["surface"] === "芝"
          ? raw["surface"]
          : inferSurface(pack.surface),
      distance: n(raw["distance"]) ?? pack.distance,
      ground: typeof raw["ground"] === "string" && raw["ground"] ? raw["ground"] : mapGroundLabelToKey(pack.groundLabel),
      bias: typeof raw["bias"] === "string" && raw["bias"] ? raw["bias"] : "flat",
      pace: typeof raw["pace"] === "string" && raw["pace"] ? raw["pace"] : "middle",
      adjustmentStrength:
        raw["adjustmentStrength"] === "weak" || raw["adjustmentStrength"] === "middle" || raw["adjustmentStrength"] === "strong"
          ? raw["adjustmentStrength"]
          : "middle",
      trackBiasStrength01: n(raw["trackBiasStrength01"]),
      turnCount: n(raw["turnCount"]),
      section200mSec:
        Array.isArray(raw["section200mSec"]) && raw["section200mSec"].every((v) => typeof v === "number")
          ? (raw["section200mSec"] as number[])
          : undefined,
      courseTopology:
        raw["courseTopology"] === "flat" || raw["courseTopology"] === "uphill" || raw["courseTopology"] === "downhill_to_flat"
          ? raw["courseTopology"]
          : undefined,
      userTrackBias: n(raw["userTrackBias"]),
      trackCushion01: n(raw["trackCushion01"]),
      paceInference: raw["paceInference"] === "manual" ? "manual" : undefined,
      meetingPhase:
        raw["meetingPhase"] === "opening" || raw["meetingPhase"] === "mid" || raw["meetingPhase"] === "closing"
          ? raw["meetingPhase"]
          : undefined,
      favoredGateNumbers: parseNumArrayInRange(raw["favoredGateNumbers"], 8),
      disfavoredGateNumbers: parseNumArrayInRange(raw["disfavoredGateNumbers"], 8),
      favoredHorseNumbers: parseNumArrayInRange(raw["favoredHorseNumbers"], 36),
      disfavoredHorseNumbers: parseNumArrayInRange(raw["disfavoredHorseNumbers"], 36),
      openingMeetingWeek: b(raw["openingMeetingWeek"]),
      closingMeetingWeek: b(raw["closingMeetingWeek"]),
      quickAdjustments:
        raw["quickAdjustments"] != null && typeof raw["quickAdjustments"] === "object"
          ? {
              lastRunReset: b((raw["quickAdjustments"] as Record<string, unknown>)["lastRunReset"]),
              lapFocus: b((raw["quickAdjustments"] as Record<string, unknown>)["lapFocus"]),
              biasSync: b((raw["quickAdjustments"] as Record<string, unknown>)["biasSync"]),
            }
          : undefined,
      ...(mergedRa != null ? { raceAnalysis: mergedRa } : {}),
    };
  }
  return {
    meetingDate: pack.date,
    venue: pack.venue,
    courseKey: undefined,
    raceName: pack.raceName,
    ...(pack.raceGrade != null ? { raceGrade: pack.raceGrade } : {}),
    ...(pack.netkeibaGradeType != null ? { netkeibaGradeType: pack.netkeibaGradeType } : {}),
    surface: inferSurface(pack.surface),
    distance: pack.distance,
    ground: mapGroundLabelToKey(pack.groundLabel),
    bias: "flat",
    pace: "middle",
    adjustmentStrength: "middle",
    trackBiasStrength01: undefined,
    turnCount: undefined,
    ...(mergedRa != null ? { raceAnalysis: mergedRa } : {}),
  };
}

function isAnalysisEntryRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object";
}

/**
 * ゆるいオブジェクトから `AnalysisJsonRoot` を判別（`raceInfo` が無い＝表示形式でない＝分析ルート扱い）
 */
function tryParseAnalysisJsonRoot(v: unknown): AnalysisJsonRoot | null {
  if (v == null || typeof v !== "object") return null;
  if (isRaceEvaluationDataShape(v)) return null;
  const o = v as Record<string, unknown>;
  if (o["raceInfo"] != null) return null;
  if (typeof o["raceId"] !== "string") return null;
  const ent = o["entries"];
  if (!Array.isArray(ent) || ent.length === 0) return null;
  const e0 = ent[0];
  if (!isAnalysisEntryRecord(e0) || typeof e0["horseId"] !== "string" || typeof e0["horseName"] !== "string")
    return null;
  return o as unknown as AnalysisJsonRoot;
}

/**
 * パイプライン由来の 1 頭分が、評価・等級をすでに完備しているか。
 */
function entryHasFullPipelineEval(e: AnalysisHorseEntry): boolean {
  if (e.abilityGrades == null) return false;
  const g = e.abilityGrades;
  if (!g.speed || !g.stamina || !g.kick || !g.sustain || !g.power) return false;
  if (e.evaluation == null && e.scoring == null) return false;
  const sc = e.evaluation ?? ({} as NonNullable<AnalysisHorseEntry["evaluation"]>);
  const s2 = e.scoring;
  const base = n(sc.baseScore) ?? n(s2?.baseScore);
  const adj = n(sc.adjustedScore) ?? n(s2?.adjustedScore);
  const di = n(sc.scoreDiff) ?? n(s2?.scoreDiff);
  return base != null && adj != null && di != null;
}

function toRaceEntryFromPreserved(
  h: EnrichedRaceHorse,
  e: AnalysisHorseEntry,
  condition: RaceCondition,
  gradeRow: { speed: string; stamina: string; kick: string; sustain: string; power: string },
  recomputed: HorseScoreResult | null,
): RaceEntryEvaluation {
  const ab = toAbilities(e);
  const ev = e.evaluation ?? { baseScore: 0, adjustedScore: 0, scoreDiff: 0 };
  const s2 = e.scoring;
  const base = n(ev.baseScore) ?? n(s2?.baseScore) ?? 0;
  const adj = n(ev.adjustedScore) ?? n(s2?.adjustedScore) ?? 0;
  const di = n(ev.scoreDiff) ?? n(s2?.scoreDiff) ?? 0;
  const finalW = getFinalWeights(condition);
  const demand = weightsToDemand0to100(finalW);
  const hLike: HorseAbility = {
    horseId: h.horseId,
    horseName: h.horseName,
    runningStyle: h.runningStyle,
    ...ab,
    signals: h.signals,
    pastRuns: h.pastRuns,
  };
  const fitLevel =
    ev.fitLevel != null ? normFitLevel(ev.fitLevel) : fitLevelFromScore(computeFitScore(hLike, demand));
  const paceFit = ev.paceFit != null ? normPaceFit(ev.paceFit) : computePaceFitLevel(hLike, condition);
  const wbc = recomputed?.baseAbilityCore ?? round1(baseAbilityCore(hLike));
  const intrinsicAbilityScore = recomputed?.intrinsicAbilityScore ?? round1(intrinsicAbilityWithAdjustments(hLike));
  const raceAdIn = recomputed?.raceAdjustedInput ?? round1(raceAdjustedInput(intrinsicAbilityScore, round1(calcHorseScore(hLike, finalW))));
  const effSig = getEffectiveEvaluationSignals(hLike);
  const rpro = recomputed?.reproducibilityDelta ?? round1(reproducibilityDelta(effSig));
  const rsk = recomputed?.riskPenalty ?? round1(riskPenaltyPoints(effSig));
  const conditionFitDelta = round1(adj - intrinsicAbilityScore);
  return {
    horseId: h.horseId,
    horseName: h.horseName,
    horseNumber: h.gate,
    frameNumber: h.frameNumber,
    jockey: e.jockeyName ?? e.jockey,
    trainer: e.trainerName ?? e.trainer,
    sex: e.sex,
    age: n(e.age),
    weight: e.weight ?? e.kinjuryo,
    bodyWeightKg: n(e.bodyWeightKg) ?? n(e.bodyWeight),
    pedigree: h.pedigree,
    runningStyle: h.runningStyle,
    abilities: ab,
    abilityGrades: {
      speed: normalizeDisplayGradeString(gradeRow.speed),
      stamina: normalizeDisplayGradeString(gradeRow.stamina),
      kick: normalizeDisplayGradeString(gradeRow.kick),
      sustain: normalizeDisplayGradeString(gradeRow.sustain),
      power: normalizeDisplayGradeString(gradeRow.power),
    },
    evaluation: {
      baseScore: base,
      adjustedScore: adj,
      scoreDiff: di,
      baseAbilityCore: wbc,
      intrinsicAbilityScore,
      raceAdjustedInput: raceAdIn,
      conditionFitDelta,
      reproducibilityDelta: rpro,
      riskPenalty: rsk,
      raceRelativeScore: recomputed?.raceRelativeScore ?? 0,
      paceFitBonus: recomputed?.paceFitBonus ?? 0,
      distanceFitBonus: recomputed?.distanceFitBonus ?? 0,
      classLevelBonus: recomputed?.classLevelBonus ?? 0,
      pedigreeBonus: recomputed?.pedigreeBonus ?? 0,
      gateBiasBonus: recomputed?.gateBiasBonus ?? 0,
      gateStyleSynergyBonus: recomputed?.gateStyleSynergyBonus ?? 0,
      connectionsBonus: recomputed?.connectionsBonus ?? 0,
      trendBonus: recomputed?.trendBonus ?? 0,
      paceBalanceBonus: recomputed?.paceBalanceBonus ?? 0,
      tripContextBonus: recomputed?.tripContextBonus ?? 0,
      finalEvaluationScore: recomputed?.finalEvaluationScore ?? 0,
      evaluationBaselineScore: recomputed?.evaluationBaselineScore ?? 0,
      evaluationAdjustmentDelta: recomputed?.evaluationAdjustmentDelta ?? 0,
      lastMinuteAdjustmentBonus: recomputed?.lastMinuteAdjustmentBonus ?? 0,
      lastRunResetBonus: recomputed?.lastRunResetBonus ?? 0,
      lapFocusBonus: recomputed?.lapFocusBonus ?? 0,
      adjustmentBadges: recomputed?.adjustmentBadges ?? [],
      lapShapeFitBonus: recomputed?.lapShapeFitBonus ?? 0,
      raceAnalysisBonus: recomputed?.raceAnalysisBonus ?? 0,
      lapSustainBonus: recomputed?.lapSustainBonus ?? 0,
      lapQualityBonus: recomputed?.lapQualityBonus ?? 0,
      stepPatternBonus: recomputed?.stepPatternBonus ?? 0,
      lapProfile: recomputed?.lapProfile ?? "一貫型",
      varianceScore: recomputed?.varianceScore ?? 0,
      roleHint: recomputed?.roleHint ?? "判定不能",
      pastRunInsight: recomputed?.pastRunInsight ?? "",
      fitLevel,
      paceFit,
      buyLabel:
        ev.buyLabel != null && BUY_SET.has(ev.buyLabel)
          ? (ev.buyLabel as BuyLabelLingo)
          : recomputed?.buyLabel ?? normalizeBuyLabel(ev.buyLabel),
    },
    evaluationSignals: h.signals,
    investment: h.investment,
    was_bias_disadvantaged: h.was_bias_disadvantaged,
    l2_top_speed: h.l2_top_speed,
    bias_mismatch: h.bias_mismatch,
    pace_mismatch: h.pace_mismatch,
    l2_sustain_ratio: h.l2_sustain_ratio,
    pastRuns: h.pastRuns,
    position_x: h.position_x,
    ...(e.abilities_source === "past_runs_estimated" || h.abilitiesPrecomputedFromPastRuns
      ? { abilities_source: "past_runs_estimated" as const }
      : {}),
    ...(h.aiPredictedWinRate != null ? { aiPredictedWinRate: h.aiPredictedWinRate } : {}),
    ...(h.aiEffectiveEv != null ? { aiEffectiveEv: h.aiEffectiveEv } : {}),
  };
}

function fromAnalysisJsonRoot(doc: AnalysisJsonRoot, raw: Record<string, unknown>): RaceEvaluationData {
  const raceId = String(raw["raceId"] ?? doc.raceId);
  const meta = (raw["meta"] as AnalysisRaceMeta | undefined) ?? doc.meta;
  const pack = mergeMeta(raw, meta);
  const condition = toCondition(raw, pack);
  const raceInfo = toRaceInfo(raceId, pack, raw, meta);
  const entries = (doc.entries ?? (raw["entries"] as AnalysisHorseEntry[])) as AnalysisHorseEntry[];
  const horses: EnrichedRaceHorse[] = entries.map((e) => toEnrichedHorse(e));

  const allPreserved = entries.every((e) => entryHasFullPipelineEval(e));
  if (allPreserved) {
    const gradeRows: Map<string, { speed: string; stamina: string; kick: string; sustain: string; power: string }> = new Map();
    for (const e of entries) {
      const g = e.abilityGrades ?? {};
      gradeRows.set(e.horseId, {
        speed: String(g.speed),
        stamina: String(g.stamina),
        kick: String(g.kick),
        sustain: String(g.sustain),
        power: String(g.power),
      });
    }
    const rOnly = evaluateRace(horses, condition);
    const byRecomputed: Map<string, HorseScoreResult> = new Map(rOnly.map((r) => [r.horseId, r] as const));
    return {
      raceId,
      raceInfo,
      condition,
      entries: entries.map((e, i) => {
        const h = horses[i]!;
        const g = gradeRows.get(e.horseId ?? "")!;
        const w = byRecomputed.get(e.horseId) ?? null;
        return toRaceEntryFromPreserved(h, e, condition, g, w);
      }),
    };
  }

  return buildEvaluationData({ raceId, raceInfo, condition, entries: horses });
}

/**
 * 既存パイプライン `analysisJson` または、すでに UI 向け `RaceEvaluationData` 化済みの JSON から
 * 表示専用 `RaceEvaluationData` へ正規化する。UI から直接は呼ばず Repository 経由を想定。
 */
function needsEvaluationV2Migration(d: RaceEvaluationData): boolean {
  return d.entries.some((e) => {
    const ev = e.evaluation as { baseAbilityCore?: unknown; pastRunInsight?: unknown } | undefined;
    if (ev == null || typeof ev.baseAbilityCore !== "number") return true;
    return typeof ev.pastRunInsight !== "string";
  });
}

/**
 * 既存 JSON の欠損を UI 読み込み時に安全補完する。
 * `frameNumber` が欠けても表示が崩れないよう `horseNumber` から復元する。
 */
function normalizeRaceEvaluationDataForUi(data: RaceEvaluationData): RaceEvaluationData {
  let touched = false;
  const mapped = data.entries.map((entry, idx) => {
    const horseNumberRaw =
      n((entry as RaceEntryEvaluation & { gate?: unknown }).horseNumber) ??
      n((entry as RaceEntryEvaluation & { gate?: unknown }).gate) ??
      idx + 1;
    const horseNumber = clampInt(horseNumberRaw, 1, 36);
    const frameNumberRaw =
      n((entry as RaceEntryEvaluation & { waku?: unknown; wakuNo?: unknown }).frameNumber) ??
      n((entry as RaceEntryEvaluation & { waku?: unknown; wakuNo?: unknown }).waku) ??
      n((entry as RaceEntryEvaluation & { waku?: unknown; wakuNo?: unknown }).wakuNo);
    const frameNumber =
      frameNumberRaw != null
        ? clampInt(frameNumberRaw, 1, 8)
        : inferFrameNumberFromHorseNumber(horseNumber);
    const normalizedPastRuns = Array.isArray(entry.pastRuns) ? entry.pastRuns : [];
    const changed =
      horseNumber !== entry.horseNumber ||
      frameNumber !== entry.frameNumber ||
      normalizedPastRuns !== entry.pastRuns;
    if (!changed) return entry;
    touched = true;
    return {
      ...entry,
      horseNumber,
      frameNumber,
      pastRuns: normalizedPastRuns,
    };
  });

  const sanitized = sanitizeRaceEntriesForUi(mapped);
  if (sanitized !== mapped) touched = true;

  return touched ? { ...data, entries: sanitized } : data;
}

export function convertToRaceEvaluationData(raw: unknown): RaceEvaluationData {
  const un = unwrapAnalysisPayload(raw);
  if (isRaceEvaluationDataShape(un)) {
    const shaped = un as RaceEvaluationData;
    const withSignals: RaceEvaluationData = {
      ...shaped,
      entries: enrichEntryEvaluationSignals(shaped.entries),
    };
    const v = normalizeRaceEvaluationDataForUi(withSignals);
    assertIsRaceEvaluationData(v);
    if (needsEvaluationV2Migration(v)) {
      return recomputeEvaluationData(v);
    }
    return v;
  }
  if (un == null || typeof un !== "object") {
    throw new Error("convertToRaceEvaluationData: オブジェクトが必要です");
  }
  const o = un as Record<string, unknown>;
  const analysis = tryParseAnalysisJsonRoot(un);
  if (analysis == null) {
    throw new Error("convertToRaceEvaluationData: analysisJson 形でも RaceEvaluationData 形でもありません");
  }
  return fromAnalysisJsonRoot(analysis, o);
}
