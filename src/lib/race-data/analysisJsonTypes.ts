/**
 * 既存 netkeiba 解析パイプラインが吐く `analysisJson` 想定形（部分一致で読む）。
 * 実キー名は揺れ得るため、convert 側で alias 解決する。
 */

import type { HorseEvaluationSignals, PastRunRecord, RaceCondition } from "../../domain/race-evaluation/abilityTypes";

/** ルート or `analysis` / `analysisJson` 配下 */
export type AnalysisJsonRoot = {
  raceId: string;
  /** レースメタ（必須想定。欠落時はルートの同名キーも探索） */
  meta?: AnalysisRaceMeta;
  condition?: Partial<RaceCondition> & Record<string, unknown>;
  /** 出走エントリ */
  entries: AnalysisHorseEntry[];
  /** ルートにフラットに置かれたメタ用の揺れ */
  date?: string;
  venue?: string;
  raceNumber?: number;
  raceName?: string;
  surface?: string;
  distance?: number;
  groundLabel?: string;
  weather?: string;
};

export type AnalysisRaceMeta = {
  date: string;
  venue: string;
  raceNumber: number;
  raceName?: string;
  /** 「芝」 / 「ダ」など */
  surface: string;
  distance: number;
  /** netkeiba 出馬表の Icon_GradeType 番号（例: 1=GI） */
  netkeibaGradeType?: number;
  /** UI用に正規化したグレード略号 */
  raceGrade?: "G1" | "G2" | "G3" | "L" | "S";
  groundLabel?: string;
  weather?: string;
};

/**
 * 1 頭。パイプラインごとに `umaban` / `horseNumber` 等の揺れあり。
 */
export type AnalysisHorseEntry = {
  horseId: string;
  horseName: string;
  /** 枠 */
  waku?: number;
  wakuNo?: number;
  frameNumber?: number;
  /** 馬番 */
  umaban?: number;
  horseNumber?: number;
  jockeyName?: string;
  jockey?: string;
  trainerName?: string;
  trainer?: string;
  sex?: "牡" | "牝" | "セ";
  age?: number;
  nameKana?: string;
  /** 斤量 */
  weight?: number;
  kinjuryo?: number;
  bodyWeightKg?: number;
  bodyWeight?: number;
  sireName?: string;
  sire?: string;
  damSireName?: string;
  damsire?: string;
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
  /** 脚質ラベル（想定6種＋揺れ） */
  runningStyle: string;
  keibajo?: string;
  abilities: Partial<{
    speed: number;
    stamina: number;
    kick: number;
    sustain: number;
    power: number;
  }>;
  /** 同出走内等級。無ければ変換時に相対等級化 */
  abilityGrades?: Partial<Record<"speed" | "stamina" | "kick" | "sustain" | "power", string>>;
  evaluation?: {
    baseScore: number;
    adjustedScore: number;
    scoreDiff: number;
    fitLevel?: "高" | "中" | "低";
    paceFit?: "◎" | "○" | "△" | "×";
    buyLabel?: string;
  };
  scoring?: {
    baseScore?: number;
    adjustedScore?: number;
    scoreDiff?: number;
  };
  /** 直近が先頭。取得スクリプトで拡張予定 */
  pastRuns?: PastRunRecord[];
  evaluationSignals?: HorseEvaluationSignals;
  /** 気性難（折り合い不安）の補助キー */
  temperamentConcern01?: number;
  temperamentRisk?: boolean;
  /** 期待値短評用（snake_case / camelCase どちらも許容） */
  predicted_probability?: number;
  predictedProbability?: number;
  actual_odds?: number;
  actualOdds?: number;
  estimated_actual_odds?: number;
  estimatedActualOdds?: number;
  value_score?: number;
  valueScore?: number;
  value_rank?: "S" | "A" | "B" | "C" | "D";
  valueRank?: "S" | "A" | "B" | "C" | "D";
  /** Fractional Kelly による推奨投資比率（0〜0.25）*/
  kelly_weight?: number;
  kellyWeight?: number;
  confidence_rank?: "S" | "A" | "B" | "C";
  confidenceRank?: "S" | "A" | "B" | "C";
  bet_type?: "軸" | "相手" | "ヒモ穴" | "見送り";
  betType?: "軸" | "相手" | "ヒモ穴" | "見送り";
  value_change?: "UP" | "DOWN" | "STABLE";
  valueChange?: "UP" | "DOWN" | "STABLE";
  key_factors?: string[];
  keyFactors?: string[];
  risk_factors?: string[];
  riskFactors?: string[];
  odds_source?: "actual" | "estimated";
  oddsSource?: "actual" | "estimated";
};
