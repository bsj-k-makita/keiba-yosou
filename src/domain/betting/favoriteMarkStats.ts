/**
 * ◎馬の着順別的中（バックテスト診断用）。
 */
export type FavoriteMarkHit = {
  winHit: boolean;
  showHit: boolean;
};

export function computeFavoriteMarkHit(
  favoriteNumber: number | undefined,
  finishOrder: readonly number[],
): FavoriteMarkHit {
  if (favoriteNumber == null || finishOrder.length === 0) {
    return { winHit: false, showHit: false };
  }
  const winHit = finishOrder[0] === favoriteNumber;
  const top3 = new Set(finishOrder.slice(0, 3));
  const showHit = top3.has(favoriteNumber);
  return { winHit, showHit };
}

export type FavoriteMarkAggregate = {
  races: number;
  winHits: number;
  showHits: number;
  winRate: number;
  /** ◎の3着内率（複勝圏生存率） */
  showRate: number;
};

export function emptyFavoriteMarkAggregate(): FavoriteMarkAggregate {
  return { races: 0, winHits: 0, showHits: 0, winRate: 0, showRate: 0 };
}

export function finalizeFavoriteMarkAggregate(acc: FavoriteMarkAggregate): void {
  acc.winRate = acc.races > 0 ? Math.round((acc.winHits / acc.races) * 1000) / 10 : 0;
  acc.showRate = acc.races > 0 ? Math.round((acc.showHits / acc.races) * 1000) / 10 : 0;
}

export function mergeFavoriteMarkHit(
  acc: FavoriteMarkAggregate,
  hit: FavoriteMarkHit,
  hasFavorite: boolean,
): void {
  if (!hasFavorite) return;
  acc.races += 1;
  if (hit.winHit) acc.winHits += 1;
  if (hit.showHit) acc.showHits += 1;
}
