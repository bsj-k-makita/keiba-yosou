#!/usr/bin/env node
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = process.cwd();
const targetFile = resolve(repoRoot, "src/lib/pipeline/aiMarkAssignment.ts");
const summaryFile = resolve(repoRoot, "src/data/backtest_summary.json");

const weights = [0.0, 0.3, 0.5, 1.0];
const constRegex = /export const G1_HYBRID_FINAL_EVAL_WEIGHT = [0-9.]+;/;

function extractMetrics(summary) {
  const totalRecoveryRate = Number(summary.totalRecoveryRate ?? NaN);
  const raceDetails = Array.isArray(summary.raceDetails) ? summary.raceDetails : [];
  const g1 = raceDetails.filter((r) => String(r.classTierLabel || "").toUpperCase() === "G1");
  let withHonmei = 0;
  let hit = 0;
  for (const race of g1) {
    const marks = race.aiMarks || {};
    const honmei = Object.entries(marks)
      .filter(([, mark]) => mark === "◎")
      .map(([num]) => Number(num))
      .filter((n) => Number.isFinite(n));
    if (honmei.length === 0) continue;
    withHonmei += 1;
    const top3 = (race.actualResults || []).slice(0, 3).map((x) => Number(x));
    if (honmei.some((n) => top3.includes(n))) hit += 1;
  }
  const g1Rate = withHonmei > 0 ? (hit / withHonmei) * 100 : 0;
  return {
    totalRecoveryRate,
    g1Hit: hit,
    g1Total: withHonmei,
    g1Rate,
  };
}

function printResults(results) {
  console.log("\n=== G1 weight sweep results ===");
  for (const r of results) {
    console.log(
      `weight=${r.weight.toFixed(2)} | recovery=${r.totalRecoveryRate.toFixed(1)}% | G1 ◎ hit=${r.g1Hit}/${r.g1Total} (${r.g1Rate.toFixed(2)}%)`,
    );
  }
}

const original = readFileSync(targetFile, "utf8");
if (!constRegex.test(original)) {
  throw new Error("G1_HYBRID_FINAL_EVAL_WEIGHT constant not found.");
}

const results = [];
try {
  for (const w of weights) {
    const patched = original.replace(
      constRegex,
      `export const G1_HYBRID_FINAL_EVAL_WEIGHT = ${w};`,
    );
    writeFileSync(targetFile, patched, "utf8");

    console.log(`\n--- running backtest for weight=${w} ---`);
    execSync("npm run backtest:bets", {
      cwd: repoRoot,
      stdio: "pipe",
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 20,
    });

    const summary = JSON.parse(readFileSync(summaryFile, "utf8"));
    results.push({ weight: w, ...extractMetrics(summary) });
  }
} finally {
  writeFileSync(targetFile, original, "utf8");
}

printResults(results);

const bestByG1ThenRecovery = [...results].sort((a, b) => {
  if (b.g1Rate !== a.g1Rate) return b.g1Rate - a.g1Rate;
  return b.totalRecoveryRate - a.totalRecoveryRate;
})[0];

console.log("\nrecommended=", JSON.stringify(bestByG1ThenRecovery));
