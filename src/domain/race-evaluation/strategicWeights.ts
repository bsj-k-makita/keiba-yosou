import { ABILITY_KEYS, type RaceCondition, type WeightSet } from "./abilityTypes";
import strategicJson from "./strategicWeights.json";

export type StrategicProfileKey = keyof typeof strategicJson;

export const STRATEGIC_WEIGHTS = strategicJson as Record<StrategicProfileKey, WeightSet>;

const DEFAULT_PROFILE: StrategicProfileKey = "TOKYO_TURF";
// StrategicWeights 重要方針:
// - 東京芝はキレ(0.40) + 持続(0.25) を主軸にして直線性能を最大化
// - 中山はパワー(0.50) 全振りで急坂・機動力戦を優先
// - ローカル小回りはテンの速さ(0.55) 優先
// - 東京ダートは speed/stamina/kick/sustain = 0.20/0.20/0.25/0.25 で
//   坂対応と末脚持続を両立し、単なる前残り専用にしない

/**
 * 競馬場・コース文脈から戦略プロファイルキーを解決する。
 * UI の `venue`（東京・阪神・阪神外 等）と raceInfo を吸収する。
 */
export function resolveStrategicProfileKey(condition: RaceCondition): StrategicProfileKey {
  const venueRaw = condition.courseKey ?? condition.venue;
  const venue = venueRaw.trim();
  const blob = `${condition.courseKey ?? ""} ${condition.venue} ${condition.raceName ?? ""}`;
  const surface = condition.surface ?? "芝";

  if (/札幌|函館|北海道/.test(venue) || venue === "札幌函館") {
    return surface === "ダート" ? "HOKKAIDO_DIRT" : "HOKKAIDO_TURF";
  }

  if (venue === "東京" || /^東京/.test(venue)) {
    return surface === "ダート" ? "TOKYO_DIRT" : "TOKYO_TURF";
  }

  if (venue === "中山" || /中山/.test(blob)) {
    return "NAKAYAMA_ALL";
  }

  if (/京都内/.test(blob) || condition.courseKey === "京都内") {
    return "KYOTO_FLAT";
  }
  if (/京都/.test(blob) || venue.includes("京都")) {
    return surface === "ダート" ? "KYOTO_FLAT" : "KYOTO_TURF_OUT";
  }

  if (/阪神/.test(blob) || venue.includes("阪神")) {
    if (/内/.test(blob) || condition.courseTopology === "uphill") {
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

  return DEFAULT_PROFILE;
}

export function getStrategicBaseWeights(condition: RaceCondition): WeightSet {
  const key = resolveStrategicProfileKey(condition);
  const base = STRATEGIC_WEIGHTS[key];
  return base ? { ...base } : { ...STRATEGIC_WEIGHTS[DEFAULT_PROFILE] };
}

/** 加重合成スコア（能力 × 戦略ウェイト）。investmentSignals と共用。 */
export function scoreFromWeightedAbilities(
  abilities: { speed: number; stamina: number; kick: number; sustain: number; power: number },
  weights: WeightSet,
): number {
  return (
    abilities.speed * weights.speed +
    abilities.stamina * weights.stamina +
    abilities.kick * weights.kick +
    abilities.sustain * weights.sustain +
    abilities.power * weights.power
  );
}

export function weightedAbilityRadarPercent(
  abilities: { speed: number; stamina: number; kick: number; sustain: number; power: number },
  weights: WeightSet,
): Record<keyof WeightSet, number> {
  const raw = ABILITY_KEYS.map((k) => abilities[k] * weights[k]);
  const sum = raw.reduce((a, b) => a + b, 0);
  if (sum < 1e-9) {
    const u = 100 / ABILITY_KEYS.length;
    return {
      speed: u,
      stamina: u,
      kick: u,
      sustain: u,
      power: u,
    };
  }
  const out = {} as Record<keyof WeightSet, number>;
  for (let i = 0; i < ABILITY_KEYS.length; i++) {
    const k = ABILITY_KEYS[i]!;
    out[k] = Math.round(((raw[i] ?? 0) / sum) * 1000) / 10;
  }
  return out;
}
