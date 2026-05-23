import { convertToRaceEvaluationData } from "../../lib/race-data/convertToRaceEvaluationData";
import { getHorsesFromRaceData } from "../../lib/race-data/raceDataRepository";
import type { RaceCondition } from "../race-evaluation/abilityTypes";
import type { RaceInfo } from "../../lib/race-data/raceEvaluationTypes";
import { raceHasFullAiBackfill } from "../../lib/pipeline/aiMarkAssignment";
import {
  DEFAULT_PROBABILITY_ENGINE,
  type ProbabilityEngine,
} from "../../lib/pipeline/probabilityEngine";
import {
  runBacktestOnRace,
  aggregateBacktest,
  type BacktestRaceInput,
  type BacktestRaceOutput,
} from "./runBacktest";
import type {
  AnchorHonmeiBacktestComparison,
  BacktestEngineComparison,
  BacktestSummary,
  RaceDetailLog,
} from "./types";
import type { AnchorHonmeiWinRateRule } from "../../lib/pipeline/probabilityEngine";
import { BET_TICKET_TYPES } from "./types";

const raceJsonLoaders = import.meta.glob<{ default: unknown }>("../../data/races/*.json", {
  eager: true,
});
const resultJsonLoaders = import.meta.glob<{ default: unknown }>("../../data/results/*.json", {
  eager: true,
});

function defaultCondition(info: RaceInfo): RaceCondition {
  return {
    venue: info.venue,
    meetingDate: info.date,
    raceName: info.raceName,
    ...(info.raceGrade != null ? { raceGrade: info.raceGrade } : {}),
    ...(info.netkeibaGradeType != null ? { netkeibaGradeType: info.netkeibaGradeType } : {}),
    surface: info.surface,
    distance: info.distance,
    ground: "good",
    bias: "flat",
    pace: "middle",
    adjustmentStrength: "middle",
    paceInference: "auto",
  };
}

function raceIdFromGlobKey(key: string): string {
  const m = key.match(/\/([^/]+)\.json$/);
  return m?.[1] ?? "";
}

/** 結果JSONとレースJSONが揃う入力を列挙 */
export function collectBacktestRaceInputs(): BacktestRaceInput[] {
  const inputs: BacktestRaceInput[] = [];

  for (const [resultKey, resultMod] of Object.entries(resultJsonLoaders)) {
    const raceId = raceIdFromGlobKey(resultKey);
    if (!raceId) continue;
    const raceKey = Object.keys(raceJsonLoaders).find((k) => k.endsWith(`/${raceId}.json`));
    if (!raceKey) continue;

    const raw = raceJsonLoaders[raceKey]!.default;
    const resultRaw = resultMod.default as {
      places?: BacktestRaceInput["places"];
      payouts?: BacktestRaceInput["payouts"];
    };
    const data = convertToRaceEvaluationData(raw);
    const horses = getHorsesFromRaceData(data);
    const info = data.raceInfo;

    const input: BacktestRaceInput = {
      raceId,
      meta: {
        date: info.date,
        venue: info.venue,
        raceNumber: info.raceNumber,
        raceName: info.raceName,
        surface: info.surface,
        distance: info.distance,
        raceGrade: info.raceGrade,
      },
      condition: {
        ...(data.condition ?? defaultCondition(info)),
        raceName: data.condition?.raceName ?? info.raceName,
        raceGrade: data.condition?.raceGrade ?? info.raceGrade,
        netkeibaGradeType: data.condition?.netkeibaGradeType ?? info.netkeibaGradeType,
      },
      horses,
      places: resultRaw.places ?? [],
      payouts: resultRaw.payouts,
    };

    inputs.push(input);
  }

  return inputs;
}

/** 結果JSONとレースJSONが揃う分だけバックテスト行を集計 */
export function collectBacktestOutputs(
  engine: ProbabilityEngine = DEFAULT_PROBABILITY_ENGINE,
  inputs?: readonly BacktestRaceInput[],
): BacktestRaceOutput[] {
  const list = inputs ?? collectBacktestRaceInputs();
  const outputs: BacktestRaceOutput[] = [];

  for (const input of list) {
    const out = runBacktestOnRace(input, { probabilityEngine: engine });
    if (out) outputs.push(out);
  }

  return outputs;
}

/**
 * 「的中レース」一覧用: 結果JSONがある全レースを返す。
 * 全頭AIバックフィル済みなら AI 印、1頭でも欠けていれば TS 印で再計算（集計サマリの96Rとは別）。
 */
export function collectRaceDetailsForHitList(): RaceDetailLog[] {
  const allInputs = collectBacktestRaceInputs();
  const outputs: BacktestRaceOutput[] = [];

  for (const input of allInputs) {
    const engine: ProbabilityEngine = raceHasFullAiBackfill(input.horses) ? "ai" : "ts";
    const out = runBacktestOnRace(input, { probabilityEngine: engine });
    if (out) outputs.push(out);
  }

  return outputs.map((o) => o.detail);
}

/**
 * 回収率バックテストの集計。
 * 既定は Python AI（方針B: ai_effective_ev 順の ◎○▲☆△△△）。AI 未バックフィルレースは除外。
 */
export function runFullBettingBacktest(
  engine: ProbabilityEngine = DEFAULT_PROBABILITY_ENGINE,
): BacktestSummary {
  const allInputs = collectBacktestRaceInputs();
  if (engine === "ai") {
    const aiReadyInputs = allInputs.filter((inp) => raceHasFullAiBackfill(inp.horses));
    const summary = runFullBettingBacktestOnInputs("ai", aiReadyInputs);
    return {
      ...summary,
      probabilityEngine: "ai",
      totalResultRaceCount: allInputs.length,
    };
  }
  const summary = aggregateBacktest(collectBacktestOutputs(engine, allInputs));
  return { ...summary, probabilityEngine: engine, totalResultRaceCount: allInputs.length };
}

/**
 * TS印と Python AI印（方針B）の回収率を、同一の AI バックフィル済みレース集合で比較する。
 */
export function runTsVsAiBacktestComparison(): BacktestEngineComparison {
  const allInputs = collectBacktestRaceInputs();
  const aiReadyInputs = allInputs.filter((inp) => raceHasFullAiBackfill(inp.horses));

  const ts = runFullBettingBacktestOnInputs("ts", aiReadyInputs);
  const ai = runFullBettingBacktestOnInputs("ai", aiReadyInputs);

  const recoveryRateDeltaByTicket = Object.fromEntries(
    BET_TICKET_TYPES.map((t) => [t, ai.byTicketType[t].rate - ts.byTicketType[t].rate]),
  ) as BacktestEngineComparison["recoveryRateDeltaByTicket"];

  return {
    generatedAt: new Date().toISOString(),
    comparableRaceCount: aiReadyInputs.length,
    totalResultRaceCount: allInputs.length,
    ts,
    ai,
    recoveryRateDeltaByTicket,
  };
}

function runFullBettingBacktestOnInputs(
  engine: ProbabilityEngine,
  inputs: readonly BacktestRaceInput[],
): BacktestSummary {
  const summary = aggregateBacktest(collectBacktestOutputs(engine, inputs));
  return { ...summary, probabilityEngine: engine };
}

function collectBacktestOutputsWithAnchorRule(
  inputs: readonly BacktestRaceInput[],
  anchorHonmeiWinRateRule: AnchorHonmeiWinRateRule,
): BacktestRaceOutput[] {
  const outputs: BacktestRaceOutput[] = [];
  for (const input of inputs) {
    const out = runBacktestOnRace(input, {
      probabilityEngine: "ai",
      anchorHonmeiWinRateRule,
    });
    if (out) outputs.push(out);
  }
  return outputs;
}

/**
 * AIモード（方針B・EV馬券）のまま、◎の勝率8%ルールだけ AI勝率 vs TS勝率×TS期待値で比較する。
 */
export function runAnchorHonmeiBacktestComparison(): AnchorHonmeiBacktestComparison {
  const allInputs = collectBacktestRaceInputs();
  const aiReadyInputs = allInputs.filter((inp) => raceHasFullAiBackfill(inp.horses));

  const aiOutputs = collectBacktestOutputsWithAnchorRule(aiReadyInputs, "ai");
  const tsOutputs = collectBacktestOutputsWithAnchorRule(aiReadyInputs, "ts");

  const aiAnchor = aggregateBacktest(aiOutputs);
  const tsAnchor = aggregateBacktest(tsOutputs);

  const recoveryRateDeltaByTicket = Object.fromEntries(
    BET_TICKET_TYPES.map((t) => [t, tsAnchor.byTicketType[t].rate - aiAnchor.byTicketType[t].rate]),
  ) as AnchorHonmeiBacktestComparison["recoveryRateDeltaByTicket"];

  let honmeiDisagreementRaces = 0;
  let aiAnchorHonmeiWinHits = 0;
  let tsAnchorHonmeiWinHits = 0;
  let aiAnchorHonmeiShowHits = 0;
  let tsAnchorHonmeiShowHits = 0;

  function honmeiGate(aiMarks: Record<string, string>): number | undefined {
    const entry = Object.entries(aiMarks).find(([, mark]) => mark === "◎");
    if (entry == null) return undefined;
    const gate = Number(entry[0]);
    return Number.isFinite(gate) ? gate : undefined;
  }

  for (let i = 0; i < aiOutputs.length; i++) {
    const aiOut = aiOutputs[i]!;
    const tsOut = tsOutputs[i]!;
    const aiHonmei = honmeiGate(aiOut.detail.aiMarks);
    const tsHonmei = honmeiGate(tsOut.detail.aiMarks);
    if (aiHonmei != null && tsHonmei != null && aiHonmei !== tsHonmei) {
      honmeiDisagreementRaces += 1;
    }
    if (aiOut.result.favoriteWinHit === true) aiAnchorHonmeiWinHits += 1;
    if (tsOut.result.favoriteWinHit === true) tsAnchorHonmeiWinHits += 1;
    if (aiOut.result.favoriteShowHit === true) aiAnchorHonmeiShowHits += 1;
    if (tsOut.result.favoriteShowHit === true) tsAnchorHonmeiShowHits += 1;
  }

  return {
    generatedAt: new Date().toISOString(),
    comparableRaceCount: aiReadyInputs.length,
    totalResultRaceCount: allInputs.length,
    aiAnchor: { ...aiAnchor, probabilityEngine: "ai" },
    tsAnchor: { ...tsAnchor, probabilityEngine: "ai" },
    recoveryRateDeltaByTicket,
    honmeiDisagreementRaces,
    aiAnchorHonmeiWinHits,
    tsAnchorHonmeiWinHits,
    aiAnchorHonmeiShowHits,
    tsAnchorHonmeiShowHits,
  };
}
