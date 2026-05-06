import type { RaceCondition, WeightSet } from "./abilityTypes";

/**
 * JRA 全10場・コース種別対応のデフォルトウェイト定義。
 * 各キーは inferCourseWeightKey() が返す文字列に対応する。
 */
export const DEFAULT_COURSE_WEIGHTS: Record<string, WeightSet> = {
  // 東京・芝（中長距離）：長い直線でのキレとスタミナを最重視
  TOKYO_TURF: { speed: 0.20, stamina: 0.25, kick: 0.25, sustain: 0.20, power: 0.10 },
  // 東京・ダート：直線の上がり勝負と坂を上り切るスタミナの両立
  TOKYO_DIRT: { speed: 0.25, stamina: 0.20, kick: 0.20, sustain: 0.20, power: 0.15 },

  // 中山・全般：日本屈指の起伏と急坂をこなすパワーを最優先
  NAKAYAMA_ALL: { speed: 0.25, stamina: 0.15, kick: 0.10, sustain: 0.20, power: 0.30 },

  // 京都・芝（外）：下り坂の加速を活かした瞬発力重視
  KYOTO_TURF_OUT: { speed: 0.20, stamina: 0.20, kick: 0.30, sustain: 0.20, power: 0.10 },
  // 京都・芝（内）/ダート：平坦を活かした先行スピードと持続力
  KYOTO_FLAT: { speed: 0.30, stamina: 0.15, kick: 0.15, sustain: 0.25, power: 0.15 },

  // 阪神・芝（外）：東京に近いが急坂のためパワーの比重を上げる
  HANSHIN_TURF_OUT: { speed: 0.20, stamina: 0.20, kick: 0.25, sustain: 0.20, power: 0.15 },
  // 阪神・芝（内）/ダート：中山同様、急坂と小回りのためパワー重視
  HANSHIN_INNER: { speed: 0.25, stamina: 0.15, kick: 0.10, sustain: 0.20, power: 0.30 },

  // 中京・全般：長い直線と高低差。持続力とパワーのバランス
  CHUKYO_ALL: { speed: 0.20, stamina: 0.20, kick: 0.15, sustain: 0.25, power: 0.20 },

  // 新潟・芝（外）：日本一長い直線。瞬発力（Kick）と持続力の極限勝負
  NIIGATA_TURF_OUT: { speed: 0.20, stamina: 0.15, kick: 0.35, sustain: 0.25, power: 0.05 },

  // 福島/小倉/新潟（内）：小回り。スタートからハナを叩く先行力（Speed）が全て
  LOCAL_SMALL: { speed: 0.40, stamina: 0.10, kick: 0.10, sustain: 0.20, power: 0.20 },

  // 札幌/函館（洋芝）：重い芝をこなすスタミナと、掻き込むためのパワーのセット
  HOKKAIDO_TURF: { speed: 0.15, stamina: 0.30, kick: 0.10, sustain: 0.20, power: 0.25 },
  // 札幌/函館（ダート）：小回りパワー勝負
  HOKKAIDO_DIRT: { speed: 0.30, stamina: 0.15, kick: 0.10, sustain: 0.15, power: 0.30 },
};

/**
 * 後方互換: 旧venue名キーでのウェイト（UI の競馬場セレクターで使用）。
 * inferCourseWeightKey が解決できないときのフォールバックとしても機能する。
 */
export const BASE_COURSE_WEIGHTS: Record<string, WeightSet> = {
  東京: {
    speed: 0.143,
    stamina: 0.143,
    kick: 0.357,
    sustain: 0.286,
    power: 0.071,
  },
  京都: {
    speed: 0.214,
    stamina: 0.143,
    kick: 0.357,
    sustain: 0.214,
    power: 0.071,
  },
  阪神外: {
    speed: 0.214,
    stamina: 0.143,
    kick: 0.286,
    sustain: 0.286,
    power: 0.214,
  },
  中山: {
    speed: 0.25,
    stamina: 0.188,
    kick: 0.125,
    sustain: 0.313,
    power: 0.313,
  },
  中京: {
    speed: 0.188,
    stamina: 0.313,
    kick: 0.188,
    sustain: 0.313,
    power: 0.25,
  },
  福島: {
    speed: 0.357,
    stamina: 0.214,
    kick: 0.071,
    sustain: 0.286,
    power: 0.143,
  },
  新潟: {
    speed: 0.286,
    stamina: 0.214,
    kick: 0.143,
    sustain: 0.286,
    power: 0.071,
  },
  小倉: {
    speed: 0.267,
    stamina: 0.267,
    kick: 0.133,
    sustain: 0.267,
    power: 0.133,
  },
  札幌函館: {
    speed: 0.143,
    stamina: 0.286,
    kick: 0.071,
    sustain: 0.214,
    power: 0.286,
  },
};

export const DEFAULT_VENUE_KEY = "東京";

/**
 * コース条件（場・芝ダ・距離・内外コース）から DEFAULT_COURSE_WEIGHTS のキーを解決する。
 * 解決できない場合は null を返す（呼び出し側で BASE_COURSE_WEIGHTS にフォールバック）。
 */
export function inferCourseWeightKey(condition: RaceCondition): string | null {
  const venue = condition.venue ?? "";
  const surface = condition.surface ?? "芝";
  const distance = condition.distance ?? 0;
  const courseKey = condition.courseKey ?? "";

  // 東京
  if (venue === "東京") {
    return surface === "ダート" ? "TOKYO_DIRT" : "TOKYO_TURF";
  }

  // 中山
  if (venue === "中山") {
    return "NAKAYAMA_ALL";
  }

  // 京都
  if (venue === "京都") {
    if (surface === "ダート") return "KYOTO_FLAT";
    // 外回りコースは距離2000m超 or courseKeyで判定
    const isOuter = courseKey.includes("外") || distance >= 2000;
    return isOuter ? "KYOTO_TURF_OUT" : "KYOTO_FLAT";
  }

  // 阪神
  if (venue === "阪神") {
    if (surface === "ダート") return "HANSHIN_INNER";
    // 外回りコースは距離2000m超 or courseKeyで判定
    const isOuter = courseKey.includes("外") || distance >= 2000;
    return isOuter ? "HANSHIN_TURF_OUT" : "HANSHIN_INNER";
  }

  // 中京
  if (venue === "中京") {
    return "CHUKYO_ALL";
  }

  // 新潟
  if (venue === "新潟") {
    if (surface === "ダート") return "LOCAL_SMALL";
    // 外回りコースは直線1000m等
    const isOuter = courseKey.includes("外") || distance >= 1600;
    return isOuter ? "NIIGATA_TURF_OUT" : "LOCAL_SMALL";
  }

  // 福島・小倉（小回り）
  if (venue === "福島" || venue === "小倉") {
    return "LOCAL_SMALL";
  }

  // 札幌・函館（北海道・洋芝）
  if (venue === "札幌" || venue === "函館") {
    return surface === "ダート" ? "HOKKAIDO_DIRT" : "HOKKAIDO_TURF";
  }

  // 札幌函館（旧結合キー）
  if (venue === "札幌函館") {
    return surface === "ダート" ? "HOKKAIDO_DIRT" : "HOKKAIDO_TURF";
  }

  return null;
}
