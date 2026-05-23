import { describe, expect, it } from "vitest";
import { resolveHorseEffectiveEv } from "./resolveHorseEffectiveEv";
import type { HorseAbility } from "./abilityTypes";

function horse(partial: Partial<HorseAbility>): HorseAbility {
  return {
    horseId: "h1",
    horseName: "テスト",
    runningStyle: "差し",
    speed: 50,
    stamina: 50,
    kick: 50,
    sustain: 50,
    power: 50,
    ...partial,
  };
}

describe("resolveHorseEffectiveEv", () => {
  it("ai_effective_ev を最優先する", () => {
    const r = resolveHorseEffectiveEv(
      horse({
        aiEffectiveEv: 1.35,
        investment: { finalExpectedValue: 1.1, predictedProbability: 0.2, actualOdds: 5, valueRank: "B", betType: "軸", valueChange: "STABLE", keyFactors: [], riskFactors: [] },
      }),
    );
    expect(r).toEqual({ effectiveEv: 1.35, source: "ai" });
  });

  it("ai が無いとき final_expected_value にフォールバックする", () => {
    const r = resolveHorseEffectiveEv(
      horse({
        investment: { finalExpectedValue: 1.25, predictedProbability: 0.2, actualOdds: 5, valueRank: "A", betType: "軸", valueChange: "STABLE", keyFactors: [], riskFactors: [] },
      }),
    );
    expect(r).toEqual({ effectiveEv: 1.25, source: "simple" });
  });

  it("どちらも無いとき null", () => {
    expect(resolveHorseEffectiveEv(horse({}))).toEqual({ effectiveEv: null, source: null });
  });
});
