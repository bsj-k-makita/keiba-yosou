import type { HorseAbility, RaceCondition } from "./abilityTypes";

/** 実装簡略化用のジョッキー階層 */
export type JockeyTier = "S" | "A" | "B" | "C";
export interface JockeyStats {
  name?: string;
  /** 直近1年勝率（0〜1） */
  winRate: number;
  /** 直近1年連対率（0〜1） */
  renaiRate: number;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function normName(s: string | undefined): string {
  return (s ?? "").replace(/\s+/g, "").trim();
}

/** 名前の部分一致 + 統計フォールバックでティア判定（外部データ揺れ吸収） */
export function resolveJockeyTier(
  jockeyName: string | undefined,
  stats?: JockeyStats,
): JockeyTier {
  const n = normName(jockeyName);
  if (!n) {
    if (stats) {
      if (stats.winRate >= 0.12) return "A";
      if (stats.winRate >= 0.07) return "B";
    }
    return "C";
  }

  const tierA = ["坂井瑠星", "戸崎圭太", "横山武史", "松山弘平", "モレイラ", "レーン"];
  const tierB = [
    "鮫島克駿",
    "西村淳也",
    "三浦皇成",
    "丹内祐次",
    "藤岡佑介",
    "津村明秀",
    "岩田康誠",
    "団野大成",
    "菱田裕二",
  ];

  // Tier S（例: ルメール・川田将雅）
  if (/川田/.test(n)) return "S";
  if (/ルメ―ル/.test(n) || /ルメール/.test(n)) return "S";

  if (tierA.some((x) => n.includes(normName(x)))) return "A";
  if (tierB.some((x) => n.includes(normName(x)))) return "B";

  // リスト外は統計データでフォールバック
  if (stats) {
    if (stats.winRate >= 0.12) return "A";
    if (stats.winRate >= 0.07) return "B";
  }
  return "C";
}

const LOCAL_OR_REGIONAL_MASTERS = [
  "吉村智洋",
  "笹川翼",
  "森泰斗",
  "岡部誠",
  "赤岡修次",
];

function hasApprenticeMark(jockeyName: string | undefined): boolean {
  return /[▲△☆]/.test(String(jockeyName ?? ""));
}

/**
 * リスト外ジョッキーのフォールバック。
 * - 地方の名手を Tier B に救済
 * - 斤量記号（▲/△/☆）は Tier C 優先
 * - 直近連対/複勝率シグナルが高い場合は Tier B へ昇格
 */
export function resolveJockeyTierWithSignals(
  jockeyName: string | undefined,
  signals?: HorseAbility["signals"],
): JockeyTier {
  const byList = resolveJockeyTier(jockeyName, {
    winRate: signals?.jockeyCourseWinRate01 ?? 0,
    renaiRate: signals?.jockeyCoursePlaceRate01 ?? 0,
  });
  if (byList !== "C") return byList;

  const n = normName(jockeyName);
  if (!n) return "C";
  if (hasApprenticeMark(jockeyName)) return "C";
  if (LOCAL_OR_REGIONAL_MASTERS.some((x) => n.includes(normName(x)))) return "B";

  const place = signals?.jockeyCoursePlaceRate01;
  const win = signals?.jockeyCourseWinRate01;
  if ((place != null && place >= 0.33) || (win != null && win >= 0.12)) return "B";
  if ((place != null && place >= 0.27) || (win != null && win >= 0.09)) return "B";
  return "C";
}

function tierOrder(t: JockeyTier): number {
  if (t === "S") return 4;
  if (t === "A") return 3;
  if (t === "B") return 2;
  return 1;
}

function computeTierUpgradeBonus(prev: JockeyTier, curr: JockeyTier): number {
  const diff = tierOrder(curr) - tierOrder(prev);
  if (diff >= 2) return 12; // C->A, C->S, B->S
  if (diff === 1) return 5; // 1段階強化
  if (diff < 0) return -3;  // 鞍上弱化
  return 0;                 // 変化なし
}

function venueRough(condition: RaceCondition): string {
  return `${condition.courseKey ?? ""} ${condition.venue ?? ""}`;
}

function isTurf(condition: RaceCondition): boolean {
  return condition.surface !== "ダート";
}

function kyotoTurf2000(condition: RaceCondition): boolean {
  if (!isTurf(condition)) return false;
  const dist = Math.round(condition.distance ?? 0);
  if (dist < 1960 || dist > 2040) return false;
  return /京都/.test(venueRough(condition));
}

function niigataTurf1000(condition: RaceCondition): boolean {
  if (!isTurf(condition)) return false;
  const dist = Math.round(condition.distance ?? 0);
  if (dist !== 1000 && dist !== 990 && dist !== 1010) return false;
  return /新潟/.test(venueRough(condition));
}

function tokyoTurf2400(condition: RaceCondition): boolean {
  if (!isTurf(condition)) return false;
  const dist = Math.round(condition.distance ?? 0);
  if (dist !== 2400 && dist !== 2380 && dist !== 2420) return false;
  return /東京/.test(venueRough(condition));
}

function isHokkaidoMeeting(condition: RaceCondition): boolean {
  return /札幌|函館/.test(venueRough(condition));
}

function outerFrameHorse(horse: HorseAbility): boolean {
  const f = horse.frameNumber;
  return f != null && Number.isFinite(f) && f >= 7;
}

export type JockeyRiderBonusBreakdown = {
  tierUpgradeBonus: number;
  courseSpecialistBonus: number;
  stableSynergyBonus: number;
  continuedRideBonus: number;
  /** 大きな鞍上昇格（C→A/S 等）。UI で勝負気配として強調 */
  ambitionFlag: boolean;
  /** UI / 理由生成用 */
  reasons: string[];
};

function lastRunCloseOrWin(horse: HorseAbility): boolean {
  const last = horse.pastRuns?.[0];
  if (last == null) return false;
  if (last.place === 1) return true;
  const m = last.marginToWinnerSec;
  return m != null && Number.isFinite(m) && m >= 0 && m <= 0.3;
}

/**
 * 鞍上強化・舞台職人・厩舎シナジー・継続騎乗の加点（点スケールは既存 `connectionsBonus` と同系）。
 */
export function computeJockeyRiderBonuses(
  horse: HorseAbility,
  condition: RaceCondition,
): JockeyRiderBonusBreakdown {
  const reasons: string[] = [];
  const curr = horse.jockey;
  const prev = horse.pastRuns?.[0]?.jockey;
  let tierUpgradeBonus = 0;

  if (prev && curr && normName(prev) !== normName(curr)) {
    const prevTier = resolveJockeyTierWithSignals(prev, undefined);
    const currTier = resolveJockeyTierWithSignals(curr, horse.signals);
    tierUpgradeBonus = computeTierUpgradeBonus(prevTier, currTier);
    if (tierUpgradeBonus > 0) {
      reasons.push(`鞍上強化 (${prevTier}→${currTier}: +${tierUpgradeBonus})`);
    } else if (tierUpgradeBonus < 0) {
      reasons.push(`鞍上弱化 (${prevTier}→${currTier}: ${tierUpgradeBonus})`);
    }
  }

  let courseSpecialistBonus = 0;
  const tierCurr = resolveJockeyTierWithSignals(curr, horse.signals);
  const jn = normName(curr);

  if (kyotoTurf2000(condition) && (/川田/.test(jn) || jn.includes("川田"))) {
    courseSpecialistBonus += 15;
    reasons.push("京都芝2000×川田 (+15)");
  }
  if (niigataTurf1000(condition) && (/鮫島/.test(jn) || /津村/.test(jn)) && outerFrameHorse(horse)) {
    courseSpecialistBonus += 10;
    reasons.push("新潟芝1000×外枠×騎手職人 (+10)");
  }
  if (isHokkaidoMeeting(condition) && isTurf(condition) && (/横山武/.test(jn) || /丹内/.test(jn))) {
    courseSpecialistBonus += 8;
    reasons.push("洋芝北海道×騎手 (+8)");
  }
  if (tokyoTurf2400(condition) && (/ルメ―ル/.test(jn) || /ルメール/.test(jn))) {
    courseSpecialistBonus += 10;
    reasons.push("東京芝2400×ルメール (+10)");
  }

  let stableSynergyBonus = 0;
  const trainer = normName(horse.trainer);
  if (trainer.includes("木村哲也") && (/ルメ―ル/.test(jn) || /ルメール/.test(jn))) {
    stableSynergyBonus += 5;
    reasons.push("木村哲也厩舎×ルメール (+5)");
  }
  if (
    trainer.includes("友道康夫") &&
    (/川田/.test(jn) || (/ルメ―ル/.test(jn) || /ルメール/.test(jn)))
  ) {
    stableSynergyBonus += 5;
    reasons.push("友道康夫厩舎×重賞級鞍上 (+5)");
  }

  let continuedRideBonus = 0;
  if (prev && curr && normName(prev) === normName(curr) && (tierCurr === "S" || tierCurr === "A")) {
    if (lastRunCloseOrWin(horse)) {
      continuedRideBonus = 5;
      reasons.push("S/A級・好内容継続乗り (+5)");
    }
  }

  const rawTotal = tierUpgradeBonus + courseSpecialistBonus + stableSynergyBonus + continuedRideBonus;
  const maxTotal = 40;
  const scale = rawTotal <= maxTotal || rawTotal <= 0 ? 1 : maxTotal / rawTotal;
  const ambitionFlag = tierUpgradeBonus >= 8;
  return {
    tierUpgradeBonus: round1(tierUpgradeBonus * scale),
    courseSpecialistBonus: round1(courseSpecialistBonus * scale),
    stableSynergyBonus: round1(stableSynergyBonus * scale),
    continuedRideBonus: round1(continuedRideBonus * scale),
    ambitionFlag,
    reasons,
  };
}

export function sumJockeyRiderBonuses(b: JockeyRiderBonusBreakdown): number {
  return round1(b.tierUpgradeBonus + b.courseSpecialistBonus + b.stableSynergyBonus + b.continuedRideBonus);
}
