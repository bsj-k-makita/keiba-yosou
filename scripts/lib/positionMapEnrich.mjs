/**
 * 脚質ポジションマップ用: pastRuns のコーナー通過と RPC（前後傾差）から position_x（0=前方〜100=後方）を算出する。
 */
import { parseCornerRanks } from "./biasMaster.mjs";
import { paceFrontBackSkewEarlyMinusLate } from "./raceFeatureEngineering.mjs";

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function median(nums) {
  const arr = nums.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (arr.length === 0) return null;
  const m = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[m] : (arr[m - 1] + arr[m]) / 2;
}

/** @param {Record<string, unknown>} run */
function cornerRanksFromRun(run) {
  const cp = run.corner_positions ?? run.cornerPositions;
  if (Array.isArray(cp) && cp.length > 0) {
    return cp.map(Number).filter((n) => Number.isFinite(n) && n > 0);
  }
  const s = run.passingOrder ?? run.cornerPassing;
  const fs = Number(run.fieldSize);
  return parseCornerRanks(s, Number.isFinite(fs) && fs > 0 ? fs : 18);
}

/**
 * 1走あたりの隊列位置を 0〜100（低いほど前方）へ。
 * @param {Record<string, unknown>} run
 * @returns {number|null}
 */
export function packPositionXOneRun(run) {
  const ranks = cornerRanksFromRun(run);
  if (ranks.length === 0) return null;
  const avgRank = ranks.reduce((a, b) => a + b, 0) / ranks.length;
  const maxInPass = Math.max(...ranks);
  const fs = Number(run.fieldSize);
  const n =
    Number.isFinite(fs) && fs >= maxInPass ? fs : Math.max(maxInPass, 8);
  const denom = Math.max(n - 1, 1);
  return clamp(((avgRank - 1) / denom) * 100, 0, 100);
}

/** 脚質ラベルからのフォールバック（コーナー情報が無い場合） */
function styleFallbackX(runningStyle) {
  const s = String(runningStyle ?? "");
  if (s.includes("逃げ")) return 12;
  if (s.includes("先行")) return 28;
  if (s.includes("好位")) return 42;
  if (s.includes("差し")) return 62;
  if (s.includes("追込")) return 82;
  if (s.includes("自在")) return 48;
  return 50;
}

/** RPC 補正の感度（秒スケールの中央値に掛けて 0〜100 に加算） */
const RPC_TO_X_SCALE = 3.5;

/** 過去走コーナー由来の隊列スコアがあるとき、既定「好位」を隊列に沿って上書きする（netkeiba HTML に脚質列が無い場合の補完） */
function inferRunningStyleFromPackPosition(px) {
  if (!Number.isFinite(px)) return "好位";
  if (px <= 24) return "逃げ";
  if (px <= 40) return "先行";
  if (px <= 55) return "好位";
  if (px <= 75) return "差し";
  return "追込";
}

/**
 * @param {Record<string, unknown>} entry
 * @returns {number} 0〜100 の整数
 */
export function computeEntryPositionX(entry) {
  const pastRuns = Array.isArray(entry.pastRuns) ? entry.pastRuns : [];
  const recent = pastRuns.slice(0, 5);
  const xs = [];
  for (const run of recent) {
    const x = packPositionXOneRun(run);
    if (x != null) xs.push(x);
  }
  entry._had_corner_pack_avg = xs.length > 0;
  let base = xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

  const rpcVals = [];
  for (const run of recent) {
    const sk = paceFrontBackSkewEarlyMinusLate(run.section200mSec, run.final3fSec);
    if (sk != null) rpcVals.push(sk);
  }
  const rpcMed = median(rpcVals);

  if (base == null) {
    base = styleFallbackX(entry.runningStyle);
  }
  if (rpcMed != null) {
    base = clamp(base + RPC_TO_X_SCALE * rpcMed, 0, 100);
  }
  return Math.round(clamp(base, 0, 100));
}

/**
 * @param {Record<string, unknown>} data - race JSON ルート
 */
export function enrichEntriesPositionMap(data) {
  const entries = Array.isArray(data?.entries) ? data.entries : [];
  const inferPack =
    process.env.ENRICH_INFER_STYLE_FROM_PACK !== "0";
  for (const e of entries) {
    e.position_x = computeEntryPositionX(e);
    if (
      inferPack &&
      e.runningStyle === "好位" &&
      e._had_corner_pack_avg === true &&
      typeof e.position_x === "number" &&
      !e.running_style_source
    ) {
      e.runningStyle = inferRunningStyleFromPackPosition(e.position_x);
      e.running_style_source = "pack_position_x";
    }
    delete e._had_corner_pack_avg;
  }
  return data;
}
