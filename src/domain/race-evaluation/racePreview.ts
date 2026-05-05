import type { HorseAbility, HorseScoreResult } from "./abilityTypes";

const DARK_HORSE_MARKS = new Set(["○", "▲", "☆", "△"]);

export type RacePreviewBadgeType = "default" | "warning" | "success";

export type HorseGapInfo = {
  horseId: string;
  name: string;
  jockey?: string;
  mark: HorseScoreResult["mark"];
  systemRank: number;
  systemScore: number;
  expectedPopularity?: number;
  gapScore?: number;
};

export type RacePreviewData = {
  badgeLabel: string;
  badgeType: RacePreviewBadgeType;
  previewText: string;
  hasGapSignals: boolean;
};

export function calculateHorseGap(expectedPopularity: number | undefined, systemRank: number): number | undefined {
  if (!Number.isFinite(expectedPopularity) || expectedPopularity == null) return undefined;
  return expectedPopularity - systemRank;
}

function expectedPopularityRankFromOdds(
  horse: HorseAbility,
  horses: readonly HorseAbility[],
): number | undefined {
  const ownOdds = horse.signals?.winOdds;
  if (ownOdds == null || !Number.isFinite(ownOdds) || ownOdds <= 0) return undefined;
  const odds = horses
    .map((h) => h.signals?.winOdds)
    .filter((v): v is number => v != null && Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);
  if (odds.length < 6) return undefined;
  const rank = odds.findIndex((o) => o >= ownOdds - 1e-6) + 1;
  return rank > 0 ? rank : undefined;
}

function toGapInfo(horses: readonly HorseAbility[], results: readonly HorseScoreResult[]): HorseGapInfo[] {
  const horseMap = new Map(horses.map((h) => [h.horseId, h] as const));
  return results.map((r) => {
    const horse = horseMap.get(r.horseId);
    const systemRank = r.finalRank ?? r.adjustedRank ?? 99;
    const expectedPopularity = horse
      ? expectedPopularityRankFromOdds(horse, horses)
      : undefined;
    return {
      horseId: r.horseId,
      name: r.horseName,
      jockey: horse?.jockey,
      mark: r.mark ?? "",
      systemRank,
      systemScore: r.finalEvaluationScore,
      expectedPopularity,
      gapScore: calculateHorseGap(expectedPopularity, systemRank),
    };
  });
}

export function generateRacePreviewData(horses: readonly HorseGapInfo[]): RacePreviewData {
  const hasGapSignals = horses.some((h) => h.expectedPopularity != null);
  const favorite = horses.find((h) => h.mark === "◎");
  const darkHorse = horses.find(
    (h) => DARK_HORSE_MARKS.has(h.mark ?? "") && (h.gapScore ?? Number.NEGATIVE_INFINITY) >= 5,
  );
  const dangerHorse = horses.find(
    (h) =>
      h.expectedPopularity != null &&
      h.expectedPopularity <= 3 &&
      h.systemRank >= 6,
  );

  let badgeLabel = "AI注目";
  let badgeType: RacePreviewBadgeType = "default";
  if (darkHorse && dangerHorse) {
    badgeLabel = "🔥 波乱警戒 / 特大妙味";
    badgeType = "warning";
  } else if (
    favorite &&
    favorite.expectedPopularity != null &&
    favorite.expectedPopularity <= 2 &&
    favorite.systemScore > 90
  ) {
    badgeLabel = "👑 自信度S / 堅実";
    badgeType = "success";
  }

  const textParts: string[] = [];
  if (favorite) {
    textParts.push(`◎ ${favorite.name}${favorite.jockey ? `(${favorite.jockey})` : ""}`);
  }
  if (badgeType === "warning" && darkHorse) {
    textParts.push(`穴☆ ${darkHorse.name}`);
  } else if (badgeType === "success" && dangerHorse) {
    textParts.push(`⚠ 危険: ${dangerHorse.name}`);
  }

  return {
    badgeLabel,
    badgeType,
    previewText: textParts.join(" | "),
    hasGapSignals,
  };
}

export function buildRacePreviewDataFromRace(
  horses: readonly HorseAbility[],
  results: readonly HorseScoreResult[],
): RacePreviewData {
  return generateRacePreviewData(toGapInfo(horses, results));
}
