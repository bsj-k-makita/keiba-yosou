/**
 * netkeiba レース結果ページから着順を取得し src/data/results/{raceId}.json に保存する。
 *
 * 使い方:
 *   node scripts/fetch-race-results.mjs --date=2026-04-26
 *   node scripts/fetch-race-results.mjs --raceId=202603010601
 *   node scripts/fetch-race-results.mjs --date=2026-04-26 --venue=東京
 *   node scripts/fetch-race-results.mjs --backfill-from-results
 *
 * 出力 JSON スキーマ:
 *   { raceId, fetchedAt, places: [...], payouts?: { WIN, SHOW, REN, WREN, TRI } }
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { sleep } from "./lib/netkeibaFetch.mjs";
import {
  fetchRaceResultFromNetkeiba,
  isRaceResultNotReadyError,
} from "./lib/fetchRaceResultFromNetkeiba.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const RESULTS_DIR = join(ROOT, "src/data/results");
const INDEX_PATH = join(ROOT, "src/data/index.json");

const SLEEP_MS = 400;

mkdirSync(RESULTS_DIR, { recursive: true });

async function fetchResult(raceId) {
  process.stderr.write(`  fetch result ${raceId}… `);
  const out = await fetchRaceResultFromNetkeiba(raceId);
  const path = join(RESULTS_DIR, `${raceId}.json`);
  writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`, "utf8");
  process.stderr.write(`ok (${out.places.length}頭)\n`);
  return out;
}

// ===== CLI =====

function parseOptions() {
  const args = process.argv.slice(2);
  let targetDate = null;
  let targetRaceId = null;
  let targetVenue = null;
  let backfillFromResults = false;

  for (const arg of args) {
    if (arg.startsWith("--date=")) targetDate = arg.slice(7).trim();
    if (arg.startsWith("--raceId=")) targetRaceId = arg.slice(9).trim();
    if (arg.startsWith("--venue=")) targetVenue = arg.slice(8).trim();
    if (arg === "--backfill-from-results") backfillFromResults = true;
  }

  return { targetDate, targetRaceId, targetVenue, backfillFromResults };
}

async function main() {
  const { targetDate, targetRaceId, targetVenue, backfillFromResults } = parseOptions();

  let raceIds = [];

  if (backfillFromResults) {
    raceIds = readdirSync(RESULTS_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""));
  } else if (targetRaceId) {
    raceIds = [targetRaceId];
  } else if (targetDate) {
    const index = JSON.parse(readFileSync(INDEX_PATH, "utf8"));
    const filtered = index.filter(
      (r) =>
        r.date === targetDate &&
        (!targetVenue || r.venue === targetVenue),
    );
    if (filtered.length === 0) {
      throw new Error(`index.json に ${targetDate} のレースが見つかりません`);
    }
    raceIds = filtered.map((r) => r.raceId);
  } else {
    throw new Error("--date=YYYY-MM-DD か --raceId=... を指定してください");
  }

  process.stderr.write(`対象: ${raceIds.length} レース\n`);

  let ok = 0;
  let skip = 0;
  let err = 0;
  for (const raceId of raceIds) {
    try {
      await fetchResult(raceId);
      ok++;
    } catch (e) {
      const msg = e?.message ?? String(e);
      if (isRaceResultNotReadyError(e)) {
        process.stderr.write(`skip (未発走/暫定): ${msg}\n`);
        skip++;
      } else {
        process.stderr.write(`err: ${msg}\n`);
        err++;
      }
    }
    await sleep(SLEEP_MS);
  }

  process.stdout.write(`done. ${ok} 成功 / ${skip} スキップ（未発走等） / ${err} 失敗\n`);
}

main().catch((e) => {
  process.stderr.write(String(e) + "\n");
  process.exit(1);
});
