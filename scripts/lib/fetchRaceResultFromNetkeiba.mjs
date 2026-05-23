import { fetchUtf8 } from "./netkeibaFetch.mjs";
import { parseNetkeibaPayouts } from "./parseNetkeibaPayouts.mjs";
import { parseRaceResultNetkeiba } from "./parseRaceResultNetkeiba.mjs";

/**
 * netkeiba 結果ページを取得し RaceResultData 形式に正規化する。
 * @param {string} raceId 12桁
 * @returns {Promise<{ raceId: string, fetchedAt: string, places: unknown[], payouts: unknown }>}
 */
export async function fetchRaceResultFromNetkeiba(raceId) {
  const url = `https://race.netkeiba.com/race/result.html?race_id=${raceId}`;
  const html = fetchUtf8(url);
  let places;
  try {
    ({ places } = parseRaceResultNetkeiba(html, raceId));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("結果未確定") || msg.includes("着順行")) {
      throw new Error(`結果未確定（未発走または暫定掲載）: ${msg}`);
    }
    throw e;
  }
  const payouts = parseNetkeibaPayouts(html);
  return {
    raceId,
    fetchedAt: new Date().toISOString(),
    places,
    payouts,
  };
}

/** 未発走・暫定掲載など、再取得を待つべきエラーか */
export function isRaceResultNotReadyError(err) {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("結果未確定") ||
    msg.includes("未発走") ||
    msg.includes("テーブルが見つかりません") ||
    msg.includes("着順行を1件も解析") ||
    msg.includes("ページ未掲載")
  );
}
