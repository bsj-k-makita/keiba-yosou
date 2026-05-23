import { describe, expect, it } from "vitest";
import {
  aggregateVenueDistanceStats,
  classifyRecoveryZone,
  filterByMinRaces,
} from "./aggregateVenueDistanceStats";
import type { RaceDetailLog } from "./types";

function detail(partial: Partial<RaceDetailLog> & Pick<RaceDetailLog, "raceId" | "venue">): RaceDetailLog {
  return {
    raceName: "テスト",
    classTier: "MAIDEN_NEW",
    classTierLabel: "未勝利",
    raceNumber: 1,
    date: "2026-05-23",
    actualResults: [1, 2, 3],
    finishLabel: "",
    aiMarks: { "1": "◎" },
    tickets: {} as RaceDetailLog["tickets"],
    totalInvested: 1000,
    totalPayout: 0,
    dominantComment: "",
    isAnchorHit: false,
    isSecondRowDead: false,
    diagnosisLabel: "",
    ...partial,
  };
}

describe("aggregateVenueDistanceStats", () => {
  it("競馬場×距離×芝ダで集計する", () => {
    const details = [
      detail({ raceId: "a", venue: "東京", totalPayout: 3000, isAnchorHit: true }),
      detail({ raceId: "b", venue: "東京", totalInvested: 0, totalPayout: 0 }),
      detail({ raceId: "c", venue: "中山", totalPayout: 0 }),
    ];
    const index = [
      { raceId: "a", date: "2026-05-23", venue: "東京", raceNumber: 1, surface: "芝" as const, distance: 1600 },
      { raceId: "b", date: "2026-05-23", venue: "東京", raceNumber: 2, surface: "芝" as const, distance: 1600 },
      { raceId: "c", date: "2026-05-23", venue: "中山", raceNumber: 1, surface: "ダート" as const, distance: 1800 },
    ];
    const agg = aggregateVenueDistanceStats(details, index);
    expect(agg.byVenue.find((r) => r.venue === "東京")?.recoveryRate).toBe(300);
    expect(agg.byVenueDistanceSurface.some((r) => r.key.includes("1600m"))).toBe(true);
    expect(filterByMinRaces(agg.byVenueDistanceSurface, 2)).toHaveLength(1);
  });

  it("classifyRecoveryZone", () => {
    expect(classifyRecoveryZone(200, 5)).toBe("strong");
    expect(classifyRecoveryZone(80, 5)).toBe("caution");
    expect(classifyRecoveryZone(30, 5)).toBe("weak");
    expect(classifyRecoveryZone(120, 0)).toBe("neutral");
  });
});
