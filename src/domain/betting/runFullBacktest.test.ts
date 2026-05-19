import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  collectRaceDetailsForHitList,
  runFullBettingBacktest,
  runTsVsAiBacktestComparison,
} from "./runFullBacktest";

describe("runFullBettingBacktest", () => {
  test(
    "結果JSONが揃うレースで Python AI 回収率サマリを生成",
    { timeout: 600_000 },
    () => {
      const summary = runFullBettingBacktest("ai");
      expect(summary.probabilityEngine).toBe("ai");
      expect(summary.totalRacesMatched).toBeGreaterThan(0);
      expect(summary.byTicketType.WIN.invested).toBeGreaterThan(0);

      const raceDetailsForHitList = collectRaceDetailsForHitList();
      expect(raceDetailsForHitList.length).toBeGreaterThanOrEqual(summary.totalRacesMatched);
      for (const id of [
        "202608030711",
        "202604010506",
        "202608030803",
        "202604010604",
        "202604010611",
      ]) {
        expect(raceDetailsForHitList.some((r) => r.raceId === id)).toBe(true);
      }

      const comparison = runTsVsAiBacktestComparison();

      const summaryPath = join(process.cwd(), "src/data/backtest_summary.json");
      const comparePath = join(process.cwd(), "src/data/backtest_comparison.json");
      writeFileSync(
        summaryPath,
        `${JSON.stringify({ ...summary, raceDetailsForHitList }, null, 2)}\n`,
        "utf8",
      );
      writeFileSync(comparePath, `${JSON.stringify(comparison, null, 2)}\n`, "utf8");

      // eslint-disable-next-line no-console
      console.log(
        `\nPython AI: ${summary.totalRecoveryRate}% (${summary.totalRacesMatched}R / 全${summary.totalResultRaceCount ?? "?"}R)`,
      );
      // eslint-disable-next-line no-console
      console.log(`Wrote ${summaryPath}`);
      // eslint-disable-next-line no-console
      console.log(`Wrote ${comparePath}`);
    },
  );
});
