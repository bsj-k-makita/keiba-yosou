import { describe, expect, it } from "vitest";
import type { HorseAbility, HorseScoreResult } from "./abilityTypes";
import {
  analyzeMarkHits,
  buildTop3WinnerIds,
  pickMarkedHorses,
  resolvePlaceToHorseId,
  sortResultsForPredictionTable,
} from "./markHitAnalysis";

function horse(id: string, name: string, gate: number): HorseAbility & { gate: number } {
  return {
    horseId: id,
    horseName: name,
    gate,
    runningStyle: "先行",
    speed: 50,
    stamina: 50,
    kick: 50,
    sustain: 50,
    power: 50,
  };
}

function resultRow(id: string, name: string, mark: string): HorseScoreResult {
  return {
    horseId: id,
    horseName: name,
    mark,
  } as unknown as HorseScoreResult;
}

describe("resolvePlaceToHorseId", () => {
  const horses = [horse("a", "テスト馬", 5)];

  it("matches by horseId", () => {
    expect(resolvePlaceToHorseId({ place: 1, horseId: "a" }, horses)).toBe("a");
  });

  it("matches by horseName when id mismatches", () => {
    expect(
      resolvePlaceToHorseId({ place: 1, horseId: "wrong", horseName: "テスト馬" }, horses),
    ).toBe("a");
  });

  it("matches by horseNumber when id empty", () => {
    expect(resolvePlaceToHorseId({ place: 1, horseNumber: 5, horseName: "他" }, horses)).toBe("a");
  });
});

describe("analyzeMarkHits", () => {
  const horses = [
    horse("1", "本命", 1),
    horse("2", "対抗", 2),
    horse("3", "単穴", 3),
    horse("9", "凡走", 9),
  ];
  const results = [
    resultRow("1", "本命", "◎"),
    resultRow("2", "対抗", "○"),
    resultRow("3", "単穴", "▲"),
    resultRow("9", "凡走", ""),
  ];

  it("marks ◎ as hit when winner id matches", () => {
    const { rows } = analyzeMarkHits(
      [{ place: 1, horseId: "1" }, { place: 2, horseId: "x" }, { place: 3, horseId: "y" }],
      results,
      horses,
    );
    expect(rows.find((r) => r.mark === "◎")?.hit).toBe(true);
    expect(rows.find((r) => r.mark === "○")?.hit).toBe(false);
  });

  it("resolves winner by name when result id is stale", () => {
    const winners = buildTop3WinnerIds(
      [{ place: 1, horseId: "stale", horseName: "本命" }],
      horses,
    );
    expect(winners.has("1")).toBe(true);
    const { rows } = analyzeMarkHits(
      [{ place: 1, horseId: "stale", horseName: "本命" }],
      results,
      horses,
    );
    expect(rows.find((r) => r.mark === "◎")?.hit).toBe(true);
  });

  it("pickMarkedHorses returns one row per mark", () => {
    expect(pickMarkedHorses(results, horses).map((p) => p.mark)).toEqual(["◎", "○", "▲"]);
  });
});

describe("sortResultsForPredictionTable", () => {
  it("puts marked horses before unmarked in mark order", () => {
    const rows = [
      resultRow("9", "凡走", ""),
      resultRow("1", "本命", "◎"),
      resultRow("3", "単穴", "▲"),
      resultRow("2", "対抗", "○"),
    ];
    const sorted = sortResultsForPredictionTable(rows, ["9", "1", "2", "3"]);
    expect(sorted.map((r) => r.mark)).toEqual(["◎", "○", "▲", ""]);
  });
});
