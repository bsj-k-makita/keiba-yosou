import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { runFullBettingBacktest } from "./runFullBacktest";

describe("runFullBettingBacktest", () => {
  test(
    "結果JSONが揃うレースで回収率サマリを生成",
    { timeout: 300_000 },
    () => {
      const summary = runFullBettingBacktest();
      expect(summary.totalRacesMatched).toBeGreaterThan(0);
      expect(summary.byTicketType.WIN.invested).toBeGreaterThan(0);

      const outPath = join(process.cwd(), "src/data/backtest_summary.json");
      writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(summary, null, 2));
      // eslint-disable-next-line no-console
      console.log(`\nWrote ${outPath}`);
    },
  );
});
