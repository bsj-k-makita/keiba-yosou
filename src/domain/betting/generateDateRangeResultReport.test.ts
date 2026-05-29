import { describe, expect, test } from "vitest";
import { join } from "node:path";
import { writeDateRangeResultReport } from "./generateDateRangeResultReport";

describe("generateDateRangeResultReport", () => {
  test(
    "writes docs/結果分析-2026-05-23_2026-05-24.md",
    { timeout: 600_000 },
    () => {
      const path = join(process.cwd(), "docs/結果分析-2026-05-23_2026-05-24.md");
      const { path: written, raceCount } = writeDateRangeResultReport(
        ["2026-05-23", "2026-05-24"],
        path,
        "2026年5月23日・24日 レース結果・評価分析",
      );
      expect(raceCount).toBeGreaterThan(0);
      expect(written).toBe(path);
      // eslint-disable-next-line no-console
      console.log(`Wrote ${written} (${raceCount} races)`);
    },
  );
});
