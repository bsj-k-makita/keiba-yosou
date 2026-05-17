/**
 * Vercel Serverless Function: GET /api/race-result?raceId=xxx
 * netkeiba result.html を取得し着順 JSON を返す。
 * ブラウザから直接呼べるため静的ファイル不要。
 */

import { load } from "cheerio";
import iconv from "iconv-lite";
import { parseNetkeibaPayouts } from "../scripts/lib/parseNetkeibaPayouts.mjs";

const NETKEIBA_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** 着差テキスト → 秒換算（scripts/lib/parseNetkeibaPastRuns.mjs と同ロジック） */
function parseChakusaToSeconds(raw) {
  if (raw == null) return null;
  const s = String(raw).replace(/\s+/g, "").trim();
  if (!s || s === "-" || s === "―" || s === "---") return 0;
  if (/^[入除][取察]|中止|取消|失格|除外/.test(s)) return null;
  if (s === "クビ") return 0.12;
  if (s === "アタマ" || s === "頭") return 0.06;
  if (s === "鼻") return 0.03;
  if (s === "大差") return 8;
  const mFrac = s.match(/^(\d+)\.(\d+)\/(\d+)$/);
  if (mFrac) {
    const ban = parseInt(mFrac[1], 10) + parseInt(mFrac[2], 10) / parseInt(mFrac[3], 10);
    return ban * 0.22;
  }
  const mHalf = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (mHalf) {
    return (parseInt(mHalf[1], 10) / parseInt(mHalf[2], 10)) * 0.22;
  }
  const num = parseFloat(s.replace(/[^\d.]/g, ""));
  if (Number.isFinite(num)) {
    if (num < 30 && (String(s).includes(".") || num < 10)) return num;
    return num * 0.22;
  }
  return null;
}

async function fetchResultPage(raceId) {
  const url = `https://race.netkeiba.com/race/result.html?race_id=${raceId}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": NETKEIBA_UA,
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from netkeiba`);
  }
  const buf = await res.arrayBuffer();
  return iconv.decode(Buffer.from(buf), "euc-jp");
}

function parseResultHtml(html, raceId) {
  const $ = load(html);

  if ($("title").text().includes("エラー") || /お探しのページ/.test(html)) {
    throw new Error("ページ未掲載（レース未開催の可能性）");
  }

  const rows = $("#All_Result_Table tbody tr, .RaceTable01 tbody tr");
  if (rows.length === 0) {
    throw new Error("着順テーブルが見つかりません");
  }

  const places = [];
  rows.each((_, el) => {
    const $tr = $(el);
    const tds = $tr.children("td");
    if (tds.length < 4) return;

    const placeRaw = tds.eq(0).text().trim().replace(/[^\d]/g, "");
    const place = parseInt(placeRaw, 10);
    if (!Number.isFinite(place) || place < 1 || place > 18) return;

    const horseLink = tds.eq(3).find('a[href*="/horse/"]').first();
    const href = horseLink.attr("href") ?? "";
    const idm = href.match(/horse\/([0-9]+)/);
    const horseId = idm ? idm[1] : "";
    const horseName = (horseLink.attr("title") || horseLink.text()).replace(/\s+/g, " ").trim()
      || tds.eq(3).text().trim();

    // タイム列・着差列のインデックスはレイアウト差異があるため試行
    const timeRaw = [7, 6, 8].map((i) => tds.eq(i).text().trim()).find((t) => /\d:\d\d\.\d/.test(t)) ?? "";
    const marginRaw = [8, 9, 7].map((i) => tds.eq(i).text().trim()).find((t) => t && t !== timeRaw) ?? "";
    const marginSec = place === 1 ? 0 : parseChakusaToSeconds(marginRaw);

    if (!horseName) return;
    places.push({ place, horseId, horseName, time: timeRaw, margin: marginSec });
  });

  if (places.length === 0) {
    throw new Error("着順行を1件も解析できません");
  }

  const payouts = parseNetkeibaPayouts(html);
  return { raceId, fetchedAt: new Date().toISOString(), places, payouts };
}

export default async function handler(req, res) {
  // CORS（念のため）
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  const { raceId } = req.query;
  if (!raceId || !/^\d{12}$/.test(String(raceId))) {
    res.status(400).json({ error: "raceId は12桁の数字で指定してください" });
    return;
  }

  try {
    const html = await fetchResultPage(raceId);
    const data = parseResultHtml(html, raceId);
    // 30分キャッシュ（レース終了後は頻繁に変わらない）
    res.setHeader("Cache-Control", "public, s-maxage=1800, stale-while-revalidate=3600");
    res.status(200).json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 404 相当（未開催・未掲載）
    if (msg.includes("未掲載") || msg.includes("テーブルが見つかりません") || msg.includes("解析できません")) {
      res.status(404).json({ error: msg });
    } else {
      res.status(502).json({ error: `netkeiba取得失敗: ${msg}` });
    }
  }
}
