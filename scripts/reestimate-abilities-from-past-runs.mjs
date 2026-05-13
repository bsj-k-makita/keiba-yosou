#!/usr/bin/env node
/**
 * 既存 src/data/races/*.json の abilities を過去走ベースで再推定し、
 * enrich（predicted_win_rate / ability_index 等）と raceAnalysis を付け直す。
 *
 *   node scripts/reestimate-abilities-from-past-runs.mjs --all
 *   node scripts/reestimate-abilities-from-past-runs.mjs 202605020811 202604010609
 *   node scripts/reestimate-abilities-from-past-runs.mjs --dry-run --all
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { applyEstimatedAbilitiesToEntries } from "./lib/estimateAbilitiesFromPastRuns.mjs";
import { enrichInvestmentSignalsInRaceData } from "./lib/investmentSignals.mjs";
import { attachRaceAnalysisOrLeave } from "./lib/raceAnalysis.mjs";
import { buildDailyBaselineMaster, saveDailyBaseline, DAILY_BASELINE_PATH } from "./lib/dailyBaseline.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const RACES_DIR = join(ROOT, "src/data/races");

function parseArgs(argv) {
  let all = false;
  let dryRun = false;
  const ids = [];
  for (const a of argv) {
    if (a === "--all") all = true;
    else if (a === "--dry-run") dryRun = true;
    else if (!a.startsWith("-")) ids.push(a.replace(/\.json$/, ""));
  }
  return { all, dryRun, ids };
}

function listRaceFiles() {
  if (!existsSync(RACES_DIR)) return [];
  return readdirSync(RACES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => join(RACES_DIR, f));
}

function processFile(filePath, dryRun) {
  const raw = readFileSync(filePath, "utf8");
  const orig = JSON.parse(raw);
  if (!orig?.entries || !Array.isArray(orig.entries)) {
    process.stderr.write(`skip (no entries): ${filePath}\n`);
    return false;
  }
  const data = JSON.parse(raw);
  applyEstimatedAbilitiesToEntries(data.entries, data.meta ?? {});
  let next = enrichInvestmentSignalsInRaceData(data);
  next = attachRaceAnalysisOrLeave(next);
  if (JSON.stringify(orig) === JSON.stringify(next)) {
    return false;
  }
  if (!dryRun) {
    writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  }
  return true;
}

async function main() {
  const { all, dryRun, ids } = parseArgs(process.argv.slice(2));
  process.env.ENRICH_RECALC_ABILITY = "1";
  let files = [];
  if (all) {
    files = listRaceFiles();
  } else if (ids.length) {
    files = ids.map((id) => join(RACES_DIR, `${id}.json`));
  } else {
    process.stderr.write(
      "Usage: node scripts/reestimate-abilities-from-past-runs.mjs (--all | <raceId> …) [--dry-run]\n",
    );
    process.exit(1);
  }

  let changed = 0;
  for (const fp of files) {
    if (!existsSync(fp)) {
      process.stderr.write(`missing: ${fp}\n`);
      continue;
    }
    if (processFile(fp, dryRun)) changed += 1;
  }

  if (!dryRun && changed > 0) {
    try {
      saveDailyBaseline(buildDailyBaselineMaster(RACES_DIR), DAILY_BASELINE_PATH);
    } catch (e) {
      process.stderr.write(`daily_baseline: ${e?.message || e}\n`);
    }
  }

  process.stdout.write(
    dryRun ? `dry-run: would rewrite ${changed} file(s).\n` : `done. updated ${changed} race file(s).\n`,
  );
}

main().catch((e) => {
  process.stderr.write(String(e?.stack || e) + "\n");
  process.exit(1);
});
