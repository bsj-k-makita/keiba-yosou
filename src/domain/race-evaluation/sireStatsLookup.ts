import type { SireStatsMaster } from "./pedigreeCluster";

/** `scripts/build-sire-stats.mjs` で生成。無い場合は空オブジェクト。 */
import sireStatsJson from "../../data/sire_stats.json";

let cached: SireStatsMaster | undefined;

export function getSireStatsMaster(): SireStatsMaster {
  if (cached != null) return cached;
  const raw = sireStatsJson as unknown;
  if (raw != null && typeof raw === "object" && !Array.isArray(raw)) {
    cached = raw as SireStatsMaster;
  } else {
    cached = {};
  }
  return cached;
}
