import { ABILITY_KEYS, type AbilityKey, type HorseAbility } from "./abilityTypes";
import { RACE_ABILITY_TYPE } from "./lingoConstants";

const GAP = 10;
const BALANCE_RANGE = 20;
const BALANCE_STD = 12;

/**
 * レーダー下1行。幾何分類（尖型・丸型等）は出さず、
 * 能力分布から「スピード型 / 持続型 …」に寄せる（言語定義 12. 能力タイプ）。
 */
const KEY_TO_TYPE: Record<AbilityKey, string> = {
  speed: RACE_ABILITY_TYPE.SPEED,
  stamina: RACE_ABILITY_TYPE.STAMINA,
  kick: RACE_ABILITY_TYPE.LATE,
  sustain: RACE_ABILITY_TYPE.SUSTAIN,
  power: RACE_ABILITY_TYPE.POWER,
};

export type RadarShapeId = AbilityKey | "balance";

function labelForKey(k: AbilityKey): string {
  return KEY_TO_TYPE[k];
}

export function inferRadarShape(horse: HorseAbility): { id: RadarShapeId; line: string } {
  const values = ABILITY_KEYS.map((k) => horse[k] ?? 0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const mean = values.reduce((a, b) => a + b, 0) / 5;
  const std = Math.sqrt(
    values.reduce((s, v) => s + (v - mean) * (v - mean), 0) / 5,
  );

  const withIdx = ABILITY_KEYS.map((k) => ({ k, v: horse[k] ?? 0 })).sort((a, b) => b.v - a.v);
  const a = withIdx[0]!;
  const b = withIdx[1]!;

  if (range < BALANCE_RANGE && std < BALANCE_STD) {
    return { id: "balance", line: RACE_ABILITY_TYPE.BALANCED };
  }

  if (a.v - b.v >= GAP) {
    return { id: a.k, line: labelForKey(a.k) };
  }

  if (range < 30) {
    return { id: "balance", line: RACE_ABILITY_TYPE.BALANCED };
  }

  const front4 = (horse.speed + horse.stamina + horse.sustain + horse.power) / 4;
  if (front4 > horse.kick + 3 && (horse.sustain + horse.stamina) / 2 > horse.kick) {
    if (horse.stamina > horse.sustain) {
      return { id: "stamina", line: RACE_ABILITY_TYPE.STAMINA };
    }
    return { id: "sustain", line: RACE_ABILITY_TYPE.SUSTAIN };
  }

  return { id: a.k, line: labelForKey(a.k) };
}
