/**
 * Vercel Serverless Function: GET /api/race-result?raceId=xxx
 * netkeiba result.html を取得し着順 JSON を返す。
 */

import {
  fetchRaceResultFromNetkeiba,
  isRaceResultNotReadyError,
} from "../scripts/lib/fetchRaceResultFromNetkeiba.mjs";

export default async function handler(req, res) {
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
    const data = await fetchRaceResultFromNetkeiba(String(raceId));
    res.setHeader("Cache-Control", "public, s-maxage=1800, stale-while-revalidate=3600");
    res.status(200).json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isRaceResultNotReadyError(err)) {
      res.status(404).json({ error: msg });
    } else {
      res.status(502).json({ error: `netkeiba取得失敗: ${msg}` });
    }
  }
}
