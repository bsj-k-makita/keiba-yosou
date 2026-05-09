import type { HorseAbility, RaceCondition } from "./abilityTypes";

export type CourseTrait =
  | "SHORT_RUN_IN"
  | "LONG_RUN_IN"
  | "INNER_ADVAN"
  | "SHIBA_START"
  | "OUTER_ADVAN"
  | "OUTSIDE_LAT_ONLY"
  | "OUTSIDE_EDGE_MAX"
  | "DOWNHILL_START"
  | "DOWNHILL_ACCELERATION"
  | "DOUBLE_YODO_HILL"
  | "DOUBLE_HILL_ENDURANCE"
  | "STAMINA_CONTEST";

export type CourseTraitHit = {
  label: string;
  reason: string;
  bonus: number;
};

const MAX_TRAIT_BONUS = 8.5;

const COURSE_TRAIT_MASTER: Record<string, readonly CourseTrait[]> = {
  TOKYO_T2000: ["SHORT_RUN_IN", "INNER_ADVAN"],
  TOKYO_T2400: ["DOUBLE_HILL_ENDURANCE"],
  TOKYO_D1600: ["INNER_ADVAN"],
  NAKAYAMA_T1200: ["DOWNHILL_START", "SHIBA_START", "OUTER_ADVAN"],
  NAKAYAMA_T1600: ["SHORT_RUN_IN", "INNER_ADVAN"],
  NAKAYAMA_T2000: ["DOUBLE_HILL_ENDURANCE"],
  NAKAYAMA_T2500: ["SHORT_RUN_IN", "INNER_ADVAN", "DOUBLE_HILL_ENDURANCE"],
  NIIGATA_T1000: ["OUTSIDE_LAT_ONLY", "OUTSIDE_EDGE_MAX"],
  NIIGATA_T1600: ["LONG_RUN_IN"],
  NIIGATA_D1800: ["OUTER_ADVAN"],
  HANSHIN_T1400: ["SHIBA_START", "OUTER_ADVAN"],
  KYOTO_T1600: ["INNER_ADVAN"],
  KYOTO_T1600_IN: ["INNER_ADVAN"],
  KYOTO_T1600_OUT: ["LONG_RUN_IN", "DOWNHILL_ACCELERATION"],
  KYOTO_T3200: ["DOUBLE_YODO_HILL"],
  CHUKYO_T1200: ["OUTER_ADVAN"],
  CHUKYO_T2000: ["STAMINA_CONTEST"],
  SAPPORO_T1800: ["SHORT_RUN_IN", "INNER_ADVAN"],
  SAPPORO_T2000: ["LONG_RUN_IN"],
  KOKURA_T1200: ["SHORT_RUN_IN", "INNER_ADVAN", "DOWNHILL_ACCELERATION"],
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
  if (v.includes("札幌")) return "SAPPORO";
  if (v.includes("函館")) return "HAKODATE";
  if (v.includes("小倉")) return "KOKURA";
  if (v.includes("中京")) return "CHUKYO";
  if (v.includes("福島")) return "FUKUSHIMA";
  return v.toUpperCase().replace(/\s+/g, "_");
}

function normalizeSurface(condition: RaceCondition): "T" | "D" {
  return condition.surface === "ダート" ? "D" : "T";
}

export function resolveCourseTraitKey(condition: RaceCondition): string | null {
  if (condition.distance == null || !Number.isFinite(condition.distance)) return null;
  const venue = normalizeVenue(condition);
  if (!venue) return null;
  const dist = Math.round(condition.distance);
  const surf = normalizeSurface(condition);
  const ck = `${condition.courseKey ?? ""} ${condition.raceName ?? ""}`;
  let key = `${venue}_${surf}${dist}`;
  if (venue === "KYOTO" && dist === 1600 && surf === "T") {
    if (/外|outer/i.test(ck)) key += "_OUT";
    else if (/内/.test(ck)) key += "_IN";
  }
  return key;
}

export function resolveCourseTraits(condition: RaceCondition): readonly CourseTrait[] {
  const key = resolveCourseTraitKey(condition);
  if (!key) return [];
  const direct = COURSE_TRAIT_MASTER[key];
  if (direct) return direct;
  const baseKey = key.replace(/_(OUT|IN)$/, "");
  return COURSE_TRAIT_MASTER[baseKey] ?? [];
}

function strengthMultiplier(strength: RaceCondition["adjustmentStrength"]): number {
  if (strength === "weak") return 0.7;
  if (strength === "middle") return 1.0;
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

function enduranceTraitBonus(horse: HorseAbility, scale: number): number {
  const avg = (horse.stamina + horse.power) / 2;
  const raw = ((avg - 40) / 60) * 7.2 * scale;
  return clamp(raw, 0, MAX_TRAIT_BONUS);
}

function yodoPedigreeExtra(horse: HorseAbility): number {
  const ped = `${horse.pedigree?.sireName ?? ""}${horse.pedigree?.damSireName ?? ""}`;
  if (/ディープ|ハーツ|キズナ|ゴールドシップ|オルフェ/.test(ped)) return 1.1;
  return 0;
}

function downhillAccelBonus(horse: HorseAbility): number {
  const bal = Math.min(horse.speed, horse.sustain);
  let b = clamp(((bal - 36) / 64) * 6.5, 0, 7);
  const ped = `${horse.pedigree?.sireName ?? ""}${horse.pedigree?.damSireName ?? ""}`;
  if (/ディープ|ハーツ|キズナ|エピファネイア|ロードカナロア|ハット/.test(ped)) {
    b += 1.15;
  }
  if (horse.l2_top_speed != null && horse.l2_top_speed >= 0.7) {
    b += 0.85;
  }
  return clamp(b, 0, MAX_TRAIT_BONUS);
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
  const hasLongRun = traits.includes("LONG_RUN_IN");
  const hasShibaStart = traits.includes("SHIBA_START");
  const hasOutsideLateOnly = traits.includes("OUTSIDE_LAT_ONLY");
  const hasOutsideEdgeMax = traits.includes("OUTSIDE_EDGE_MAX");
  const hasDownhillStart = traits.includes("DOWNHILL_START");
  const hasDownhillAccel = traits.includes("DOWNHILL_ACCELERATION");
  const hasDoubleYodo = traits.includes("DOUBLE_YODO_HILL");
  const hasDoubleHill = traits.includes("DOUBLE_HILL_ENDURANCE");
  const hasStaminaContest = traits.includes("STAMINA_CONTEST");

  const styleIsFront = style === "逃げ" || style === "先行";
  const styleIsLate = style === "差し" || style === "追込";
  const styleIsMidFront = styleIsFront || style === "好位";
  const gateNum = gate ?? 0;
  const frameNum = frame ?? 0;

  // ── 坂・淀・長丁場の耐久系（スタミナ×パワー） ─────────────────
  if (hasDoubleYodo) {
    const raw = enduranceTraitBonus(horse, 1.18) + yodoPedigreeExtra(horse);
    const bonus = clamp(raw * mult, 0, MAX_TRAIT_BONUS);
    hits.push({
      label: "コース耐久（淀坂）",
      reason: `スタミナ・パワー適合（DOUBLE_YODO_HILL）`,
      bonus: round1(bonus),
    });
  }
  if (hasDoubleHill) {
    const raw = enduranceTraitBonus(horse, 1.12);
    const bonus = clamp(raw * mult, 0, MAX_TRAIT_BONUS);
    hits.push({
      label: "コース耐久（複坂）",
      reason: `スタミナ・パワー適合（DOUBLE_HILL_ENDURANCE）`,
      bonus: round1(bonus),
    });
  }
  if (hasStaminaContest) {
    const raw = enduranceTraitBonus(horse, 1.08);
    const bonus = clamp(raw * mult, 0, MAX_TRAIT_BONUS);
    hits.push({
      label: "コース耐久（急坂連続）",
      reason: `スタミナ・パワー適合（STAMINA_CONTEST）`,
      bonus: round1(bonus),
    });
  }

  // ── 下り加速・淀の機動力 ─────────────────
  if (hasDownhillAccel) {
    const raw = downhillAccelBonus(horse) * mult;
    const bonus = clamp(raw, 0, MAX_TRAIT_BONUS);
    hits.push({
      label: "下り坂機動力",
      reason: `スピード×持続・血統/加速データ（DOWNHILL_ACCELERATION）`,
      bonus: round1(bonus),
    });
  }

  // ── スタート直後の加速（DOWNHILL_START） ─────────────────
  if (hasDownhillStart && frameNum >= 1 && frameNum <= 3 && styleIsFront) {
    const raw = 4.2 * mult;
    hits.push({
      label: "スタート加速枠",
      reason: `内枠${frameNum}×${style}（DOWNHILL_START）`,
      bonus: round1(clamp(raw, 0, MAX_TRAIT_BONUS)),
    });
  }

  // ── 初角まで長いコース：外枠先行のロス緩和（OUTER_ADVAN フラグが無くても 6〜8 枠で発動） ─────────────────
  if (hasLongRun && frameNum >= 6 && styleIsFront) {
    const raw = 4.0 * mult;
    hits.push({
      label: "長い初角・外前ロス緩和",
      reason: `${frameNum}枠×${style}（LONG_RUN_IN）`,
      bonus: round1(clamp(raw, 0, MAX_TRAIT_BONUS)),
    });
  }

  // ── 初角が極端に短い：外枠先行へのペナルティ ─────────────────
  if (hasShortRun && frameNum >= 6 && styleIsFront) {
    const raw = -6.8 * mult;
    hits.push({
      label: "短い初角・外前ペナルティ",
      reason: `${frameNum}枠×${style}（SHORT_RUN_IN）`,
      bonus: round1(clamp(raw, -MAX_TRAIT_BONUS, 0)),
    });
  }

  // ── 内前・短初角の内枠先行 ─────────────────
  if ((hasInner || hasShortRun) && frameNum >= 1 && frameNum <= 3 && styleIsFront) {
    const raw = 6.3 * mult;
    const bonus = clamp(raw, 0, MAX_TRAIT_BONUS);
    hits.push({
      label: "枠番×脚質シナジー",
      reason: `内前有利: ${frameNum}枠 × ${style}（SHORT_RUN_IN/INNER_ADVAN）`,
      bonus: round1(bonus),
    });
  }

  // ── 外先行有利 ─────────────────
  if (
    hasOuter &&
    frameNum >= 6 &&
    styleIsMidFront &&
    !(hasOutsideEdgeMax && hasOutsideLateOnly)
  ) {
    const raw = (hasShibaStart ? 6.4 : 5.8) * mult;
    const bonus = clamp(raw, 0, MAX_TRAIT_BONUS);
    hits.push({
      label: "枠番×脚質シナジー",
      reason: `外前有利: ${frameNum}枠 × ${style}（OUTER_ADVAN${hasShibaStart ? "/SHIBA_START" : ""}）`,
      bonus: round1(bonus),
    });
  }

  // ── 新潟芝1000：極端な外有利・内不利 ─────────────────
  if (hasOutsideEdgeMax && hasOutsideLateOnly && frameNum >= 7 && styleIsLate) {
    const raw = 8.5 * mult;
    hits.push({
      label: "直線・外枠支配（MAX）",
      reason: `${frameNum}枠×${style}（NIIGATA_T1000 / OUTSIDE_EDGE_MAX）`,
      bonus: round1(clamp(raw, 0, MAX_TRAIT_BONUS)),
    });
  }
  if (hasOutsideEdgeMax && hasOutsideLateOnly && frameNum <= 2 && styleIsLate) {
    const raw = -7.5 * mult;
    hits.push({
      label: "直線・内枠ペナルティ",
      reason: `${frameNum}枠×${style}（NIIGATA_T1000）`,
      bonus: round1(clamp(raw, -MAX_TRAIT_BONUS, 0)),
    });
  }

  // 通常の外ラチ（OUTSIDE_EDGE_MAX 無し）
  if (hasOutsideLateOnly && !hasOutsideEdgeMax && frameNum >= 6 && styleIsLate) {
    const raw = 6.1 * mult;
    hits.push({
      label: "枠番×脚質シナジー",
      reason: `外ラチ傾向: ${frameNum}枠 × ${style}（OUTSIDE_LAT_ONLY）`,
      bonus: round1(clamp(raw, 0, MAX_TRAIT_BONUS)),
    });
  }

  if (hasOuter && gateNum >= 11 && styleIsFront) {
    const raw = 2.2 * mult;
    hits.push({
      label: "枠番×脚質シナジー",
      reason: `馬番外寄り: 馬番${gateNum} × ${style}（OUTER_ADVAN）`,
      bonus: round1(clamp(raw, 0, MAX_TRAIT_BONUS)),
    });
  }

  return hits;
}
