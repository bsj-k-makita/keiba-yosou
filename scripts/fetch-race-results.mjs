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
import { load } from "cheerio";
import { fetchUtf8, sleep } from "./lib/netkeibaFetch.mjs";
import { parseChakusaToSeconds } from "./lib/parseNetkeibaPastRuns.mjs";
import { parseRaceResultNetkeiba } from "./lib/parseRaceResultNetkeiba.mjs";
import { parseNetkeibaPayouts } from "./lib/parseNetkeibaPayouts.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const RESULTS_DIR = join(ROOT, "src/data/results");
const INDEX_PATH = join(ROOT, "src/data/index.json");

const SLEEP_MS = 400;

mkdirSync(RESULTS_DIR, { recursive: true });

// ===== HTML パース =====

/**
 * netkeiba result.html から着順リストを抽出する。
 * @returns {{ place: number, horseId: string, horseName: string, time: string, margin: number|null }[]}
 */
function parseResultPage(html, raceId) {
  const $ = load(html);

  if ($("title").text().includes("エラー") || /お探しのページ/.test(html)) {
    throw new Error("ページ取得失敗または未掲載（レース未開催の可能性）");
  }

  // 結果テーブル: #All_Result_Table または .ResultTableWrap
  const rows = $("#All_Result_Table tbody tr, .RaceTable01 tbody tr");
  if (rows.length === 0) {
    throw new Error("着順テーブルが見つかりません（レース前 or HTML 構造変更の可能性）");
  }

  const places = [];

  rows.each((_, el) => {
    const $tr = $(el);
    const tds = $tr.children("td");
    if (tds.length < 4) return;

    // 列レイアウト（result.html）:
    // 0:着順 1:枠 2:馬番 3:馬名 4:性齢 5:斤量 6:騎手 7:タイム 8:着差 ...
    const placeRaw = tds.eq(0).text().trim().replace(/[^\d]/g, "");
    const place = parseInt(placeRaw, 10);
    if (!Number.isFinite(place) || place < 1) return; // 除外・中止行をスキップ

    // 馬名リンクから horseId
    const horseLink = tds.eq(3).find('a[href*="/horse/"]').first();
    const href = horseLink.attr("href") ?? "";
    const idm = href.match(/horse\/([0-9]+)/);
    const horseId = idm ? idm[1] : "";

    const horseName = (horseLink.attr("title") || horseLink.text()).replace(/\s+/g, " ").trim()
      || tds.eq(3).text().trim();

    const time = tds.eq(7).text().trim() || tds.eq(6).text().trim();

    // 着差（馬身 or 秒表記。1着は "0" 相当）
    const marginRaw = tds.eq(8).text().trim() || tds.eq(7).text().trim();
    const marginSec = place === 1 ? 0 : parseChakusaToSeconds(marginRaw);

    places.push({ place, horseId, horseName, time, margin: marginSec });
  });

  if (places.length === 0) {
    throw new Error("着順行を1件も解析できません");
  }

  return places;
}

// ===== フェッチ =====

async function fetchResult(raceId) {
  const url = `https://race.netkeiba.com/race/result.html?race_id=${raceId}`;
  process.stderr.write(`  fetch result ${raceId}… `);
  const html = fetchUtf8(url);
  let places;
  try {
    ({ places } = parseRaceResultNetkeiba(html, raceId));
  } catch {
    places = parseResultPage(html, raceId);
  }
  const payouts = parseNetkeibaPayouts(html);
  const out = {
    raceId,
    fetchedAt: new Date().toISOString(),
    places,
    payouts,
  };
  const path = join(RESULTS_DIR, `${raceId}.json`);
  writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`, "utf8");
  process.stderr.write(`ok (${places.length}頭)\n`);
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
  let err = 0;
  for (const raceId of raceIds) {
    try {
      await fetchResult(raceId);
      ok++;
    } catch (e) {
      process.stderr.write(`err: ${e?.message ?? e}\n`);
      err++;
    }
    await sleep(SLEEP_MS);
  }

  process.stdout.write(`done. ${ok} 成功 / ${err} 失敗\n`);
}

main().catch((e) => {
  process.stderr.write(String(e) + "\n");
  process.exit(1);
});
