import {
  ABILITY_AXIS,
  ABILITY_AXIS_LABELS,
  type BuyLabelLingo,
  type RunningStyle,
} from "./lingoConstants";
import type { PastRunRecord } from "./pastRunTypes";
export type { PastRunRecord } from "./pastRunTypes";

export type AbilityKey = (typeof ABILITY_AXIS)[number];

export const ABILITY_KEYS: AbilityKey[] = [...ABILITY_AXIS];

export type WeightSet = Record<AbilityKey, number>;

export const ABILITY_LABELS: Record<AbilityKey, string> = ABILITY_AXIS_LABELS;
export type { RunningStyle };
export { RUNNING_STYLE_DEFAULT } from "./lingoConstants";

export const MIN_WEIGHT = 0.05;
export const MAX_WEIGHT = 0.45;

/**
 * 過去走・オッズ等は任意。未設定のときは中立（ペナルティ・穴馬ガードはスキップ）。
 * 数値はパイプライン取り込み時に拡張する。
 */
export type HorseEvaluationSignals = {
  winOdds?: number;
  /** 直近3走で「大敗」扱いの回数（1.5秒超負け等。閾値は取り込み側で定義） */
  heavyDefeatCountLast3?: number;
  /** 直近5走で2桁着順（10着以下）の回数 */
  doubleDigitPlaceCountLast5?: number;
  /** 直近5走で「好走」（3着以内 or 着差0.5秒以内）の回数。大敗ペナルティの文脈判断に使う */
  goodRunCountLast5?: number;
  /** 0〜1 高いほど再現性加点 */
  reproducibility01?: number;
  /** 0=重賞扱いなし。2以上で S 等級の禁止ルール等を緩和 */
  gradedRaceTier?: number;
  /** 0〜1: 騎手の対象コース勝率（例: 京都芝3200m） */
  jockeyCourseWinRate01?: number;
  /** 0〜1: 騎手の対象コース複勝率 */
  jockeyCoursePlaceRate01?: number;
  /** 0〜1: 調教師の対象コース勝率 */
  trainerCourseWinRate01?: number;
  /** 0〜1: 調教師の対象コース複勝率 */
  trainerCoursePlaceRate01?: number;
  /** 0〜1: 高いほど気性面の不安が強い（折り合い不安） */
  temperamentConcern01?: number;
  /** 折り合い注意のフラグ（UI表示用） */
  temperamentRisk?: boolean;
};

export type InvestmentValueRank = "S" | "A" | "B" | "C" | "D";
export type InvestmentConfidenceRank = "S" | "A" | "B" | "C";
export type InvestmentBetType = "軸" | "相手" | "ヒモ穴" | "見送り";
export type InvestmentValueChange = "UP" | "DOWN" | "STABLE";

/**
 * 期待値短評生成用の入力。JSON 取り込み時に正規化して保持する。
 */
export type InvestmentCommentInput = {
  predictedProbability: number;
  actualOdds: number;
  oddsSource?: "actual" | "estimated";
  /** 実質期待値: (P × O) - margin。1.0超で購入ライン。 */
  valueScore?: number;
  valueRank: InvestmentValueRank;
  confidenceRank?: InvestmentConfidenceRank;
  betType: InvestmentBetType;
  valueChange: InvestmentValueChange;
  keyFactors: string[];
  riskFactors: string[];
  /** Fractional Kelly による推奨投資比率（0〜0.25）。全資金に対する割合。 */
  kellyWeight?: number;
};

export type HorsePedigree = {
  sireName?: string;
  damSireName?: string;
  /** 0〜1: 血統によるコース適性（中立 0.5） */
  courseFit01?: number;
  /** 0〜1: 血統による距離適性（中立 0.5） */
  distanceFit01?: number;
  /** 0〜1: 平坦コース適性（中立 0.5） */
  flatTrackFit01?: number;
  /** 0〜1: 急坂・起伏コース適性（中立 0.5） */
  uphillTrackFit01?: number;
  /** 0〜1: 下り→平坦での加速持続適性（中立 0.5） */
  downhillToFlatFit01?: number;
  /** 0〜1: 牡馬で中長距離に寄る強さ（中立 0.5） */
  maleStayerFit01?: number;
  /** 0〜1: 牝馬で 2000m 以下に寄る強さ（中立 0.5） */
  femaleMiddleFit01?: number;
};

export type AdjustmentDefinition = {
  label: string;
  adjustment: WeightSet;
};

export type HorseAbility = {
  horseId: string;
  horseName: string;
  runningStyle: RunningStyle;
  sex?: "牡" | "牝" | "セ";
  age?: number;
  frameNumber?: number;
  jockey?: string;
  trainer?: string;
  bodyWeightKg?: number;
  speed: number;
  stamina: number;
  kick: number;
  sustain: number;
  power: number;
  pedigree?: HorsePedigree;
  signals?: HorseEvaluationSignals;
  investment?: InvestmentCommentInput;
  /** 直近1走目が先頭。4〜6 本の 200m 通過が揃うと展開分類・再現性推定に使う */
  pastRuns?: PastRunRecord[];
};

export type AdjustmentStrengthKey = "weak" | "middle" | "strong";

export type RaceCondition = {
  venue: string;
  courseKey?: string;
  raceName?: string;
  /** 芝・ダート。未設定時は物理特性補正では「芝」扱い。 */
  surface?: "芝" | "ダート";
  /** 当該レース距離（m）。距離適性ボーナス計算に使用。 */
  distance?: number;
  ground: string;
  /** 馬場状態とは別軸の時計傾向。 */
  trackSpeed?: "standard" | "fast" | "slow";
  bias: string;
  pace: string;
  adjustmentStrength: AdjustmentStrengthKey;
  /** 当日のトラックバイアス強度（0〜1）。未設定時は bias 種別から推定。 */
  trackBiasStrength01?: number;
  /** コーナー数。多いほど内枠の物理的有利を増幅。 */
  turnCount?: number;
  /**
   * 今日のレース全体ラップ（200m 通過秒、スタート→ゴール順）。
   * 4 本以上あるとラップ形状一致スコアの計算に使われる。
   */
  section200mSec?: readonly number[];
  /** コース形態。未設定時は venue / courseKey から推定。 */
  courseTopology?: "flat" | "uphill" | "downhill_to_flat";
  /**
   * ユーザー手動バイアス（-1〜+1）。
   * -1: 極端な内有利, 0: フラット, +1: 極端な外有利
   */
  userTrackBias?: number;
};

export type BuyLabel = BuyLabelLingo;

export type HorseScoreResult = {
  horseId: string;
  horseName: string;
  baseScore: number;
  adjustedScore: number;
  /** 補正後 − 標準重み。従来どおり。 */
  scoreDiff: number;
  /** 5平均×0.75＋上位2平均×0.25（再現性・大敗前の素ブレンド） */
  baseAbilityCore: number;
  /**
   * 再現性・大敗ペナ反映後の基礎（カード表示の「基礎能力」）
   * conditionFitDelta は本値と補正後の差
   */
  intrinsicAbilityScore: number;
  /** baseAbilityCore×0.6 + adjustedScore×0.4。相対化の入力。 */
  raceAdjustedInput: number;
  /**
   * 今回の正規化重みでの加重合計 − intrinsic（調整後基礎）
   */
  conditionFitDelta: number;
  reproducibilityDelta: number;
  riskPenalty: number;
  /** 標準重み（コース基準）による順位 */
  baseRank?: number;
  /** 補正後スコア（絶対点）の順位。レース内相対化の前 */
  adjustedRank?: number;
  /** 同レース内で補正後スコアを min-max した 0〜100 */
  raceRelativeScore: number;
  /** 展開適合から加算。能力値は変更しない */
  paceFitBonus: number;
  /** 距離適性（過去走 + 能力プロファイル）からの加点/減点 */
  distanceFitBonus: number;
  /** 過去走のレース格・内容からの加点/減点 */
  classLevelBonus: number;
  /** 血統適性（距離/コース）による補正 */
  pedigreeBonus: number;
  /** 枠順×当日バイアスの物理的有利不利補正 */
  gateBiasBonus: number;
  /** 枠順×脚質のクロス評価（シナジー） */
  gateStyleSynergyBonus: number;
  /** 騎手・調教師の対象コース実績による補正 */
  connectionsBonus: number;
  /** 年齢・馬体重など傾向データによる補正 */
  trendBonus: number;
  /** 前後傾差に対する適性（末脚と持続力の分離）補正 */
  paceBalanceBonus: number;
  /** 前走の不利・恩恵（負けて強し / 展開利）の文脈補正 */
  tripContextBonus: number;
  /** `raceRelativeScore` + `paceFitBonus`（0〜100）。印・買い判断の基準順は `finalRank` */
  finalEvaluationScore: number;
  finalRank?: number;
  mark?: "◎" | "○" | "▲" | "△" | "☆" | "";
  buyLabel: BuyLabel;
  reason: string;
  strongAbilities: AbilityKey[];
  /** 過去走推定（シグナル）の1行。データ無しのとき空 */
  pastRunInsight: string;
  /** ラップ形状一致ボーナス。データ不足で判定不能のとき 0 */
  lapShapeFitBonus: number;
  /** 消耗戦での減速耐性（持続力）ボーナス */
  lapSustainBonus: number;
  /** 上がりの質（時計＋順位）ボーナス */
  lapQualityBonus: number;
  /** 特定ステップ×内容の黄金パターン加点 */
  stepPatternBonus: number;
  /** ラップ適性の表示プロファイル */
  lapProfile: "瞬発戦型" | "消耗戦型" | "一貫型";
  /** 過去走スコアの標準偏差。判定不能（サンプル < 3）のとき 0 */
  varianceScore: number;
  /** 軸向き / 頭向き / データ不足で判定不能 */
  roleHint: "頭" | "軸" | "判定不能";
};

/** 将来実装: レース狙い度の入力要因メモ */
export type RaceTargetingSignals = {
  largeUpsideExists: boolean;
  favoriteMisalignmentWithTopMark: boolean;
  multipleSameTypePeers: boolean;
  dismissibleFavoriteExists: boolean;
};
