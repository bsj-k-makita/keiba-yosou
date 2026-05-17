import { describe, expect, test } from "vitest";
import {
  computeFavoriteMarkHit,
  emptyFavoriteMarkAggregate,
  finalizeFavoriteMarkAggregate,
  mergeFavoriteMarkHit,
} from "./favoriteMarkStats";

describe("favoriteMarkStats", () => {
  test("3着内率を集計", () => {
    const acc = emptyFavoriteMarkAggregate();
    mergeFavoriteMarkHit(acc, computeFavoriteMarkHit(5, [5, 2, 8]), true);
    mergeFavoriteMarkHit(acc, computeFavoriteMarkHit(3, [1, 2, 3]), true);
    mergeFavoriteMarkHit(acc, computeFavoriteMarkHit(7, [1, 2, 4]), true);
    finalizeFavoriteMarkAggregate(acc);
    expect(acc.races).toBe(3);
    expect(acc.winHits).toBe(1);
    expect(acc.showHits).toBe(2);
    expect(acc.showRate).toBe(66.7);
  });
});
