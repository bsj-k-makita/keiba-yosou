import { describe, expect, it } from "vitest";
import { convertToRaceEvaluationData } from "../../lib/race-data/convertToRaceEvaluationData";
import { getHorsesFromRaceData } from "../../lib/race-data/raceDataRepository";
import { runRaceEvaluationPipeline } from "../../lib/pipeline/evaluationPipeline";
import {
  buildRaceBettingContextFromPipeline,
  buildTicketsCopyText,
} from "./buildRaceBettingContext";
import { collectBacktestRaceInputs } from "./runFullBacktest";
import { runBacktestOnRace } from "./runBacktest";

const raceLoaders = import.meta.glob<{ default: unknown }>("../../data/races/202603010605.json", {
  eager: true,
});

function comboKey(
  tickets: readonly { ticketType: string; combinations: readonly (readonly number[])[] }[],
): string {
  return tickets
    .map((t) => `${t.ticketType}:${t.combinations.map((c) => c.join("-")).sort().join("|")}`)
    .sort()
    .join("\n");
}

describe("BT vs UI betting alignment", () => {
  it("202603010605 uses same pipeline path for marks and EV tickets", () => {
    const raw = Object.values(raceLoaders)[0]!.default;
    const data = convertToRaceEvaluationData(raw);
    const horses = getHorsesFromRaceData(data);
    const condition = {
      ...(data.condition ?? {
        venue: data.raceInfo.venue,
        meetingDate: data.raceInfo.date,
        raceName: data.raceInfo.raceName,
        surface: data.raceInfo.surface,
        distance: data.raceInfo.distance,
        ground: "good" as const,
        bias: "flat" as const,
        pace: "middle" as const,
        adjustmentStrength: "middle" as const,
      }),
      raceName: data.condition?.raceName ?? data.raceInfo.raceName,
      raceGrade: data.condition?.raceGrade ?? data.raceInfo.raceGrade,
      netkeibaGradeType: data.condition?.netkeibaGradeType ?? data.raceInfo.netkeibaGradeType,
    };

    const engine = "ts" as const;
    const pipeline = runRaceEvaluationPipeline(horses, condition, { probabilityEngine: engine });
    const uiCtx = buildRaceBettingContextFromPipeline(pipeline, horses, condition, 100);

    const input = collectBacktestRaceInputs().find((i) => i.raceId === "202603010605");
    expect(input).toBeDefined();
    const bt = runBacktestOnRace(input!, { probabilityEngine: engine });
    expect(bt).not.toBeNull();
    expect(uiCtx).not.toBeNull();

    const uiMarks = uiCtx!.marks.map((m) => `${m.horseNumber}${m.mark}`).sort().join(",");
    const btMarks = Object.entries(bt!.detail.aiMarks ?? {})
      .map(([n, m]) => `${n}${m}`)
      .sort()
      .join(",");

    expect(uiMarks).toBe(btMarks);

    const uiInvested = uiCtx!.evTickets.reduce((s, t) => s + t.combinations.length * t.betAmount, 0);
    expect(bt!.result.totalInvested).toBe(uiInvested);
    expect(comboKey(uiCtx!.evTickets)).toBe(
      comboKey(
        uiCtx!.evTickets.map((t) => ({
          ticketType: t.ticketType,
          combinations: t.combinations,
        })),
      ),
    );

    // eslint-disable-next-line no-console
    console.log("\n4/26 福島5R EV tickets (UI=BT):\n", buildTicketsCopyText(uiCtx!));
  });
});
