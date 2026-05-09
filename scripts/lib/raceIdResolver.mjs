/**
 * 12桁 raceId と index / レース JSON から JRA 公式（sp.jra.jp）ナビ用コンテキストを解決する。
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";

/**
 * @param {string} isoDate YYYY-MM-DD
 * @returns {string} YYYYMMDD
 */
export function compactDateFromIso(isoDate) {
  return String(isoDate ?? "")
    .trim()
    .replace(/-/g, "")
    .slice(0, 8);
}

/**
 * @param {string} raceId
 * @param {string} root リポジトリルート
 * @returns {{
 *   raceId: string,
 *   venue: string,
 *   date: string,
 *   raceNumber: number,
 *   raceName: string,
 *   compactDate: string
 * }}
 */
export function resolveRaceNavigationContext(raceId, root) {
  const id = String(raceId ?? "").trim();
  if (!/^\d{12}$/.test(id)) {
    const hint =
      /^[…⋯]+$/.test(id) || /^\.{2,3}$/.test(id)
        ? " Remove placeholder … and use the real 12-digit id."
        : "";
    throw new Error(`raceIdResolver: invalid raceId (expected 12 digits): ${raceId}.${hint}`);
  }

  const indexPath = join(root, "src/data/index.json");
  const racePath = join(root, "src/data/races", `${id}.json`);

  let venue;
  let date;
  let raceNumber;
  let raceName;

  if (existsSync(indexPath)) {
    const rows = JSON.parse(readFileSync(indexPath, "utf8"));
    const row = Array.isArray(rows) ? rows.find((r) => String(r.raceId) === id) : null;
    if (row) {
      venue = row.venue;
      date = row.date;
      raceNumber = row.raceNumber != null ? Number(row.raceNumber) : NaN;
      raceName = row.raceName;
    }
  }

  if (existsSync(racePath)) {
    const doc = JSON.parse(readFileSync(racePath, "utf8"));
    const ri = doc.raceInfo ?? {};
    venue = venue ?? ri.venue ?? doc.meta?.venue;
    date = date ?? ri.date ?? doc.meta?.date;
    if (!Number.isFinite(raceNumber)) {
      raceNumber = ri.raceNumber != null ? Number(ri.raceNumber) : NaN;
    }
    raceName = raceName ?? ri.raceName ?? doc.meta?.raceName;
  }

  if (!Number.isFinite(raceNumber) || raceNumber < 1) {
    raceNumber = parseInt(id.slice(-2), 10);
  }

  if (!venue || !date || !Number.isFinite(raceNumber) || raceNumber < 1) {
    throw new Error(
      `raceIdResolver: need venue, date, raceNumber for ${id}. ` +
        `Fill src/data/index.json and/or src/data/races/${id}.json.`,
    );
  }

  const compactDate = compactDateFromIso(date);
  if (!/^\d{8}$/.test(compactDate)) {
    throw new Error(`raceIdResolver: invalid date for ${id}: ${date}`);
  }

  return {
    raceId: id,
    venue: String(venue).trim(),
    date: String(date).trim(),
    raceNumber,
    raceName: raceName != null ? String(raceName).trim() : "",
    compactDate,
  };
}
