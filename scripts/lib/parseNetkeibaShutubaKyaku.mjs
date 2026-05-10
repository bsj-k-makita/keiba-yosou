/**
 * netkeiba 出馬表（shutuba）の各行から脚質ラベルを読む。
 * PC/SP で列レイアウトが変わるため複数経路を試す。
 * 現在の無料HTMLには脚質列が無いレースがあり、その場合は null。
 */

/**
 * @param {string} raw
 * @returns {string|null} 逃げ|先行|好位|差し|追込|自在 のいずれか
 */
export function mapNetkeibaKyakuLabelToRunningStyle(raw) {
  const t = String(raw ?? "")
    .replace(/\s+/g, "")
    .replace(/追い込み/g, "追込");
  if (!t || t === "--" || t === "—" || t === "---") return null;
  if (/大逃|逃げ|^逃/.test(t)) return "逃げ";
  if (/先行|^先/.test(t)) return "先行";
  if (/好位|^好/.test(t)) return "好位";
  if (/差し|^差/.test(t)) return "差し";
  if (/追込|^追/.test(t)) return "追込";
  if (/自在|^自/.test(t)) return "自在";
  return null;
}

/**
 * Icon_HorseMark… / 馬柱 `horse_race_type0n.png` の番号（1〜5）
 * @param {number} n
 * @returns {string|null}
 */
export function mapNetkeibaHorseRaceTypeIconNumber(n) {
  if (n === 1) return "逃げ";
  if (n === 2) return "先行";
  if (n === 3) return "好位";
  if (n === 4) return "差し";
  if (n === 5) return "追込";
  return null;
}

/**
 * @param {import("cheerio").CheerioAPI} $ - cheerio
 * @param {import("cheerio").Cheerio<Element>} $tr - tr.HorseList
 * @returns {string|null}
 */
export function parseRunningStyleFromShutubaHorseRow($tr, $) {
  const rowHtml = $tr.html() ?? "";
  const iconMatch = rowHtml.match(/Icon_HorseMark(?:Type)?[_]?(\d+)/i);
  if (iconMatch) {
    const n = parseInt(iconMatch[1], 10);
    const byIcon = mapNetkeibaHorseRaceTypeIconNumber(n);
    if (byIcon) return byIcon;
  }

  const tds = $tr.children("td");
  for (let i = 0; i < tds.length; i += 1) {
    const $td = $(tds[i]);
    const cls = `${$td.attr("class") ?? ""} ${$td.attr("id") ?? ""}`;
    if (!/Kyaku|脚質|HorseMark|MarkType|Txt_Kyaku/i.test(cls)) continue;
    let hit = mapNetkeibaKyakuLabelToRunningStyle($td.text());
    if (hit) return hit;
    const els = $td.find("span, img, b, em").toArray();
    for (const el of els) {
      const $e = $(el);
      hit =
        mapNetkeibaKyakuLabelToRunningStyle($e.attr("title")) ??
        mapNetkeibaKyakuLabelToRunningStyle($e.attr("alt")) ??
        mapNetkeibaKyakuLabelToRunningStyle($e.text());
      if (hit) return hit;
    }
  }

  const $kyakuDd = $tr.find(
    "td.HorseInfo dd.Kyaku, td.Horse_Info dd.Kyaku, dd[class*='Kyaku'], dd.Txt_Kyaku",
  );
  if ($kyakuDd.length) {
    const hit = mapNetkeibaKyakuLabelToRunningStyle($kyakuDd.first().text());
    if (hit) return hit;
  }

  return null;
}
