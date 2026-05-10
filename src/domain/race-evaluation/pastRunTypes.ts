import type { LapStructureKind } from "./lapStructure";

/**
 * 直近から順に [直近, 2走前, …]（最大5想定）
 */
export type PastRunRecord = {
  /** 着順 1 スタート。欠損のときは 0 または省略 */
  place?: number;
  /**
   * 1着に対する遅れ（秒）。勝ちは 0 または未設定。
   * 1.5 以上を「大敗」閾値に使う。
   */
  marginToWinnerSec?: number;
  /**
   * 200m 毎の通過（秒）— **スタート直後の200m から ゴール前200m まで**の順（時系列）。
   * 4〜8 本想定。netkeiba から取り込む場合、レース結果ページの「レース全体ラップ」行（全馬共通ペース）で埋めることがある。
   */
  section200mSec?: readonly number[];
  /** 取得済みなら分類をキャッシュ（任意） */
  lapStructure?: LapStructureKind;
  /** レース日 YYYY-MM-DD（並び替え用。未設定は配列順のみ） */
  date?: string;
  /** レースID（netkeiba）。無い場合あり。 */
  raceId?: string;
  /** レース名（クラス推定用） */
  raceName?: string;
  /** レースレベル推定（表示/評価補助） */
  raceClass?: "G1" | "G2" | "G3" | "OP" | "3勝" | "2勝" | "1勝" | "新馬" | "未勝利" | "その他";
  /** レース距離（m）。無い場合は文脈評価を控えめにする。 */
  raceDistance?: number;
  /** 上がり3F（秒）。 */
  final3fSec?: number;
  /** 上がり順位（1 が最速）。 */
  final3fRank?: number;
  /** 開催競馬場（例: 東京）。戦績「開催」列から */
  venue?: string;
  /** 芝 / ダート（距離列の種別から） */
  surface?: "芝" | "ダート";
  /** 頭数 */
  fieldSize?: number;
  /** 枠番（1〜8） */
  waku?: number;
  /** 通過順（例: 8-8-7-4）。コーナー位置の分解に使用 */
  passingOrder?: string;
  /** passingOrder の別名（外部JSON揺れ） */
  cornerPassing?: string;
  /** コーナー通過順を数値配列で保持する場合（先頭から順） */
  corner_positions?: readonly number[];
  /** 0〜1: 不利度。大外を回す/前が壁など、値が大きいほど不利を受けた。 */
  tripTrouble01?: number;
  /** 0〜1: 展開利・馬場恩恵。値が大きいほど恩恵を受けた。 */
  tripBenefit01?: number;
  /** 当該走の騎手名（乗り替わり・継続騎乗判定用。未設定時は鞍上強化ロジックをスキップ） */
  jockey?: string;
};
