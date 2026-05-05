#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const RACES_DIR = join(ROOT, "src/data/races");
const INDEX_PATH = join(ROOT, "src/data/index.json");

function parseArgs(argv) {
  const out = { all: false, date: "", raceIds: [], dryRun: false };
  for (const a of argv) {
    if (a === "--all") out.all = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a.startsWith("--date=")) out.date = a.slice("--date=".length).trim();
    else if (!a.startsWith("-")) out.raceIds.push(a.replace(/\.json$/, ""));
  }
  if (out.date && !/^\d{4}-\d{2}-\d{2}$/.test(out.date)) {
    throw new Error(`invalid --date format: ${out.date}`);
  }
  return out;
}

function listRaceIdsByDate(date) {
  const rows = JSON.parse(readFileSync(INDEX_PATH, "utf8"));
  return rows
    .filter((r) => r?.date === date)
    .map((r) => String(r.raceId))
    .filter(Boolean);
}

function listAllRaceIds() {
  if (!existsSync(RACES_DIR)) return [];
  return readdirSync(RACES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

function resetEntry(entry) {
  let touched = 0;
  if (entry.market_win_odds != null || entry.marketWinOdds != null) touched += 1;
  if (entry.market_popularity != null || entry.marketPopularity != null) touched += 1;
  if (entry.market_observed_at != null) touched += 1;
  if (entry.market_win_odds_source === "actual") touched += 1;
  if (entry.market_popularity_source === "actual") touched += 1;
  if (entry.odds_source === "actual") touched += 1;

  delete entry.market_win_odds;
  delete entry.marketWinOdds;
  delete entry.market_popularity;
  delete entry.marketPopularity;
  delete entry.market_observed_at;
  entry.market_win_odds_source = "estimated";
  entry.market_popularity_source = "estimated";
  entry.odds_source = "estimated";
  delete entry.odds_observed_at;
  delete entry.actual_odds_source;

  return touched;
}

function processRace(raceId, dryRun) {
  const path = join(RACES_DIR, `${raceId}.json`);
  if (!existsSync(path)) return { changed: false, touchedEntries: 0, resetSignals: 0 };
  const data = JSON.parse(readFileSync(path, "utf8"));
  let touchedEntries = 0;
  let resetSignals = 0;
  for (const entry of data.entries ?? []) {
    const touched = resetEntry(entry);
    if (touched > 0) {
      touchedEntries += 1;
      resetSignals += touched;
    }
  }
  if (!dryRun && touchedEntries > 0) {
    writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  }
  return { changed: touchedEntries > 0, touchedEntries, resetSignals };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const raceIds = args.all
    ? listAllRaceIds()
    : args.date
      ? listRaceIdsByDate(args.date)
      : args.raceIds;
  if (raceIds.length === 0) {
    process.stderr.write("Usage: node scripts/reset-market-odds.mjs --all | --date=YYYY-MM-DD | <raceId> [raceId...] [--dry-run]\n");
    process.exit(1);
  }
  let changedFiles = 0;
  let touchedEntries = 0;
  let resetSignals = 0;
  for (const raceId of raceIds) {
    const res = processRace(raceId, args.dryRun);
    if (res.changed) changedFiles += 1;
    touchedEntries += res.touchedEntries;
    resetSignals += res.resetSignals;
  }
  process.stdout.write(
    `done. files=${changedFiles}/${raceIds.length}, entries=${touchedEntries}, reset_signals=${resetSignals}, dryRun=${args.dryRun}\n`,
  );
}

main();
