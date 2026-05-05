import { ABILITY_KEYS, type AbilityKey, type HorseAbility } from "./abilityTypes";

export function extractStrongAbilities(horse: HorseAbility): AbilityKey[] {
  let maxVal = -Infinity;
  for (const key of ABILITY_KEYS) {
    maxVal = Math.max(maxVal, horse[key]);
  }
  if (maxVal <= 0) {
    return [];
  }
  const threshold = maxVal * 0.85;
  const keys: AbilityKey[] = [];
  for (const key of ABILITY_KEYS) {
    if (horse[key] >= threshold) {
      keys.push(key);
    }
  }
  return keys.sort((a, b) => horse[b] - horse[a]);
}
