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

const MAX_TRAIT_BONUS = 8.5;

const COURSE_TRAIT_MASTER: Record<string, readonly CourseTrait[]> = {
  TOKYO_T2000: ["SHORT_RUN_IN", "INNER_ADVAN"],
  TOKYO_D1600: ["INNER_ADVAN"],
  NAKAYAMA_D1200: ["SHIBA_START", "OUTER_ADVAN"],
  NAKAYAMA_T2500: ["SHORT_RUN_IN", "INNER_ADVAN"],
  NIIGATA_T1000: ["OUTSIDE_LAT_ONLY"],
  NIIGATA_D1800: ["OUTER_ADVAN"],
  HANSHIN_T1400: ["SHIBA_START", "OUTER_ADVAN"],
  KYOTO_T1600: ["INNER_ADVAN"],
  CHUKYO_T1200: ["OUTER_ADVAN"],
  SAPPORO_T1800: ["INNER_ADVAN"],
  KOKURA_T1200: ["SHORT_RUN_IN", "INNER_ADVAN"],
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
  // strong は逆転を起こすが、特性単体は過学習を避けて +8.5 上限で制御する。
  return 1.35;
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

  const styleIsFront = style === "逃げ" || style === "先行";
  const styleIsLate = style === "差し" || style === "追込";
  const styleIsMidFront = styleIsFront || style === "好位";
  const gateNum = gate ?? 0;
  const frameNum = frame ?? 0;

  // フラグ別に「枠番 × 脚質」シナジーへ直接変換する。
  // 内前有利コースは序盤ポジション価値が高く、短い助走区間でロスの少ない内前を最大評価。
  if ((hasInner || hasShortRun) && frameNum >= 1 && frameNum <= 3 && styleIsFront) {
    const raw = 6.3 * mult;
    const bonus = clamp(raw, 0, MAX_TRAIT_BONUS);
    hits.push({
      label: "枠番×脚質シナジー",
      reason: `内前有利: ${frameNum}枠 × ${style}（SHORT_RUN_IN/INNER_ADVAN）`,
      bonus: round1(bonus),
    });
  }

  // 外先行有利は芝スタートで加速余地が生まれるため上乗せを強くする。
  if (hasOuter && frameNum >= 6 && styleIsMidFront) {
    const raw = (hasShibaStart ? 6.4 : 5.8) * mult;
    const bonus = clamp(raw, 0, MAX_TRAIT_BONUS);
    hits.push({
      label: "枠番×脚質シナジー",
      reason: `外前有利: ${frameNum}枠 × ${style}（OUTER_ADVAN${hasShibaStart ? "/SHIBA_START" : ""}）`,
      bonus: round1(bonus),
    });
  }

  // 外ラチ沿い依存（新潟直千など）は大外かつ差し/追込で一気に伸びる傾向。
  if (hasOutsideLateOnly && frameNum >= 6 && styleIsLate) {
    const raw = 6.1 * mult;
    const bonus = clamp(raw, 0, MAX_TRAIT_BONUS);
    hits.push({
      label: "枠番×脚質シナジー",
      reason: `外ラチ傾向: ${frameNum}枠 × ${style}（OUTSIDE_LAT_ONLY）`,
      bonus: round1(bonus),
    });
  }

  // 同じ外有利でも馬番の絶対外目は包まれにくく、先行馬は加点を追加。
  if (hasOuter && gateNum >= 11 && styleIsFront) {
    const raw = 2.2 * mult;
    const bonus = clamp(raw, 0, MAX_TRAIT_BONUS);
    hits.push({
      label: "枠番×脚質シナジー",
      reason: `馬番外寄り: 馬番${gateNum} × ${style}（OUTER_ADVAN）`,
      bonus: round1(bonus),
    });
  }

  return hits;
}

