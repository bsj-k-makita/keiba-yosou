import type { RaceCondition } from "./abilityTypes";

/** バックテスト集計・重賞ロジック用の粗いクラス区分 */
export type RaceClassBucket = "MAIDEN_NEW" | "OPEN_GRADE" | "OTHER";

export function isOpenOrGradedRace(condition: RaceCondition): boolean {
  return inferRaceClassBucket(condition) === "OPEN_GRADE";
}

export function inferRaceClassBucket(condition: RaceCondition): RaceClassBucket {
  const name = String(condition.raceName ?? "");
  if (/未勝利|新馬/.test(name)) return "MAIDEN_NEW";
  if (/オープン|\(OP\)|ＯＰ|G1|G2|G3|GⅠ|GⅡ|GⅢ|Jpn1|JPN1|リステッド|（L）|ステークス/.test(name)) {
    return "OPEN_GRADE";
  }
  return "OTHER";
}
