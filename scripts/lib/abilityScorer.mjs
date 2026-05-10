/**
 * 能力ベースの単勝予測勝率（オッズ非依存）。enrich で一度計算し JSON に固定する。
 * ラップ形状・馬場適性・統計素の複合（過去走由来フィールドは raceFeatureEngineering で先行計算）。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STRATEGIC_WEIGHTS = JSON.parse(
  readFileSync(join(__dirname, "../../src/domain/race-evaluation/strategicWeights.json"), "utf8"),
);

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function parseNumeric(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function softmax(values, temperature = 8) {
  if (values.length === 0) return [];
  const T = Math.max(1, temperature);
  const max = Math.max(...values);
  const exps = values.map((v) => Math.exp((v - max) / T));
  const sum = exps.reduce((s, x) => s + x, 0);
  if (sum <= 0) return values.map(() => 1 / values.length);
  return exps.map((x) => x / sum);
}

function resolveStrategicProfileKeyFromData(data) {
  const c = data?.condition ?? {};
  const ri = data?.raceInfo ?? {};
  const venue = String(c.venue ?? ri.venue ?? "東京").trim();
  const surface = c.surface ?? ri.surface ?? "芝";
  const blob = `${c.courseKey ?? ""} ${venue} ${c.raceName ?? ri.raceName ?? ""}`;

  if (/札幌|函館|北海道/.test(venue) || venue === "札幌函館") {
    return surface === "ダート" ? "HOKKAIDO_DIRT" : "HOKKAIDO_TURF";
  }
  if (venue === "東京" || /^東京/.test(venue)) {
    return surface === "ダート" ? "TOKYO_DIRT" : "TOKYO_TURF";
  }
  if (venue === "中山" || /中山/.test(blob)) {
    return "NAKAYAMA_ALL";
  }
  if (/京都内/.test(blob) || c.courseKey === "京都内") {
    return "KYOTO_FLAT";
  }
  if (/京都/.test(blob) || venue.includes("京都")) {
    return surface === "ダート" ? "KYOTO_FLAT" : "KYOTO_TURF_OUT";
  }
  if (/阪神/.test(blob) || venue.includes("阪神")) {
    if (/内/.test(blob) || c.courseTopology === "uphill") {
      return "HANSHIN_INNER";
    }
    return surface === "ダート" ? "HANSHIN_INNER" : "HANSHIN_TURF_OUT";
  }
  if (venue.includes("新潟") || /新潟/.test(blob)) {
    if (surface === "ダート") {
      return "LOCAL_SMALL";
    }
    return /外|ストレート/.test(blob) ? "NIIGATA_TURF_OUT" : "LOCAL_SMALL";
  }
  if (venue === "中京" || /中京/.test(blob)) {
    return "CHUKYO_ALL";
  }
  if (venue === "福島" || venue === "小倉") {
    return "LOCAL_SMALL";
  }
  return "TOKYO_TURF";
}

/**
 * 出走表からの簡易ペース想定（raceFeatureEngineering と同じ定義）
 */
export function inferExpectedPaceFromEntries(entries) {
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
 * @param {object} raceData - race JSON ルート（raceInfo / condition）
 */
export function buildRaceMeta(raceData) {
  const ri = raceData?.raceInfo ?? {};
  const c = raceData?.condition ?? {};
  return {
    venue: String(c.venue ?? ri.venue ?? "東京").trim(),
    surface: c.surface ?? ri.surface ?? "芝",
    distance: Number(c.distance ?? ri.distance ?? 1600) || 1600,
    raceName: String(ri.raceName ?? ""),
    groundLabel: String(ri.groundLabel ?? c.ground ?? ""),
    bias: String(c.bias ?? "flat"),
  };
}

function paceAlignmentBonus(runningStyle, paceExpected) {
  const s = String(runningStyle ?? "");
  if (!paceExpected || paceExpected === "middle") return 0;
  const front = /逃げ|先行|好位/.test(s);
  const late = /差し|追込/.test(s);
  if (paceExpected === "high_early" && front) return 2.2;
  if (paceExpected === "slow_finish" && late) return 2.2;
  if (paceExpected === "high_early" && late) return -1.4;
  if (paceExpected === "slow_finish" && front) return -1.4;
  return 0;
}

function groundPowerBonus(entry, raceMeta) {
  const gl = String(raceMeta.groundLabel ?? "");
  if (!/稍|重|不/.test(gl)) return 0;
  const ab = entry?.abilities ?? {};
  const power = Number(ab.power ?? 50);
  return (power - 50) * 0.12;
}

/** 枠・適性・馬場・展開・ペース不一致を除く「実績・素点＋ラップ定量」 */
function strategicCoreAbility(entry, data) {
  const ab = entry?.abilities ?? {};
  const speed = Number(ab.speed ?? 50);
  const stamina = Number(ab.stamina ?? 50);
  const kick = Number(ab.kick ?? 50);
  const sustain = Number(ab.sustain ?? 50);
  const power = Number(ab.power ?? 50);
  const key = resolveStrategicProfileKeyFromData(data ?? {});
  const w = STRATEGIC_WEIGHTS[key] ?? STRATEGIC_WEIGHTS.TOKYO_TURF;
  return (
    speed * w.speed + stamina * w.stamina + kick * w.kick + sustain * w.sustain + power * w.power
  );
}

/** 適性・枠順を含めない能力指数（ポテンシャル）の線形スコア */
export function abilityPotentialRawScore(entry, data) {
  const core = strategicCoreAbility(entry, data);
  const lapTop = Number(entry.l2_top_speed ?? entry.l2TopSpeed ?? 0);
  const lapSus = Number(entry.l2_sustain_ratio ?? entry.l2SustainRatio ?? 0.5);
  const lapBonus = lapTop > 0 ? lapTop * 26 : 0;
  const sustainBonus = Number.isFinite(lapSus) ? (lapSus - 0.5) * 20 : 0;
  return core + lapBonus + sustainBonus;
}

/**
 * potential（実績・ラップ）と suitability（枠・血統適性・馬場・展開・不一致）に分解。
 * predicted_win_rate の softmax 入力は potential + suitability の合算（従来と同一）。
 */
export function splitAbilityScores(entry, data, gateBonus, paceExpected) {
  const potential = abilityPotentialRawScore(entry, data);
  const pd = entry.pedigree ?? {};
  const courseFit = Number(pd.courseFit01 ?? 0.5);
  const distFit = Number(pd.distanceFit01 ?? 0.5);
  const pedigree = (courseFit - 0.5) * 16 + (distFit - 0.5) * 12;
  const meta = buildRaceMeta(data);
  const ground = groundPowerBonus(entry, meta);
  const pace = paceAlignmentBonus(entry.runningStyle, paceExpected);
  const gb = Number.isFinite(gateBonus) ? gateBonus : 0;
  const mismatchPenaltyPts = entry.pace_mismatch || entry.paceMismatch ? 7 : 0;
  const biasRescue = entry.was_bias_disadvantaged || entry.wasBiasDisadvantaged ? 2.5 : 0;
  const suitabilitySum = gb + pedigree + ground + pace - mismatchPenaltyPts + biasRescue;
  const full = potential + suitabilitySum;
  return {
    potential,
    full,
    parts: {
      gate: gb,
      pedigree,
      ground,
      pace,
      mismatchPenalty: mismatchPenaltyPts,
      biasRescue,
    },
  };
}

function abilityRawScore(entry, data, gateBonus, paceExpected) {
  return splitAbilityScores(entry, data, gateBonus, paceExpected).full;
}

function rankOrderDescending(values) {
  const n = values.length;
  const order = values.map((v, i) => ({ v, i }));
  order.sort((a, b) => b.v - a.v);
  const rankAtIndex = new Array(n).fill(0);
  order.forEach((_, pos) => {
    rankAtIndex[order[pos].i] = pos;
  });
  return rankAtIndex;
}

function explainSuitabilityDrag(split) {
  const { parts, potential, full } = split;
  const out = [];
  if (parts.pedigree <= -3) {
    out.push({
      code: "pedigree",
      label: `血統のコース・距離適性が重い（${parts.pedigree.toFixed(1)}pt）`,
    });
  } else if (parts.pedigree < -1.5) {
    out.push({
      code: "pedigree",
      label: `コース・距離適性がやや不利（${parts.pedigree.toFixed(1)}pt）`,
    });
  }
  if (parts.pace <= -1.2) {
    out.push({ code: "pace_style", label: "今回のペース展開と脚質が合いにくい" });
  }
  if (parts.ground <= -1) {
    out.push({
      code: "ground",
      label: `不良馬場でのパワー不利（${parts.ground.toFixed(1)}pt）`,
    });
  }
  if (parts.mismatchPenalty >= 6.5) {
    out.push({ code: "pace_mismatch", label: "ペース不一致ペナルティ（過去走）" });
  }
  if (parts.gate <= -2) {
    out.push({
      code: "gate",
      label: `枠・ゲート不利（${parts.gate.toFixed(1)}pt）`,
    });
  }
  const dragPct = potential > 1e-6 ? clamp(((potential - full) / potential) * 100, 0, 99) : 0;
  if (dragPct >= 10 && out.length === 0) {
    out.push({
      code: "combined_drag",
      label: `適性・枠・展開の合計で評価が約${Math.round(dragPct)}%下がっています`,
      impactApproxPct: Math.round(dragPct),
    });
  }
  return out;
}

/**
 * ability_index（0〜100・レース内）と suitability_flags を各 entry に付与。
 * predicted_win_rate は既に abilityPotential + suitability を softmax した値（probsWin）
 */
export function attachAbilityIndexAndSuitabilityFlags(entries, raceData, calcGateBonusPoints, probsWin) {
  const n = entries.length;
  if (n === 0) return;
  const fieldSize = n;
  const condition = raceData?.condition ?? {};
  const paceExpected = inferExpectedPaceFromEntries(entries);
  const splits = [];
  for (let i = 0; i < n; i += 1) {
    const e = entries[i];
    const gateNumber = parseNumeric(e.horseNumber ?? e.gate ?? e.umaban) ?? i + 1;
    const gb = calcGateBonusPoints(gateNumber, fieldSize, condition);
    splits.push(splitAbilityScores(e, raceData, gb, paceExpected));
  }
  const potentials = splits.map((s) => s.potential);
  const maxPot = Math.max(...potentials, 1e-9);
  const potRanks = rankOrderDescending(potentials);
  const winRanks = rankOrderDescending(probsWin);

  for (let i = 0; i < n; i += 1) {
    const ai = clamp((splits[i].potential / maxPot) * 100, 0, 100);
    entries[i].ability_index = Math.round(ai * 10) / 10;

    const wr = winRanks[i];
    const pr = potRanks[i];
    const rankGap = wr - pr;
    let flags = [];
    if (ai >= 65 && rankGap >= 4) {
      flags = explainSuitabilityDrag(splits[i]);
    }
    entries[i].suitability_flags = flags;
  }
}

/**
 * 同一レース内で softmax した予測勝率（合計1）。
 * @param {object[]} entries
 * @param {object} raceData
 * @param {(gateNumber: number, fieldSize: number, condition: object) => number} calcGateBonusPoints
 */
export function computePredictedWinRates(entries, raceData, calcGateBonusPoints) {
  const fieldSize = entries.length;
  const condition = raceData?.condition ?? {};
  const paceExpected = inferExpectedPaceFromEntries(entries);
  const scores = entries.map((e, i) => {
    const gateNumber = parseNumeric(e.horseNumber ?? e.gate ?? e.umaban) ?? i + 1;
    const gateBonus = calcGateBonusPoints(gateNumber, fieldSize, condition);
    return abilityRawScore(e, raceData, gateBonus, paceExpected);
  });
  return softmax(scores, 4);
}

/**
 * 単頭の線形能力スコア（オッズ非依存）。同一レースの勝率（0〜1・合計1）は computePredictedWinRates で softmax する。
 * @param {object} horseData
 * @param {object} raceMeta - buildRaceMeta の戻り
 * @param {{ gateBonus?: number, paceExpected?: string | null }} [ctx]
 * @returns {number}
 */
export function calculateAbilityScore(horseData, raceMeta, ctx = {}) {
  const paceExpected = ctx.paceExpected ?? null;
  const gateBonus = ctx.gateBonus ?? 0;
  const syntheticRoot = {
    raceInfo: {
      venue: raceMeta.venue,
      raceName: raceMeta.raceName,
      groundLabel: raceMeta.groundLabel,
    },
    condition: {
      venue: raceMeta.venue,
      surface: raceMeta.surface,
      distance: raceMeta.distance,
      ground: raceMeta.groundLabel,
      bias: raceMeta.bias,
    },
  };
  return abilityRawScore(horseData, syntheticRoot, gateBonus, paceExpected);
}

export { computeEntryPositionX, enrichEntriesPositionMap, packPositionXOneRun } from "./positionMapEnrich.mjs";
