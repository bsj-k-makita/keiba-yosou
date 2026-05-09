import type { HorseAbility, RaceCondition } from "./abilityTypes";
import { resolveCourseTraits } from "./courseTraitResolver";

export type PaceSeverityKind = "high" | "slow" | "neutral";

function escapeCount(horses: readonly HorseAbility[]): number {
  let n = 0;
  for (const h of horses) {
    if (h.runningStyle === "逃げ") n += 1;
  }
  return n;
}

/** 逃げ馬の平均スピード軸（ダッシュ質の代理）。低い「形だけ逃げ」ではペース激化を弱める */
function escapeAvgSpeed(horses: readonly HorseAbility[]): number | null {
  const esc = horses.filter((h) => h.runningStyle === "逃げ");
  if (esc.length === 0) return null;
  let s = 0;
  for (const h of esc) {
    s += h.speed ?? 50;
  }
  return s / esc.length;
}

function hasDownhillStartTrait(condition: RaceCondition): boolean {
  return resolveCourseTraits(condition).includes("DOWNHILL_START");
}

/**
 * 出走馬の脚質からペース激化度を推定。
 * DOWNHILL_START コースはハイペース閾値を引き下げ（追走力・末脚側を相対強化）。
 */
export function inferPaceSeverityKind(
  horses: readonly HorseAbility[],
  condition: RaceCondition,
): PaceSeverityKind {
  const ec = escapeCount(horses);
  const highThr = hasDownhillStartTrait(condition) ? 2 : 3;
  const avgSp = escapeAvgSpeed(horses);
  /** 逃げが足りてもスピード軸が低いときは激化を見送り（差し過大評価を抑制） */
  const escapeQualityOk = avgSp == null || avgSp >= 51.5;

  if (ec >= highThr && escapeQualityOk) return "high";
  if (ec >= highThr && !escapeQualityOk) return "neutral";
  if (ec <= 1) return "slow";
  return "neutral";
}

/**
 * 既にハイ／スロー系が明示されているときは維持し、未指定または middle のときのみ脚質推断で上書き。
 */
export function resolveEffectiveRacePace(condition: RaceCondition, horses: readonly HorseAbility[]): string {
  if (condition.paceInference === "manual") {
    return condition.pace && condition.pace.length > 0 ? condition.pace : "middle";
  }
  const key = condition.pace ?? "";
  const ambiguous = key === "" || key === "middle";
  if (!ambiguous) return condition.pace;

  const sev = inferPaceSeverityKind(horses, condition);
  if (sev === "high") return "many_front_runners";
  if (sev === "slow") return "no_front_runner";
  return key || "middle";
}
