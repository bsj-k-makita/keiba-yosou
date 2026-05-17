import type { HorseAbility, RaceCondition } from "./abilityTypes";

export type PedigreeClusterInfo = {
  sireKey: string;
  sireName: string;
  clusterSize: number;
  /** 同父が2頭以上いるとき true */
  inCluster: boolean;
  /** 距離帯×馬場の複勝圏率（0〜1）。データ無しは undefined */
  sireTop3Rate01?: number;
  clusterBonus: number;
};

export type PedigreeFieldMap = Map<string, PedigreeClusterInfo>;

function normalizeSireKey(horse: HorseAbility): string | null {
  const p = horse.pedigree;
  if (p?.sireId) return `id:${p.sireId}`;
  const name = p?.sireName?.trim();
  if (name) return `name:${name}`;
  return null;
}

export function distanceBandKey(distance: number | undefined): string {
  const d = distance ?? 0;
  if (d <= 0) return "unknown";
  if (d <= 1400) return "sprint";
  if (d <= 1800) return "mile";
  if (d <= 2200) return "middle";
  return "stayer";
}

export function sireStatsBucketKey(condition: RaceCondition): string {
  const surface = condition.surface === "ダート" ? "ダ" : "芝";
  return `${surface}_${distanceBandKey(condition.distance)}`;
}

type SireStatRow = { runs: number; top3: number; top3Rate: number };

export type SireStatsMaster = Record<string, Record<string, SireStatRow>>;

/**
 * レース内の同父クラスタと（任意）種牡馬統計から血統クラスタ補正を構築。
 */
export function buildPedigreeFieldMap(
  horses: readonly HorseAbility[],
  condition: RaceCondition,
  sireStats?: SireStatsMaster | null,
): PedigreeFieldMap {
  const bucket = sireStatsBucketKey(condition);
  const bySire = new Map<string, { sireName: string; horseIds: string[] }>();

  for (const h of horses) {
    const key = normalizeSireKey(h);
    if (!key) continue;
    const cur = bySire.get(key) ?? {
      sireName: h.pedigree?.sireName?.trim() || key.replace(/^id:|^name:/, ""),
      horseIds: [],
    };
    cur.horseIds.push(h.horseId);
    bySire.set(key, cur);
  }

  const out: PedigreeFieldMap = new Map();

  for (const h of horses) {
    const key = normalizeSireKey(h);
    if (!key) continue;
    const group = bySire.get(key);
    if (!group) continue;

    const clusterSize = group.horseIds.length;
    const inCluster = clusterSize >= 2;

    let sireTop3Rate01: number | undefined;
    const sireId = h.pedigree?.sireId;
    if (sireStats && sireId && sireStats[sireId]?.[bucket]) {
      sireTop3Rate01 = sireStats[sireId][bucket].top3Rate;
    }

    let clusterBonus = 0;
    if (inCluster) {
      clusterBonus += clusterSize >= 3 ? 0.9 : 0.5;
      if (sireTop3Rate01 != null && sireTop3Rate01 >= 0.45) {
        clusterBonus += 0.6;
      } else if (sireTop3Rate01 != null && sireTop3Rate01 >= 0.32) {
        clusterBonus += 0.3;
      }
      if (h.pedigree?.sireLineName && clusterSize >= 2) {
        clusterBonus += 0.2;
      }
    }

    out.set(h.horseId, {
      sireKey: key,
      sireName: group.sireName,
      clusterSize,
      inCluster,
      sireTop3Rate01,
      clusterBonus: Math.round(clusterBonus * 10) / 10,
    });
  }

  return out;
}

export function getPedigreeClusterBonus(
  horseId: string,
  fieldMap: PedigreeFieldMap | undefined,
): number {
  return fieldMap?.get(horseId)?.clusterBonus ?? 0;
}

export function formatPedigreeClusterBadge(info: PedigreeClusterInfo | undefined): string | null {
  if (!info?.inCluster) return null;
  const rate =
    info.sireTop3Rate01 != null ? ` 複勝圏${Math.round(info.sireTop3Rate01 * 100)}%` : "";
  return `🧬同父${info.clusterSize}頭${rate}`;
}
