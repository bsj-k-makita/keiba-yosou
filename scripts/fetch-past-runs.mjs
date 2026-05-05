#!/usr/bin/env node
/**
 * netkeiba から各馬の直近5走を取得し、レース JSON の `entries[].pastRuns` に書き込む。
 * 着順・着差（秒推定）・日付、およびレース全体の 200m ラップ（同レースの全馬で共通のペース行）を格納する。
 *
 * 使用:
 *   node scripts/fetch-past-runs.mjs 202608030201
 *   node scripts/fetch-past-runs.mjs --all
 *   node scripts/fetch-past-runs.mjs 202608030201 --force
 *
 * オプション:
 *   --all      src/data/races/*.json をすべて処理
 *   --force    既に pastRuns がある行も上書き
 *   --sleep=N  リクエスト間隔（ms。既定 400）
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { fetchPastRunsForHorse } from "./lib/parseNetkeibaPastRuns.mjs";
import { sleep } from "./lib/netkeibaFetch.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const RACES_DIR = join(ROOT, "src/data/races");

function parseArgs(argv) {
  const out = { all: false, force: false, sleepMs: 400, raceIds: [] };
  for (const a of argv) {
    if (a === "--all") out.all = true;
    else if (a === "--force") out.force = true;
    else if (a.startsWith("--sleep=")) out.sleepMs = Math.max(100, parseInt(a.slice(8), 10) || 400);
    else if (!a.startsWith("-")) out.raceIds.push(a);
  }
  return out;
}

function listRaceJsons() {
  if (!existsSync(RACES_DIR)) return [];
  return readdirSync(RACES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => join(RACES_DIR, f));
}

async function processRaceFile(filePath, { force, sleepMs, raceLapCache }) {
  const raw = readFileSync(filePath, "utf8");
  const data = JSON.parse(raw);
  if (!data.entries || !Array.isArray(data.entries)) {
    process.stderr.write(`skip (no entries): ${filePath}\n`);
    return 0;
  }
  let n = 0;
  for (const entry of data.entries) {
    const hid = entry.horseId;
    if (!hid) continue;
    if (!force && entry.pastRuns && entry.pastRuns.length > 0) continue;

    process.stderr.write(`  horse ${hid} ${entry.horseName ?? ""}… `);
    const { pastRuns, horseProfile } = await fetchPastRunsForHorse(String(hid), { sleepMs, raceLapCache });
    entry.pastRuns = pastRuns;
    entry.sex = entry.sex ?? horseProfile?.sex;
    entry.age = entry.age ?? horseProfile?.age;
    entry.trainer = entry.trainer ?? horseProfile?.trainer;
    entry.bodyWeightKg = entry.bodyWeightKg ?? horseProfile?.bodyWeightKg;
    if (horseProfile?.pedigree) {
      entry.pedigree = {
        ...(entry.pedigree ?? {}),
        ...(horseProfile.pedigree.sireName ? { sireName: horseProfile.pedigree.sireName } : {}),
        ...(horseProfile.pedigree.damSireName ? { damSireName: horseProfile.pedigree.damSireName } : {}),
      };
    }
    n += 1;
    process.stderr.write(`${pastRuns.length} runs\n`);
    await sleep(sleepMs);
  }
  if (n > 0) {
    writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  }
  return n;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const raceLapCache = new Map();
  const sleepMs = args.sleepMs;

  let files = [];
  if (args.all) {
    files = listRaceJsons();
  } else if (args.raceIds.length) {
    for (const id of args.raceIds) {
      const f = join(RACES_DIR, `${id.replace(/\.json$/, "")}.json`);
      if (!existsSync(f)) {
        process.stderr.write(`file not found: ${f}\n`);
        process.exit(1);
      }
      files.push(f);
    }
  } else {
    process.stderr.write(
      "Usage: node scripts/fetch-past-runs.mjs <raceId> [raceId...] | --all [--force] [--sleep=400]\n",
    );
    process.exit(1);
  }

  let total = 0;
  for (const fp of files) {
    process.stderr.write(`${fp} …\n`);
    const n = await processRaceFile(fp, { force: args.force, sleepMs, raceLapCache });
    total += n;
  }
  process.stdout.write(`done. updated pastRuns for ${total} horses (${files.length} files).\n`);
}

main().catch((e) => {
  process.stderr.write(String(e?.stack || e) + "\n");
  process.exit(1);
});
