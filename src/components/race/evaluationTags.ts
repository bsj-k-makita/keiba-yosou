import type { HorseAbility, HorseScoreResult, RaceCondition } from "../../domain/race-evaluation";
import {
  buildPedigreeFieldMap,
  formatPedigreeClusterBadge,
} from "../../domain/race-evaluation/pedigreeCluster";
import { getSireStatsMaster } from "../../domain/race-evaluation/sireStatsLookup";

type OddsStanding = {
  rank: number;
  total: number;
};

function getOddsStanding(horse: HorseAbility, horses: readonly HorseAbility[]): OddsStanding | null {
  const myOdds = horse.signals?.winOdds;
  if (myOdds == null || !Number.isFinite(myOdds) || myOdds <= 0) return null;
  const odds = horses
    .map((h) => h.signals?.winOdds)
    .filter((o): o is number => o != null && Number.isFinite(o) && o > 0)
    .sort((a, b) => a - b);
  if (odds.length < 6) return null;
  const rank = odds.findIndex((o) => o >= myOdds - 1e-6) + 1;
  if (rank <= 0) return null;
  return { rank, total: odds.length };
}

export function computeMarketAlertLabel(
  horse: HorseAbility,
  result: HorseScoreResult,
  horses: readonly HorseAbility[],
): "危険な人気馬" | "大穴候補" | null {
  const standing = getOddsStanding(horse, horses);
  if (standing == null) return null;
  const finalRank = result.finalRank ?? result.adjustedRank ?? 99;
  const lapEdge =
    (result.lapShapeFitBonus ?? 0) +
    (result.raceAnalysisBonus ?? 0) +
    (result.lapSustainBonus ?? 0) +
    (result.lapQualityBonus ?? 0);
  const contextEdge =
    (result.pedigreeBonus ?? 0) +
    (result.gateBiasBonus ?? 0) +
    (result.gateStyleSynergyBonus ?? 0) +
    (result.connectionsBonus ?? 0) +
    (result.trendBonus ?? 0) +
    (result.paceBalanceBonus ?? 0) +
    (result.tripContextBonus ?? 0);
  if (standing.rank <= 3 && (result.buyLabel === "消し" || finalRank >= 6)) {
    return "危険な人気馬";
  }
  if (standing.rank >= 6 && (finalRank <= 3 || lapEdge >= 1.6 || contextEdge >= 3.0)) {
    return "大穴候補";
  }
  return null;
}

export function getLapProfileVisual(profile: HorseScoreResult["lapProfile"]): { icon: string; label: string } {
  if (profile === "瞬発戦型") return { icon: "⚡", label: "瞬発戦型" };
  if (profile === "消耗戦型") return { icon: "🔥", label: "消耗戦型" };
  return { icon: "🔁", label: "一貫型" };
}

export function computeConnectionSpecialBadges(
  horse: HorseAbility,
  condition: RaceCondition,
  fieldHorses?: readonly HorseAbility[],
): string[] {
  const s = horse.signals;
  const badges: string[] = [];
  if (fieldHorses != null && fieldHorses.length >= 2) {
    const pedMap = buildPedigreeFieldMap(fieldHorses, condition, getSireStatsMaster());
    const pedBadge = formatPedigreeClusterBadge(pedMap.get(horse.horseId));
    if (pedBadge) badges.push(pedBadge);
  }
  if (s == null) return badges.slice(0, 2);
  if ((s.jockeyCourseWinRate01 ?? 0) >= 0.3) {
    badges.push(`🎯騎手コース勝率${Math.round((s.jockeyCourseWinRate01 ?? 0) * 100)}%`);
  }
  if ((s.trainerCourseWinRate01 ?? 0) >= 0.3) {
    badges.push(`🎯厩舎コース勝率${Math.round((s.trainerCourseWinRate01 ?? 0) * 100)}%`);
  }
  const longDistance = (condition.distance ?? 0) >= 2800;
  if (longDistance && ((s.jockeyCoursePlaceRate01 ?? 0) >= 0.5 || (horse.jockey ?? "").includes("レーン"))) {
    badges.push("🔥長距離の鬼");
  }
  const temperamentConcern = s.temperamentConcern01 ?? 0;
  if (s.temperamentRisk === true || temperamentConcern >= 0.6) {
    badges.push("💢折り合い注意");
  }
  return badges.slice(0, 3);
}
