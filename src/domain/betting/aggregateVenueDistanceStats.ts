import type { RaceDetailLog } from "./types";
import type { RaceIndexItem } from "../../lib/race-data/raceEvaluationTypes";

export type RecoveryZone = "strong" | "neutral" | "weak" | "caution";

export type VenueDistanceBucketStats = {
  key: string;
  venue: string;
  distance: number | null;
  distanceLabel: string;
  surface: string | null;
  races: number;
  betRaces: number;
  skips: number;
  hitRaces: number;
  invested: number;
  payout: number;
  recoveryRate: number;
  hitRaceRate: number;
  anchorHitRate: number;
  anchorShowRate: number;
  zone: RecoveryZone;
};

type Acc = {
  races: number;
  betRaces: number;
  skips: number;
  hitRaces: number;
  invested: number;
  payout: number;
  anchorHits: number;
  anchorShows: number;
};

function initAcc(): Acc {
  return {
    races: 0,
    betRaces: 0,
    skips: 0,
    hitRaces: 0,
    invested: 0,
    payout: 0,
    anchorHits: 0,
    anchorShows: 0,
  };
}

function addDetail(acc: Acc, d: RaceDetailLog): void {
  acc.races += 1;
  const invested = d.totalInvested ?? 0;
  const payout = d.totalPayout ?? 0;
  acc.invested += invested;
  acc.payout += payout;
  if (invested === 0) {
    acc.skips += 1;
  } else {
    acc.betRaces += 1;
    if (payout > 0) acc.hitRaces += 1;
  }
  if (d.isAnchorHit) acc.anchorHits += 1;
  const anchorNum = Object.entries(d.aiMarks ?? {}).find(([, m]) => m === "◎")?.[0];
  const hn = anchorNum != null ? Number(anchorNum) : NaN;
  if (Number.isFinite(hn) && d.actualResults?.slice(0, 3).includes(hn)) {
    acc.anchorShows += 1;
  }
}

function pct(n: number, d: number): number {
  if (d <= 0) return 0;
  return Math.round((n / d) * 1000) / 10;
}

export function classifyRecoveryZone(recoveryRate: number, betRaces: number): RecoveryZone {
  if (betRaces === 0) return "neutral";
  if (recoveryRate >= 150) return "strong";
  if (recoveryRate < 50) return "weak";
  if (recoveryRate < 100) return "caution";
  return "neutral";
}

function finalizeBucket(
  key: string,
  venue: string,
  distance: number | null,
  surface: string | null,
  acc: Acc,
): VenueDistanceBucketStats {
  const recoveryRate =
    acc.invested > 0 ? Math.round((acc.payout / acc.invested) * 1000) / 10 : 0;
  const distanceLabel = distance != null && distance > 0 ? `${distance}m` : "（距離不明）";
  return {
    key,
    venue,
    distance,
    distanceLabel,
    surface,
    races: acc.races,
    betRaces: acc.betRaces,
    skips: acc.skips,
    hitRaces: acc.hitRaces,
    invested: acc.invested,
    payout: acc.payout,
    recoveryRate,
    hitRaceRate: pct(acc.hitRaces, acc.betRaces),
    anchorHitRate: pct(acc.anchorHits, acc.races),
    anchorShowRate: pct(acc.anchorShows, acc.races),
    zone: classifyRecoveryZone(recoveryRate, acc.betRaces),
  };
}

export type VenueDistanceAggregation = {
  byVenue: VenueDistanceBucketStats[];
  byVenueSurface: VenueDistanceBucketStats[];
  byVenueDistanceSurface: VenueDistanceBucketStats[];
};

/**
 * raceDetailsForHitList + index.json から競馬場・距離・芝ダの回収傾向を集計する。
 */
export function aggregateVenueDistanceStats(
  details: readonly RaceDetailLog[],
  indexRows: readonly RaceIndexItem[],
): VenueDistanceAggregation {
  const metaById = new Map(indexRows.map((r) => [r.raceId, r]));

  const byVenue = new Map<string, Acc>();
  const byVenueSurface = new Map<string, Acc>();
  const byVenueDistanceSurface = new Map<string, Acc>();

  for (const d of details) {
    const meta = metaById.get(d.raceId);
    const venue = d.venue || meta?.venue || "（場不明）";
    const distance = meta?.distance ?? null;
    const surface = meta?.surface ?? null;
    const distLabel = distance != null && distance > 0 ? `${distance}m` : "（距離不明）";
    const surfLabel = surface ?? "—";

    const venueKey = venue;
    const vsKey = `${venue} / ${surfLabel}`;
    const vdsKey = `${venue} / ${distLabel} / ${surfLabel}`;

    for (const [map, key] of [
      [byVenue, venueKey],
      [byVenueSurface, vsKey],
      [byVenueDistanceSurface, vdsKey],
    ] as const) {
      if (!map.has(key)) map.set(key, initAcc());
      addDetail(map.get(key)!, d);
    }
  }

  const sortByRecovery = (a: VenueDistanceBucketStats, b: VenueDistanceBucketStats) =>
    b.recoveryRate - a.recoveryRate || b.races - a.races || a.key.localeCompare(b.key, "ja");

  const toList = (
    map: Map<string, Acc>,
    parse: (key: string) => { venue: string; distance: number | null; surface: string | null },
  ): VenueDistanceBucketStats[] =>
    [...map.entries()]
      .map(([key, acc]) => {
        const { venue, distance, surface } = parse(key);
        return finalizeBucket(key, venue, distance, surface, acc);
      })
      .sort(sortByRecovery);

  return {
    byVenue: toList(byVenue, (key) => ({ venue: key, distance: null, surface: null })),
    byVenueSurface: toList(byVenueSurface, (key) => {
      const [venue, surface] = key.split(" / ");
      return { venue: venue ?? key, distance: null, surface: surface ?? null };
    }),
    byVenueDistanceSurface: toList(byVenueDistanceSurface, (key) => {
      const parts = key.split(" / ");
      const venue = parts[0] ?? key;
      const distRaw = parts[1]?.replace(/m$/, "");
      const distance = distRaw != null && distRaw !== "（距離不明）" ? Number(distRaw) : null;
      const surface = parts[2] ?? null;
      return {
        venue,
        distance: Number.isFinite(distance) ? distance : null,
        surface,
      };
    }),
  };
}

export function filterByMinRaces(
  rows: readonly VenueDistanceBucketStats[],
  minRaces: number,
): VenueDistanceBucketStats[] {
  return rows.filter((r) => r.races >= minRaces);
}

export function zoneLabelJa(zone: RecoveryZone): string {
  if (zone === "strong") return "強";
  if (zone === "weak") return "弱";
  if (zone === "caution") return "注意";
  return "—";
}
