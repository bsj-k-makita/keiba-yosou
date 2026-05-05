#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { enrichInvestmentSignalsInRaceData } from "./lib/investmentSignals.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const RACES_DIR = join(ROOT, "src/data/races");

function parseArgs(argv) {
  const out = { all: false, raceIds: [] };
  for (const a of argv) {
    if (a === "--all") out.all = true;
    else if (!a.startsWith("-")) out.raceIds.push(a.replace(/\.json$/, ""));
  }
  return out;
}

function listRaceIds() {
  if (!existsSync(RACES_DIR)) return [];
  return readdirSync(RACES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

function processRace(raceId) {
  const path = join(RACES_DIR, `${raceId}.json`);
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const before = JSON.stringify(raw);
  const next = enrichInvestmentSignalsInRaceData(raw);
  const after = JSON.stringify(next);
  if (before !== after) {
    writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    return true;
  }
  return false;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const raceIds = args.all ? listRaceIds() : args.raceIds;
  if (raceIds.length === 0) {
    process.stderr.write("Usage: node scripts/enrich-investment-signals.mjs --all | <raceId> [raceId...]\n");
    process.exit(1);
  }
  let updated = 0;
  for (const raceId of raceIds) {
    const changed = processRace(raceId);
    if (changed) updated += 1;
  }
  process.stdout.write(`done. updated ${updated}/${raceIds.length} race files.\n`);
}

main();
