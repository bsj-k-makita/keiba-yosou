import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { runTsVsAiBacktestComparison } from "./runFullBacktest";

describe("runTsVsAiBacktestComparison", () => {
  test(
    "TS印 vs Python AI印の回収率比較サマリを生成",
    { timeout: 600_000 },
    () => {
      const comparison = runTsVsAiBacktestComparison();
      expect(comparison.comparableRaceCount).toBeGreaterThan(0);
      expect(comparison.ts.totalRacesMatched).toBeLessThanOrEqual(comparison.comparableRaceCount);
      expect(comparison.ai.totalRacesMatched).toBeLessThanOrEqual(comparison.comparableRaceCount);
      expect(comparison.ts.totalRacesMatched + comparison.ts.totalRacesSkipped).toBe(
        comparison.comparableRaceCount,
      );

      const outPath = join(process.cwd(), "src/data/backtest_comparison.json");
      writeFileSync(outPath, `${JSON.stringify(comparison, null, 2)}\n`, "utf8");

      // eslint-disable-next-line no-console
      console.log("\n=== TS vs Python AI 回収率比較（同一レース集合）===");
      // eslint-disable-next-line no-console
      console.log(`比較レース数: ${comparison.comparableRaceCount} / 全結果あり ${comparison.totalResultRaceCount}`);
      // eslint-disable-next-line no-console
      console.log(`TS  総回収率: ${comparison.ts.totalRecoveryRate}%`);
      // eslint-disable-next-line no-console
      console.log(`AI  総回収率: ${comparison.ai.totalRecoveryRate}%`);
      // eslint-disable-next-line no-console
      console.log(`差分 (AI−TS): ${(comparison.ai.totalRecoveryRate - comparison.ts.totalRecoveryRate).toFixed(1)} pt`);
      // eslint-disable-next-line no-console
      console.log(`\nWrote ${outPath}`);
    },
  );
});
