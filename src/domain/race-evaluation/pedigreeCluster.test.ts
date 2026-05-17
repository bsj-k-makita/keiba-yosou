import { describe, expect, test } from "vitest";
import { buildPedigreeFieldMap, distanceBandKey, sireStatsBucketKey } from "./pedigreeCluster";
import type { HorseAbility, RaceCondition } from "./abilityTypes";

function horse(
  id: string,
  sireId: string,
  sireName: string,
): HorseAbility & { horseId: string } {
  return {
    horseId: id,
    horseName: id,
    speed: 50,
    stamina: 50,
    kick: 50,
    sustain: 50,
    power: 50,
    runningStyle: "好位",
    pedigree: { sireId, sireName },
  };
}

describe("pedigreeCluster", () => {
  test("distanceBandKey buckets by distance", () => {
    expect(distanceBandKey(1200)).toBe("sprint");
    expect(distanceBandKey(1600)).toBe("mile");
    expect(distanceBandKey(2000)).toBe("middle");
    expect(distanceBandKey(2400)).toBe("stayer");
  });

  test("same sire cluster gives bonus to all members", () => {
    const horses = [
      horse("a", "s1", "父A"),
      horse("b", "s1", "父A"),
      horse("c", "s2", "父B"),
    ];
    const condition: RaceCondition = {
      venue: "東京",
      ground: "good",
      bias: "flat",
      pace: "middle",
      adjustmentStrength: "middle",
      distance: 2400,
      surface: "芝",
    };
    const map = buildPedigreeFieldMap(horses, condition, {
      s1: {
        [sireStatsBucketKey(condition)]: { runs: 20, top3: 10, top3Rate: 0.5 },
      },
    });
    expect(map.get("a")?.clusterSize).toBe(2);
    expect(map.get("a")?.clusterBonus).toBeGreaterThan(0);
    expect(map.get("c")?.clusterBonus).toBe(0);
  });
});
