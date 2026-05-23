import { describe, expect, it } from "vitest";
import type { RaceEvaluationData } from "../../lib/race-data/raceEvaluationTypes";
import {
  computeRaceMaxEvFromEvaluation,
  fetchWeeklyTopEvRaces,
  filterRacesInWeek,
  filterUnconfirmedUpcomingRaces,
  filterUpcomingRacesInCalendarWeek,
  formatUpcomingWeekScopeLabel,
  getWeekDateRange,
} from "./weeklyTopEvRaces";

describe("weeklyTopEvRaces", () => {
  it("getWeekDateRange は月曜〜日曜", () => {
    expect(getWeekDateRange("2026-05-24")).toEqual({
      start: "2026-05-18",
      end: "2026-05-24",
    });
  });

  it("filterUpcomingRacesInCalendarWeek は今日以降の当週開催のみ", () => {
    const rows = [
      { raceId: "a", date: "2026-05-17", venue: "東京", raceNumber: 1, surface: "芝" as const, distance: 1600 },
      { raceId: "b", date: "2026-05-23", venue: "東京", raceNumber: 2, surface: "芝" as const, distance: 1600 },
      { raceId: "c", date: "2026-05-24", venue: "京都", raceNumber: 3, surface: "芝" as const, distance: 1600 },
      { raceId: "d", date: "2026-05-31", venue: "東京", raceNumber: 4, surface: "芝" as const, distance: 1600 },
    ];
    const filtered = filterUpcomingRacesInCalendarWeek(rows, "2026-05-20");
    expect(filtered.map((r) => r.raceId)).toEqual(["b", "c"]);
    expect(formatUpcomingWeekScopeLabel(rows, "2026-05-20")).toBe("05/23〜05/24");
  });

  it("filterRacesInWeek は当週のみ", () => {
    const rows = [
      { raceId: "a", date: "2026-05-17", venue: "東京", raceNumber: 1, surface: "芝" as const, distance: 1600 },
      { raceId: "b", date: "2026-05-23", venue: "東京", raceNumber: 2, surface: "芝" as const, distance: 1600 },
      { raceId: "c", date: "2026-05-25", venue: "東京", raceNumber: 3, surface: "芝" as const, distance: 1600 },
    ];
    const filtered = filterRacesInWeek(rows, "2026-05-24");
    expect(filtered.map((r) => r.raceId)).toEqual(["b"]);
  });

  it("computeRaceMaxEvFromEvaluation は Python AI ◎（ai_effective_ev 1位）を返す", () => {
    const data = {
      raceId: "x",
      raceInfo: {
        raceId: "x",
        date: "2026-05-24",
        venue: "京都",
        raceNumber: 10,
        surface: "芝" as const,
        distance: 1200,
      },
      condition: {} as RaceEvaluationData["condition"],
      entries: [
        {
          horseId: "1",
          horseName: "低EV",
          horseNumber: 1,
          frameNumber: 1,
          sex: "牡",
          age: 4,
          jockey: "A",
          trainer: "B",
          weight: 57,
          runningStyle: "先行",
          abilities: { speed: 50, stamina: 50, kick: 50, sustain: 50, power: 50 },
          abilityGrades: {
            speed: "C",
            stamina: "C",
            kick: "C",
            sustain: "C",
            power: "C",
          },
          aiPredictedWinRate: 0.1,
          aiEffectiveEv: 0.5,
          evaluationSignals: { winOdds: 5 },
          evaluation: { finalEvaluationScore: 10 } as RaceEvaluationData["entries"][0]["evaluation"],
        },
        {
          horseId: "2",
          horseName: "本命",
          horseNumber: 2,
          frameNumber: 1,
          sex: "牡",
          age: 4,
          jockey: "騎手B",
          trainer: "B",
          weight: 57,
          runningStyle: "先行",
          abilities: { speed: 50, stamina: 50, kick: 50, sustain: 50, power: 50 },
          abilityGrades: {
            speed: "C",
            stamina: "C",
            kick: "C",
            sustain: "C",
            power: "C",
          },
          aiPredictedWinRate: 0.08,
          aiEffectiveEv: 1.2,
          evaluationSignals: { winOdds: 20 },
          evaluation: { finalEvaluationScore: 5 } as RaceEvaluationData["entries"][0]["evaluation"],
        },
      ],
    } satisfies RaceEvaluationData;

    const peak = computeRaceMaxEvFromEvaluation(data);
    expect(peak?.bestHorseName).toBe("本命");
    expect(peak?.bestHorseJockey).toBe("騎手B");
    expect(peak?.maxEv).toBe(1.2);
    expect(peak?.valueRank).toBe("C");
  });

  it("filterUnconfirmedUpcomingRaces は結果確定済みを除外する", async () => {
    const rows = [
      { raceId: "done", date: "2026-05-23", venue: "東京", raceNumber: 1, surface: "芝" as const, distance: 1600 },
      { raceId: "open", date: "2026-05-24", venue: "京都", raceNumber: 2, surface: "芝" as const, distance: 1600 },
    ];
    const filtered = await filterUnconfirmedUpcomingRaces(rows, "2026-05-23", async (raceId) =>
      raceId === "done"
        ? {
            raceId,
            fetchedAt: "2026-05-23T12:00:00.000Z",
            places: [
              { place: 1, horseId: "1", horseName: "A" },
              { place: 2, horseId: "2", horseName: "B" },
              { place: 3, horseId: "3", horseName: "C" },
            ],
          }
        : null,
    );
    expect(filtered.map((r) => r.raceId)).toEqual(["open"]);
  });

  it("fetchWeeklyTopEvRaces は結果確定済みをTOP5から除外する", async () => {
    const rows = [
      { raceId: "done", date: "2026-05-23", venue: "東京", raceNumber: 1, surface: "芝" as const, distance: 1600 },
      { raceId: "open", date: "2026-05-24", venue: "京都", raceNumber: 2, surface: "芝" as const, distance: 1600 },
    ];
    const evalData = {
      raceId: "open",
      raceInfo: {
        raceId: "open",
        date: "2026-05-24",
        venue: "京都",
        raceNumber: 2,
        surface: "芝" as const,
        distance: 1600,
      },
      condition: {} as RaceEvaluationData["condition"],
      entries: [
        {
          horseId: "1",
          horseName: "本命",
          horseNumber: 1,
          frameNumber: 1,
          sex: "牡",
          age: 4,
          jockey: "A",
          trainer: "B",
          weight: 57,
          runningStyle: "先行",
          abilities: { speed: 50, stamina: 50, kick: 50, sustain: 50, power: 50 },
          abilityGrades: {
            speed: "C",
            stamina: "C",
            kick: "C",
            sustain: "C",
            power: "C",
          },
          aiPredictedWinRate: 0.1,
          aiEffectiveEv: 1.5,
          evaluationSignals: { winOdds: 10 },
          evaluation: { finalEvaluationScore: 10 } as RaceEvaluationData["entries"][0]["evaluation"],
        },
      ],
    } satisfies RaceEvaluationData;

    const top = await fetchWeeklyTopEvRaces(
      rows,
      "2026-05-23",
      async (raceId) => (raceId === "open" ? evalData : null),
      5,
      async (raceId) =>
        raceId === "done"
          ? {
              raceId,
              fetchedAt: "2026-05-23T12:00:00.000Z",
              places: [
                { place: 1, horseId: "1", horseName: "A" },
                { place: 2, horseId: "2", horseName: "B" },
                { place: 3, horseId: "3", horseName: "C" },
              ],
            }
          : null,
    );
    expect(top.map((t) => t.raceId)).toEqual(["open"]);
  });
});
