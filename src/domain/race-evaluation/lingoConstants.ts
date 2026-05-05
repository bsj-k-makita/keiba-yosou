/**
 * 用語定数（言語定義.md を単一ソースの参照基準とする。実装の文言は原則ここから）
 */

/** 能力5軸のキー（abilityTypes.AbilityKey と同順） */
export const ABILITY_AXIS = [
  "speed",
  "stamina",
  "kick",
  "sustain",
  "power",
] as const;
export type AbilityAxisKey = (typeof ABILITY_AXIS)[number];

export const ABILITY_AXIS_LABELS: Record<AbilityAxisKey, string> = {
  speed: "スピード",
  stamina: "スタミナ",
  kick: "末脚",
  sustain: "持続力",
  power: "パワー",
};

/** 能力5軸の説明（カード表示用） */
export const ABILITY_AXIS_DESCRIPTIONS: Record<AbilityAxisKey, string> = {
  speed: "先行力と巡航速度。道中の位置取りに効く。",
  stamina: "距離をこなす体力。消耗戦での耐久力。",
  kick: "直線での瞬間的な加速力。切れ味の源。",
  sustain: "速い脚を長く維持する力。長い直線で効く。",
  power: "坂・重馬場・接触に耐える推進力。",
};

/** 脚質6種 */
export const RUNNING_STYLES = [
  "逃げ",
  "先行",
  "好位",
  "差し",
  "追込",
  "自在",
] as const;
export type RunningStyle = (typeof RUNNING_STYLES)[number];
export const RUNNING_STYLE_DEFAULT: RunningStyle = "好位";

/** 能力ランク */
export const ABILITY_RANK_GRADES = ["S", "A", "B", "C", "D"] as const;
export type AbilityRankGrade = (typeof ABILITY_RANK_GRADES)[number];

export const PACE_PACE = {
  /** 展開3種 */
  SLOW: "スロー", // 後半勝負
  MIDDLE: "ミドル", // 標準
  HIGH: "ハイ", // 消耗戦
} as const;

export const PACE_PACE_ID = "ペース" as const;

export const BIAS = {
  FRONT: "前残り",
  CLOSER: "差し有利",
  FLAT: "フラット",
  INSIDE: "内有利",
  OUTSIDE: "外有利",
} as const;

export const PACE_FIT = {
  PERFECT: "◎", // 完全一致
  FIT: "○", // 合う
  MAYBE: "△", // 条件次第
  BAD: "×", // 不利
} as const;
export type PaceFitToken = (typeof PACE_FIT)[keyof typeof PACE_FIT];
export const PACE_FIT_ORDER: readonly PaceFitToken[] = [PACE_FIT.PERFECT, PACE_FIT.FIT, PACE_FIT.MAYBE, PACE_FIT.BAD];

/** 今回向き3段階 */
export const FIT_TENDENCY = {
  HI: "高", // 能力と条件が一致
  MID: "中", // 可もなく不可もなく
  LO: "低", // 不一致
} as const;
export type FitTendency = (typeof FIT_TENDENCY)[keyof typeof FIT_TENDENCY];

/**
 * 買い判断（言語定義 11.＋従来の「穴候補」表現を維持）
 */
export const BUY_LABELS = {
  FAVORITE: "本命候補",
  RIVAL: "対抗",
  TAN: "単穴",
  ANA: "穴候補",
  GROUP: "相手",
  DISMISS: "消し",
} as const;
export type BuyLabelLingo = (typeof BUY_LABELS)[keyof typeof BUY_LABELS];

export const JUDGMENT = {
  BUY: "買い",
} as const;

/** 表示用（カード上段等） */
export const UI = {
  ADJUSTED_SCORE: "補正後評価",
  ADJUSTED_SCORE_ABBR: "補正評価", // マトリクス表記
  /** 5 能力の平均（条件重み前の土台） */
  INTRINSIC_BASE: "基礎能力",
  /** 今回正規化重みでの加重合計 − 基礎平均 */
  CONDITION_FIT_DELTA: "条件適性差",
  BASE_SCORE: "標準評価",
  RANK_SHIFT: "順位変動",
  /** 標準 → 最終（レース内相対＋展開） */
  RANK_SHIFT_FINAL: "順位変動（最終）",
  RACE_RELATIVE: "レース内相対",
  FINAL_EVAL_SCORE: "最終評価",
  FIT: "今回向き",
  FIT_COLON: "今回向き：", // ラベル＋区切り
  PACE_FIT: "展開", // 脚質横の「展開◎」
  PACE_FIT_PREFIX: "展開",
  REASON: "理由",
  STRENGTH: "強み",
  TYPE: "タイプ",
  DETAIL: "詳細",
  RUNNING_STYLE: "脚質", // 脚質：先行
  DASH: "—", // 欠損
  PACE_TODAY: "今回の展開",
} as const;

export const RACE_TYPE_SHORT = {
  FRONT: "前残り型",
  CLOSER: "差し有利型",
  HEAVY: "重馬場型",
  BALANCED: "バランス型",
} as const;

export const RANK_LETTER_MARKS = {
  CIRCLE_DOUBLE: "◎" as const,
  CIRCLE: "○" as const,
  TRI: "▲" as const,
  TRI_S: "△" as const,
  STAR: "☆" as const,
};

export const RACE_ABILITY_TYPE = {
  SPEED: "スピード型",
  LATE: "末脚型",
  SUSTAIN: "持続型",
  STAMINA: "スタミナ型",
  POWER: "パワー型",
  BALANCED: "バランス型",
} as const;
