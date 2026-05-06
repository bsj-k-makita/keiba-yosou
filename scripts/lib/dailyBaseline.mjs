import { readFileSync, readdirSync, writeFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
export const DAILY_BASELINE_PATH = join(ROOT, "src/data/daily_baseline.json");
export const DEFAULT_RACES_DIR = join(ROOT, "src/data/races");

function mean(nums) {
  const a = nums.filter((x) => Number.isFinite(x));
  if (a.length === 0) return null;
  return a.reduce((x, y) => x + y, 0) / a.length;
}

function stddev(nums) {
  const a = nums.filter((x) => Number.isFinite(x));
  if (a.length < 2) return null;
  const m = mean(a);
  if (m == null) return null;
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length);
}

/** @param {unknown} s */
export function normalizeSurfaceLabel(s) {
  const t = String(s ?? "");
  if (t === "ダート" || t.startsWith("ダ")) return "ダート";
  return "芝";
}

export function dayVenueSurfaceKey(date, venue, surface) {
  return `${date}|${venue}|${normalizeSurfaceLabel(surface)}`;
}

/**
 * 1 レース JSON から analysis メトリクスを取り出す（無ければ null）
 * @param {object} doc
 */
export function extractAnalysisMetrics(doc) {
  const a = doc?.analysis;
  if (a == null || typeof a !== "object") return null;
  const bias = a.bias ?? {};
  return {
    paceBalance: typeof a.paceBalance === "number" && Number.isFinite(a.paceBalance) ? a.paceBalance : null,
    medianFinal3fSec:
      typeof a.medianFinal3fSec === "number" && Number.isFinite(a.medianFinal3fSec) ? a.medianFinal3fSec : null,
    meanMarginFieldSec:
      typeof a.meanMarginFieldSec === "number" && Number.isFinite(a.meanMarginFieldSec) ? a.meanMarginFieldSec : null,
    innerOuter: typeof bias.innerOuter === "number" && Number.isFinite(bias.innerOuter) ? bias.innerOuter : null,
    frontCloser: typeof bias.frontCloser === "number" && Number.isFinite(bias.frontCloser) ? bias.frontCloser : null,
  };
}

/**
 * 同一日・競馬場・芝/ダの「他レース」だけからピア平均を作る（オンライン・ネットワーク無し）。
 * @param {string} racesDir
 * @param {string} date YYYY-MM-DD
 * @param {string} venue
 * @param {string} surface 芝 | ダート
 * @param {string} excludeRaceId 除外するレース（現在処理中）
 */
export function aggregatePeerBaseline(racesDir, date, venue, surface, excludeRaceId) {
  const wantedSurf = normalizeSurfaceLabel(surface);
  let files = [];
  try {
    files = readdirSync(racesDir).filter((f) => f.endsWith(".json"));
  } catch {
    return { count: 0, avgPaceBalance: null, avgMedianFinal3fSec: null, avgMeanMarginFieldSec: null };
  }

  const pb = [];
  const mf3 = [];
  const mm = [];
  const io = [];
  const fc = [];

  for (const f of files) {
    const raceId = f.replace(/\.json$/i, "");
    if (raceId === excludeRaceId) continue;
    let doc;
    try {
      doc = JSON.parse(readFileSync(join(racesDir, f), "utf8"));
    } catch {
      continue;
    }
    if (doc?.meta?.date !== date) continue;
    if (String(doc?.meta?.venue ?? "").trim() !== String(venue).trim()) continue;
    if (normalizeSurfaceLabel(doc?.meta?.surface) !== wantedSurf) continue;

    const m = extractAnalysisMetrics(doc);
    if (m == null) continue;

    if (m.paceBalance != null) pb.push(m.paceBalance);
    if (m.medianFinal3fSec != null) mf3.push(m.medianFinal3fSec);
    if (m.meanMarginFieldSec != null) mm.push(m.meanMarginFieldSec);
    if (m.innerOuter != null) io.push(m.innerOuter);
    if (m.frontCloser != null) fc.push(m.frontCloser);
  }

  const count = Math.max(pb.length, mf3.length, mm.length);
  return {
    count: pb.length,
    avgPaceBalance: mean(pb),
    avgMedianFinal3fSec: mean(mf3),
    avgMeanMarginFieldSec: mean(mm),
    avgBiasInnerOuter: mean(io),
    avgBiasFrontCloser: mean(fc),
    stdPaceBalance: stddev(pb),
  };
}

/**
 * `src/data/races/*.json` を全走査し、日×場×芝/ダごとのベースラインを構築する。
 * @param {string} racesDir
 */
export function buildDailyBaselineMaster(racesDir) {
  /** @type {Map<string, { samples: object[] }>} */
  const buckets = new Map();

  let files = [];
  try {
    files = readdirSync(racesDir).filter((f) => f.endsWith(".json"));
  } catch {
    return { version: 1, updatedAt: new Date().toISOString(), sourceRaceFiles: 0, entries: {} };
  }

  for (const f of files) {
    let doc;
    try {
      doc = JSON.parse(readFileSync(join(racesDir, f), "utf8"));
    } catch {
      continue;
    }
    const date = doc?.meta?.date;
    const venue = doc?.meta?.venue;
    if (!date || !venue) continue;
    const surface = normalizeSurfaceLabel(doc?.meta?.surface);
    const m = extractAnalysisMetrics(doc);
    if (m == null) continue;

    const key = dayVenueSurfaceKey(date, venue, surface);
    const bucket = buckets.get(key) ?? { samples: [] };
    bucket.samples.push(m);
    buckets.set(key, bucket);
  }

  const entries = {};
  for (const [key, { samples }] of buckets) {
    const pb = samples.map((s) => s.paceBalance).filter((x) => x != null && Number.isFinite(x));
    const mf3 = samples.map((s) => s.medianFinal3fSec).filter((x) => x != null && Number.isFinite(x));
    const mm = samples.map((s) => s.meanMarginFieldSec).filter((x) => x != null && Number.isFinite(x));
    const io = samples.map((s) => s.innerOuter).filter((x) => x != null && Number.isFinite(x));
    const fcv = samples.map((s) => s.frontCloser).filter((x) => x != null && Number.isFinite(x));

    entries[key] = {
      raceCount: samples.length,
      avgPaceBalance: mean(pb),
      stdPaceBalance: stddev(pb),
      avgMedianFinal3fSec: mean(mf3),
      avgMeanMarginFieldSec: mean(mm),
      avgBiasInnerOuter: mean(io),
      avgBiasFrontCloser: mean(fcv),
    };
  }

  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    sourceRaceFiles: files.length,
    entries,
  };
}

export function loadDailyBaseline(path = DAILY_BASELINE_PATH) {
  if (!existsSync(path)) return { version: 1, updatedAt: null, sourceRaceFiles: 0, entries: {} };
  return JSON.parse(readFileSync(path, "utf8"));
}

export function saveDailyBaseline(data, path = DAILY_BASELINE_PATH) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

/**
 * 保存済み daily_baseline.json からキー Lookup（ピア集計が無い場合のフォールバック）
 */
export function lookupDailyBaselineEntry(baselineRoot, date, venue, surface) {
  const entries = baselineRoot?.entries ?? {};
  const key = dayVenueSurfaceKey(date, venue, surface);
  return entries[key] ?? null;
}
