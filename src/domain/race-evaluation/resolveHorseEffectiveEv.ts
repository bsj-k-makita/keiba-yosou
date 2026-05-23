import type { HorseAbility, InvestmentCommentInput } from "./abilityTypes";

function n(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** UI・ViewModel で採用した期待値の由来 */
export type EffectiveEvSource = "ai" | "simple";

export type ResolvedHorseEffectiveEv = {
  effectiveEv: number | null;
  source: EffectiveEvSource | null;
};

type HorseEvInput = Pick<HorseAbility, "aiEffectiveEv" | "investment"> & {
  ai_effective_ev?: number;
};

type InvestmentEvInput = InvestmentCommentInput & {
  final_expected_value?: number;
};

/**
 * 馬の表示用期待値。Python AI の ai_effective_ev を最優先し、
 * 無いときのみ enrich の final_expected_value（Node 簡易）にフォールバック。
 */
export function resolveHorseEffectiveEv(horse: HorseEvInput): ResolvedHorseEffectiveEv {
  const ai =
    n(horse.aiEffectiveEv) ?? n((horse as HorseEvInput & { ai_effective_ev?: number }).ai_effective_ev);
  if (ai != null) {
    return { effectiveEv: ai, source: "ai" };
  }

  const inv = horse.investment as InvestmentEvInput | undefined;
  const simple = n(inv?.finalExpectedValue) ?? n(inv?.final_expected_value);
  if (simple != null) {
    return { effectiveEv: simple, source: "simple" };
  }

  return { effectiveEv: null, source: null };
}

/** investment ブロックのみから期待値を解決（EvRow 等） */
export function resolveInvestmentEffectiveEv(
  investment: InvestmentCommentInput,
  aiEffectiveEv?: number | null,
): ResolvedHorseEffectiveEv {
  return resolveHorseEffectiveEv({
    aiEffectiveEv: aiEffectiveEv ?? undefined,
    investment,
  });
}
