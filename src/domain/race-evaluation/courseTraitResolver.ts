import type { HorseAbility, RaceCondition } from "./abilityTypes";

export type CourseTrait =
  | "SHORT_RUN_IN"
  | "INNER_ADVAN"
  | "SHIBA_START"
  | "OUTER_ADVAN"
  | "OUTSIDE_LAT_ONLY";

export type CourseTraitHit = {
  label: string;
  reason: string;
  bonus: number;
};

const COURSE_TRAIT_MASTER: Record<string, readonly CourseTrait[]> = {
  TOKYO_T2000: ["SHORT_RUN_IN", "INNER_ADVAN"],
  NAKAYAMA_D1200: ["SHIBA_START", "OUTER_ADVAN"],
  NIIGATA_T1000: ["OUTSIDE_LAT_ONLY"],
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function normalizeVenue(condition: RaceCondition): string {
  const v = (condition.courseKey ?? condition.venue ?? "").trim();
  if (v.includes("東京")) return "TOKYO";
  if (v.includes("中山")) return "NAKAYAMA";
  if (v.includes("新潟")) return "NIIGATA";
  if (v.includes("阪神")) return "HANSHIN";
  if (v.includes("京都")) return "KYOTO";
  return v.toUpperCase().replace(/\s+/g, "_");
}

function normalizeSurface(condition: RaceCondition): "T" | "D" {
  return condition.surface === "ダート" ? "D" : "T";
}

export function resolveCourseTraitKey(condition: RaceCondition): string | null {
  if (condition.distance == null || !Number.isFinite(condition.distance)) return null;
  const venue = normalizeVenue(condition);
  if (!venue) return null;
  return `${venue}_${normalizeSurface(condition)}${Math.round(condition.distance)}`;
}

export function resolveCourseTraits(condition: RaceCondition): readonly CourseTrait[] {
  const key = resolveCourseTraitKey(condition);
  if (!key) return [];
  return COURSE_TRAIT_MASTER[key] ?? [];
}

function strengthMultiplier(strength: RaceCondition["adjustmentStrength"]): number {
  if (strength === "weak") return 0.7;
  if (strength === "middle") return 1.0;
  // strong は逆転を起こしやすくするため極端に増幅
  return 2.0;
}

function resolveGateNumber(horse: HorseAbility): number | null {
  const gate = (horse as HorseAbility & { gate?: number }).gate;
  if (gate != null && Number.isFinite(gate) && gate > 0) {
    return gate;
  }
  return null;
}

function resolveFrameNumber(horse: HorseAbility): number | null {
  if (horse.frameNumber != null && Number.isFinite(horse.frameNumber) && horse.frameNumber > 0) {
    return horse.frameNumber;
  }
  return null;
}

export function computeCourseTraitHits(
  horse: HorseAbility,
  condition: RaceCondition,
): CourseTraitHit[] {
  const traits = resolveCourseTraits(condition);
  if (traits.length === 0) return [];
  const gate = resolveGateNumber(horse);
  const frame = resolveFrameNumber(horse);
  const style = horse.runningStyle;
  const mult = strengthMultiplier(condition.adjustmentStrength);
  const hits: CourseTraitHit[] = [];

  const hasInner = traits.includes("INNER_ADVAN");
  const hasOuter = traits.includes("OUTER_ADVAN");
  const hasShortRun = traits.includes("SHORT_RUN_IN");
  const hasShibaStart = traits.includes("SHIBA_START");
  const hasOutsideLateOnly = traits.includes("OUTSIDE_LAT_ONLY");

  // A. 内前有利（SHORT_RUN_IN / INNER_ADVAN）
  if ((hasInner || hasShortRun) && gate != null && gate >= 1 && gate <= 4 && (style === "逃げ" || style === "先行")) {
    const raw = 8.5 * mult;
    const bonus = condition.adjustmentStrength === "strong" ? raw : clamp(raw, 0, 8.5);
    hits.push({
      label: "コース特性一致",
      reason: `内前有利: 馬番${gate}・${style}（SHORT_RUN_IN/INNER_ADVAN）`,
      bonus: round1(bonus),
    });
  }

  // B. 外前有利（SHIBA_START / OUTER_ADVAN）
  if (hasOuter && frame != null && frame >= 7 && frame <= 8 && style === "先行") {
    const raw = (hasShibaStart ? 7.5 : 6.5) * mult;
    const bonus = condition.adjustmentStrength === "strong" ? raw : clamp(raw, 0, 8.5);
    hits.push({
      label: "コース特性一致",
      reason: `外前有利: ${frame}枠・${style}（OUTER_ADVAN${hasShibaStart ? "/SHIBA_START" : ""}）`,
      bonus: round1(bonus),
    });
  }

  // 新潟直千向け: 外ラチ依存（差し・追込の外枠を優遇）
  if (hasOutsideLateOnly && frame != null && frame >= 6 && (style === "差し" || style === "追込")) {
    const raw = 4.2 * mult;
    const bonus = condition.adjustmentStrength === "strong" ? raw : clamp(raw, 0, 6.5);
    hits.push({
      label: "コース特性一致",
      reason: `外ラチ傾向: ${frame}枠・${style}（OUTSIDE_LAT_ONLY）`,
      bonus: round1(bonus),
    });
  }

  return hits;
}

