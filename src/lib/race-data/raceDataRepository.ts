import type { HorseAbility } from "../../domain/race-evaluation/abilityTypes";
import { convertToRaceEvaluationData } from "./convertToRaceEvaluationData";
import type { RaceEvaluationData, RaceIndexItem, RaceResultData } from "./raceEvaluationTypes";
import { raceDataToHorses } from "./raceDataToHorses";
import { assertRaceDataQuality } from "./dataQualityGuards";
import indexJson from "../../data/index.json";

const raceJsonLoaders = import.meta.glob<{ default: unknown }>("../../data/races/*.json");
const resultJsonLoaders = import.meta.glob<{ default: unknown }>("../../data/results/*.json");

/** レース JSON 更新・HMR 後も古い表示が残らないよう、評価データはキャッシュしない */
const resultCache = new Map<string, RaceResultData | null>();
const resultFetchInFlight = new Map<string, Promise<RaceResultData | null>>();

function resultStorageKey(raceId: string): string {
  return `race-result-cache:${raceId}`;
}

function loadResultFromLocalStorage(raceId: string): RaceResultData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(resultStorageKey(raceId));
    if (!raw) return null;
    return JSON.parse(raw) as RaceResultData;
  } catch {
    return null;
  }
}

function saveResultToLocalStorage(raceId: string, result: RaceResultData): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(resultStorageKey(raceId), JSON.stringify(result));
  } catch {
    // ignore storage failures
  }
}

/**
 * レース一覧。初期実装は JSON 固定。将来は fetch / DB 差し替え可。
 * 日付の新しい順（降順）。同一日は index.json 上の並びを維持する。
 */
export async function getRaceIndex(): Promise<RaceIndexItem[]> {
  const list = indexJson as RaceIndexItem[];
  return list
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const byDate = b.item.date.localeCompare(a.item.date);
      if (byDate !== 0) return byDate;
      return a.index - b.index;
    })
    .map(({ item }) => item);
}

/**
 * 開発時は fetch + cache bust でディスク更新をそのまま反映（import のモジュールキャッシュを避ける）。
 * 本番ビルドでは import.meta.glob のまま（ビルド時点の JSON がバンドルされる）。
 */
async function loadRaceJsonRaw(raceId: string): Promise<unknown | null> {
  if (import.meta.env.DEV) {
    try {
      const safeId = encodeURIComponent(raceId);
      const base = new URL(`../../data/races/${safeId}.json`, import.meta.url);
      const sep = base.href.includes("?") ? "&" : "?";
      const res = await fetch(`${base.href}${sep}_=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) return null;
      return (await res.json()) as unknown;
    } catch {
      // fall through
    }
  }

  const rel = `../../data/races/${raceId}.json`;
  const load = raceJsonLoaders[rel];
  if (load == null) return null;
  const mod = (await load()) as { default: unknown };
  return mod.default;
}

/**
 * 生のレース JSON（1 ファイル分）。`races/{raceId}.json`。
 */
export async function getRaceById(raceId: string): Promise<unknown | null> {
  return loadRaceJsonRaw(raceId);
}

/**
 * raceId に対応する能力評価データを取得する。無ければ null。
 */
export async function getRaceEvaluationById(
  raceId: string,
): Promise<RaceEvaluationData | null> {
  const raw = await getRaceById(raceId);
  if (raw == null) return null;
  const data = convertToRaceEvaluationData(raw);
  assertRaceDataQuality(data);
  return data;
}

/**
 * 結果 JSON を取得する。fetch-race-results.mjs で生成した
 * src/data/results/{raceId}.json が存在すれば返す。無ければ null。
 */
export async function getRaceResultById(
  raceId: string,
): Promise<RaceResultData | null> {
  if (resultCache.has(raceId)) {
    return resultCache.get(raceId) ?? null;
  }

  const rel = `../../data/results/${raceId}.json`;
  const load = resultJsonLoaders[rel];
  if (load != null) {
    const mod = (await load()) as { default: unknown };
    const result = mod.default as RaceResultData;
    resultCache.set(raceId, result);
    return result;
  }

  const cached = loadResultFromLocalStorage(raceId);
  if (cached != null) {
    resultCache.set(raceId, cached);
    return cached;
  }

  resultCache.set(raceId, null);
  return null;
}

/**
 * API 経由で結果を即時取得し、メモリ・localStorage に保存する。
 */
export async function fetchRaceResultByApi(raceId: string): Promise<RaceResultData | null> {
  if (!/^\d{12}$/.test(raceId)) return null;
  const inFlight = resultFetchInFlight.get(raceId);
  if (inFlight != null) return inFlight;
  const task = (async () => {
    try {
      const res = await fetch(`/api/race-result?raceId=${encodeURIComponent(raceId)}`);
      if (res.status === 404) {
        resultCache.set(raceId, null);
        return null;
      }
      if (!res.ok) {
        return null;
      }
      const data = (await res.json()) as RaceResultData;
      if (!data || !Array.isArray(data.places)) {
        return null;
      }
      resultCache.set(raceId, data);
      saveResultToLocalStorage(raceId, data);
      return data;
    } catch {
      return null;
    } finally {
      resultFetchInFlight.delete(raceId);
    }
  })();
  resultFetchInFlight.set(raceId, task);
  return task;
}

/**
 * ドメインの Horse 行へ。馬番を `gate` として扱い既存 UI と整合。
 */
export function getHorsesFromRaceData(
  data: RaceEvaluationData,
): (HorseAbility & { gate: number; frameNumber: number })[] {
  return raceDataToHorses(data);
}
