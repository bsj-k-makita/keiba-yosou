import { load } from "cheerio";
import { parseChakusaToSeconds } from "./parseNetkeibaPastRuns.mjs";

/**
 * race.netkeiba.com race/result.html の結果テーブルをパースする。
 * @param {string} html
 * @param {string} [raceId]
 * @returns {{
 *   places: Array<{
 *     place: number,
 *     waku: number,
 *     horseId: string,
 *     horseName: string,
 *     final3fSec: number | null,
 *     cornerPassing: string | null,
 *     marginToWinnerSec: number | null,
 *   }>
 * }}
 */
export function parseRaceResultNetkeiba(html, raceId = "") {
  const $ = load(html);

  if ($("title").text().includes("エラー") || /お探しのページ/.test(html)) {
    throw new Error("ページ取得失敗または未掲載（レース未開催の可能性）");
  }

  const table = $("#All_Result_Table, .RaceTable01").first();
  const headerCells = table.find("thead tr th")
    .toArray()
    .map((th) =>
      $(th)
        .text()
        .replace(/\s+/g, "")
        .trim(),
    );

  const idx = (label) => {
    const i = headerCells.findIndex((t) => t === label || t.includes(label));
    return i >= 0 ? i : -1;
  };

  const iPlace = idx("着順");
  const iWaku = idx("枠");
  const iHorse = idx("馬名") >= 0 ? idx("馬名") : 3;
  const iFinal3f = idx("後3F");
  const iCorner = idx("コーナー通過順") >= 0 ? idx("コーナー通過順") : idx("通過");
  const iMargin = idx("着差");

  const rows = table.find("tbody tr");
  const places = [];

  rows.each((_, el) => {
    const $tr = $(el);
    const tds = $tr.children("td");
    if (tds.length < 4) return;

    const placeRaw = (iPlace >= 0 ? tds.eq(iPlace) : tds.eq(0)).text().trim().replace(/[^\d]/g, "");
    const place = parseInt(placeRaw, 10);
    if (!Number.isFinite(place) || place < 1) return;

    const wakuRaw = (iWaku >= 0 ? tds.eq(iWaku) : tds.eq(1)).text().trim().replace(/[^\d]/g, "");
    const waku = parseInt(wakuRaw, 10) || 0;

    const horseLink = tds.eq(iHorse).find('a[href*="/horse/"]').first();
    const href = horseLink.attr("href") ?? "";
    const idm = href.match(/horse\/([0-9]+)/);
    const horseId = idm ? idm[1] : "";

    const horseName = (horseLink.attr("title") || horseLink.text()).replace(/\s+/g, " ").trim()
      || tds.eq(iHorse).text().trim();

    let final3fSec = null;
    if (iFinal3f >= 0) {
      const t = tds
        .eq(iFinal3f)
        .text()
        .trim()
        .replace(/[^\d.]/g, "");
      const f = parseFloat(t);
      if (Number.isFinite(f)) final3fSec = f;
    }

    let cornerPassing = null;
    if (iCorner >= 0) {
      cornerPassing =
        tds
          .eq(iCorner)
          .text()
          .replace(/\s+/g, "")
          .trim() || null;
      if (cornerPassing === "") cornerPassing = null;
    }

    let marginToWinnerSec = null;
    if (iMargin >= 0) {
      const marginCell = tds.eq(iMargin).text().trim();
      marginToWinnerSec = parseChakusaToSeconds(marginCell);
    }
    if (place === 1) marginToWinnerSec = 0;

    places.push({
      place,
      waku,
      horseId,
      horseName,
      final3fSec,
      cornerPassing,
      marginToWinnerSec,
    });
  });

  if (places.length === 0) {
    throw new Error(`着順行を1件も解析できません (${raceId})`);
  }

  return { places };
}
