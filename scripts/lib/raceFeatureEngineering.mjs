import {
  INNER_SHARE_THRESHOLD,
  OUTER_SASHI_SHARE_THRESHOLD,
  computeWasBiasDisadvantaged,
  finalizeBiasEntry,
  loadBiasMaster,
  lookupBiasForPastRun,
  accumulateRaceIntoBiasMaster,
  bucketToSerializable,
  parseCornerRanks,
} from "./biasMaster.mjs";

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

function round4(x) {
  return Math.round(x * 10000) / 10000;
}

/** 200m sec から km/h */
export function sectorSpeedKmh(sec200) {
  if (sec200 == null || sec200 <= 0) return null;
  return (200 / sec200) * 3.6;
}

/**
 * L2=ゴール前400..200m、L1=200..0m（section の末尾2本）
 */
export function sliceRaceL2L1(section200mSec) {
  const sec = Array.isArray(section200mSec) ? section200mSec : [];
  if (sec.length < 2) return { l2: null, l1: null };
  const l1 = sec[sec.length - 1];
  const l2 = sec[sec.length - 2];
  return {
    l2: Number.isFinite(l2) ? l2 : null,
    l1: Number.isFinite(l1) ? l1 : null,
  };
}

/**
 * 4角が3角より前へ進んだポジション数（正なら末脚で詰めた）
 */
export function cornerImprovement(cornerRanks) {
  if (cornerRanks.length < 2) return 0;
  const c3 = cornerRanks[cornerRanks.length - 2];
  const c4 = cornerRanks[cornerRanks.length - 1];
  if (!Number.isFinite(c3) || !Number.isFinite(c4)) return 0;
  return Math.max(0, c3 - c4);
}

/**
 * 押し上げ補正（秒）: 大型で詰めたほどL2区間の実勢を速く見積もる
 */
export function pushUpCorrectionSec(improvement) {
  return clamp(improvement * 0.05, 0, 0.55);
}

/**
 * 推定した当該馬のL2秒
 */
export function estimateHorseL2Sec(l2Race, cornerRanks) {
  if (l2Race == null) return null;
  const imp = cornerImprovement(cornerRanks);
  return l2Race - pushUpCorrectionSec(imp);
}

/**
 * 0-1: 推定L2区間の最高速（全走の最大を正規化）
 */
export function l2TopSpeedIndex01(horseL2Sec) {
  if (horseL2Sec == null || horseL2Sec <= 0) return null;
  const kmh = sectorSpeedKmh(horseL2Sec);
  if (kmh == null) return null;
  // 59–66 km/h 帯を 0-1 に（仕様: 62-64 台がハイレベル）
  return clamp((kmh - 57.5) / 8.5, 0, 1);
}

/**
 * 0-1: L2→L1 の減速が小さいほど高い
 * @param {number|null} cohortMedianDelta - 同日レース内などの比較用（省略時は絶対値）
 */
export function l2SustainRatio01(horseL2, horseL1, cohortMedianDelta = null) {
  if (horseL2 == null || horseL1 == null || horseL2 <= 0 || horseL1 <= 0) return null;
  const decel = horseL1 - horseL2;
  if (!Number.isFinite(decel)) return null;
  let baseline = 0.55;
  if (cohortMedianDelta != null && Number.isFinite(cohortMedianDelta)) {
    baseline = cohortMedianDelta;
  }
  const advantage = baseline - decel;
  return clamp(0.5 + advantage / 1.6, 0, 1);
}

/** 前傾（ハイペース寄り）スコア: 直線以前 − 上がり3F（秒） */
export function paceFrontBackSkewEarlyMinusLate(section200mSec, final3fSec) {
  const sec = Array.isArray(section200mSec) ? section200mSec.map(Number) : [];
  const sum = sec.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  const late = Number(final3fSec);
  if (!Number.isFinite(sum) || sum <= 0 || !Number.isFinite(late)) return null;
  const early = sum - late;
  return early - late;
}

function median(nums) {
  const arr = nums.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (arr.length === 0) return null;
  const m = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[m] : (arr[m - 1] + arr[m]) / 2;
}

function inferHorsePaceTendencyFromPast(pastRuns) {
  const skews = [];
  for (const run of pastRuns ?? []) {
    const sk = paceFrontBackSkewEarlyMinusLate(run.section200mSec, run.final3fSec);
    if (sk != null) skews.push(sk);
  }
  const med = median(skews);
  if (med == null) return null;
  if (med > 2.5) return "front_loaded";
  if (med < -2.5) return "late_kick";
  return "neutral";
}

function inferExpectedPaceFromEntries(entries) {
  const n = entries?.length ?? 0;
  if (n <= 0) return null;
  let front = 0;
  for (const e of entries) {
    const s = String(e?.runningStyle ?? "");
    if (/逃げ|先行/.test(s)) front += 1;
  }
  const ratio = front / n;
  if (ratio >= 0.35) return "high_early";
  if (ratio <= 0.12) return "slow_finish";
  return "middle";
}

/**
 * @param {object} data race json root
 * @param {object} [biasPayload] loadBiasMaster() の戻り
 */
export function enrichEntriesWithRaceFeatures(data, biasPayload) {
  const entries = Array.isArray(data?.entries) ? data.entries : [];
  if (entries.length === 0) return data;

  const biasRoot = biasPayload ?? loadBiasMaster();
  const biasEntries = biasRoot.entries ?? {};

  const paceExpected = inferExpectedPaceFromEntries(entries);

  const allDecels = [];
  for (const e of entries) {
    const runs = e.pastRuns ?? [];
    const last = runs[0];
    if (last?.section200mSec?.length >= 2) {
      const { l2, l1 } = sliceRaceL2L1(last.section200mSec);
      if (l2 != null && l1 != null) allDecels.push(l1 - l2);
    }
  }
  const cohortMedianDelta = median(allDecels);

  for (const entry of entries) {
    const pastRuns = entry.pastRuns ?? [];
    const last = pastRuns[0];

    const biasRow = lookupBiasForPastRun(biasEntries, last);
    entry.was_bias_disadvantaged = computeWasBiasDisadvantaged(biasRow, last);

    let bestTop = 0;
    let bestSustain = null;

    for (const run of pastRuns) {
      const sec = run.section200mSec;
      const { l2: l2Race, l1: l1Race } = sliceRaceL2L1(sec);
      const corners = parseCornerRanks(run.passingOrder ?? run.cornerPassing, run.fieldSize ?? 16);
      const hL2 = estimateHorseL2Sec(l2Race, corners);
      if (hL2 != null) {
        const ts = l2TopSpeedIndex01(hL2);
        if (ts != null && ts > bestTop) bestTop = ts;
      }
      const sust = l2SustainRatio01(hL2 ?? l2Race, l1Race, cohortMedianDelta);
      if (sust != null) {
        bestSustain = bestSustain == null ? sust : Math.max(bestSustain, sust);
      }
    }

    /** 仕様: 0〜1（過去は 0〜100 で保存したファイルも resolve 側で吸収） */
    entry.l2_top_speed = bestTop > 0 ? round4(bestTop) : undefined;
    entry.l2_sustain_ratio =
      bestSustain != null ? round4(bestSustain) : undefined;

    const tendency = inferHorsePaceTendencyFromPast(pastRuns);
    let mismatch = false;
    if (paceExpected === "slow_finish" && tendency === "front_loaded") mismatch = true;
    if (paceExpected === "high_early" && tendency === "late_kick") mismatch = true;
    entry.pace_mismatch = mismatch;
  }

  return data;
}

/**
 * 当日の早めレース結果だけをバイアス集計にライブマージする（設計用フック）
 * @param {object} biasPayload { entries: Record<string, object> }
 * @param {Array<{date:string,venue:string,surface:string,topRows:object[],fieldSize:number}>} slices
 */
export function mergeLiveBiasSlices(biasPayload, slices) {
  const bucket = new Map();
  for (const [k, v] of Object.entries(biasPayload.entries ?? {})) {
    const total = v.top3Total ?? 0;
    bucket.set(k, {
      top3InnerCount:
        v.top3InnerCount ?? Math.round((v.innerShare ?? 0) * total),
      outerSashiTop3Count:
        v.outerSashiTop3Count ?? Math.round((v.outerSashiShare ?? 0) * total),
      top3Total: total,
      raceCount: v.raceCount ?? 0,
    });
  }
  for (const s of slices) {
    const surface = s.surface === "ダート" ? "ダート" : "芝";
    accumulateRaceIntoBiasMaster(bucket, s.date, s.venue, surface, s.topRows, s.fieldSize);
  }
  return { ...biasPayload, entries: bucketToSerializable(bucket) };
}

export { INNER_SHARE_THRESHOLD, OUTER_SASHI_SHARE_THRESHOLD, finalizeBiasEntry };
