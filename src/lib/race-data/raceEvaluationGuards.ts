import type { RaceEvaluationData } from "./raceEvaluationTypes";

const ABILITY_AXIS = [
  "speed",
  "stamina",
  "kick",
  "sustain",
  "power",
] as const;

function raceEvaluationShapeError(v: unknown): string | null {
  if (v == null || typeof v !== "object") return "不正な形式";
  const o = v as Record<string, unknown>;
  if (typeof o["raceId"] !== "string") return "raceId が必須です";
  if (o["raceInfo"] == null || typeof o["raceInfo"] !== "object")
    return "raceInfo が必須です";
  if (o["condition"] == null || typeof o["condition"] !== "object")
    return "condition が必須です";
  if (!Array.isArray(o["entries"]) || o["entries"].length === 0) {
    return "entries が空です";
  }
  for (const ent of o["entries"] as unknown[]) {
    if (ent == null || typeof ent !== "object") return "不正な entry";
    const e = ent as Record<string, unknown>;
    for (const k of ABILITY_AXIS) {
      const a = (e["abilities"] as Record<string, unknown> | undefined)?.[k];
      if (typeof a !== "number") return `abilities.${k} が不正です`;
    }
    if (typeof e["runningStyle"] !== "string")
      return "runningStyle が不正です";
  }
  return null;
}

/** `convertToRaceEvaluationData` で、既存 UI 形式の JSON か判別 */
export function isRaceEvaluationDataShape(v: unknown): v is RaceEvaluationData {
  return raceEvaluationShapeError(v) == null;
}

export function assertIsRaceEvaluationData(v: unknown): asserts v is RaceEvaluationData {
  const err = raceEvaluationShapeError(v);
  if (err) throw new Error(`RaceEvaluationData: ${err}`);
}
