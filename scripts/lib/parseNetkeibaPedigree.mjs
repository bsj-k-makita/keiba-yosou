import { load } from "cheerio";
import { fetchUtf8 } from "./netkeibaFetch.mjs";

/**
 * netkeiba 5代血統表の先頭セル配置（父=0, 母=1, 母父=2）から主要血統を抽出。
 * @param {import('cheerio').CheerioAPI} $
 * @param {import('cheerio').Element} td
 */
function extractHorseFromPedCell($, td) {
  const $td = $(td);
  const a = $td
    .find('a[href*="/horse/"]')
    .filter((_, el) => {
      const t = $(el).text().replace(/\s+/g, "").trim();
      return t.length > 0 && t !== "血統" && t !== "産駒";
    })
    .first();
  if (!a.length) return null;
  const href = a.attr("href") ?? "";
  const m = href.match(/\/horse\/([^/]+)\//);
  const name = a.text().replace(/\s+/g, " ").trim();
  if (!name) return null;
  return { id: m?.[1] ?? undefined, name };
}

/**
 * @param {string} html
 * @returns {{
 *   sireId?: string,
 *   sireName?: string,
 *   damSireId?: string,
 *   damSireName?: string,
 *   sireLineName?: string,
 * } | null}
 */
export function parsePedigreeFromPedHtml(html) {
  if (!html || String(html).length < 500) return null;
  const $ = load(html);
  if ($("title").text().includes("エラー") || /お探しのページ/.test(html)) return null;

  const cells = $(".blood_table.detail td").toArray();
  if (cells.length < 3) return null;

  const sire = extractHorseFromPedCell($, cells[0]);
  const damSire = extractHorseFromPedCell($, cells[2]);
  if (!sire?.name) return null;

  const sireCellText = $(cells[0]).text().replace(/\s+/g, " ");
  const lineMatch = sireCellText.match(/([A-Za-z\u3040-\u9fff]+系)/);

  return {
    ...(sire.id ? { sireId: sire.id } : {}),
    sireName: sire.name,
    ...(damSire?.id ? { damSireId: damSire.id } : {}),
    ...(damSire?.name ? { damSireName: damSire.name } : {}),
    ...(lineMatch?.[1] ? { sireLineName: lineMatch[1] } : {}),
  };
}

/**
 * @param {string} horseId
 * @returns {ReturnType<typeof parsePedigreeFromPedHtml>}
 */
export function fetchPedigreeForHorse(horseId) {
  const id = String(horseId ?? "").trim();
  if (!id) return null;
  const urls = [
    `https://db.netkeiba.com/horse/ped/${encodeURIComponent(id)}/`,
    `https://db.sp.netkeiba.com/horse/ped/${encodeURIComponent(id)}/`,
  ];
  for (const url of urls) {
    try {
      const html = fetchUtf8(url);
      const parsed = parsePedigreeFromPedHtml(html);
      if (parsed?.sireName) return parsed;
    } catch {
      // try next
    }
  }
  return null;
}
