import { load } from "cheerio";
import { fetchUtf8, sleep } from "./netkeibaFetch.mjs";
import { fetchPedigreeForHorse } from "./parseNetkeibaPedigree.mjs";

/**
 * 着差テキストを「勝ち馬からの遅れ（秒）」に近い値へ。
 * netkeiba 戦績表は秒の小数が多いが、馬身表記（3.1/2 等）も混ざる。
 */
export function parseChakusaToSeconds(raw) {
  if (raw == null) return null;
  const s = String(raw).replace(/\s+/g, "").trim();
  if (!s || s === "-" || s === "―" || s === "---") return 0;
  if (/^[入除][取察]|中止|取消|失格|除外/.test(s)) return null;
  if (s === "クビ") return 0.12;
  if (s === "アタマ" || s === "頭") return 0.06;
  if (s === "鼻") return 0.03;
  if (s === "大差") return 8;
  // 3.1/2 形式（3.5 馬身想定）
  const mFrac = s.match(/^(\d+)\.(\d+)\/(\d+)$/);
  if (mFrac) {
    const ban = parseInt(mFrac[1], 10) + parseInt(mFrac[2], 10) / parseInt(mFrac[3], 10);
    return ban * 0.22;
  }
  const mHalf = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (mHalf) {
    const a = parseInt(mHalf[1], 10) / parseInt(mHalf[2], 10);
    return a * 0.22;
  }
  const num = parseFloat(s.replace(/[^\d.]/g, ""));
  if (Number.isFinite(num)) {
    // 0.8〜20 程度の小数は秒とみなす（戦績表で一般的）
    if (num < 30 && (String(s).includes(".") || num < 10)) return num;
    return num * 0.22;
  }
  return null;
}

/**
 * レースページ先頭の 200m ラップ行（全馬共通のレースペース）をパース。
 * @returns {number[]|null}
 */
export function parseRaceLedgerLap200m(html) {
  const $ = load(html);
  const cell = $(".race_lap_cell").first().text().trim();
  if (!cell) return null;
  const parts = cell.split(/[-－―~〜]/).map((x) => parseFloat(x.trim())).filter((n) => Number.isFinite(n));
  return parts.length >= 4 ? parts : null;
}

function normalizeSex(v) {
  if (v === "牡" || v === "牝" || v === "セ") return v;
  return undefined;
}

/**
 * db.netkeiba 戦績表 thead から列インデックスを解決する。
 */
function buildDbResultHeaderIndex($) {
  const labels = $("table.db_h_race_results thead tr th")
    .toArray()
    .map((th, i) => ({ i, label: $(th).text().replace(/\s+/g, "").trim() }));

  const find = (keywords) => {
    for (const kw of keywords) {
      const hit = labels.find((x) => x.label.includes(kw));
      if (hit) return hit.i;
    }
    return -1;
  };

  return {
    date: find(["日付"]),
    kaisai: find(["開催"]),
    raceName: find(["レース名"]),
    fieldSize: find(["頭数"]),
    waku: find(["枠番", "枠"]),
    place: find(["着順"]),
    distance: find(["距離"]),
    margin: find(["着差"]),
    passing: find(["通過", "通過順"]),
    agari: find(["上り"]),
  };
}

/** ヘッダから解けた列インデックスに応じた最小 td 数（古い「12列固定」による行全スキップを防ぐ） */
function minTdCountForRow(hi) {
  const idxs = Object.values(hi).filter((x) => typeof x === "number" && x >= 0);
  return idxs.length ? Math.max(...idxs) + 1 : 12;
}

/** db_h_race_results 以外クラス名が変わった場合のフォールバック */
function findHorseResultTableRows($) {
  const direct = $("table.db_h_race_results tbody tr").toArray();
  if (direct.length) return direct;
  return $("table")
    .filter((_, el) => {
      const head = $(el).find("thead").text().replace(/\s+/g, "");
      return head.includes("レース名") && (head.includes("着順") || head.includes("開催"));
    })
    .first()
    .find("tbody tr")
    .toArray();
}

function venueFromKaisai(raw) {
  const vens = ["東京", "中山", "阪神", "京都", "中京", "新潟", "福島", "小倉", "札幌", "函館"];
  const t = String(raw ?? "").replace(/\s+/g, "");
  for (const v of vens) {
    if (t.includes(v)) return v;
  }
  return undefined;
}

function surfaceFromDistanceCol(raw) {
  const t = String(raw ?? "");
  if (t.startsWith("障") || t.includes("障")) return "ダート";
  if (t.startsWith("ダ") || t.includes("ダ")) return "ダート";
  return "芝";
}

function parseFinal3fFromAgari(raw) {
  const t = String(raw ?? "")
    .trim()
    .replace(/[^\d.]/g, "");
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : undefined;
}

function extractRaceIdFromHref(href) {
  const m = String(href ?? "").match(/\/race\/(\d{12})\//);
  return m ? m[1] : "";
}

function parseRaceSummaryLine(raw) {
  const s = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!s) return {};
  const dm = s.match(/(\d{4}[./]\d{1,2}[./]\d{1,2})/);
  const vm = s.match(/(東京|中山|阪神|京都|中京|新潟|福島|小倉|札幌|函館)\s*\d{1,2}R/);
  const sm = s.match(/(芝|ダ|障)\s*(\d{3,4})m/i);
  return {
    date: dm ? normalizeDate(dm[1]) : null,
    venue: vm ? vm[1] : undefined,
    surface: sm ? surfaceFromDistanceCol(sm[1]) : undefined,
    raceDistance: sm ? parseInt(sm[2], 10) : undefined,
  };
}

function parseJockeyFromSpResultLine(raw) {
  const s = String(raw ?? "").replace(/\s+/g, " ").trim();
  const m = s.match(/\)\s*([^\(\)]+)\(\d{2}\.\d\)/);
  return m ? m[1].trim() : undefined;
}

function parsePlaceFromSpResultLine(raw) {
  const t = String(raw ?? "").replace(/\s+/g, "").trim();
  const m = t.match(/^(\d{1,2})/);
  if (!m) return undefined;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : undefined;
}

function parseSpHorseResultCards($) {
  const rows = $("#ResultsList li .LinkBox_Item02").toArray().slice(0, 5);
  const out = [];
  for (const row of rows) {
    const anchor = $(row);
    const href = anchor.attr("href") ?? "";
    const raceId = extractRaceIdFromHref(href);
    const raceName = anchor.find(".Set_RaceName").first().text().replace(/\s+/g, " ").trim();
    const ps = anchor.find(".List_TextBox p");
    const line1 = ps.eq(0).text();
    const line2 = ps.eq(1).text();
    const summary = parseRaceSummaryLine(line1);
    const place = parsePlaceFromSpResultLine(line2);
    const jockey = parseJockeyFromSpResultLine(line2);
    out.push({
      ...(summary.date ? { date: summary.date } : {}),
      ...(raceId ? { raceId } : {}),
      ...(raceName ? { raceName } : {}),
      ...(raceName ? { raceClass: inferRaceClass(raceName) } : {}),
      ...(place != null ? { place } : {}),
      ...(summary.venue ? { venue: summary.venue } : {}),
      ...(summary.surface ? { surface: summary.surface } : {}),
      ...(summary.raceDistance != null ? { raceDistance: summary.raceDistance } : {}),
      ...(jockey ? { jockey } : {}),
    });
  }
  return out;
}

function fetchRaceLap200mWithFallback(raceId) {
  // 現在のネットワーク環境では db.netkeiba.com が 400 を返すことがあるため sp へフォールバック。
  const urls = [
    `https://db.netkeiba.com/race/${raceId}/`,
    `https://db.sp.netkeiba.com/race/${raceId}/`,
  ];
  for (const url of urls) {
    try {
      const html = fetchUtf8(url);
      const lap = parseRaceLedgerLap200m(html);
      if (lap && lap.length >= 4) return lap;
    } catch {
      // try next
    }
  }
  return null;
}

function parseHorseProfile($) {
  const text = $("body").text().replace(/\s+/g, " ");
  const sexAge =
    $(".db_prof_area_02")
      .text()
      .match(/(牡|牝|セ)\s*([0-9]{1,2})/) ??
    text.match(/(牡|牝|セ)\s*([0-9]{1,2})歳?/);

  const trainer =
    $('a[href*="/trainer/"]').first().text().replace(/\s+/g, " ").trim() ||
    $(".db_head_name.fc").text().replace(/\s+/g, " ").trim() ||
    undefined;

  const bodyWeightMatch = text.match(/馬体重[^0-9]*([0-9]{3})/);
  const bodyWeightKg = bodyWeightMatch ? parseInt(bodyWeightMatch[1], 10) : undefined;

  return {
    sex: normalizeSex(sexAge?.[1]),
    age: sexAge?.[2] ? parseInt(sexAge[2], 10) : undefined,
    trainer: trainer && trainer !== "厩舎" ? trainer : undefined,
    pedigree: {},
    bodyWeightKg: Number.isFinite(bodyWeightKg) ? bodyWeightKg : undefined,
  };
}

function mergePedigreeProfile(profile, pedigreeFromPed) {
  if (!pedigreeFromPed?.sireName) return profile;
  profile.pedigree = {
    ...(profile.pedigree ?? {}),
    ...(pedigreeFromPed.sireId ? { sireId: pedigreeFromPed.sireId } : {}),
    sireName: pedigreeFromPed.sireName,
    ...(pedigreeFromPed.damSireId ? { damSireId: pedigreeFromPed.damSireId } : {}),
    ...(pedigreeFromPed.damSireName ? { damSireName: pedigreeFromPed.damSireName } : {}),
    ...(pedigreeFromPed.sireLineName ? { sireLineName: pedigreeFromPed.sireLineName } : {}),
  };
  return profile;
}

/**
 * @param {string} horseId
 * @param {{ raceLapCache?: Map<string, number[]|null>, sleepMs?: number }} [opts]
 * @returns {Promise<{ pastRuns: object[], raceIdsFetched: string[], horseProfile: object }>}
 */
export async function fetchPastRunsForHorse(horseId, opts = {}) {
  const sleepMs = opts.sleepMs ?? 400;
  const raceLapCache = opts.raceLapCache ?? new Map();
  const urls = [
    `https://db.netkeiba.com/horse/result/${encodeURIComponent(horseId)}/`,
    `https://db.sp.netkeiba.com/horse/result/${encodeURIComponent(horseId)}/`,
  ];
  let html = "";
  for (const url of urls) {
    try {
      html = fetchUtf8(url);
      if (String(html ?? "").length >= 1000) break;
    } catch {
      // next URL
    }
  }
  const $ = load(html);
  const hi = buildDbResultHeaderIndex($);
  const needCells = minTdCountForRow(hi);
  const rows = findHorseResultTableRows($).slice(0, 5);
  const horseProfile = parseHorseProfile($);
  const pastRuns = [];
  const raceIdsFetched = [];

  for (const tr of rows) {
    const tds = $(tr).find("td");
    if (tds.length < needCells) continue;

    const dateText = hi.date >= 0 ? tds.eq(hi.date).text().trim() : "";
    const raceCell = hi.raceName >= 0 ? tds.eq(hi.raceName) : tds.eq(4);
    const raceLink = raceCell.find("a[href*='/race/']").attr("href") || "";
    const raceName = raceCell.find("a").first().text().replace(/\s+/g, " ").trim();
    const raceId = extractRaceIdFromHref(raceLink);

    const placeStr =
      hi.place >= 0 ? tds.eq(hi.place).text().trim().replace(/[^\d]/g, "") : "";
    const place = placeStr ? parseInt(placeStr, 10) : undefined;
    const chText = hi.margin >= 0 ? tds.eq(hi.margin).text().trim() : "";
    let marginToWinnerSec = parseChakusaToSeconds(chText);
    if (place === 1) marginToWinnerSec = 0;

    const kaisaiRaw = hi.kaisai >= 0 ? tds.eq(hi.kaisai).text() : "";
    const venue = venueFromKaisai(kaisaiRaw);
    const distRaw = hi.distance >= 0 ? tds.eq(hi.distance).text() : "";
    const surface = surfaceFromDistanceCol(distRaw);
    const fieldSizeRaw = hi.fieldSize >= 0 ? tds.eq(hi.fieldSize).text().trim().replace(/[^\d]/g, "") : "";
    const fieldSize = fieldSizeRaw ? parseInt(fieldSizeRaw, 10) : undefined;
    const wakuRaw = hi.waku >= 0 ? tds.eq(hi.waku).text().trim().replace(/[^\d]/g, "") : "";
    const waku = wakuRaw ? parseInt(wakuRaw, 10) : undefined;
    const passingRaw =
      hi.passing >= 0
        ? tds
            .eq(hi.passing)
            .text()
            .replace(/\s+/g, "")
            .trim()
        : "";
    const passingOrder = passingRaw || undefined;
    const final3fSec = hi.agari >= 0 ? parseFinal3fFromAgari(tds.eq(hi.agari).text()) : undefined;

    let section200mSec = undefined;
    if (raceId) {
      if (!raceLapCache.has(raceId)) {
        await sleep(sleepMs);
        raceLapCache.set(raceId, fetchRaceLap200mWithFallback(raceId));
        raceIdsFetched.push(raceId);
      }
      const lap = raceLapCache.get(raceId);
      if (lap && lap.length) section200mSec = lap;
    }

    const ymd = normalizeDate(dateText);
    const raceClass = inferRaceClass(raceName);
    pastRuns.push({
      ...(ymd ? { date: ymd } : {}),
      ...(raceId ? { raceId } : {}),
      ...(raceName ? { raceName } : {}),
      ...(raceClass ? { raceClass } : {}),
      ...(place != null && !Number.isNaN(place) ? { place } : {}),
      ...(marginToWinnerSec != null ? { marginToWinnerSec } : {}),
      ...(section200mSec ? { section200mSec } : {}),
      ...(venue ? { venue } : {}),
      ...(surface ? { surface } : {}),
      ...(fieldSize != null && !Number.isNaN(fieldSize) ? { fieldSize } : {}),
      ...(waku != null && !Number.isNaN(waku) ? { waku } : {}),
      ...(passingOrder ? { passingOrder } : {}),
      ...(final3fSec != null ? { final3fSec } : {}),
    });
  }

  if (pastRuns.length === 0) {
    const mobileRows = parseSpHorseResultCards($);
    for (const run of mobileRows) {
      pastRuns.push(run);
      const raceId = run.raceId;
      if (!raceId) continue;
      if (!raceLapCache.has(raceId)) {
        await sleep(sleepMs);
        raceLapCache.set(raceId, fetchRaceLap200mWithFallback(raceId));
        raceIdsFetched.push(raceId);
      }
      const lap = raceLapCache.get(raceId);
      if (lap && lap.length) run.section200mSec = lap;
    }
  }

  try {
    await sleep(Math.min(sleepMs, 250));
    const pedigreeFromPed = fetchPedigreeForHorse(horseId);
    mergePedigreeProfile(horseProfile, pedigreeFromPed);
  } catch {
    // 血統ページ未取得でも過去走は返す
  }

  return { pastRuns, raceIdsFetched, horseProfile };
}

function normalizeDate(text) {
  const flat = text.replace(/\s/g, "");
  const m =
    flat.match(/(\d{4})[./](\d{1,2})[./](\d{1,2})/) ?? flat.match(/(\d{4})[年](\d{1,2})[月](\d{1,2})/);
  if (m) {
    const y = m[1];
    const mo = m[2].padStart(2, "0");
    const d = m[3].padStart(2, "0");
    return `${y}-${mo}-${d}`;
  }
  return null;
}

function inferRaceClass(raceName) {
  const s = String(raceName ?? "").replace(/\s+/g, "");
  if (!s) return "その他";
  if (/(G[ⅠI1]|JpnⅠ|GI|ＧⅠ|G1)/i.test(s)) return "G1";
  if (/(G[ⅡI2]|JpnⅡ|GII|ＧⅡ|G2)/i.test(s)) return "G2";
  if (/(G[ⅢI3]|JpnⅢ|GIII|ＧⅢ|G3)/i.test(s)) return "G3";
  if (/オープン|OP|L\b|リステッド/i.test(s)) return "OP";
  if (/3勝|1600万/i.test(s)) return "3勝";
  if (/2勝|1000万/i.test(s)) return "2勝";
  if (/1勝|500万/i.test(s)) return "1勝";
  if (/新馬/.test(s)) return "新馬";
  if (/未勝利/.test(s)) return "未勝利";
  return "その他";
}
