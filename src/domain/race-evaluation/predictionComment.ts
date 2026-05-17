import type { HorseScoreResult } from "./abilityTypes";

type FactorKey = "地力最上位" | "展開・脚質絶好" | "ラップ適合" | "枠順・バイアス恩恵" | "総合";

const COMMENTS: Record<FactorKey, string> = {
  地力最上位: "近走の指数ピークがメンバー中突出。基礎能力の芯が違い力通り。",
  "展開・脚質絶好": "前傾ラップの激流想定。先行勢自滅時の差し馬の網に最も引っかかる。",
  ラップ適合: "想定される特有の持続力ラップへの適合度が極めて高い。",
  "枠順・バイアス恩恵": "現在のイン有利バイアスに内枠が合致。鞍上強化も含め勝負気配高。",
  総合: "総合的なバランスが取れた一頭。",
};

function dominantFactor(result: HorseScoreResult): FactorKey {
  const bonuses: Record<FactorKey, number> = {
    地力最上位: result.enginePeakBonus ?? 0,
    "展開・脚質絶好": result.paceFitBonus ?? 0,
    ラップ適合:
      (result.lapShapeFitBonus ?? 0) +
      (result.lapSustainBonus ?? 0) +
      (result.lapQualityBonus ?? 0),
    "枠順・バイアス恩恵":
      (result.gateStyleSynergyBonus ?? 0) +
      (result.gateBiasBonus ?? 0) +
      (result.connectionsBonus ?? 0) +
      (result.jockeyRiderBonus ?? 0),
    総合: 0,
  };

  let best: FactorKey = "総合";
  let bestV = -Infinity;
  for (const [k, v] of Object.entries(bonuses) as [FactorKey, number][]) {
    if (k === "総合") continue;
    if (v > bestV) {
      bestV = v;
      best = k;
    }
  }
  if (bestV < 0.5) return "総合";
  return best;
}

export function generatePredictionShortComment(result: HorseScoreResult): string {
  const key = dominantFactor(result);
  return COMMENTS[key];
}

export function applyPredictionShortComments(results: HorseScoreResult[]): void {
  for (const r of results) {
    r.predictionShortComment = generatePredictionShortComment(r);
  }
}
