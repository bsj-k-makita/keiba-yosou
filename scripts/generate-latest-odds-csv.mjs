#!/usr/bin/env node
/**
 * 最新オッズCSVを自動生成する。
 *
 * 優先ソース:
 * 1) JRA系外部API（JRA_ODDS_API_BASE_URL が設定されている場合）
 * 2) JRA公式サイト（sp.jra.jp）を Playwright で取得（API 未設定または未取得時）
 * 3) netkeiba 単勝オッズ（type=b1、source=auto のフォールバック）
 *
 * 対象レースの指定（どれか一つ）:
 * - --date=YYYY-MM-DD … src/data/index.json のその開催日の全レース（日単位バッチ向け）
 * - --all … index の全レース
 * - --raceId=12桁 … 単発（複数回指定可）。--date より優先
 * - 上記なし … index 内の最新日だけ
 *
 * 出力CSVヘッダ:
 * raceId,horseNumber,actualOdds,marketWinOdds,marketPopularity,observedAt,source
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, isAbsolute, join } from "path";
import { fileURLToPath } from "url";
import { load } from "cheerio";
import { gunzipSync, inflateRawSync, inflateSync } from "zlib";
import { fetchUtf8, fetchSpUtf8, sleep } from "./lib/netkeibaFetch.mjs";
import { loadLocalEnv } from "./lib/loadEnvFiles.mjs";
import { resolveRaceNavigationContext } from "./lib/raceIdResolver.mjs";
import { createJraOfficialOddsSession, fetchJraOfficialWinOddsForRace } from "./lib/jraDriver.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const INDEX_PATH = join(ROOT, "src/data/index.json");
loadLocalEnv(ROOT);

/** netkeiba の race_id は12桁。ドキュメントの「…」はプレースホルダなのでそのまま渡さないこと。 */
function validateExplicitRaceIds(ids) {
  for (const raw of ids) {
    const id = String(raw ?? "").trim();
    if (/^[…⋯]+$/.test(id) || /^\.{2,3}$/.test(id)) {
      throw new Error(
        `Invalid --raceId: "${raw}" is a placeholder (…). Pass the real 12-digit race id, e.g. --raceId=202605020511`,
      );
    }
    if (!/^\d{12}$/.test(id)) {
      throw new Error(
        `--raceId must be 12 digits (netkeiba race_id). Got "${raw}". Example: --raceId=202605020511`,
      );
    }
  }
}

function parseArgs(argv) {
  let outPath = "data/latest-odds.csv";
  let date = "";
  let all = false;
  let sleepMs = 250;
  let source = "jra";
  /** @type {string[]} */
  const explicitRaceIds = [];
  for (const arg of argv) {
    if (arg.startsWith("--out=")) outPath = arg.slice("--out=".length).trim();
    else if (arg.startsWith("--date=")) date = arg.slice("--date=".length).trim();
    else if (arg === "--all") all = true;
    else if (arg.startsWith("--sleep=")) sleepMs = Math.max(100, Number(arg.slice(8)) || 250);
    else if (arg.startsWith("--source=")) source = arg.slice("--source=".length).trim();
    else if (arg.startsWith("--raceId=")) explicitRaceIds.push(arg.slice("--raceId=".length).trim());
  }
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`invalid --date: ${date}`);
  }
  if (!["jra", "auto", "netkeiba"].includes(source)) {
    throw new Error(`invalid --source: ${source}`);
  }
  return {
    outPath: isAbsolute(outPath) ? outPath : join(ROOT, outPath),
    date,
    all,
    sleepMs,
    source,
    explicitRaceIds,
  };
}

function parseNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function quoteCsv(v) {
  const s = String(v ?? "");
  if (!/[",\n]/.test(s)) return s;
  return `"${s.replaceAll('"', '""')}"`;
}

function rowsToCsv(rows) {
  const headers = [
    "raceId",
    "horseNumber",
    "actualOdds",
    "marketWinOdds",
    "marketPopularity",
    "observedAt",
    "source",
  ];
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(headers.map((h) => quoteCsv(r[h] ?? "")).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function raceIdsFromIndex(args) {
  if (args.explicitRaceIds.length > 0) {
    return args.explicitRaceIds.map((id) => String(id).trim()).filter(Boolean);
  }
  const index = JSON.parse(readFileSync(INDEX_PATH, "utf8"));
  const rows = Array.isArray(index) ? index : [];
  if (args.all) return rows.map((r) => r.raceId).filter(Boolean);
  if (args.date) return rows.filter((r) => r.date === args.date).map((r) => r.raceId).filter(Boolean);
  const dates = [...new Set(rows.map((r) => r.date).filter(Boolean))].sort();
  const latestDate = dates[dates.length - 1];
  return rows.filter((r) => r.date === latestDate).map((r) => r.raceId).filter(Boolean);
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/generate-latest-odds-csv.mjs [options]

Options:
  --out=<path>       Output CSV path (default: data/latest-odds.csv)
  --date=YYYY-MM-DD  All races on that date from src/data/index.json (day batch)
  --all              All races in index.json
  --raceId=12digits  One race (repeatable). Overrides --date when given.
  --source=jra|auto|netkeiba
  --sleep=ms         Delay between races (default 250)
  -h, --help         This message

Examples:
  npm run odds-csv-date -- --date=2026-05-10
  node scripts/generate-latest-odds-csv.mjs --date=2026-05-10 --source=jra --out=data/latest-odds.csv
`);
}

function stripInternalCsvFields(row) {
  const { _excluded, ...rest } = row;
  void _excluded;
  return rest;
}

async function fetchFromJraOfficialPlaywright(raceId, session, root) {
  const ctx = resolveRaceNavigationContext(raceId, root);
  const raw = session ? await session.fetchRows(ctx) : await fetchJraOfficialWinOddsForRace(ctx);
  return raw.map(stripInternalCsvFields);
}

function parseJsonpBody(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  try {
    if (raw.startsWith("(") && raw.endsWith(")")) return JSON.parse(raw.slice(1, -1));
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function decodeCompressedJson(payload) {
  const bin = Buffer.from(String(payload ?? ""), "base64");
  const decoders = [inflateRawSync, inflateSync, gunzipSync];
  for (const fn of decoders) {
    try {
      return JSON.parse(fn(bin).toString("utf8"));
    } catch {
      // next
    }
  }
  return null;
}

function toOddsNumber(v) {
  const m = String(v ?? "").replace(/\s+/g, "").match(/^(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function toRankNumber(v) {
  const n = parseInt(String(v ?? "").replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function toOddsRecord(item) {
  if (item == null) return null;
  if (Array.isArray(item)) {
    const horseNumber = toRankNumber(item[0]);
    if (!horseNumber) return null;
    return {
      horseNumber,
      marketWinOdds: toOddsNumber(item[1]),
      marketPopularity: toRankNumber(item[2]),
    };
  }
  if (typeof item !== "object") return null;
  const horseNumber = toRankNumber(
    item.horseNo ?? item.horse_no ?? item.horseNumber ?? item.umaban ?? item.no ?? item.num ?? item.horse,
  );
  if (!horseNumber) return null;
  return {
    horseNumber,
    marketWinOdds:
      toOddsNumber(item.odds) ??
      toOddsNumber(item.winOdds) ??
      toOddsNumber(item.win_odds) ??
      toOddsNumber(item.placeOdds) ??
      toOddsNumber(item.place_odds) ??
      toOddsNumber(item.fuku) ??
      toOddsNumber(item.tansho),
    marketPopularity:
      toRankNumber(item.popularity) ??
      toRankNumber(item.marketPopularity) ??
      toRankNumber(item.market_popularity) ??
      toRankNumber(item.ninki) ??
      toRankNumber(item.rank),
  };
}

function extractOddsRecords(node, out) {
  if (node == null) return;
  if (Array.isArray(node)) {
    for (const it of node) {
      const rec = toOddsRecord(it);
      if (rec && (rec.marketWinOdds != null || rec.marketPopularity != null)) out.push(rec);
      else if (it && typeof it === "object") extractOddsRecords(it, out);
    }
    return;
  }
  if (typeof node !== "object") return;
  for (const [k, v] of Object.entries(node)) {
    const horseNumber = toRankNumber(k);
    if (horseNumber && v && typeof v === "object") {
      const marketWinOdds = toOddsNumber(v.odds ?? v.winOdds ?? v.placeOdds ?? v.fuku ?? v.tansho);
      const marketPopularity = toRankNumber(v.popularity ?? v.ninki ?? v.rank);
      if (marketWinOdds != null || marketPopularity != null) {
        out.push({ horseNumber, marketWinOdds, marketPopularity });
      }
    }
    const rec = toOddsRecord(v);
    if (rec && (rec.marketWinOdds != null || rec.marketPopularity != null)) out.push(rec);
  }
}

function parseSpApiJraOddsRows(raceId) {
  const observedAt = new Date().toISOString();
  const url =
    `https://race.sp.netkeiba.com/?pid=api_get_jra_odds&input=UTF-8&output=jsonp&race_id=${raceId}` +
    "&type=b1&action=update&sort=0&compress=1";
  const body = fetchSpUtf8(url);
  const payload = parseJsonpBody(body);
  if (!payload || payload.status === "NG" || payload.data == null || payload.data === "") return [];
  const decodedData =
    typeof payload.data === "string" && payload.data.length > 0 ? decodeCompressedJson(payload.data) ?? payload.data : payload.data;
  const records = [];
  extractOddsRecords(decodedData, records);
  const uniq = new Map();
  for (const rec of records) {
    const horseNumber = toRankNumber(rec.horseNumber);
    if (!horseNumber) continue;
    const prev = uniq.get(horseNumber) ?? { marketWinOdds: null, marketPopularity: null };
    uniq.set(horseNumber, {
      raceId,
      horseNumber,
      actualOdds: null,
      marketWinOdds: rec.marketWinOdds ?? prev.marketWinOdds,
      marketPopularity: rec.marketPopularity ?? prev.marketPopularity,
      observedAt,
      source: "netkeiba-sp-api",
    });
  }
  return [...uniq.values()];
}

async function fetchFromJraLikeApi(raceId) {
  const base = process.env.JRA_ODDS_API_BASE_URL;
  if (!base) return [];
  try {
    const endpointTemplate = process.env.JRA_ODDS_API_ENDPOINT_TEMPLATE || "";
    const endpoint = endpointTemplate.length > 0 ? endpointTemplate.replaceAll("{raceId}", raceId) : "";
    const url = endpoint.length > 0 ? new URL(endpoint, base) : new URL(base);
    if (endpoint.length === 0) url.searchParams.set("raceId", raceId);
    const headers = {};
    if (process.env.JRA_ODDS_API_TOKEN) {
      headers.Authorization = `Bearer ${process.env.JRA_ODDS_API_TOKEN}`;
    }
    if (process.env.JRA_ODDS_API_KEY) {
      headers["X-API-Key"] = process.env.JRA_ODDS_API_KEY;
    }
    const res = await fetch(url, {
      headers: Object.keys(headers).length > 0 ? headers : undefined,
    });
    if (!res.ok) return [];
    const data = await res.json();
    const rowsPath = process.env.JRA_ODDS_API_ROWS_PATH || "";
    let rows = [];
    if (rowsPath.length > 0) {
      const viaPath = rowsPath.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), data);
      rows = Array.isArray(viaPath) ? viaPath : [];
    } else if (Array.isArray(data?.rows)) rows = data.rows;
    else if (Array.isArray(data?.list)) rows = data.list;
    else if (Array.isArray(data?.data)) rows = data.data;
    else if (Array.isArray(data)) rows = data;
    const observedAt = new Date().toISOString();
    return rows
      .map((r) => ({
        raceId,
        horseNumber: parseNumber(r.horseNumber ?? r.horse_no ?? r.umaban),
        actualOdds: parseNumber(r.actualOdds ?? r.actual_odds ?? r.placeOdds ?? r.place_odds),
        marketWinOdds: parseNumber(r.marketWinOdds ?? r.market_win_odds ?? r.winOdds ?? r.win_odds),
        marketPopularity: parseNumber(r.marketPopularity ?? r.market_popularity ?? r.popularity ?? r.ninki),
        observedAt: r.observedAt ?? r.observed_at ?? observedAt,
        source: "jra-api",
      }))
      .filter((r) => r.horseNumber != null);
  } catch {
    return [];
  }
}

function parseNetkeibaB1Odds(raceId) {
  // まず出馬表ページ自身が叩いている API を利用（取得できるときは最も正確）
  try {
    const apiRows = parseSpApiJraOddsRows(raceId);
    if (apiRows.length > 0) return apiRows;
  } catch {
    // fallback to HTML sources
  }

  let html = "";
  try {
    html = fetchUtf8(`https://race.netkeiba.com/odds/index.html?type=b1&race_id=${raceId}`);
  } catch {
    html = "";
  }
  const $ = load(html);
  const observedAt = new Date().toISOString();
  const rows = [];
  $("tr").each((_, tr) => {
    const tds = $(tr).children("td");
    if (tds.length < 6) return;
    const horseNumber = parseInt(tds.eq(1).text().replace(/[^\d]/g, ""), 10);
    if (!Number.isFinite(horseNumber) || horseNumber <= 0) return;
    const oddsText = tds.eq(tds.length - 1).text().replace(/\s+/g, " ").trim();
    const oddsMatch = oddsText.match(/(\d+\.\d+)/);
    const marketWinOdds = oddsMatch ? parseFloat(oddsMatch[1]) : null;
    if (marketWinOdds == null || !Number.isFinite(marketWinOdds) || marketWinOdds <= 0) return;
    const rowText = $(tr).text().replace(/\s+/g, " ").trim();
    const popMatch = rowText.match(/(\d+)人気/);
    const marketPopularity = popMatch ? parseInt(popMatch[1], 10) : null;
    rows.push({
      raceId,
      horseNumber,
      actualOdds: null,
      marketWinOdds,
      marketPopularity,
      observedAt,
      source: "netkeiba-b1",
    });
  });
  const uniq = new Map();
  for (const r of rows) {
    const prev = uniq.get(r.horseNumber);
    if (!prev) {
      uniq.set(r.horseNumber, r);
      continue;
    }
    uniq.set(r.horseNumber, {
      ...prev,
      marketWinOdds: prev.marketWinOdds ?? r.marketWinOdds,
      marketPopularity: prev.marketPopularity ?? r.marketPopularity,
    });
  }
  const out = [...uniq.values()];
  if (out.length > 0) return out;

  // PC版がブロックされる環境向けに、sp版 odds_view からオッズ取得を試みる
  const spOddsHtml = fetchSpUtf8(`https://race.sp.netkeiba.com/?pid=odds_view&race_id=${raceId}`);
  const spOdds = load(spOddsHtml);
  const spOddsRows = [];
  spOdds("tr.HorseList").each((_, tr) => {
    const oddsSpan = spOdds(tr).find('span[id^="odds-1_"]').first();
    const ninkiSpan = spOdds(tr).find('span[id^="ninki-1_"]').first();
    const idMatch = String(oddsSpan.attr("id") ?? ninkiSpan.attr("id") ?? "").match(/_(\d{1,2})$/);
    const horseNumber = idMatch ? parseInt(idMatch[1], 10) : NaN;
    if (!Number.isFinite(horseNumber) || horseNumber <= 0) return;
    const oddsText = oddsSpan.text().replace(/\s+/g, "").trim();
    const oddsMatch = oddsText.match(/^(\d+(?:\.\d+)?)$/);
    const marketWinOdds = oddsMatch ? parseFloat(oddsMatch[1]) : null;
    if (marketWinOdds == null || !Number.isFinite(marketWinOdds) || marketWinOdds <= 0) return;
    const ninkiText = ninkiSpan.text().replace(/\s+/g, "").trim();
    const ninkiMatch = ninkiText.match(/^(\d{1,2})$/);
    const marketPopularity = ninkiMatch ? parseInt(ninkiMatch[1], 10) : null;
    spOddsRows.push({
      raceId,
      horseNumber,
      actualOdds: null,
      marketWinOdds,
      marketPopularity,
      observedAt,
      source: "netkeiba-sp-odds",
    });
  });
  if (spOddsRows.length > 0) return spOddsRows;

  // sp odds_view も未掲出なら、sp出馬表も最終フォールバックで確認
  const spHtml = fetchSpUtf8(`https://race.sp.netkeiba.com/race/shutuba.html?race_id=${raceId}`);
  const $$ = load(spHtml);
  const spRows = [];
  $$("tr.HorseList").each((_, tr) => {
    const oddsSpan = $$(tr).find('span[id^="odds-1_"]').first();
    const ninkiSpan = $$(tr).find('span[id^="ninki-1_"]').first();
    const idMatch = String(oddsSpan.attr("id") ?? ninkiSpan.attr("id") ?? "").match(/_(\d{1,2})$/);
    const horseNumber = idMatch ? parseInt(idMatch[1], 10) : NaN;
    if (!Number.isFinite(horseNumber) || horseNumber <= 0) return;
    const oddsText = oddsSpan.text().replace(/\s+/g, "").trim();
    const oddsMatch = oddsText.match(/^(\d+(?:\.\d+)?)$/);
    const marketWinOdds = oddsMatch ? parseFloat(oddsMatch[1]) : null;
    if (marketWinOdds == null || !Number.isFinite(marketWinOdds) || marketWinOdds <= 0) return;
    const ninkiText = ninkiSpan.text().replace(/\s+/g, "").trim();
    const ninkiMatch = ninkiText.match(/^(\d{1,2})$/);
    const marketPopularity = ninkiMatch ? parseInt(ninkiMatch[1], 10) : null;
    spRows.push({
      raceId,
      horseNumber,
      actualOdds: null,
      marketWinOdds,
      marketPopularity,
      observedAt,
      source: "netkeiba-sp-shutuba",
    });
  });
  return spRows;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return;
  }
  const args = parseArgs(argv);
  if (args.explicitRaceIds.length > 0) validateExplicitRaceIds(args.explicitRaceIds);
  const raceIds = raceIdsFromIndex(args);
  if (raceIds.length === 0) {
    throw new Error(
      "no race ids for this selection. Check src/data/index.json or use --date / --all / --raceId=",
    );
  }

  const useApi = Boolean(process.env.JRA_ODDS_API_BASE_URL);
  /** @type {Awaited<ReturnType<typeof createJraOfficialOddsSession>> | null} */
  let jraSession = null;
  const obtainPlaywrightSession = async () => {
    if (raceIds.length <= 1) return null;
    if (!jraSession) jraSession = await createJraOfficialOddsSession();
    return jraSession;
  };

  const allRows = [];
  let byJra = 0;
  let byNetkeiba = 0;
  let jraMissRaces = 0;
  try {
    for (const raceId of raceIds) {
      if (args.source !== "netkeiba") {
        let jraRows = [];
        if (useApi) {
          jraRows = await fetchFromJraLikeApi(raceId);
        }
        if (jraRows.length === 0) {
          try {
            const sess = await obtainPlaywrightSession();
            jraRows = await fetchFromJraOfficialPlaywright(raceId, sess, ROOT);
          } catch (e) {
            process.stderr.write(`JRA official odds failed ${raceId}: ${e?.message || e}\n`);
            jraRows = [];
          }
        }
        if (jraRows.length > 0) {
          allRows.push(...jraRows);
          byJra += jraRows.length;
          if (jraSession) await jraSession.politeGap();
          else await sleep(args.sleepMs);
          continue;
        }
        jraMissRaces += 1;
        if (args.source === "jra") {
          await sleep(args.sleepMs);
          continue;
        }
      }
      if (args.source !== "jra") {
        const netkeibaRows = parseNetkeibaB1Odds(raceId);
        allRows.push(...netkeibaRows);
        byNetkeiba += netkeibaRows.length;
      }
      await sleep(args.sleepMs);
    }
  } finally {
    if (jraSession) await jraSession.close();
  }

  const outDir = dirname(args.outPath);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  writeFileSync(args.outPath, rowsToCsv(allRows), "utf8");
  process.stdout.write(
    `done. races=${raceIds.length}, rows=${allRows.length}, jra_rows=${byJra}, jra_miss_races=${jraMissRaces}, netkeiba_rows=${byNetkeiba}, source=${args.source}, out=${args.outPath}\n`,
  );
}

main().catch((e) => {
  process.stderr.write(String(e?.stack || e) + "\n");
  process.exit(1);
});
