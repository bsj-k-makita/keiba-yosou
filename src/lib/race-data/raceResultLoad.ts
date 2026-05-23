import type { RaceResultData } from "./raceEvaluationTypes";

/** 着順表示に使える結果か（3着以上・馬名または horseId あり） */
export function isUsableRaceResult(data: unknown): data is RaceResultData {
  if (data == null || typeof data !== "object") return false;
  const places = (data as RaceResultData).places;
  if (!Array.isArray(places) || places.length < 3) return false;
  const valid = places.filter(
    (p) =>
      (typeof p.horseName === "string" && p.horseName.trim().length > 0) ||
      (typeof p.horseId === "string" && p.horseId.trim().length > 0) ||
      (typeof p.horseNumber === "number" && Number.isFinite(p.horseNumber) && p.horseNumber > 0),
  );
  return valid.length >= 3;
}

export function hasQuinellaWideAndTrifectaPayouts(data: RaceResultData): boolean {
  const p = data.payouts;
  return (p?.REN?.length ?? 0) > 0 && (p?.WREN?.length ?? 0) > 0 && (p?.TRI?.length ?? 0) > 0;
}
