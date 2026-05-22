import { describe, expect, it } from "vitest";
import type { HorseAbility, HorseScoreResult } from "../../domain/race-evaluation/abilityTypes";
import {
  AI_MARK_SLOTS,
  applyAiMarksByEffectiveEv,
  raceHasFullAiBackfill,
  sortResultsForAiDisplay,
} from "./aiMarkAssignment";

function horse(id: string, ev: number, rate = 0.1): HorseAbility {
  return {
    horseId: id,
    horseName: id,
    runningStyle: "先行",
    speed: 50,
    stamina: 50,
    kick: 50,
    sustain: 50,
    power: 50,
    aiPredictedWinRate: rate,
    aiEffectiveEv: ev,
  };
}

function row(id: string, score: number): HorseScoreResult {
  return {
    horseId: id,
    horseName: id,
    baseScore: score,
    adjustedScore: score,
    scoreDiff: 0,
    finalEvaluationScore: score,
    finalRank: 1,
    mark: "",
    buyLabel: "見送り",
  } as unknown as HorseScoreResult;
}

describe("aiMarkAssignment", () => {
  it("raceHasFullAiBackfill requires all horses", () => {
    expect(raceHasFullAiBackfill([horse("a", 1.2)])).toBe(true);
    expect(raceHasFullAiBackfill([horse("a", 1.2), { ...horse("b", 1.1), aiEffectiveEv: undefined }])).toBe(
      false,
    );
  });

  it("applyAiMarksByEffectiveEv assigns ◎○▲☆△△△ to top 7 by ev", () => {
    expect(AI_MARK_SLOTS).toEqual(["◎", "○", "▲", "☆", "△", "△", "△"]);
    const horses = [
      horse("h1", 0.1),
      horse("h2", 0.2),
      horse("h3", 0.3),
      horse("h4", 0.4),
      horse("h5", 0.5),
      horse("h6", 0.6),
      horse("h7", 0.7),
      horse("top", 1.8, 0.3),
    ];
    const results = applyAiMarksByEffectiveEv(
      horses.map((h, i) => row(h.horseId, 100 - i)),
      horses,
    );
    expect(results.find((r) => r.horseId === "top")?.mark).toBe("◎");
    expect(results.filter((r) => r.mark === "△")).toHaveLength(3);
    expect(results.find((r) => r.horseId === "h1")?.mark).toBe("");
  });

  it("sortResultsForAiDisplay orders by mark not ev", () => {
    const horses = [horse("a", 0.2), horse("b", 1.5), horse("c", 1.0)];
    const marked = applyAiMarksByEffectiveEv([row("a", 1), row("b", 2), row("c", 3)], horses);
    const sorted = sortResultsForAiDisplay(marked, ["b", "c", "a"]);
    expect(sorted.map((r) => r.mark)).toEqual(["◎", "○", "▲"]);
    expect(sorted.map((r) => r.horseId)).toEqual(["b", "c", "a"]);
  });

  it("G1 uses hybrid score (ev + finalEvaluationScore blend)", () => {
    const horses = [horse("ev_top", 1.0), horse("ability_top", 0.99)];
    const results = applyAiMarksByEffectiveEv(
      [row("ev_top", 40), row("ability_top", 99)],
      horses,
      { venue: "東京", ground: "良", bias: "flat", pace: "middle", adjustmentStrength: "middle", raceGrade: "G1" },
    );
    expect(results.find((r) => r.horseId === "ability_top")?.mark).toBe("◎");
  });

  it("勝率8%未満の馬は◎にならず、条件を満たす馬が◎になる", () => {
    const horses = [
      horse("longshot", 2.2, 0.03),
      horse("solid", 1.4, 0.11),
      horse("other", 1.1, 0.1),
    ];
    const results = applyAiMarksByEffectiveEv(
      [row("longshot", 95), row("solid", 80), row("other", 70)],
      horses,
    );
    expect(results.find((r) => r.horseId === "longshot")?.mark).not.toBe("◎");
    expect(results.find((r) => r.horseId === "solid")?.mark).toBe("◎");
  });

  it("全頭が勝率8%未満でも◎は必ず1頭に付与される", () => {
    const horses = [horse("ev_top", 2.0, 0.07), horse("second", 1.4, 0.06), horse("third", 1.1, 0.05)];
    const results = applyAiMarksByEffectiveEv(
      [row("ev_top", 95), row("second", 80), row("third", 70)],
      horses,
    );
    expect(results.find((r) => r.horseId === "ev_top")?.mark).toBe("◎");
    expect(results.filter((r) => r.mark === "◎")).toHaveLength(1);
  });
});
