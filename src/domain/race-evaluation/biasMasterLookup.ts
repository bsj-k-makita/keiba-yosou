import type { RaceCondition } from "./abilityTypes";
import biasMasterJson from "../../data/bias_master.json";

export type BiasMasterEntry = {
  raceCount: number;
  top3Total?: number;
  innerShare: number;
  outerSashiShare: number;
  innerFavor: boolean;
  outerSashiFavor: boolean;
};

type BiasMasterFile = {
  version?: number;
  entries?: Record<string, BiasMasterEntry>;
};

const FILE = biasMasterJson as BiasMasterFile;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** scripts/lib/biasMaster.mjs の biasKey と同一 */
export function biasMasterKey(meetingDate: string, venue: string, surface: "芝" | "ダート"): string {
  return `${meetingDate}|${venue}|${surface}`;
}

/**
 * 当日・当場・surface の集計行から、枠補正に使う方向と強度（0〜1）を得る。
 */
export function trackBiasFromBiasMasterEntry(e: BiasMasterEntry | null | undefined): {
  direction: number;
  strength01: number;
} | null {
  if (e == null || !Number.isFinite(e.raceCount) || e.raceCount < 1) return null;

  const damp = Math.min(1, e.raceCount / 8);
  let direction = 0;

  if (e.innerFavor && !e.outerSashiFavor) direction = 1;
  else if (e.outerSashiFavor && !e.innerFavor) direction = -1;
  else if (e.innerFavor && e.outerSashiFavor) {
    direction = e.innerShare >= e.outerSashiShare ? 1 : -1;
  } else {
    const diff = e.innerShare - e.outerSashiShare;
    if (Math.abs(diff) < 0.06) return null;
    direction = diff > 0 ? 1 : -1;
  }

  const magnitude = Math.abs(e.innerShare - e.outerSashiShare);
  const strength01 = clamp(magnitude * 2.0 * damp + (e.innerFavor || e.outerSashiFavor ? 0.12 : 0.06), 0.12, 0.78);

  return { direction, strength01 };
}

function resolveSurface(condition: RaceCondition): "芝" | "ダート" {
  return condition.surface === "ダート" ? "ダート" : "芝";
}

/**
 * `bias_master.json` を参照してトラックバイアスオーバーレイを返す。
 */
export function lookupBiasMasterTrackBias(condition: RaceCondition): { direction: number; strength01: number } | null {
  const date = condition.meetingDate?.trim();
  const venue = condition.venue?.trim();
  if (!date || !venue || date.length < 8) return null;

  const entries = FILE.entries;
  if (entries == null || typeof entries !== "object") return null;

  const key = biasMasterKey(date, venue, resolveSurface(condition));
  const row = entries[key];
  return trackBiasFromBiasMasterEntry(row);
}
