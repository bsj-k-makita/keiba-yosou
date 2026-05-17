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

/** enrich / abilityScorer: 適性・枠・展開由来で勝率が伸び悩む理由（JSON の suitability_flags） */
export type SuitabilityFlag = {
  code: string;
  label: string;
  impactApproxPct?: number;
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
  /** enrich が保存する単勝予測勝率（0〜1）。オッズ非依存で固定。 */
  predictedWinRate?: number;
  /** enrich: predicted_win_rate × 単勝オッズ − ev_margin_dynamic（表示・ランクの単一ソース） */
  finalExpectedValue?: number;
  /** @deprecated 旧式（複勝実効オッズ由来）。final_expected_value を優先 */
  expectedValue?: number;
  actualOdds: number;
  oddsSource?: "actual" | "estimated";
  /** @deprecated 旧 enrich の value_score。final_expected_value を優先 */
  valueScore?: number;
  valueRank: InvestmentValueRank;
  confidenceRank?: InvestmentConfidenceRank;
  betType: InvestmentBetType;
  valueChange: InvestmentValueChange;
  keyFactors: string[];
  riskFactors: string[];
  /** 推奨する購入比率（0〜0.25）。入力予算に対する目安（算出は数学的な資金配分式ベース）。 */
  kellyWeight?: number;
};

export type HorsePedigree = {
  sireId?: string;
  sireName?: string;
  damSireId?: string;
  damSireName?: string;
  /** 父系統名（例: Roberto系） */
  sireLineName?: string;
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
  /**
   * `abilities_source=past_runs_estimated` の JSON から復元したとき true。
   * evaluateRace 内の過去走ブレンド・L2キレ再合成を省略し、二重補正を防ぐ。
   */
  abilitiesPrecomputedFromPastRuns?: boolean;
  pedigree?: HorsePedigree;
  signals?: HorseEvaluationSignals;
  investment?: InvestmentCommentInput;
  /**
   * enrich: レース内 0〜100。枠・コース適性・馬場・展開を除いた能力指数（ポテンシャル）。
   * 予測勝率（predicted_win_rate）とは別。
   */
  abilityIndex?: number;
  /** ポテンシャルは高いが予測勝率が伸びないときの理由フラグ */
  suitabilityFlags?: SuitabilityFlag[];
  /** 前走が当時のトラックバイアスと逆行していたか（巻き返し補正に使用） */
  was_bias_disadvantaged?: boolean;
  /** 過去L2区間（残り400-200m）の最大パフォーマンスを 0〜1 で正規化（旧JSONの0〜100も読込側で吸収） */
  l2_top_speed?: number;
  /** 前走でバイアス不一致があったか（外部取り込み揺れ対応） */
  bias_mismatch?: boolean;
  /** 前走でペース不一致があったか（外部取り込み揺れ対応） */
  pace_mismatch?: boolean;
  /** L2からL1にかけての減速耐性（0-1） */
  l2_sustain_ratio?: number;
  /** 脚質ポジションマップ用（enrich が過去走から算出、0=前方〜100=後方） */
  position_x?: number;
  /** 直近1走目が先頭。4〜6 本の 200m 通過が揃うと展開分類・再現性推定に使う */
  pastRuns?: PastRunRecord[];
};

export type AdjustmentStrengthKey = "weak" | "middle" | "strong";

/**
 * 能力値の「重視ステータス」プリセット。
 * 選択時、対象能力のウェイトを 1.5 倍にしてから正規化する。
 * null = プリセット未選択（コースデフォルトのまま）
 */
export type AbilityPriority =
  | "speed"    // スピード/先行重視
  | "stamina"  // スタミナ/持続重視（staminaとsustainを両方ブースト）
  | "kick"     // キレ（瞬発）勝負
  | "power"    // パワー/急坂重視
  | null;

export type QuickAdjustmentKey = "lastRunReset" | "lapFocus" | "biasSync";

/** `races/*.json` の `analysis.lapType` と同一キー */
export type RaceStoredLapType = "late_accelerated" | "early_pressured" | "even_pace" | "neutral";

/**
 * 結果確定後に蓄積するレース質・枠順バイアス（fetch スクリプトが JSON に書く想定）
 */
/** 同日・同場・同 surface の他レース／保存済み daily_baseline による参照ライン */
export type RacePeerBaselineSummary = {
  peerRaceCount?: number;
  avgPaceBalancePeer?: number;
  avgMedianFinal3fPeer?: number;
  avgMeanMarginPeer?: number;
  /** ディスク上のピアが無く daily_baseline.json を参照した */
  fallbackFromFile?: boolean;
  savedDayRaceCount?: number;
  savedAvgPaceBalance?: number;
};

export type RaceAnalysisSnapshot = {
  bias?: {
    innerOuter?: number;
    frontCloser?: number;
    innerShare?: number;
    outerSashiShare?: number;
  };
  lapType?: RaceStoredLapType;
  paceBalance?: number;
  /** フィールド全頭の上がり3F中央値（秒） */
  medianFinal3fSec?: number;
  /** 全頭の勝ち馬からの平均着差（秒換算） */
  meanMarginFieldSec?: number;
  lapStructureLabel?: string;
  peerBaseline?: RacePeerBaselineSummary;
  source?: string;
  computedAt?: string;
};

export type RaceCondition = {
  venue: string;
  /** 開催日 YYYY-MM-DD（馬場バイアスマスタ照合用。未設定時はマスタ連動をスキップ） */
  meetingDate?: string;
  courseKey?: string;
  raceName?: string;
  /** netkeiba グレード（G1/G2/G3/L/S）。クラス階層判定の最優先ソース */
  raceGrade?: "G1" | "G2" | "G3" | "L" | "S";
  /** netkeiba Icon_GradeType（1=GI 等） */
  netkeibaGradeType?: number;
  /**
   * ON の能力軸は最終ウェイト計算で 3 倍したあと再正規化（重点項目）。
   */
  abilityFocus?: Partial<Record<AbilityKey, boolean>>;
  /** 芝・ダート。未設定時は物理特性補正では「芝」扱い。 */
  surface?: "芝" | "ダート";
  /** 当該レース距離（m）。距離適性ボーナス計算に使用。 */
  distance?: number;
  ground: string;
  /**
   * トラッククッションの目安（0 に近いほど柔らかい／負荷が乗りやすい、1 に近いほど硬く坂の実質負荷が軽い）。
   * 未設定時は `venuePhysicalFactors` の坂・直線補正はクッション連動なし。
   */
  trackCushion01?: number;
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
   * @deprecated 旧スライダー。評価では無視し、馬番クリック（`favoredHorseNumbers` 等）を使用。
   */
  userTrackBias?: number;
  /**
   * 能力値の重視プリセット。
   * 設定時、対象能力ウェイトを 1.5 倍にして正規化し、評価に反映する。
   */
  abilityPriority?: AbilityPriority;
  /**
   * @deprecated 勝率 softmax はパイプラインで常に T=4 固定。JSON互換のため残す。
   */
  softmaxTemperature?: number;
  /** 直前補正（クイックトグル） */
  quickAdjustments?: Partial<Record<QuickAdjustmentKey, boolean>>;
  /** 開幕週の馬場を明示すると4角バイアスが強コース側に寄る（未設定はヒューリスティックのみ） */
  openingMeetingWeek?: boolean;
  /** 最終週・馬場消化後を明示すると後方脚質の4角寄りを強める（未設定はヒューリスティックのみ） */
  closingMeetingWeek?: boolean;
  /**
   * 開催時期の明示（UI）。設定時は `openingMeetingWeek` / `closingMeetingWeek` より優先して解釈する。
   * 未設定時は従来どおりフラグ＋レース名・クッションのヒューリスティックを使用。
   */
  meetingPhase?: "opening" | "mid" | "closing";
  /**
   * @deprecated 枠番1〜8の旧指定。未設定時のみ `favoredHorseNumbers` のフォールバックに使う。
   */
  favoredGateNumbers?: readonly number[];
  /**
   * @deprecated 枠番1〜8の旧指定。
   */
  disfavoredGateNumbers?: readonly number[];
  /**
   * 馬番（ゲート番号）ごとのピンポイント加点。スライダー廃止後の手動ゲート補正の主入力。
   */
  favoredHorseNumbers?: readonly number[];
  /**
   * 馬番（ゲート番号）ごとのピンポイント減点。
   */
  disfavoredHorseNumbers?: readonly number[];
  /**
   * `middle` / 空 のときに脚質からペースを推計するか。
   * `manual` のときはユーザーが選んだ `pace` をそのまま使い（ミドルなら激化推計しない）。
   */
  paceInference?: "auto" | "manual";
  /**
   * 過去に同一レースで確定したラップ質・バイアス（または手入力）。
   * `section200mSec` が無い preview でも lapType 適性を評価できる。
   */
  raceAnalysis?: RaceAnalysisSnapshot;
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
  /** 初角〜4角想定の通過順位（1が最先行）。印ロジック・4角補正に使用 */
  estimatedFourthCornerRank?: number;
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
  /** 鞍上強化・舞台職人・継続乗りなど騎手文脈の直接加点 */
  jockeyRiderBonus?: number;
  /** 大きな鞍上昇格（勝負気配）。表示用 */
  jockeyAmbitionFlag?: boolean;
  /** 馬格×馬場（北海道/ダート）でのパワー加点 */
  heavyWeightPowerBonus?: number;
  /** 急坂・スタミナ要求コースでの耐久適性加点 */
  staminaTestBonus?: number;
  /** 年齢・馬体重など傾向データによる補正 */
  trendBonus: number;
  /** 前後傾差に対する適性（末脚と持続力の分離）補正 */
  paceBalanceBonus: number;
  /** 前走の不利・恩恵（負けて強し / 展開利）の文脈補正 */
  tripContextBonus: number;
  /** コースの物理特性（内前/外前など）との一致による直接加点 */
  courseTraitBonus?: number;
  /** コース特性一致時の説明ラベル（UI表示・tooltip用） */
  courseTraitReasons?: string[];
  /** `raceRelativeScore` + `paceFitBonus`（0〜100）。印・買い判断の基準順は `finalRank` */
  finalEvaluationScore: number;
  /**
   * 補正強度を抑えた参照点（距離・文脈ボーナスは素の値、条件Impactのみ弱ティア）。
   * UI で「補正前」表示に使用。
   */
  evaluationBaselineScore: number;
  /** finalEvaluationScore − evaluationBaselineScore */
  evaluationAdjustmentDelta: number;
  /** 直前補正の総加点 */
  lastMinuteAdjustmentBonus: number;
  /** 前走不利リセット補正の加点 */
  lastRunResetBonus: number;
  /** ラップ適性重視補正の加点 */
  lapFocusBonus: number;
  /** カード表示用バッジ */
  adjustmentBadges: string[];
  finalRank?: number;
  mark?: "◎" | "○" | "▲" | "△" | "☆" | "";
  /** スコア内訳の主因から生成した1行短評 */
  predictionShortComment?: string;
  /** 複勝安定度インデックス（0〜100 目安）。救済ヒモ選出に利用 */
  stabilityScore?: number;
  /** 自動推計したペース激化度（表示・ヒモ△3狙いに利用） */
  paceSeverityKind?: "high" | "slow" | "neutral";
  /** △ヒモ穴の個性ラベル（メインの `mark` と併用） */
  hokkakeRole?: "△1安定" | "△2物理" | "△3狙い";
  buyLabel: BuyLabel;
  reason: string;
  strongAbilities: AbilityKey[];
  /** 過去走推定（シグナル）の1行。データ無しのとき空 */
  pastRunInsight: string;
  /** ラップ形状一致ボーナス。データ不足で判定不能のとき 0 */
  lapShapeFitBonus: number;
  /** 蓄積 `raceAnalysis` に基づく適性・バイアス一致ボーナス */
  raceAnalysisBonus: number;
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
  /** 第1層: 展開不問のエンジン素点バイアス（過去走 IDM 相当ピーク・スロー切れ負け緩和） */
  enginePeakBonus: number;
  /** 第2層: 消耗戦耐性（底力）フラグが立っているか */
  staminaResilienceFlag: boolean;
  /** 第2層: 耐性の強度 0〜1（複数走で確認できるほど高い） */
  staminaResilienceStrength01: number;
  /** 第3層: 今日のレース分類（瞬発戦/持続戦/消耗戦）。判定不能で null */
  todayLapKind: "瞬発戦" | "持続戦" | "消耗戦" | null;
  /** 第3層: 消耗戦×耐性フラグで付与する適性バフ（既存ラップ枠 +16.8 内に収まる） */
  staminaResilienceBonus: number;
  /** 第4層: 「オッズの歪み」=能力高×近走展開不適合×割安オッズ が検出されたか */
  oddsDistortionFlag: boolean;
  /** 第4層: 歪みの強度 0〜1。viewModel が Kelly/EV を補正する係数の元 */
  oddsDistortionScore01: number;
  /** 第4層: 検出根拠の短文配列（UI 表示用） */
  oddsDistortionReasons: string[];
};

/** 将来実装: レース狙い度の入力要因メモ */
export type RaceTargetingSignals = {
  largeUpsideExists: boolean;
  favoriteMisalignmentWithTopMark: boolean;
  multipleSameTypePeers: boolean;
  dismissibleFavoriteExists: boolean;
};
