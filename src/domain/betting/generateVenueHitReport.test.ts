import { describe, expect, test } from "vitest";
import { writeVenueHitReport } from "./generateVenueHitReport";

describe("generateVenueHitReport", () => {
  test(
    "writes docs/競馬場別的中実績.md from AI backtest",
    { timeout: 600_000 },
    () => {
      const { path, raceCount } = writeVenueHitReport();
      expect(raceCount).toBeGreaterThan(0);
      // eslint-disable-next-line no-console
      console.log(`Wrote ${path} (${raceCount} races)`);
    },
  );
});
