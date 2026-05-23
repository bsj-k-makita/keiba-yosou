import type { HorseAbility } from "../../domain/race-evaluation/abilityTypes";
import { convertToRaceEvaluationData } from "./convertToRaceEvaluationData";
import type { RaceEvaluationData, RaceIndexItem, RaceResultData } from "./raceEvaluationTypes";
import {
  hasQuinellaWideAndTrifectaPayouts,
  isUsableRaceResult,
} from "./raceResultLoad";
import { raceDataToHorses } from "./raceDataToHorses";
import { assertRaceDataQuality } from "./dataQualityGuards";
import indexJson from "../../data/index.json";

export { isUsableRaceResult, hasQuinellaWideAndTrifectaPayouts } from "./raceResultLoad";

const raceJsonLoaders = import.meta.glob<{ default: unknown }>("../../data/races/*.json");
const resultJsonLoaders = import.meta.glob<{ default: unknown }>("../../data/results/*.json");

/** レース JSON 更新・HMR 後も古い表示が残らないよう、評価データはキャッシュしない */
const resultCache = new Map<string, RaceResultData>();
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
 * 開発時は fetch + cache bust で結果 JSON の更新を即反映（レース JSON と同様）。
 */
async function loadResultJsonRaw(raceId: string): Promise<unknown | null> {
  if (import.meta.env.DEV) {
    try {
      const safeId = encodeURIComponent(raceId);
      const base = new URL(`../../data/results/${safeId}.json`, import.meta.url);
      const sep = base.href.includes("?") ? "&" : "?";
      const res = await fetch(`${base.href}${sep}_=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) return null;
      return (await res.json()) as unknown;
    } catch {
      // fall through
    }
  }

  const rel = `../../data/results/${raceId}.json`;
  const load = resultJsonLoaders[rel];
  if (load == null) return null;
  const mod = (await load()) as { default: unknown };
  return mod.default;
}

/** メモリキャッシュを捨てる（結果 JSON 追加後の再読込用） */
export function invalidateRaceResultCache(raceId?: string): void {
  if (raceId != null) {
    resultCache.delete(raceId);
    return;
  }
  resultCache.clear();
}

async function loadUsableRaceResult(raceId: string): Promise<RaceResultData | null> {
  const raw = await loadResultJsonRaw(raceId);
  if (isUsableRaceResult(raw)) {
    resultCache.set(raceId, raw);
    return raw;
  }

  const fromLs = loadResultFromLocalStorage(raceId);
  if (isUsableRaceResult(fromLs)) {
    resultCache.set(raceId, fromLs);
    return fromLs;
  }

  const mem = resultCache.get(raceId);
  if (mem != null && isUsableRaceResult(mem)) return mem;

  return null;
}

/**
 * 結果 JSON を取得する。fetch-race-results.mjs で生成した
 * src/data/results/{raceId}.json が存在すれば返す。無ければ null。
 * 失敗時は null をキャッシュしない（後から JSON を足しても再読込できる）。
 */
export async function getRaceResultById(
  raceId: string,
): Promise<RaceResultData | null> {
  return loadUsableRaceResult(raceId);
}

/**
 * キャッシュ（JSON / localStorage）があれば返し、なければ API で自動取得する。
 * 毎回ディスクを先に見る（開発中に fetch した直後も反映）。
 * 払戻3券種が揃っていないときだけ API で補完を試みる（着順表示は揃っていなくても可）。
 */
export async function ensureRaceResultFetched(raceId: string): Promise<RaceResultData | null> {
  invalidateRaceResultCache(raceId);

  const fromDisk = await loadUsableRaceResult(raceId);
  if (fromDisk != null) {
    if (!hasQuinellaWideAndTrifectaPayouts(fromDisk)) {
      const upgraded = await fetchRaceResultByApi(raceId);
      if (upgraded != null) return upgraded;
    }
    return fromDisk;
  }

  const fromApi = await fetchRaceResultByApi(raceId);
  if (fromApi != null) return fromApi;

  return null;
}

export async function fetchRaceResultByApi(raceId: string): Promise<RaceResultData | null> {
  if (!/^\d{12}$/.test(raceId)) return null;
  const inFlight = resultFetchInFlight.get(raceId);
  if (inFlight != null) return inFlight;
  const task = (async () => {
    try {
      const res = await fetch(`/api/race-result?raceId=${encodeURIComponent(raceId)}`);
      if (res.status === 404) {
        return null;
      }
      if (!res.ok) {
        return null;
      }
      const data = (await res.json()) as RaceResultData;
      if (!isUsableRaceResult(data)) {
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
