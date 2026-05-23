import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { runAnchorHonmeiBacktestComparison } from "./runFullBacktest";

describe("runAnchorHonmeiBacktestComparison", () => {
  test(
    "◎勝率8%ルール AI vs TS の回収率比較サマリを生成",
    { timeout: 600_000 },
    () => {
      const comparison = runAnchorHonmeiBacktestComparison();
      expect(comparison.comparableRaceCount).toBeGreaterThan(0);
      expect(comparison.aiAnchor.totalRacesMatched + comparison.aiAnchor.totalRacesSkipped).toBe(
        comparison.comparableRaceCount,
      );
      expect(comparison.tsAnchor.totalRacesMatched).toBeGreaterThan(0);

      const outPath = join(process.cwd(), "src/data/backtest_anchor_honmei_comparison.json");
      writeFileSync(outPath, `${JSON.stringify(comparison, null, 2)}\n`, "utf8");

      const aiRate = comparison.aiAnchor.totalRecoveryRate;
      const tsRate = comparison.tsAnchor.totalRecoveryRate;
      const delta = tsRate - aiRate;
      const n = comparison.comparableRaceCount;
      const aiWinPct = ((comparison.aiAnchorHonmeiWinHits / n) * 100).toFixed(1);
      const tsWinPct = ((comparison.tsAnchorHonmeiWinHits / n) * 100).toFixed(1);

      // eslint-disable-next-line no-console
      console.log("\n=== ◎勝率8%ルール比較（AIモード・同一レース集合）===");
      // eslint-disable-next-line no-console
      console.log(`比較レース数: ${n} / 全結果あり ${comparison.totalResultRaceCount}`);
      // eslint-disable-next-line no-console
      console.log(`◎不一致レース: ${comparison.honmeiDisagreementRaces} (${((comparison.honmeiDisagreementRaces / n) * 100).toFixed(1)}%)`);
      // eslint-disable-next-line no-console
      console.log(
        `AI勝率◎  総回収率: ${aiRate}%  投資R: ${comparison.aiAnchor.totalRacesMatched}  ◎単勝的中: ${comparison.aiAnchorHonmeiWinHits}/${n} (${aiWinPct}%)`,
      );
      // eslint-disable-next-line no-console
      console.log(
        `TS勝率◎  総回収率: ${tsRate}%  投資R: ${comparison.tsAnchor.totalRacesMatched}  ◎単勝的中: ${comparison.tsAnchorHonmeiWinHits}/${n} (${tsWinPct}%)`,
      );
      // eslint-disable-next-line no-console
      console.log(`差分 (TS−AI): ${delta.toFixed(1)} pt`);
      // eslint-disable-next-line no-console
      console.log(`\nWrote ${outPath}`);
    },
  );
});
