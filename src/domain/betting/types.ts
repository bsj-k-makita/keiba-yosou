import type { RaceClassBucket } from "../race-evaluation/raceClassLevel";
import type { ClassTier } from "../race-evaluation/resolveEffectiveRaceClass";
import type { RaceOfficialPayouts } from "../../lib/race-data/raceEvaluationTypes";

export type { RaceOfficialPayouts };

export type BetTicketType = "WIN" | "MAIN_LINE" | "WIDE" | "TRIFECTA_FORM";

/** UI・集計で共通利用する券種順 */
export const BET_TICKET_TYPES: BetTicketType[] = ["WIN", "MAIN_LINE", "WIDE", "TRIFECTA_FORM"];

export type BetTicket = {
  ticketType: BetTicketType;
  /** 各組み合わせは馬番の昇順（馬連・3連複は順不同） */
  combinations: number[][];
  betAmount: number;
};

export type TicketTypeStats = {
  invested: number;
  payout: number;
  rate: number;
  accuracy: number;
  hitCount: number;
  betCount: number;
  estimatedPayout: boolean;
};

export type RaceBetResult = {
  raceId: string;
  classLevel: RaceClassBucket;
  classTier?: ClassTier;
  totalInvested: number;
  totalPayout: number;
  byType: Record<BetTicketType, TicketTypeStats>;
  skippedReason?: string;
  /** 最終◎が1着だったか */
  favoriteWinHit?: boolean;
  /** 最終◎が3着以内だったか */
  favoriteShowHit?: boolean;
};

export type BacktestRaceOutput = {
  result: RaceBetResult;
  detail: RaceDetailLog;
};

export type RaceDetailTicketSlot = {
  invested: number;
  payout: number;
  /** EV推奨券の購入組み合わせが的中 */
  isHit: boolean;
};

export type RaceDetailLog = {
  raceId: string;
  raceName: string;
  classTier: ClassTier;
  classTierLabel: string;
  venue: string;
  raceNumber: number;
  date: string;
  /** 1〜3着の馬番 */
  actualResults: number[];
  /** 例: 12(◎)→7(○)→3(△) */
  finishLabel: string;
  aiMarks: Record<string, string>;
  tickets: Record<BetTicketType, RaceDetailTicketSlot>;
  totalInvested: number;
  totalPayout: number;
  dominantComment: string;
  isAnchorHit: boolean;
  isSecondRowDead: boolean;
  diagnosisLabel: string;
  skippedReason?: string;
};

/** TS印 vs Python AI印（同一レース集合）の回収率比較 */
export type BacktestEngineComparison = {
  generatedAt: string;
  /** ai_* バックフィル済みかつ結果JSONありのレース数 */
  comparableRaceCount: number;
  /** 全結果JSONレース数（参考） */
  totalResultRaceCount: number;
  ts: BacktestSummary;
  ai: BacktestSummary;
  /** 券種別回収率差（AI − TS、%ポイント） */
  recoveryRateDeltaByTicket: Record<BetTicketType, number>;
};

export type BacktestSummary = {
  totalRacesMatched: number;
  totalRacesSkipped: number;
  totalInvestedSum: number;
  totalPayoutSum: number;
  totalRecoveryRate: number;
  byTicketType: Record<BetTicketType, TicketTypeStats>;
  byClassLevel: Record<
    RaceClassBucket,
    { races: number; invested: number; payout: number; rate: number }
  >;
  byClassTier: Record<ClassTier, { races: number; invested: number; payout: number; rate: number }>;
  /** 集計時の勝率エンジン */
  probabilityEngine?: "ts" | "ai";
  /** 結果JSONありの全レース数（AI集計時の分母表示用） */
  totalResultRaceCount?: number;
  /** 的中レース一覧用（結果確定全R・AI未全頭はTS印） */
  raceDetailsForHitList?: RaceDetailLog[];
  /** 最終◎の単勝・3着内（複勝圏）的中率 */
  favoriteMark: {
    races: number;
    winHits: number;
    showHits: number;
    winRate: number;
    showRate: number;
  };
  secondRowDead: {
    anchorSurvivedRaces: number;
    secondRowDeadCount: number;
    secondRowDeadRate: number;
  };
  raceDetails: RaceDetailLog[];
  generatedAt: string;
};

export type RacePayoutInput = {
  raceId: string;
  classLevel: RaceClassBucket;
  /** 1着〜の馬番（ゲート番号） */
  finishOrder: number[];
  /** 馬番 → 単勝オッズ（公式払戻が無い単勝のみフォールバック） */
  winOddsByNumber: Map<number, number>;
  /** netkeiba 確定払戻 */
  officialPayouts?: RaceOfficialPayouts;
  /**
   * 的中時のフォールバック用推定オッズ（馬連・ワイド・3連複）。
   * 確定配当行が無い組み合わせでも払戻0にしない。
   */
  fallbackExoticOdds?: {
    ren?: Record<string, number>;
    wide?: Record<string, number>;
    trifecta?: Record<string, number>;
  };
};
