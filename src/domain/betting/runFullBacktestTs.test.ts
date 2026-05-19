import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { runFullBettingBacktest } from "./runFullBacktest";

describe("runFullBettingBacktest TS only", () => {
  test(
    "TS印のみの回収率サマリを生成（参考用）",
    { timeout: 300_000 },
    () => {
      const summary = runFullBettingBacktest("ts");
      expect(summary.probabilityEngine).toBe("ts");
      expect(summary.totalRacesMatched).toBeGreaterThan(0);

      const outPath = join(process.cwd(), "src/data/backtest_summary_ts.json");
      writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
      // eslint-disable-next-line no-console
      console.log(`TS 総回収率: ${summary.totalRecoveryRate}% → ${outPath}`);
    },
  );
});
