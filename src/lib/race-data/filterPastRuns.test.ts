import { describe, expect, it } from "vitest";
import { filterPastRunsForCurrentRace } from "./filterPastRuns";

describe("filterPastRunsForCurrentRace", () => {
  it("removes past run rows for the current raceId", () => {
    const filtered = filterPastRunsForCurrentRace(
      [
        { date: "2026-04-26", raceId: "202603010605", place: 6 },
        { date: "2026-03-29", raceId: "202606030204", place: 3 },
      ],
      "202603010605",
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.raceId).toBe("202606030204");
  });
});
