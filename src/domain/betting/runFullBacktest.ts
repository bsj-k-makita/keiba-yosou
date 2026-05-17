import { convertToRaceEvaluationData } from "../../lib/race-data/convertToRaceEvaluationData";
import { getHorsesFromRaceData } from "../../lib/race-data/raceDataRepository";
import type { RaceCondition } from "../race-evaluation/abilityTypes";
import type { RaceInfo } from "../../lib/race-data/raceEvaluationTypes";
import { runBacktestOnRace, aggregateBacktest, type BacktestRaceInput, type BacktestRaceOutput } from "./runBacktest";
import type { BacktestSummary } from "./types";

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

/** 結果JSONとレースJSONが揃う分だけバックテスト行を集計 */
export function collectBacktestOutputs(): BacktestRaceOutput[] {
  const outputs: BacktestRaceOutput[] = [];

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

    const out = runBacktestOnRace(input);
    if (out) outputs.push(out);
  }

  return outputs;
}

export function runFullBettingBacktest(): BacktestSummary {
  return aggregateBacktest(collectBacktestOutputs());
}
