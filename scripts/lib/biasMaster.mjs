import { readFileSync, writeFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { fetchUtf8, sleep } from "./netkeibaFetch.mjs";
import { parseRaceResultNetkeiba } from "./parseRaceResultNetkeiba.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
export const BIAS_MASTER_PATH = join(ROOT, "src/data/bias_master.json");

/** 内枠占有率がこれ以上なら「内有利」 */
export const INNER_SHARE_THRESHOLD = 0.42;
/** 外枠×後方コーナー由来のTop3がこれ以上なら「外差し有利」 */
export const OUTER_SASHI_SHARE_THRESHOLD = 0.22;

/**
 * @param {string|null|undefined} cornerPassing
 * @param {number} fieldSize
 */
export function parseCornerRanks(cornerPassing, fieldSize) {
  if (cornerPassing == null || cornerPassing === "") return [];
  const parts = String(cornerPassing)
    .split(/[-－―]/)
    .map((x) => parseInt(x.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  return parts;
}

/**
 * 最終コーナー通過が「中団以降」か（1が先頭）。field の約上位2/5より後ろ。
 */
export function isMidPackOrWorseLastCorner(lastCornerRank, fieldSize) {
  if (!Number.isFinite(lastCornerRank) || lastCornerRank <= 0) return false;
  const n = Math.max(8, Number(fieldSize) || 16);
  const threshold = Math.max(4, Math.ceil(n * 0.38));
  return lastCornerRank >= threshold;
}

function biasKey(date, venue, surface) {
  return `${date}|${venue}|${surface}`;
}

/**
 * @param {object} agg
 * @param {object} opts
 */
export function finalizeBiasEntry(agg, opts = {}) {
  const innerThreshold = opts.innerThreshold ?? INNER_SHARE_THRESHOLD;
  const outerThreshold = opts.outerThreshold ?? OUTER_SASHI_SHARE_THRESHOLD;
  const top3Total = Math.max(1, agg.top3Total || 0);
  const innerShare = (agg.top3InnerCount ?? 0) / top3Total;
  const outerSashiShare = (agg.outerSashiTop3Count ?? 0) / top3Total;
  return {
    raceCount: agg.raceCount ?? 0,
    top3Total,
    top3InnerCount: agg.top3InnerCount ?? 0,
    innerShare,
    outerSashiTop3Count: agg.outerSashiTop3Count ?? 0,
    outerSashiShare,
    innerFavor: innerShare >= innerThreshold,
    outerSashiFavor: outerSashiShare >= outerThreshold,
  };
}

/**
 * 1レースの解析済み行からバイアス集計バンドルへ合算する。
 * @param {Map<string, object>} bucket
 * @param {string} date 'YYYY-MM-DD'
 * @param {string} venue
 * @param {string} surface '芝'|'ダート'
 * @param {{place:number,waku:number,cornerPassing:string|null}[]} topRows place<=3
 * @param {number} fieldSize
 */
export function accumulateRaceIntoBiasMaster(bucket, date, venue, surface, topRows, fieldSize) {
  const key = biasKey(date, venue, surface);
  const agg = bucket.get(key) ?? {
    top3InnerCount: 0,
    outerSashiTop3Count: 0,
    top3Total: 0,
    raceCount: 0,
  };
  agg.raceCount += 1;
  for (const row of topRows) {
    agg.top3Total += 1;
    if (row.waku >= 1 && row.waku <= 3) agg.top3InnerCount += 1;
    const corners = parseCornerRanks(row.cornerPassing, fieldSize);
    const last = corners.length > 0 ? corners[corners.length - 1] : null;
    if (row.waku >= 7 && row.waku <= 8 && isMidPackOrWorseLastCorner(last, fieldSize)) {
      agg.outerSashiTop3Count += 1;
    }
  }
  bucket.set(key, agg);
}

/**
 * @param {Map<string, object>} bucket
 */
export function bucketToSerializable(bucket) {
  const entries = {};
  for (const [k, agg] of bucket) {
    entries[k] = finalizeBiasEntry(agg);
  }
  return entries;
}

/**
 * @param {Record<string, object>} biasEntries
 * @param {object} lastRun
 */
export function lookupBiasForPastRun(biasEntries, lastRun) {
  if (biasEntries == null || lastRun == null) return null;
  const date = lastRun.date;
  const venue = lastRun.venue;
  const surface = lastRun.surface;
  if (!date || !venue || !surface) return null;
  const key = biasKey(date, venue, surface);
  return biasEntries[key] ?? null;
}

/**
 * @param {object|null} biasRow finalizeBiasEntry の結果
 * @param {object} lastRun
 */
export function computeWasBiasDisadvantaged(biasRow, lastRun) {
  if (biasRow == null || lastRun == null) return false;
  const waku = lastRun.waku;
  const fs = lastRun.fieldSize ?? 16;
  const corners = parseCornerRanks(lastRun.passingOrder ?? lastRun.cornerPassing, fs);
  const lastCorner = corners.length > 0 ? corners[corners.length - 1] : null;
  const mid = Math.max(3, Math.ceil(fs / 3));

  if (biasRow.innerFavor === true && Number.isFinite(waku) && waku >= 7) {
    return true;
  }
  if (biasRow.outerSashiFavor === true && Number.isFinite(waku) && waku <= 3) {
    if (lastCorner != null && lastCorner <= mid) return true;
  }
  return false;
}

/**
 * @param {string} indexPath
 * @param {{ sleepMs?: number, onProgress?: (s:string)=>void }} opts
 * @returns {Promise<{ entries: Record<string, object>, fetchedRaces: number }>}
 */
export async function buildBiasMasterFromIndex(indexPath, opts = {}) {
  const sleepMs = opts.sleepMs ?? 400;
  const index = JSON.parse(readFileSync(indexPath, "utf8"));
  if (!Array.isArray(index)) throw new Error("index.json must be an array");

  const bucket = new Map();
  let fetched = 0;

  for (const row of index) {
    const raceId = row.raceId;
    const date = row.date;
    const venue = row.venue;
    const surface = row.surface === "ダート" ? "ダート" : "芝";
    if (!raceId || !date || !venue) continue;

    try {
      opts.onProgress?.(raceId);
      const url = `https://race.netkeiba.com/race/result.html?race_id=${raceId}`;
      const html = fetchUtf8(url);
      const { places } = parseRaceResultNetkeiba(html, raceId);
      const fieldSize = places.length;
      const top = places.filter((p) => p.place <= 3);
      accumulateRaceIntoBiasMaster(bucket, date, venue, surface, top, fieldSize);
      fetched += 1;
    } catch {
      // 未確定・未取得レースはスキップ
    }
    await sleep(sleepMs);
  }

  const entries = bucketToSerializable(bucket);
  return { entries, fetchedRaces: fetched };
}

export function loadBiasMaster(path = BIAS_MASTER_PATH) {
  if (!existsSync(path)) return { version: 1, updatedAt: null, entries: {} };
  return JSON.parse(readFileSync(path, "utf8"));
}

export function saveBiasMaster(data, path = BIAS_MASTER_PATH) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

/**
 * index.json を走査して bias_master.json を更新する。
 */
export async function updateBiasMasterFromNetwork(opts = {}) {
  const indexPath = opts.indexPath ?? join(ROOT, "src/data/index.json");
  const { entries, fetchedRaces } = await buildBiasMasterFromIndex(indexPath, opts);
  const next = {
    version: 1,
    updatedAt: new Date().toISOString(),
    fetchedRaces,
    entries,
  };
  saveBiasMaster(next, opts.outPath ?? BIAS_MASTER_PATH);
  return next;
}

const RESULTS_DIR = join(ROOT, "src/data/results");

/**
 * 保存済み results/{raceId}.json から指定日の bias_master エントリだけ差し替える。
 * 全 index の netkeiba 再取得を避ける（レートリミット対策）。
 */
export function updateBiasMasterForDate(date, opts = {}) {
  const indexPath = opts.indexPath ?? join(ROOT, "src/data/index.json");
  const resultsDir = opts.resultsDir ?? RESULTS_DIR;
  const index = JSON.parse(readFileSync(indexPath, "utf8"));
  if (!Array.isArray(index)) throw new Error("index.json must be an array");

  const bucket = new Map();
  let fetched = 0;

  for (const row of index) {
    if (row.date !== date || !row.raceId || !row.venue) continue;
    const resultPath = join(resultsDir, `${row.raceId}.json`);
    if (!existsSync(resultPath)) continue;
    const result = JSON.parse(readFileSync(resultPath, "utf8"));
    const places = result.places ?? [];
    if (places.length < 3) continue;
    const surface = row.surface === "ダート" ? "ダート" : "芝";
    const top = places
      .filter((p) => p.place <= 3)
      .map((p) => ({
        place: p.place,
        waku: p.waku,
        cornerPassing: p.cornerPassing ?? null,
      }));
    accumulateRaceIntoBiasMaster(bucket, date, row.venue, surface, top, places.length);
    fetched += 1;
  }

  const newEntries = bucketToSerializable(bucket);
  const master = loadBiasMaster(opts.outPath ?? BIAS_MASTER_PATH);
  const entries = { ...(master.entries ?? {}) };
  const prefix = `${date}|`;
  for (const key of Object.keys(entries)) {
    if (key.startsWith(prefix)) delete entries[key];
  }
  Object.assign(entries, newEntries);

  const next = {
    version: 1,
    updatedAt: new Date().toISOString(),
    fetchedRaces: fetched,
    entries,
  };
  saveBiasMaster(next, opts.outPath ?? BIAS_MASTER_PATH);
  return next;
}
