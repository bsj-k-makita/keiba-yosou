/**
 * レース結果ページ＋ db ラップから `analysis`（バイアス・ラップ質）を組み立てる。
 * 未確定レースでは例外になり呼び出し側で握りつぶす。
 */
import { fetchUtf8 } from "./netkeibaFetch.mjs";
import { parseRaceResultNetkeiba } from "./parseRaceResultNetkeiba.mjs";
import { parseRaceLedgerLap200m } from "./parseNetkeibaPastRuns.mjs";
import { paceFrontBackSkewEarlyMinusLate } from "./raceFeatureEngineering.mjs";
import {
  accumulateRaceIntoBiasMaster,
  finalizeBiasEntry,
  parseCornerRanks,
} from "./biasMaster.mjs";
import {
  aggregatePeerBaseline,
  DEFAULT_RACES_DIR,
  loadDailyBaseline,
  lookupDailyBaselineEntry,
} from "./dailyBaseline.mjs";

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

function round2(x) {
  return Math.round(x * 100) / 100;
}

function median(nums) {
  const arr = nums.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (arr.length === 0) return null;
  const m = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[m] : (arr[m - 1] + arr[m]) / 2;
}

function mean(a) {
  return a.length === 0 ? 0 : a.reduce((x, y) => x + y, 0) / a.length;
}

function stdev(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length);
}

/**
 * lapStructure.ts と同じ分類（日本語ラベル）
 */
export function classifyLapStructureJs(section200mSec) {
  const s = Array.isArray(section200mSec) ? section200mSec.map(Number) : [];
  if (s.length < 4) return "中間";
  const n = s.length;
  const l1 = s[n - 1];
  const l2 = s[n - 2];
  const l3 = s[n - 3];
  const l4 = s[n - 4];
  const l5 = n >= 5 ? s[n - 5] : null;

  if (l3 - l2 >= 0.45 && l2 <= 11.5) {
    return "瞬発戦";
  }

  if (n >= 6) {
    const f3 = s[0] + s[1] + s[2];
    const b3 = s[n - 3] + s[n - 2] + s[n - 1];
    if (f3 + 1.0 <= b3 && l1 > l2 + 0.12) {
      return "消耗戦";
    }
  }

  if (n >= 5 && l5 != null) {
    const last4m = stdev([l1, l2, l3, l4]);
    if (last4m < 0.32 && l1 < l2 - 0.02 && l2 < l3 - 0.02) {
      return "持続戦";
    }
  }

  const mAll = mean([...s]);
  const head3 = s.length >= 3 ? mean(s.slice(0, 3)) : mAll;
  if (mAll < 11.85 && head3 < 12.0 && mAll < 12.0) {
    return "高速巡航戦";
  }

  return "中間";
}

/** API / JSON 用 lapType（英語キー） */
function lapStructureToStoredType(kind) {
  if (kind === "消耗戦") return "early_pressured";
  if (kind === "瞬発戦" || kind === "持続戦") return "late_accelerated";
  if (kind === "高速巡航戦") return "even_pace";
  return "neutral";
}

/**
 * @param {string} base
 * @param {number|null} paceBalance
 * @param {number|null|undefined} peerAvgPaceBalance 同日同場同 surface の他レース平均（無ければ絶対閾値）
 */
function refineStoredLapType(base, paceBalance, peerAvgPaceBalance) {
  if (paceBalance == null || !Number.isFinite(paceBalance)) return base;
  const thr = 2.0;
  const ref =
    peerAvgPaceBalance != null && Number.isFinite(peerAvgPaceBalance) ? peerAvgPaceBalance : null;
  if (ref != null) {
    const dev = paceBalance - ref;
    if (dev >= thr) return "early_pressured";
    if (dev <= -thr) return "late_accelerated";
    return base;
  }
  if (paceBalance >= thr) return "early_pressured";
  if (paceBalance <= -thr) return "late_accelerated";
  return base;
}

/**
 * top3 馬の最終コーナー通過順平均から前有利/差し有利を -2..+2
 * 正: 前・イン側有利 / 負: 差し・後方から有利寄り
 */
function computeFrontCloserScore(topRows, fieldSize) {
  const fs = Math.max(8, Number(fieldSize) || 16);
  const ranks = [];
  for (const row of topRows) {
    const corners = parseCornerRanks(row.cornerPassing, fs);
    const last = corners.length > 0 ? corners[corners.length - 1] : null;
    if (last != null && Number.isFinite(last)) ranks.push(last);
  }
  if (ranks.length === 0) return 0;
  const avg = ranks.reduce((a, b) => a + b, 0) / ranks.length;
  const mid = fs * 0.35;
  return round2(clamp((mid - avg) / (fs / 7), -2, 2));
}

/**
 * 内枠占有の偏差を -2..+2（正＝内有利）
 */
function computeInnerOuterScore(innerShare) {
  if (!Number.isFinite(innerShare)) return 0;
  const baseline = 3 / 8;
  return round2(clamp((innerShare - baseline) / 0.07, -2, 2));
}

/**
 * @param {object} data enrich 済みレース JSON（raceId, meta）
 * @returns {object|null} analysis オブジェクト or null
 */
export function buildRaceAnalysisSnapshot(data) {
  const raceId = data?.raceId;
  const meta = data?.meta ?? {};
  const date = meta.date;
  const venue = meta.venue;
  const surfaceRaw = meta.surface === "ダート" ? "ダート" : "芝";
  if (!raceId || !date || !venue) return null;

  const resultUrl = `https://race.netkeiba.com/race/result.html?race_id=${raceId}`;
  const html = fetchUtf8(resultUrl);
  const { places } = parseRaceResultNetkeiba(html, raceId);
  const fieldSize = places.length;
  if (fieldSize < 4) return null;

  const topRows = places
    .filter((p) => p.place <= 3)
    .map((p) => ({
      place: p.place,
      waku: p.waku,
      cornerPassing: p.cornerPassing,
    }));

  const dbUrl = `https://db.netkeiba.com/race/${raceId}/`;
  const rhtml = fetchUtf8(dbUrl);
  const section200mSec = parseRaceLedgerLap200m(rhtml);

  const f3s = places.map((p) => p.final3fSec).filter((x) => Number.isFinite(x));
  const medianF3 = median(f3s);

  const margins = places
    .map((p) => p.marginToWinnerSec)
    .filter((x) => x != null && Number.isFinite(x));
  const meanMarginFieldSec = margins.length > 0 ? round2(mean(margins)) : null;

  const peer = aggregatePeerBaseline(DEFAULT_RACES_DIR, date, venue, surfaceRaw, raceId);
  const savedDay = lookupDailyBaselineEntry(loadDailyBaseline(), date, venue, surfaceRaw);
  const peerAvgPaceBalance =
    peer.count >= 1 ? peer.avgPaceBalance : savedDay?.avgPaceBalance ?? null;

  let paceBalance = null;
  let lapStructureLabel = "中間";
  let lapType = "neutral";

  if (section200mSec != null && section200mSec.length >= 4 && medianF3 != null) {
    paceBalance = paceFrontBackSkewEarlyMinusLate(section200mSec, medianF3);
    lapStructureLabel = classifyLapStructureJs(section200mSec);
    const baseLt = lapStructureToStoredType(lapStructureLabel);
    lapType = refineStoredLapType(baseLt, paceBalance, peerAvgPaceBalance);
  }

  const bucket = new Map();
  accumulateRaceIntoBiasMaster(bucket, date, venue, surfaceRaw, topRows, fieldSize);
  const key = `${date}|${venue}|${surfaceRaw}`;
  const agg = bucket.get(key);
  const biasRow = agg ? finalizeBiasEntry(agg) : null;
  const innerShare = biasRow?.innerShare ?? 0;
  const innerOuter = computeInnerOuterScore(innerShare);
  const frontCloser = computeFrontCloserScore(topRows, fieldSize);

  const peerSummary =
    peer.count >= 1 || savedDay != null
      ? {
          peerRaceCount: peer.count,
          avgPaceBalancePeer: peer.avgPaceBalance ?? undefined,
          avgMedianFinal3fPeer: peer.avgMedianFinal3fSec ?? undefined,
          avgMeanMarginPeer: peer.avgMeanMarginFieldSec ?? undefined,
          fallbackFromFile: peer.count < 1 && savedDay != null,
          savedDayRaceCount: savedDay?.raceCount,
          savedAvgPaceBalance: savedDay?.avgPaceBalance,
        }
      : undefined;

  return {
    bias: {
      innerOuter,
      frontCloser,
      innerShare: round2(innerShare),
      outerSashiShare: biasRow ? round2(biasRow.outerSashiShare) : undefined,
    },
    lapType,
    paceBalance: paceBalance != null ? round2(paceBalance) : undefined,
    medianFinal3fSec: medianF3 != null ? round2(medianF3) : undefined,
    meanMarginFieldSec: meanMarginFieldSec ?? undefined,
    lapStructure: lapStructureLabel,
    section200mSec: section200mSec ?? undefined,
    peerBaseline: peerSummary,
    source: "netkeiba_result",
    computedAt: new Date().toISOString(),
  };
}

/**
 * 結果が取れたときだけ `analysis` と `condition.section200mSec` / `raceAnalysis` を付与。
 * @param {object} data
 */
export function attachRaceAnalysisOrLeave(data) {
  try {
    const snap = buildRaceAnalysisSnapshot(data);
    if (snap == null) return data;

    const { section200mSec } = snap;
    data.analysis = {
      bias: {
        innerOuter: snap.bias.innerOuter,
        frontCloser: snap.bias.frontCloser,
      },
      lapType: snap.lapType,
      paceBalance: snap.paceBalance,
      medianFinal3fSec: snap.medianFinal3fSec,
      meanMarginFieldSec: snap.meanMarginFieldSec,
      lapStructure: snap.lapStructure,
      ...(snap.peerBaseline != null ? { peerBaseline: snap.peerBaseline } : {}),
      source: snap.source,
      computedAt: snap.computedAt,
    };

    data.condition = {
      ...(data.condition ?? {}),
      venue: data.condition?.venue ?? data.meta?.venue,
      raceName: data.condition?.raceName ?? data.meta?.raceName,
      surface:
        data.condition?.surface ??
        (data.meta?.surface === "ダート" ? "ダート" : "芝"),
      distance: data.condition?.distance ?? data.meta?.distance,
      ground: data.condition?.ground ?? "good",
      bias: data.condition?.bias ?? "flat",
      pace: data.condition?.pace ?? "middle",
      adjustmentStrength: data.condition?.adjustmentStrength ?? "middle",
      ...(section200mSec != null && section200mSec.length >= 4
        ? { section200mSec }
        : {}),
      raceAnalysis: {
        bias: snap.bias,
        lapType: snap.lapType,
        paceBalance: snap.paceBalance,
        medianFinal3fSec: snap.medianFinal3fSec,
        meanMarginFieldSec: snap.meanMarginFieldSec,
        lapStructureLabel: snap.lapStructure,
        ...(snap.peerBaseline != null ? { peerBaseline: snap.peerBaseline } : {}),
        source: snap.source,
        computedAt: snap.computedAt,
      },
    };
    return data;
  } catch {
    return data;
  }
}
