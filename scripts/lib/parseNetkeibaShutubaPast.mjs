/**
 * shutuba_past.html（5走表示）の馬柱アイコン horse_race_type01〜05.png から脚質を読む。
 * PC: race.netkeiba.com/race/shutuba_past.html?race_id=
 */
import { load } from "cheerio";
import {
  mapNetkeibaHorseRaceTypeIconNumber,
  mapNetkeibaKyakuLabelToRunningStyle,
} from "./parseNetkeibaShutubaKyaku.mjs";

const RE_HORSE_RACE_TYPE = /horse_race_type(\d+)/i;

/** @param {string} href */
function horseIdFromHref(href) {
  const s = String(href ?? "");
  let m = s.match(/[?&]horse_id=(\d+)/);
  if (m) return m[1];
  m = s.match(/\/horse\/(\d+)/);
  return m ? m[1] : null;
}

/**
 * @param {string} src img の src
 * @returns {string|null}
 */
export function parseRunningStyleFromHorseRaceTypeImg(src) {
  const m = String(src ?? "").match(RE_HORSE_RACE_TYPE);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return mapNetkeibaHorseRaceTypeIconNumber(n);
}

/**
 * @param {string} html shutuba_past.html 全文
 * @returns {Map<string, string>} horseId → 逃げ|先行|好位|差し|追込
 */
export function parseShutubaPastHorseRunningStyles(html) {
  const map = new Map();
  const $ = load(html);
  const title = $("title").text();
  if (title.includes("エラー") || /お探しのページ/.test(html)) {
    return map;
  }

  let $rows = $("table#sort_table tbody tr");
  if ($rows.length === 0) $rows = $("table.Sort_Table tbody tr");
  if ($rows.length === 0) $rows = $("div.Shutuba_HorseList table tbody tr");
  if ($rows.length === 0) $rows = $("div.Newpaper_Container table tbody tr");

  $rows.each((_, el) => {
    const $tr = $(el);
    const link = $tr.find('a[href*="db.netkeiba.com/horse/"], a[href*="/horse/"]').first();
    if (!link.length) return;
    const horseId = horseIdFromHref(link.attr("href"));
    if (!horseId) return;
    if (map.has(horseId)) return;
    const img = $tr.find('img[src*="horse_race_type"]').first();
    let style = img.length ? parseRunningStyleFromHorseRaceTypeImg(img.attr("src") ?? "") : null;
    if (!style) {
      const ky = $tr.find("span.kyakusitu").first().text();
      style = mapNetkeibaKyakuLabelToRunningStyle(ky);
    }
    if (!style) return;
    map.set(horseId, style);
  });

  return map;
}

/**
 * メイン出馬表で脚質が取れていない馬に、5走表の馬柱アイコン由来の脚質を補完する。
 * @param {unknown[]} entries
 * @param {Map<string, string>} styleByHorseId
 */
export function applyShutubaPastRunningStylesToEntries(entries, styleByHorseId) {
  if (!styleByHorseId || styleByHorseId.size === 0) return;
  for (const e of entries) {
    if (e?.running_style_source === "netkeiba_shutuba") continue;
    const hid = String(e?.horseId ?? "");
    if (!hid) continue;
    const st = styleByHorseId.get(hid);
    if (!st) continue;
    e.runningStyle = st;
    e.running_style_source = "netkeiba_shutuba_past";
  }
}
