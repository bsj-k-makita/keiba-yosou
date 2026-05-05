#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "fs";
import { join, dirname, isAbsolute } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { loadLocalEnv } from "./lib/loadEnvFiles.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const RACES_DIR = join(ROOT, "src/data/races");
loadLocalEnv(ROOT);

function parseArgs(argv) {
  let csvPath = "data/latest-odds.csv";
  let skipExternal = false;
  let skipGenerate = false;
  let date = "";
  let retries = 1;
  let retryWaitMs = 30000;
  let source = "jra";
  let liveFallback = false;
  let poll = false;
  let pollIntervalMs = 30000;
  let pollTimeoutMs = 0;
  for (const arg of argv) {
    if (arg.startsWith("--csv=")) csvPath = arg.slice("--csv=".length).trim();
    if (arg === "--skip-external") skipExternal = true;
    if (arg === "--skip-generate") skipGenerate = true;
    if (arg.startsWith("--date=")) date = arg.slice("--date=".length).trim();
    if (arg.startsWith("--retries=")) retries = Math.max(1, parseInt(arg.slice(10), 10) || 1);
    if (arg.startsWith("--retry-wait=")) retryWaitMs = Math.max(1000, parseInt(arg.slice(13), 10) || 30000);
    if (arg.startsWith("--source=")) source = arg.slice("--source=".length).trim();
    if (arg === "--live-fallback") liveFallback = true;
    if (arg === "--poll") poll = true;
    if (arg.startsWith("--poll-interval=")) pollIntervalMs = Math.max(1000, parseInt(arg.slice(16), 10) || 30000);
    if (arg.startsWith("--poll-timeout=")) pollTimeoutMs = Math.max(1000, parseInt(arg.slice(15), 10) || 0);
  }
  if (!["jra", "auto", "netkeiba"].includes(source)) {
    throw new Error(`invalid --source: ${source}`);
  }
  if (poll && pollTimeoutMs <= 0) {
    pollTimeoutMs = 30 * 60 * 1000;
  }
  const absCsvPath = isAbsolute(csvPath) ? csvPath : join(ROOT, csvPath);
  return {
    absCsvPath,
    skipExternal,
    skipGenerate,
    date,
    retries,
    retryWaitMs,
    source,
    liveFallback,
    pollIntervalMs,
    pollTimeoutMs,
  };
}

function runNodeScript(args) {
  const res = spawnSync("node", args, {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  if (res.status !== 0) {
    throw new Error(`command failed: node ${args.join(" ")}`);
  }
}

function summarizeOddsSources() {
  const files = readdirSync(RACES_DIR).filter((f) => f.endsWith(".json"));
  let entries = 0;
  let actualOdds = 0;
  let estimatedOdds = 0;
  let actualMarketWin = 0;
  let actualPopularity = 0;
  for (const f of files) {
    const data = JSON.parse(readFileSync(join(RACES_DIR, f), "utf8"));
    for (const e of data.entries ?? []) {
      entries += 1;
      if (e.odds_source === "actual") actualOdds += 1;
      if (e.odds_source === "estimated") estimatedOdds += 1;
      if (e.market_win_odds_source === "actual") actualMarketWin += 1;
      if (e.market_popularity_source === "actual") actualPopularity += 1;
    }
  }
  return { files: files.length, entries, actualOdds, estimatedOdds, actualMarketWin, actualPopularity };
}

function countCsvRows(csvPath) {
  if (!existsSync(csvPath)) return 0;
  const text = readFileSync(csvPath, "utf8");
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length <= 1) return 0;
  return Math.max(0, lines.length - 1);
}

async function waitMs(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const {
    absCsvPath,
    skipExternal,
    skipGenerate,
    date,
    retries,
    retryWaitMs,
    source,
    liveFallback,
    pollIntervalMs,
    pollTimeoutMs,
  } = parseArgs(process.argv.slice(2));

  const startedAt = Date.now();
  let attempt = 0;
  let lastSummary = null;
  let lastCsvRows = 0;

  while (true) {
    attempt += 1;

    if (!skipGenerate) {
      const genArgs = ["scripts/generate-latest-odds-csv.mjs", `--out=${absCsvPath}`, `--source=${source}`];
      if (date) genArgs.push(`--date=${date}`);
      else genArgs.push("--all");
      runNodeScript(genArgs);
    }
    lastCsvRows = countCsvRows(absCsvPath);

    if (liveFallback) {
      const fetchArgs = ["scripts/fetch-live-odds.mjs", "--all", `--retries=${retries}`, `--retry-wait=${retryWaitMs}`];
      if (date) {
        fetchArgs.splice(1, 1, `--date=${date}`);
      }
      runNodeScript(fetchArgs);
    }

    if (!skipExternal) {
      if (existsSync(absCsvPath)) {
        runNodeScript(["scripts/apply-external-odds.mjs", `--csv=${absCsvPath}`]);
      } else {
        process.stdout.write(`skip external csv (not found): ${absCsvPath}\n`);
      }
    }

    lastSummary = summarizeOddsSources();
    const hasActual =
      lastSummary.actualOdds > 0 ||
      lastSummary.actualMarketWin > 0 ||
      lastSummary.actualPopularity > 0 ||
      lastCsvRows > 0;
    process.stdout.write(
      `attempt=${attempt} summary: races=${lastSummary.files}, entries=${lastSummary.entries}, csv_rows=${lastCsvRows}, actual_odds=${lastSummary.actualOdds}, estimated_odds=${lastSummary.estimatedOdds}, actual_market_win=${lastSummary.actualMarketWin}, actual_popularity=${lastSummary.actualPopularity}\n`,
    );

    if (pollTimeoutMs <= 0 || hasActual) break;

    const elapsed = Date.now() - startedAt;
    const remain = pollTimeoutMs - elapsed;
    if (remain <= 0) {
      process.stdout.write(`poll timeout reached: ${pollTimeoutMs}ms\n`);
      break;
    }
    const wait = Math.min(pollIntervalMs, remain);
    process.stdout.write(`no actual odds yet. waiting ${wait}ms before next attempt...\n`);
    await waitMs(wait);
  }
}

await main();
