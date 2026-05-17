import type { HorseAbility, HorseScoreResult } from "./abilityTypes";

/** 結果確認・一覧的中率で扱う本命印 */
export const TOP_PREDICTION_MARKS = ["◎", "○", "▲"] as const;
export type TopPredictionMark = (typeof TOP_PREDICTION_MARKS)[number];

export type MarkPick = {
  mark: TopPredictionMark;
  horseId: string;
  horseName: string;
  gate?: number;
};

export type MarkHitRow = MarkPick & {
  hit: boolean;
};

export type PlaceLike = {
  place: number;
  horseId?: string;
  horseName?: string;
  horseNumber?: number;
};

export function normalizeHorseName(name: string): string {
  return name.replace(/\s+/g, "").trim();
}

function gateOf(h: HorseAbility): number | undefined {
  if ("gate" in h && typeof (h as { gate?: number }).gate === "number") {
    return (h as { gate?: number }).gate;
  }
  return undefined;
}

/**
 * 着順データの horseId / 馬名 / 馬番から、評価用 horses 上の horseId を解決する。
 * 結果 JSON と出走表で ID が空・不一致のときも馬名・馬番で突合する。
 */
export function resolvePlaceToHorseId(
  place: PlaceLike,
  horses: readonly HorseAbility[],
): string | null {
  const id = (place.horseId ?? "").trim();
  if (id && horses.some((h) => h.horseId === id)) {
    return id;
  }

  const nameKey = place.horseName ? normalizeHorseName(place.horseName) : "";
  if (nameKey) {
    const byName = horses.filter((h) => normalizeHorseName(h.horseName) === nameKey);
    if (byName.length === 1) {
      return byName[0]!.horseId;
    }
  }

  const num = place.horseNumber;
  if (num != null && Number.isFinite(num)) {
    const byGate = horses.filter((h) => gateOf(h) === num);
    if (byGate.length === 1) {
      return byGate[0]!.horseId;
    }
  }

  return id.length > 0 ? id : null;
}

/** 1〜3着の horseId 集合（出走表の馬と突合済み） */
export function buildTop3WinnerIds(
  places: readonly PlaceLike[],
  horses: readonly HorseAbility[],
): Set<string> {
  const winners = new Set<string>();
  for (const p of places) {
    if (p.place < 1 || p.place > 3) continue;
    const resolved = resolvePlaceToHorseId(p, horses);
    if (resolved) winners.add(resolved);
  }
  return winners;
}

/** 評価結果から ◎○▲ の付与馬を取得（配列順に依存しない） */
export function pickMarkedHorses(
  results: readonly HorseScoreResult[],
  horses: readonly HorseAbility[],
): MarkPick[] {
  const horseById = new Map(horses.map((h) => [h.horseId, h] as const));
  const out: MarkPick[] = [];
  for (const mark of TOP_PREDICTION_MARKS) {
    const row = results.find((r) => r.mark === mark);
    if (!row) continue;
    const horse = horseById.get(row.horseId);
    out.push({
      mark,
      horseId: row.horseId,
      horseName: row.horseName,
      gate: horse ? gateOf(horse) : undefined,
    });
  }
  return out;
}

export function analyzeMarkHits(
  places: readonly PlaceLike[],
  results: readonly HorseScoreResult[],
  horses: readonly HorseAbility[],
): { winners: Set<string>; rows: MarkHitRow[] } {
  const winners = buildTop3WinnerIds(places, horses);
  const rows = pickMarkedHorses(results, horses).map((pick) => ({
    ...pick,
    hit: winners.has(pick.horseId),
  }));
  return { winners, rows };
}

/** 印の表示優先度（小さいほど上）。印なしは 5 */
export function markDisplayPriority(mark: string | undefined): number {
  if (mark === "◎") return 0;
  if (mark === "○") return 1;
  if (mark === "▲") return 2;
  if (mark === "☆") return 3;
  if (mark === "△") return 4;
  return 5;
}

function hokkakeRolePriority(role: string | undefined): number {
  if (role === "△1安定") return 0;
  if (role === "△2物理") return 1;
  if (role === "△3狙い") return 2;
  return 3;
}

/**
 * 出馬表・カード一覧用の並び。
 * 印付き馬を ◎→○→▲→☆→△ の順で先頭に集め、印なしは枠順→馬番。
 */
export function sortResultsForPredictionTable(
  results: readonly HorseScoreResult[],
  gateOrderHorseIds: readonly string[],
): HorseScoreResult[] {
  const gateOrder = new Map(gateOrderHorseIds.map((id, i) => [id, i] as const));
  const pipelineOrder = new Map(results.map((r, i) => [r.horseId, i] as const));
  return [...results].sort((a, b) => {
    const ma = markDisplayPriority(a.mark);
    const mb = markDisplayPriority(b.mark);
    if (ma !== mb) return ma - mb;

    if (a.mark === "△" && b.mark === "△") {
      const ha = hokkakeRolePriority(a.hokkakeRole);
      const hb = hokkakeRolePriority(b.hokkakeRole);
      if (ha !== hb) return ha - hb;
    }

    const da = (a.finalRank ?? a.adjustedRank ?? 99) - (b.finalRank ?? b.adjustedRank ?? 99);
    if (da !== 0) return da;

    const ga = gateOrder.get(a.horseId) ?? 999;
    const gb = gateOrder.get(b.horseId) ?? 999;
    if (ga !== gb) return ga - gb;

    return (pipelineOrder.get(a.horseId) ?? 0) - (pipelineOrder.get(b.horseId) ?? 0);
  });
}

/** ◎○▲ が構造消し以外に付いているか */
export function hasRequiredTopMarks(
  results: readonly HorseScoreResult[],
  structuralDismissIds: ReadonlySet<string>,
): boolean {
  return TOP_PREDICTION_MARKS.every((mark) =>
    results.some((r) => r.mark === mark && !structuralDismissIds.has(r.horseId)),
  );
}

/** 手動入力 PlaceMap（1〜4着の horseId）を places 形式へ */
export function manualPlaceMapToPlaces(
  map: Partial<Record<"1" | "2" | "3" | "4", string>>,
): PlaceLike[] {
  const out: PlaceLike[] = [];
  for (const key of ["1", "2", "3", "4"] as const) {
    const horseId = map[key];
    if (!horseId) continue;
    out.push({ place: Number(key), horseId });
  }
  return out;
}
