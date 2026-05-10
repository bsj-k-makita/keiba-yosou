#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { enrichInvestmentSignalsInRaceData } from "./lib/investmentSignals.mjs";
import { updateBiasMasterFromNetwork } from "./lib/biasMaster.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const RACES_DIR = join(ROOT, "src/data/races");

function parseArgs(argv) {
  const out = { all: false, biasUpdate: false, raceIds: [] };
  for (const a of argv) {
    if (a === "--all") out.all = true;
    else if (a === "--bias-update") out.biasUpdate = true;
    else if (a === "--recalc-ability") process.env.ENRICH_RECALC_ABILITY = "1";
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

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.biasUpdate) {
    process.stderr.write("Updating bias_master.json from index.json (netkeiba result pages)…\n");
    const res = await updateBiasMasterFromNetwork({});
    process.stdout.write(
      `bias_master: updatedAt=${res.updatedAt}, mergedEntries=${Object.keys(res.entries ?? {}).length}, fetchedRaces=${res.fetchedRaces}\n`,
    );
  }

  const raceIds = args.all ? listRaceIds() : args.raceIds;
  if (raceIds.length === 0) {
    if (args.biasUpdate) {
      process.stdout.write("done (bias-only).\n");
      return;
    }
    process.stderr.write(
      "Usage: node scripts/enrich-investment-signals.mjs [--bias-update] [--recalc-ability] --all | <raceId> [raceId...]\n",
    );
    process.exit(1);
  }
  let updated = 0;
  for (const raceId of raceIds) {
    const changed = processRace(raceId);
    if (changed) updated += 1;
  }
  process.stdout.write(`done. updated ${updated}/${raceIds.length} race files.\n`);
}

main().catch((e) => {
  process.stderr.write(String(e?.stack ?? e) + "\n");
  process.exit(1);
});
