import type { PastRunRecord } from "./pastRunTypes";

/** JRA レーシングプログラム準拠のクラス階層（数値が小さいほど上位） */
export type ClassTier =
  | "G1_CLASS"
  | "G2_G3_CLASS"
  | "OPEN_LISTED"
  | "CONDITIONAL_UPPER"
  | "CONDITIONAL_LOWER"
  | "MAIDEN_NEW";

export const CLASS_TIER_RANK: Record<ClassTier, number> = {
  G1_CLASS: 1,
  G2_G3_CLASS: 2,
  OPEN_LISTED: 3,
  CONDITIONAL_UPPER: 4,
  CONDITIONAL_LOWER: 5,
  MAIDEN_NEW: 6,
};

export type RaceClassSource = {
  raceName?: string;
  /** index / meta の netkeiba グレード */
  raceGrade?: "G1" | "G2" | "G3" | "L" | "S";
  netkeibaGradeType?: number;
};

const G1_NAME = /G\s*Ⅰ|G\s*I\b|G1|Ｇ１|J-G1|Jpn1|JPN1|ジャパンカップ|有馬記念|天皇賞/i;
const G23_NAME = /G\s*Ⅱ|G\s*Ⅲ|G2|G3|Ｇ２|Ｇ３|J-G2|J-G3/i;
const OPEN_NAME = /オープン|\(OP\)|ＯＰ|OP\b|リステッド|\(L\)|（L）|Ｌ\b/i;
const STAKES_NAME = /ステークス|S\b$/;
const UPPER_COND = /3勝|３勝|1600万|１６００万|2勝|２勝|1000万|１０００万/;
const LOWER_COND = /1勝|１勝|500万|５００万/;
const MAIDEN_NAME = /新馬|未勝利/;

function normalizeName(name: string): string {
  return name.replace(/\s+/g, "").trim();
}

function tierFromNetkeibaGradeType(ngt: number | undefined): ClassTier | null {
  if (ngt == null || !Number.isFinite(ngt)) return null;
  if (ngt === 1) return "G1_CLASS";
  if (ngt === 2 || ngt === 3) return "G2_G3_CLASS";
  if (ngt === 4 || ngt === 5) return "OPEN_LISTED";
  return null;
}

function tierFromRaceGrade(grade: RaceClassSource["raceGrade"]): ClassTier | null {
  if (grade === "G1") return "G1_CLASS";
  if (grade === "G2" || grade === "G3") return "G2_G3_CLASS";
  if (grade === "L" || grade === "S") return "OPEN_LISTED";
  return null;
}

/**
 * レース名・raceGrade・netkeibaGradeType から ClassTier を決定。
 * raceGrade（スクレイピングメタ）を最優先し、レース名は補完に使う。
 */
export function resolveEffectiveRaceClass(source: RaceClassSource): ClassTier {
  const name = normalizeName(String(source.raceName ?? ""));

  const fromGrade = tierFromRaceGrade(source.raceGrade);
  if (fromGrade != null) return fromGrade;

  const fromNgt = tierFromNetkeibaGradeType(source.netkeibaGradeType);
  if (fromNgt != null) return fromNgt;

  if (MAIDEN_NAME.test(name) && !G1_NAME.test(name) && !G23_NAME.test(name)) {
    return "MAIDEN_NEW";
  }

  if (G1_NAME.test(name)) return "G1_CLASS";
  if (G23_NAME.test(name)) return "G2_G3_CLASS";

  if (OPEN_NAME.test(name)) return "OPEN_LISTED";
  if (STAKES_NAME.test(name) && !UPPER_COND.test(name) && !LOWER_COND.test(name) && !MAIDEN_NAME.test(name)) {
    return "OPEN_LISTED";
  }

  if (UPPER_COND.test(name)) return "CONDITIONAL_UPPER";
  if (LOWER_COND.test(name)) return "CONDITIONAL_LOWER";

  return "CONDITIONAL_LOWER";
}

export function isGradedOpenTier(tier: ClassTier): boolean {
  return CLASS_TIER_RANK[tier] <= CLASS_TIER_RANK.OPEN_LISTED;
}

export function isMaidenNewTier(tier: ClassTier): boolean {
  return tier === "MAIDEN_NEW";
}

export function classTierLabelJa(tier: ClassTier): string {
  const map: Record<ClassTier, string> = {
    G1_CLASS: "G1",
    G2_G3_CLASS: "G2・G3",
    OPEN_LISTED: "OP・リステッド",
    CONDITIONAL_UPPER: "3勝・2勝",
    CONDITIONAL_LOWER: "1勝",
    MAIDEN_NEW: "新馬・未勝利",
  };
  return map[tier];
}

/** 過去走の raceClass / レース名から ClassTier を推定 */
export function classTierFromPastRun(run: PastRunRecord): ClassTier | null {
  const rc = run.raceClass;
  if (rc === "G1") return "G1_CLASS";
  if (rc === "G2" || rc === "G3") return "G2_G3_CLASS";
  if (rc === "OP") return "OPEN_LISTED";
  if (rc === "3勝" || rc === "2勝") return "CONDITIONAL_UPPER";
  if (rc === "1勝") return "CONDITIONAL_LOWER";
  if (rc === "新馬" || rc === "未勝利") return "MAIDEN_NEW";
  if (run.raceName) return resolveEffectiveRaceClass({ raceName: run.raceName });
  return null;
}

const GOOD_MARGIN_SEC = 0.3;
const BOARD_PLACE = 5;

/**
 * 同等以上のクラスで掲示板（5着以内）または0.3秒以内の善戦があるか（重賞壁フィルター用）。
 */
export function hasOpenClassStepCredibility(
  horse: { pastRuns?: readonly PastRunRecord[] },
  currentTier: ClassTier,
): boolean {
  if (!isGradedOpenTier(currentTier)) return true;

  const currentRank = CLASS_TIER_RANK[currentTier];
  const runs = horse.pastRuns ?? [];

  for (const run of runs.slice(0, 6)) {
    const runTier = classTierFromPastRun(run);
    if (runTier == null) continue;
    if (CLASS_TIER_RANK[runTier] > currentRank) continue;

    const place = run.place ?? 99;
    const margin = run.marginToWinnerSec;
    if (place <= BOARD_PLACE) return true;
    if (margin != null && Number.isFinite(margin) && margin <= GOOD_MARGIN_SEC) return true;
  }

  return false;
}
