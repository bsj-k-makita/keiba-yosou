#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { load } from "cheerio";
import { gunzipSync, inflateRawSync, inflateSync } from "zlib";
import { fetchUtf8, fetchSpUtf8, sleep } from "./lib/netkeibaFetch.mjs";
import { enrichInvestmentSignalsInRaceData } from "./lib/investmentSignals.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const RACES_DIR = join(ROOT, "src/data/races");
const INDEX_PATH = join(ROOT, "src/data/index.json");

function parseArgs(argv) {
  const out = {
    all: false,
    date: "",
    raceIds: [],
    sleepMs: 300,
    retries: 1,
    retryWaitMs: 30000,
    source: "browser",
  };
  for (const a of argv) {
    if (a === "--all") out.all = true;
    else if (a.startsWith("--date=")) out.date = a.slice("--date=".length).trim();
    else if (a.startsWith("--sleep=")) out.sleepMs = Math.max(100, parseInt(a.slice(8), 10) || 300);
    else if (a.startsWith("--retries=")) out.retries = Math.max(1, parseInt(a.slice(10), 10) || 1);
    else if (a.startsWith("--retry-wait=")) out.retryWaitMs = Math.max(1000, parseInt(a.slice(13), 10) || 30000);
    else if (a.startsWith("--source=")) out.source = a.slice("--source=".length).trim();
    else if (!a.startsWith("-")) out.raceIds.push(a.replace(/\.json$/, ""));
  }
  if (!["browser", "http", "auto"].includes(out.source)) {
    throw new Error(`invalid --source: ${out.source}`);
  }
  if (out.date && !/^\d{4}-\d{2}-\d{2}$/.test(out.date)) {
    throw new Error(`invalid --date format: ${out.date}`);
  }
  return out;
}

function listRaceIds() {
  if (!existsSync(RACES_DIR)) return [];
  return readdirSync(RACES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

function listRaceIdsByDate(date) {
  const rows = JSON.parse(readFileSync(INDEX_PATH, "utf8"));
  return rows
    .filter((r) => r?.date === date)
    .map((r) => String(r.raceId))
    .filter(Boolean);
}

function parseTanshoOddsAndPopularity(raceId) {
  const url = `https://race.netkeiba.com/odds/index.html?type=b1&race_id=${raceId}`;
  const html = fetchUtf8(url);
  const $ = load(html);
  const byHorseNo = new Map();
  $("tr").each((_, tr) => {
    const tds = $(tr).children("td");
    if (tds.length < 6) return;
    let horseNo = parseInt(tds.eq(1).text().replace(/[^\d]/g, ""), 10);
    if (!Number.isFinite(horseNo) || horseNo < 1) {
      const idCandidates = [
        $(tr).find('span[id^="uno-1_"]').first().attr("id"),
        $(tr).find('span[id^="odds-1_"]').first().attr("id"),
        $(tr).find('span[id^="ninki-1_"]').first().attr("id"),
      ];
      for (const id of idCandidates) {
        const m = String(id ?? "").match(/_(\d{1,2})$/);
        if (!m) continue;
        const parsed = parseInt(m[1], 10);
        if (Number.isFinite(parsed) && parsed >= 1) {
          horseNo = parsed;
          break;
        }
      }
    }
    if (!Number.isFinite(horseNo) || horseNo < 1) return;
    const oddsText = tds.eq(tds.length - 1).text().replace(/\s+/g, " ").trim();
    const oddsMatch = oddsText.match(/(\d+\.\d+)/);
    const odds = oddsMatch ? parseFloat(oddsMatch[1]) : null;
    const rowText = $(tr).text().replace(/\s+/g, " ").trim();
    const popMatch = rowText.match(/(\d+)人気/);
    const popularity = popMatch ? parseInt(popMatch[1], 10) : null;
    const current = byHorseNo.get(horseNo);
    if (current == null) {
      byHorseNo.set(horseNo, { odds, popularity });
      return;
    }
    // 同じ行が2セットあるので、より情報量が多い方を採用。
    byHorseNo.set(horseNo, {
      odds: current.odds ?? odds,
      popularity: current.popularity ?? popularity,
    });
  });
  return byHorseNo;
}

function parseTrackMeta($) {
  const text = $(".RaceData01, .RaceData02").text().replace(/\s+/g, " ").trim();
  const weather = text.match(/天候[:：]?\s*(晴|曇|雨|雪|小雨|小雪)/)?.[1] ?? null;
  const groundLabel = text.match(/馬場[:：]?\s*(良|稍重|重|不良)/)?.[1] ?? null;
  return { weather, groundLabel };
}

function parseShutubaOddsAndPopularity(raceId) {
  const url = `https://race.netkeiba.com/race/shutuba.html?race_id=${raceId}`;
  let html = "";
  try {
    html = fetchUtf8(url);
  } catch {
    html = "";
  }
  if (String(html ?? "").length < 1000) {
    html = fetchSpUtf8(`https://race.sp.netkeiba.com/race/shutuba.html?race_id=${raceId}`);
  }
  const $ = load(html);
  const meta = parseTrackMeta($);
  const byHorseNo = new Map();
  const byHorseId = new Map();
  $("tr.HorseList").each((_, tr) => {
    const tds = $(tr).children("td");
    if (tds.length < 2) return;
    let horseNo = parseInt(tds.eq(1).text().replace(/[^\d]/g, ""), 10);
    const horseHref = $(tr).find('a[href*="/horse/"]').first().attr("href");
    const horseIdMatch = String(horseHref ?? "").match(/horse\/(\d+)/);
    const horseId = horseIdMatch ? horseIdMatch[1] : undefined;
    if (!Number.isFinite(horseNo) || horseNo < 1) {
      const idCandidates = [
        $(tr).find('span[id^="uno-1_"]').first().attr("id"),
        $(tr).find('span[id^="odds-1_"]').first().attr("id"),
        $(tr).find('span[id^="ninki-1_"]').first().attr("id"),
      ];
      for (const id of idCandidates) {
        const m = String(id ?? "").match(/_(\d{1,2})$/);
        if (!m) continue;
        const parsed = parseInt(m[1], 10);
        if (Number.isFinite(parsed) && parsed >= 1) {
          horseNo = parsed;
          break;
        }
      }
    }
    if (!Number.isFinite(horseNo) || horseNo < 1) horseNo = null;

    // shutuba 固有: odds-1_01 / ninki-1_01 のような ID でオッズと人気が埋まる
    const oddsText = $(tr).find('span[id^="odds-1_"]').first().text().replace(/\s+/g, "").trim();
    const oddsMatch = oddsText.match(/^(\d+(?:\.\d+)?)$/);
    const odds = oddsMatch ? parseFloat(oddsMatch[1]) : null;

    const ninkiText = $(tr).find('span[id^="ninki-1_"]').first().text().replace(/\s+/g, "").trim();
    const ninkiMatch = ninkiText.match(/^(\d{1,2})$/);
    const popularity = ninkiMatch ? parseInt(ninkiMatch[1], 10) : null;

    if (odds == null && popularity == null) return;
    if ((horseNo == null || horseNo < 1) && !horseId) return;
    const payload = { odds, popularity };
    if (horseNo != null && horseNo >= 1) byHorseNo.set(horseNo, payload);
    if (horseId) byHorseId.set(horseId, payload);
  });
  return { byHorseNo, byHorseId, meta };
}

function parseSpShutubaOddsAndPopularity(raceId) {
  const html = fetchSpUtf8(`https://race.sp.netkeiba.com/race/shutuba.html?race_id=${raceId}`);
  const $ = load(html);
  const meta = parseTrackMeta($);
  const byHorseNo = new Map();
  const byHorseId = new Map();
  $("tr.HorseList").each((_, tr) => {
    const oddsSpan = $(tr).find('span[id^="odds-1_"]').first();
    const ninkiSpan = $(tr).find('span[id^="ninki-1_"]').first();
    const idMatch = String(oddsSpan.attr("id") ?? ninkiSpan.attr("id") ?? "").match(/_(\d{1,2})$/);
    const horseNo = idMatch ? parseInt(idMatch[1], 10) : null;
    const horseHref = $(tr).find('a[href*="/horse/"]').first().attr("href");
    const horseIdMatch = String(horseHref ?? "").match(/horse\/(\d+)/);
    const horseId = horseIdMatch ? horseIdMatch[1] : undefined;
    const oddsText = oddsSpan.text().replace(/\s+/g, "").trim();
    const oddsMatch = oddsText.match(/^(\d+(?:\.\d+)?)$/);
    const odds = oddsMatch ? parseFloat(oddsMatch[1]) : null;
    const ninkiText = ninkiSpan.text().replace(/\s+/g, "").trim();
    const ninkiMatch = ninkiText.match(/^(\d{1,2})$/);
    const popularity = ninkiMatch ? parseInt(ninkiMatch[1], 10) : null;
    if (odds == null && popularity == null) return;
    if ((horseNo == null || horseNo < 1) && !horseId) return;
    const payload = { odds, popularity };
    if (horseNo != null && horseNo >= 1) byHorseNo.set(horseNo, payload);
    if (horseId) byHorseId.set(horseId, payload);
  });
  return { byHorseNo, byHorseId, meta };
}

function parseSpOddsView(raceId) {
  const html = fetchSpUtf8(`https://race.sp.netkeiba.com/?pid=odds_view&race_id=${raceId}`);
  const $ = load(html);
  const byHorseNo = new Map();
  const byHorseId = new Map();
  const rows = $("tr.HorseList");
  if (rows.length === 0) return { byHorseNo, byHorseId };
  rows.each((_, tr) => {
    const oddsSpan = $(tr).find('span[id^="odds-1_"]').first();
    const ninkiSpan = $(tr).find('span[id^="ninki-1_"]').first();
    const idMatch = String(oddsSpan.attr("id") ?? ninkiSpan.attr("id") ?? "").match(/_(\d{1,2})$/);
    const horseNo = idMatch ? parseInt(idMatch[1], 10) : null;
    const horseHref = $(tr).find('a[href*="/horse/"]').first().attr("href");
    const horseIdMatch = String(horseHref ?? "").match(/horse\/(\d+)/);
    const horseId = horseIdMatch ? horseIdMatch[1] : undefined;
    const oddsText = oddsSpan.text().replace(/\s+/g, "").trim();
    const oddsMatch = oddsText.match(/^(\d+(?:\.\d+)?)$/);
    const odds = oddsMatch ? parseFloat(oddsMatch[1]) : null;
    const ninkiText = ninkiSpan.text().replace(/\s+/g, "").trim();
    const ninkiMatch = ninkiText.match(/^(\d{1,2})$/);
    const popularity = ninkiMatch ? parseInt(ninkiMatch[1], 10) : null;
    if (odds == null && popularity == null) return;
    if ((horseNo == null || horseNo < 1) && !horseId) return;
    const payload = { odds, popularity };
    if (horseNo != null && horseNo >= 1) byHorseNo.set(horseNo, payload);
    if (horseId) byHorseId.set(horseId, payload);
  });
  return { byHorseNo, byHorseId };
}

function parseJsonpBody(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  try {
    if (raw.startsWith("(") && raw.endsWith(")")) {
      return JSON.parse(raw.slice(1, -1));
    }
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function decodeCompressedJson(payload) {
  const buf = Buffer.from(String(payload ?? ""), "base64");
  const decoders = [inflateRawSync, inflateSync, gunzipSync];
  for (const decode of decoders) {
    try {
      const json = decode(buf).toString("utf8");
      const parsed = JSON.parse(json);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // next decoder
    }
  }
  return null;
}

function parseOddsNumber(value) {
  if (value == null) return null;
  const m = String(value).replace(/\s+/g, "").match(/^(\d+\.\d+)$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseRankNumber(value) {
  if (value == null) return null;
  const m = String(value).replace(/[^\d]/g, "");
  if (!m) return null;
  const n = parseInt(m, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function toOddsRecord(item) {
  if (item == null) return null;
  if (Array.isArray(item)) {
    const horseNo = parseRankNumber(item[0]);
    if (!horseNo) return null;
    return {
      horseNo,
      odds: parseOddsNumber(item[1]),
      popularity: parseRankNumber(item[2]),
    };
  }
  if (typeof item !== "object") return null;
  const horseNo = parseRankNumber(
    item.horseNo ?? item.horse_no ?? item.horseNumber ?? item.umaban ?? item.no ?? item.num ?? item.horse,
  );
  if (!horseNo) return null;
  const odds =
    parseOddsNumber(item.odds) ??
    parseOddsNumber(item.winOdds) ??
    parseOddsNumber(item.win_odds) ??
    parseOddsNumber(item.placeOdds) ??
    parseOddsNumber(item.place_odds) ??
    parseOddsNumber(item.fuku) ??
    parseOddsNumber(item.tansho);
  const popularity =
    parseRankNumber(item.popularity) ??
    parseRankNumber(item.marketPopularity) ??
    parseRankNumber(item.market_popularity) ??
    parseRankNumber(item.ninki) ??
    parseRankNumber(item.rank);
  return { horseNo, odds, popularity };
}

function extractOddsRecords(node, out) {
  if (node == null) return;
  if (Array.isArray(node)) {
    for (const it of node) {
      const rec = toOddsRecord(it);
      if (rec && (rec.odds != null || rec.popularity != null)) out.push(rec);
      else if (it && typeof it === "object") extractOddsRecords(it, out);
    }
    return;
  }
  if (typeof node !== "object") return;
  for (const [k, v] of Object.entries(node)) {
    // { "1": { odds: "2.3", ninki: "1" }, ... } 形式
    const keyHorseNo = parseRankNumber(k);
    if (keyHorseNo && v && typeof v === "object") {
      const odds = parseOddsNumber(v.odds ?? v.winOdds ?? v.placeOdds ?? v.fuku ?? v.tansho);
      const popularity = parseRankNumber(v.popularity ?? v.ninki ?? v.rank);
      if (odds != null || popularity != null) {
        out.push({ horseNo: keyHorseNo, odds, popularity });
      }
    }
    const rec = toOddsRecord(v);
    if (rec && (rec.odds != null || rec.popularity != null)) out.push(rec);
  }
}

function parseSpApiJraOdds(raceId) {
  const url =
    `https://race.sp.netkeiba.com/?pid=api_get_jra_odds&input=UTF-8&output=jsonp&race_id=${raceId}` +
    "&type=b1&action=update&sort=0&compress=1";
  const body = fetchSpUtf8(url);
  const payload = parseJsonpBody(body);
  if (!payload || payload.status === "NG" || payload.data == null || payload.data === "") {
    return { byHorseNo: new Map(), byHorseId: new Map() };
  }
  const decodedData =
    typeof payload.data === "string" && payload.data.length > 0 ? decodeCompressedJson(payload.data) ?? payload.data : payload.data;
  const records = [];
  extractOddsRecords(decodedData, records);
  const byHorseNo = new Map();
  for (const rec of records) {
    if (!Number.isFinite(rec.horseNo) || rec.horseNo < 1) continue;
    const prev = byHorseNo.get(rec.horseNo) ?? { odds: null, popularity: null };
    byHorseNo.set(rec.horseNo, {
      odds: rec.odds ?? prev.odds,
      popularity: rec.popularity ?? prev.popularity,
    });
  }
  return { byHorseNo, byHorseId: new Map() };
}

function mergeOddsMaps(primary, fallback) {
  const merged = new Map();
  for (const [horseNo, rec] of fallback.entries()) merged.set(horseNo, { ...rec });
  for (const [horseNo, rec] of primary.entries()) {
    const prev = merged.get(horseNo) ?? { odds: null, popularity: null };
    merged.set(horseNo, {
      odds: rec.odds ?? prev.odds,
      popularity: rec.popularity ?? prev.popularity,
    });
  }
  return merged;
}

function applyOddsToRaceData(data, oddsByHorseNo, oddsByHorseId) {
  let updated = 0;
  const observedAt = new Date().toISOString();
  for (const entry of data.entries ?? []) {
    const horseId = String(entry.horseId ?? "");
    const horseNo = Number(entry.horseNumber);
    const hit = (horseId ? oddsByHorseId.get(horseId) : undefined) ?? oddsByHorseNo.get(horseNo);
    if (!hit) continue;
    if (hit.odds != null && Number.isFinite(hit.odds) && hit.odds > 0) {
      entry.market_win_odds = hit.odds;
      entry.marketWinOdds = hit.odds;
      entry.market_win_odds_source = "actual";
      entry.market_observed_at = observedAt;
      updated += 1;
    }
    if (hit.popularity != null && Number.isFinite(hit.popularity) && hit.popularity > 0) {
      entry.market_popularity = hit.popularity;
      entry.marketPopularity = hit.popularity;
      entry.market_popularity_source = "actual";
      entry.market_observed_at = observedAt;
    }
  }
  return updated;
}

function applyTrackMetaToRaceData(data, meta) {
  if (!data?.meta || !meta) return false;
  const nextWeather = meta.weather ?? data.meta.weather ?? null;
  const nextGroundLabel = meta.groundLabel ?? data.meta.groundLabel ?? null;
  let changed = false;
  if ((data.meta.weather ?? null) !== nextWeather) {
    data.meta.weather = nextWeather;
    changed = true;
  }
  if ((data.meta.groundLabel ?? null) !== nextGroundLabel) {
    data.meta.groundLabel = nextGroundLabel;
    changed = true;
  }
  return changed;
}

function normalizeBrowserRows(rows) {
  const byHorseNo = new Map();
  const byHorseId = new Map();
  for (const row of rows ?? []) {
    const horseNo = Number(row?.horseNo);
    const horseId = row?.horseId ? String(row.horseId) : "";
    const odds = Number.isFinite(row?.odds) ? Number(row.odds) : null;
    const popularity = Number.isFinite(row?.popularity) ? Number(row.popularity) : null;
    if ((!Number.isFinite(horseNo) || horseNo < 1) && horseId.length === 0) continue;
    if (odds == null && popularity == null) continue;
    const payload = { odds, popularity };
    if (Number.isFinite(horseNo) && horseNo >= 1) byHorseNo.set(horseNo, payload);
    if (horseId.length > 0) byHorseId.set(horseId, payload);
  }
  return { byHorseNo, byHorseId };
}

async function createBrowserOddsFetcher() {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    return null;
  }
  const channel = process.env.ODDS_BROWSER_CHANNEL || "chrome";
  const browser = await chromium.launch({
    headless: true,
    channel,
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  let blockedByUpstream = false;

  return {
    async fetchRaceOdds(raceId) {
      if (blockedByUpstream) return { byHorseNo: new Map(), byHorseId: new Map() };
      const url = `https://race.netkeiba.com/race/shutuba.html?race_id=${raceId}`;
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      } catch (e) {
        const msg = String(e?.message || e || "");
        if (msg.includes("ERR_HTTP_RESPONSE_CODE_FAILURE")) {
          blockedByUpstream = true;
          process.stderr.write("browser source blocked by upstream. fallback to http source for this run.\n");
          return { byHorseNo: new Map(), byHorseId: new Map() };
        }
        throw e;
      }
      await page.waitForTimeout(1200);
      const rows = await page.evaluate(() => {
        const parseNoFromId = (id) => {
          const m = String(id ?? "").match(/_(\d{1,2})$/);
          if (!m) return null;
          const n = Number.parseInt(m[1], 10);
          return Number.isFinite(n) && n >= 1 ? n : null;
        };
        const parseOdds = (s) => {
          const m = String(s ?? "").replace(/\s+/g, "").match(/^(\d+\.\d)$/);
          return m ? Number.parseFloat(m[1]) : null;
        };
        const parsePopularity = (s) => {
          const m = String(s ?? "").replace(/\s+/g, "").match(/^(\d{1,2})$/);
          return m ? Number.parseInt(m[1], 10) : null;
        };
        const out = [];
        const rows = Array.from(document.querySelectorAll("tr.HorseList"));
        for (const tr of rows) {
          const horseAnchor = tr.querySelector('a[href*="/horse/"]');
          const href = horseAnchor?.getAttribute("href") ?? "";
          const horseId = (href.match(/horse\/(\d+)/) ?? [])[1] ?? "";
          const cells = tr.querySelectorAll("td");
          const noText = cells.length > 1 ? (cells[1]?.textContent ?? "") : "";
          let horseNo = Number.parseInt(noText.replace(/[^\d]/g, ""), 10);
          if (!Number.isFinite(horseNo) || horseNo < 1) {
            horseNo =
              parseNoFromId(tr.querySelector('span[id^="uno-1_"]')?.id) ??
              parseNoFromId(tr.querySelector('span[id^="odds-1_"]')?.id) ??
              parseNoFromId(tr.querySelector('span[id^="ninki-1_"]')?.id) ??
              NaN;
          }
          const oddsText = tr.querySelector('span[id^="odds-1_"]')?.textContent ?? "";
          const ninkiText = tr.querySelector('span[id^="ninki-1_"]')?.textContent ?? "";
          out.push({
            horseNo: Number.isFinite(horseNo) && horseNo >= 1 ? horseNo : null,
            horseId: horseId.length > 0 ? horseId : null,
            odds: parseOdds(oddsText),
            popularity: parsePopularity(ninkiText),
          });
        }
        return out;
      });
      return normalizeBrowserRows(rows);
    },
    async close() {
      await context.close();
      await browser.close();
    },
  };
}

async function processRace(raceId, opts) {
  const path = join(RACES_DIR, `${raceId}.json`);
  if (!existsSync(path)) return { changed: false, fetched: 0 };
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const before = JSON.stringify(raw);
  let oddsByHorseNo = new Map();
  let oddsByHorseId = new Map();
  let resolvedMeta = { weather: null, groundLabel: null };

  if (opts.source === "browser" || opts.source === "auto") {
    if (opts.browserFetcher != null) {
      try {
        const browserOdds = await opts.browserFetcher.fetchRaceOdds(raceId);
        oddsByHorseNo = mergeOddsMaps(oddsByHorseNo, browserOdds.byHorseNo);
        oddsByHorseId = new Map([...oddsByHorseId.entries(), ...browserOdds.byHorseId.entries()]);
      } catch (e) {
        process.stderr.write(`browser fetch failed ${raceId}: ${e?.message || e}\n`);
      }
    }
  }

  if (opts.source === "http" || opts.source === "auto" || (opts.source === "browser" && oddsByHorseNo.size === 0)) {
    let api = { byHorseNo: new Map(), byHorseId: new Map() };
    try {
      api = parseSpApiJraOdds(raceId);
    } catch {
      // ignore
    }
    const b1 = parseTanshoOddsAndPopularity(raceId);
    const shutuba = parseShutubaOddsAndPopularity(raceId);
    let sp = { byHorseNo: new Map(), byHorseId: new Map(), meta: { weather: null, groundLabel: null } };
    let spOddsView = { byHorseNo: new Map(), byHorseId: new Map() };
    try {
      sp = parseSpShutubaOddsAndPopularity(raceId);
    } catch {
      // sp も失敗時は従来ソースのみ
    }
    try {
      spOddsView = parseSpOddsView(raceId);
    } catch {
      // ignore
    }
    oddsByHorseNo = mergeOddsMaps(
      mergeOddsMaps(mergeOddsMaps(mergeOddsMaps(mergeOddsMaps(oddsByHorseNo, api.byHorseNo), shutuba.byHorseNo), sp.byHorseNo), spOddsView.byHorseNo),
      b1,
    );
    oddsByHorseId = new Map([
      ...oddsByHorseId.entries(),
      ...shutuba.byHorseId.entries(),
      ...sp.byHorseId.entries(),
      ...spOddsView.byHorseId.entries(),
    ]);
    resolvedMeta = {
      weather: shutuba.meta?.weather ?? sp.meta?.weather ?? null,
      groundLabel: shutuba.meta?.groundLabel ?? sp.meta?.groundLabel ?? null,
    };
  }

  const fetched = applyOddsToRaceData(raw, oddsByHorseNo, oddsByHorseId);
  applyTrackMetaToRaceData(raw, resolvedMeta);
  const next = enrichInvestmentSignalsInRaceData(raw);
  const after = JSON.stringify(next);
  if (before !== after) {
    writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    return { changed: true, fetched };
  }
  return { changed: false, fetched };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const raceIds = args.all
    ? listRaceIds()
    : args.date
      ? listRaceIdsByDate(args.date)
      : args.raceIds;
  if (raceIds.length === 0) {
    process.stderr.write("Usage: node scripts/fetch-live-odds.mjs --all | --date=YYYY-MM-DD | <raceId> [raceId...] [--sleep=300] [--retries=3] [--retry-wait=30000]\n");
    process.exit(1);
  }
  let changedTotal = 0;
  let fetchedTotal = 0;
  let pending = [...raceIds];
  const browserFetcher = args.source === "http" ? null : await createBrowserOddsFetcher();
  if ((args.source === "browser" || args.source === "auto") && browserFetcher == null) {
    process.stderr.write("browser source unavailable (playwright not installed). fallback=http only.\n");
  }
  for (let round = 1; round <= args.retries; round += 1) {
    if (pending.length === 0) break;
    let roundFetched = 0;
    let roundChanged = 0;
    const nextPending = [];
    for (const raceId of pending) {
      try {
        const res = await processRace(raceId, {
          source: args.source,
          browserFetcher,
        });
        if (res.changed) {
          changedTotal += 1;
          roundChanged += 1;
        }
        fetchedTotal += res.fetched;
        roundFetched += res.fetched;
        if (res.fetched <= 0) nextPending.push(raceId);
      } catch (e) {
        process.stderr.write(`skip ${raceId}: ${e?.message || e}\n`);
        nextPending.push(raceId);
      }
      await sleep(args.sleepMs);
    }
    pending = nextPending;
    process.stdout.write(
      `round ${round}/${args.retries}: changed=${roundChanged}, fetched=${roundFetched}, pending=${pending.length}\n`,
    );
    if (pending.length > 0 && round < args.retries) {
      await sleep(args.retryWaitMs);
    }
  }
  if (browserFetcher != null) await browserFetcher.close();
  process.stdout.write(
    `done. changed ${changedTotal}/${raceIds.length} files, fetched odds rows=${fetchedTotal}, unresolved races=${pending.length}.\n`,
  );
}

main();
