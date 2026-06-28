import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { REN_EV_THRESHOLD } from "../race-evaluation/investmentEvConstants";
import { collectBacktestRaceInputs } from "./runFullBacktest";
import { aggregateBacktest, runBacktestOnRace } from "./runBacktest";
import type { BacktestRaceInput, BacktestRaceOutput } from "./runBacktest";

function filterJune2026Inputs(): BacktestRaceInput[] {
  return collectBacktestRaceInputs().filter((input) => input.meta.date.startsWith("2026-06"));
}

function runJuneWithThreshold(
  inputs: readonly BacktestRaceInput[],
  renEvThreshold?: number,
): BacktestRaceOutput[] {
  const outputs: BacktestRaceOutput[] = [];
  for (const input of inputs) {
    const out = runBacktestOnRace(input, {
      probabilityEngine: "ai",
      ...(renEvThreshold != null ? { renEvThreshold } : {}),
    });
    if (out) outputs.push(out);
  }
  return outputs;
}

describe("compareRenEvThresholdJune", () => {
  test(
    "6月72R: 馬連EV閾値 1.8 vs 2.0 試算",
    { timeout: 300_000 },
    () => {
      const inputs = filterJune2026Inputs();
      expect(inputs.length).toBeGreaterThan(0);

      const baselineThreshold = REN_EV_THRESHOLD;
      const trialThreshold = 2.0;

      const thresholds = [1.8, 1.85, 1.9, 1.95, 2.0] as const;
      const outputsByThreshold = new Map<number, BacktestRaceOutput[]>();
      const byThreshold: Record<
        string,
        ReturnType<typeof aggregateBacktest> & { renEvThreshold: number }
      > = {};

      for (const renEvThreshold of thresholds) {
        const outputs = runJuneWithThreshold(inputs, renEvThreshold);
        outputsByThreshold.set(renEvThreshold, outputs);
        byThreshold[String(renEvThreshold)] = {
          renEvThreshold,
          ...aggregateBacktest(outputs),
        };
      }

      const baseline = byThreshold[String(baselineThreshold)]!;
      const trial = byThreshold[String(trialThreshold)]!;
      const baselineOutputs = outputsByThreshold.get(baselineThreshold)!;
      const trialOutputs = outputsByThreshold.get(trialThreshold)!;

      let mainLineDropped = 0;
      let mainLineAdded = 0;
      let mainLineChanged = 0;
      for (let i = 0; i < baselineOutputs.length; i++) {
        const bInv = baselineOutputs[i]!.result.byType.MAIN_LINE.invested;
        const tInv = trialOutputs[i]!.result.byType.MAIN_LINE.invested;
        if (bInv > 0 && tInv === 0) mainLineDropped += 1;
        if (bInv === 0 && tInv > 0) mainLineAdded += 1;
        if (bInv !== tInv) mainLineChanged += 1;
      }

      const comparison = {
        period: "2026-06",
        raceCount: inputs.length,
        baseline: {
          renEvThreshold: baselineThreshold,
          totalRacesMatched: baseline.totalRacesMatched,
          totalRecoveryRate: baseline.totalRecoveryRate,
          totalInvestedSum: baseline.totalInvestedSum,
          totalPayoutSum: baseline.totalPayoutSum,
          mainLine: baseline.byTicketType.MAIN_LINE,
          wide: baseline.byTicketType.WIDE,
          trifecta: baseline.byTicketType.TRIFECTA_FORM,
          win: baseline.byTicketType.WIN,
        },
        trial: {
          renEvThreshold: trialThreshold,
          totalRacesMatched: trial.totalRacesMatched,
          totalRecoveryRate: trial.totalRecoveryRate,
          totalInvestedSum: trial.totalInvestedSum,
          totalPayoutSum: trial.totalPayoutSum,
          mainLine: trial.byTicketType.MAIN_LINE,
          wide: trial.byTicketType.WIDE,
          trifecta: trial.byTicketType.TRIFECTA_FORM,
          win: trial.byTicketType.WIN,
        },
        delta: {
          totalRecoveryRate: trial.totalRecoveryRate - baseline.totalRecoveryRate,
          mainLineRecoveryRate: trial.byTicketType.MAIN_LINE.rate - baseline.byTicketType.MAIN_LINE.rate,
          mainLineInvested:
            trial.byTicketType.MAIN_LINE.invested - baseline.byTicketType.MAIN_LINE.invested,
          mainLinePayout:
            trial.byTicketType.MAIN_LINE.payout - baseline.byTicketType.MAIN_LINE.payout,
          mainLineHitCount:
            trial.byTicketType.MAIN_LINE.hitCount - baseline.byTicketType.MAIN_LINE.hitCount,
        },
        sweep: thresholds.map((t) => ({
          renEvThreshold: t,
          totalRecoveryRate: byThreshold[String(t)]!.totalRecoveryRate,
          mainLineRate: byThreshold[String(t)]!.byTicketType.MAIN_LINE.rate,
          mainLineInvested: byThreshold[String(t)]!.byTicketType.MAIN_LINE.invested,
          mainLineHitCount: byThreshold[String(t)]!.byTicketType.MAIN_LINE.hitCount,
          mainLineBetCount: byThreshold[String(t)]!.byTicketType.MAIN_LINE.betCount,
        })),
        mainLineRaceChanges: {
          dropped: mainLineDropped,
          added: mainLineAdded,
          investedChanged: mainLineChanged,
        },
        generatedAt: new Date().toISOString(),
      };

      const outPath = join(process.cwd(), "src/data/backtest_ren_ev_june_comparison.json");
      writeFileSync(outPath, `${JSON.stringify(comparison, null, 2)}\n`, "utf8");

      const b = comparison.baseline;
      const t = comparison.trial;
      const d = comparison.delta;

      // eslint-disable-next-line no-console
      console.log("\n=== 6月 馬連EV閾値試算 ===");
      // eslint-disable-next-line no-console
      console.log(`対象: ${comparison.raceCount}レース（結果あり）`);
      // eslint-disable-next-line no-console
      console.log(
        `現行 ${b.renEvThreshold}: 投資R ${b.totalRacesMatched}  総回収 ${b.totalRecoveryRate}%  馬連 ${b.mainLine.rate}% (${b.mainLine.hitCount}的中 / 投${b.mainLine.invested})`,
      );
      // eslint-disable-next-line no-console
      console.log(
        `試算 ${t.renEvThreshold}: 投資R ${t.totalRacesMatched}  総回収 ${t.totalRecoveryRate}%  馬連 ${t.mainLine.rate}% (${t.mainLine.hitCount}的中 / 投${t.mainLine.invested})`,
      );
      // eslint-disable-next-line no-console
      console.log("閾値スイープ:");
      for (const row of comparison.sweep) {
        // eslint-disable-next-line no-console
        console.log(
          `  ${row.renEvThreshold}: 総回収 ${row.totalRecoveryRate}%  馬連 ${row.mainLineRate}% (${row.mainLineHitCount}的中 / ${row.mainLineBetCount}点 / 投${row.mainLineInvested})`,
        );
      }
      // eslint-disable-next-line no-console
      console.log(
        `差分: 総回収 ${d.totalRecoveryRate >= 0 ? "+" : ""}${d.totalRecoveryRate.toFixed(1)}pt  馬連 ${d.mainLineRecoveryRate >= 0 ? "+" : ""}${d.mainLineRecoveryRate.toFixed(1)}pt  馬連投資 ${d.mainLineInvested >= 0 ? "+" : ""}${d.mainLineInvested}`,
      );
      // eslint-disable-next-line no-console
      console.log(
        `馬連購入レース変化: 見送り+${comparison.mainLineRaceChanges.dropped} / 追加+${comparison.mainLineRaceChanges.added}`,
      );
      // eslint-disable-next-line no-console
      console.log(`\nWrote ${outPath}`);

      expect(comparison.raceCount).toBeGreaterThanOrEqual(70);
    },
  );
});
