import type {
  BuyLabel,
  HorseEvaluationSignals,
  InvestmentCommentInput,
  PastRunRecord,
  RaceCondition,
  RunningStyle,
  SuitabilityFlag,
} from "../../domain/race-evaluation/abilityTypes";
import type { DisplayGrade } from "../../domain/race-evaluation/abilityGrades";
import type { FitTendency, PaceFitToken } from "../../domain/race-evaluation/lingoConstants";

/**
 * レース一覧用（index.json）。DB 化時はテーブル行のイメージ。
 */
/** netkeiba `Icon_GradeType` / 表示ラベルからマップしたグレード（一覧バッジ用） */
export type RaceGradeLabel = "G1" | "G2" | "G3" | "L" | "S";

export type RaceIndexItem = {
  raceId: string;
  date: string;
  venue: string;
  raceNumber: number;
  raceName?: string;
  surface: "芝" | "ダート";
  distance: number;
  /** 出馬表HTMLの Icon_GradeType から推定（名前に頼らない） */
  raceGrade?: RaceGradeLabel;
  /** netkeiba のアイコン番号（1=GI 等）。未検出時は省略 */
  netkeibaGradeType?: number;
};

/** 発走30分前以降に固定する AI 印（オッズ更新後も上書きしない） */
export type AiMarkSnapshot = {
  frozenAt: string;
  marksByHorseId: Record<string, string>;
  /** 印ロジック改定時に increment。不一致ならスナップショットを破棄して再計算 */
  logicVersion?: number;
};

export type RaceInfo = {
  raceId: string;
  date: string;
  venue: string;
  raceNumber: number;
  raceName?: string;
  surface: "芝" | "ダート";
  distance: number;
  raceGrade?: RaceGradeLabel;
  netkeibaGradeType?: number;
  /** 発走時刻 HH:MM（JST）。未設定時は raceNumber から推定 */
  postTime?: string;
  /** backfill / snapshot スクリプトが保存した印（JSON 永続） */
  aiMarkSnapshot?: AiMarkSnapshot;
  /** 馬場状態（表示用。condition.ground とは別物もあり得る） */
  groundLabel?: string;
  weather?: string;
};

/**
 * 1頭分の能力ランク。出走表内相対等級（UIの abilityGrades と同じ前提）。
 * 新規パイプラインでは正規化・評価パイプから一貫して埋める。
 */
export type PerAxisDisplayGrade = DisplayGrade;

export type EntryEvaluationBlock = {
  baseScore: number;
  adjustedScore: number;
  scoreDiff: number;
  /** 5平均×0.75＋上位2平均×0.25 */
  baseAbilityCore: number;
  /** 再現性・大敗調整を反映した基礎能力 */
  intrinsicAbilityScore: number;
  /** 基礎（調整後）0.6 ＋ 補正後素点 0.4。相対化の素点 */
  raceAdjustedInput: number;
  /** 加重合計（補正後）− intrinsic。今回条件とのズレの量。 */
  conditionFitDelta: number;
  reproducibilityDelta: number;
  riskPenalty: number;
  /** 同レース内相対 35〜85 */
  raceRelativeScore: number;
  paceFitBonus: number;
  /** 距離適性（過去走 + 能力プロファイル）からのボーナス */
  distanceFitBonus: number;
  /** レース格・走破内容からのボーナス */
  classLevelBonus: number;
  /** 血統適性（距離/コース）ボーナス */
  pedigreeBonus: number;
  /** 枠順×当日バイアスの物理的有利不利ボーナス */
  gateBiasBonus: number;
  /** 枠順×脚質のシナジー評価 */
  gateStyleSynergyBonus: number;
  /** 騎手・調教師のコース実績ボーナス */
  connectionsBonus: number;
  /** 年齢・馬体重など客観傾向ボーナス */
  trendBonus: number;
  /** 前後傾差への適性ボーナス */
  paceBalanceBonus: number;
  /** 前走の不利・恩恵の文脈ボーナス */
  tripContextBonus: number;
  /** 相対＋展開ボーナス（0〜100） */
  finalEvaluationScore: number;
  /** 動的補正を弱めた参照点（パイプライン JSON に無い場合あり） */
  evaluationBaselineScore?: number;
  evaluationAdjustmentDelta?: number;
  /** 直前補正の総加点 */
  lastMinuteAdjustmentBonus?: number;
  /** 前走不利リセット補正 */
  lastRunResetBonus?: number;
  /** ラップ適性重視補正 */
  lapFocusBonus?: number;
  /** カード表示用の補正バッジ */
  adjustmentBadges?: string[];
  /** ラップ形状一致ボーナス。判定不能のとき 0 */
  lapShapeFitBonus: number;
  /** 蓄積 raceAnalysis 由来のラップ質・枠バイアス一致 */
  raceAnalysisBonus: number;
  /** 消耗戦での持続力ボーナス */
  lapSustainBonus: number;
  /** 上がりの質（時計+順位）ボーナス */
  lapQualityBonus: number;
  /** 特定ステップ×内容ボーナス */
  stepPatternBonus: number;
  /** 表示用ラッププロファイル */
  lapProfile: "瞬発戦型" | "消耗戦型" | "一貫型";
  /** 過去走スコアの標準偏差。判定不能（サンプル < 3）のとき 0 */
  varianceScore: number;
  /** 軸向き / 頭向き / データ不足で判定不能 */
  roleHint: "頭" | "軸" | "判定不能";
  /** 過去走シグナル1行。無データは空 */
  pastRunInsight: string;
  fitLevel: FitTendency;
  paceFit: PaceFitToken;
  buyLabel: BuyLabel;
};

/**
 * サイト表示用の 1 レース・分析済みデータ（Evaluation JSON ルート）。
 * UI は主に本型経由で読む（生 HTML / raw には直接触れない）。
 */
export type RaceEvaluationData = {
  raceId: string;
  raceInfo: RaceInfo;
  /** evaluateRace 等の入力として使う条件。初期表示の既定値。 */
  condition: RaceCondition;
  entries: RaceEntryEvaluation[];
};

/**
 * fetch-race-results.mjs で生成する結果 JSON のスキーマ。
 * src/data/results/{raceId}.json
 */
export type RaceResultPlace = {
  place: number;
  horseId: string;
  horseName: string;
  /** 馬番（netkeiba 結果表） */
  horseNumber?: number;
  waku?: number;
  time?: string;
  /** 1着との着差（秒換算）。1着は 0。旧スキーマ */
  margin?: number | null;
  final3fSec?: number | null;
  cornerPassing?: string | null;
  /** 1着との着差（秒）。netkeiba 結果 JSON */
  marginToWinnerSec?: number | null;
};

/** netkeiba 確定払戻（100円あたりの配当金） */
export type RaceOfficialPayoutRow = {
  numbers: number[];
  dividend: number;
};

export type RaceOfficialPayouts = {
  WIN: RaceOfficialPayoutRow[];
  SHOW: RaceOfficialPayoutRow[];
  /** 馬連 */
  REN: RaceOfficialPayoutRow[];
  /** ワイド */
  WREN: RaceOfficialPayoutRow[];
  /** 3連複 */
  TRI: RaceOfficialPayoutRow[];
};

export type RaceResultData = {
  raceId: string;
  fetchedAt: string;
  places: RaceResultPlace[];
  payouts?: RaceOfficialPayouts;
};

export type RaceEntryEvaluation = {
  horseId: string;
  horseName: string;
  /** 馬番 */
  horseNumber: number;
  frameNumber: number;
  jockey?: string;
  trainer?: string;
  sex?: "牡" | "牝" | "セ";
  age?: number;
  weight?: number;
  bodyWeightKg?: number;
  pedigree?: {
    sireName?: string;
    damSireName?: string;
    courseFit01?: number;
    distanceFit01?: number;
    flatTrackFit01?: number;
    uphillTrackFit01?: number;
    downhillToFlatFit01?: number;
    maleStayerFit01?: number;
    femaleMiddleFit01?: number;
  };

  runningStyle: RunningStyle;

  abilities: {
    speed: number;
    stamina: number;
    kick: number;
    sustain: number;
    power: number;
  };
  abilities_source?:
    | "past_runs_estimated"
    | "neutral_no_past_runs"
    | "neutral_no_usable_runs";

  abilityGrades: {
    speed: PerAxisDisplayGrade;
    stamina: PerAxisDisplayGrade;
    kick: PerAxisDisplayGrade;
    sustain: PerAxisDisplayGrade;
    power: PerAxisDisplayGrade;
  };

  /** 再現性・大敗・オッズ等。未設定のときは中立。 */
  evaluationSignals?: HorseEvaluationSignals;
  /** オッズ歪みに基づく短評入力。存在時は短評生成で優先利用。 */
  investment?: InvestmentCommentInput;
  pastRuns?: PastRunRecord[];
  was_bias_disadvantaged?: boolean;
  l2_top_speed?: number;
  bias_mismatch?: boolean;
  pace_mismatch?: boolean;
  l2_sustain_ratio?: number;
  /** enrich: 隊列位置の横軸スコア（0〜100） */
  position_x?: number;
  /** enrich: レース内 0〜100（枠・適性除くポテンシャル） */
  abilityIndex?: number;
  suitabilityFlags?: SuitabilityFlag[];
  /** Phase1 Python ML バックフィル（scripts/backfill-ai-predictions.py） */
  aiPredictedWinRate?: number;
  aiEffectiveEv?: number;

  evaluation: EntryEvaluationBlock;
};
