import type { RaceClassBucket } from "../race-evaluation/raceClassLevel";
import type { RaceOfficialPayouts } from "../../lib/race-data/raceEvaluationTypes";

export type { RaceOfficialPayouts };

export type BetTicketType = "WIN" | "MAIN_LINE" | "TRIFECTA_FORM";

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
  totalInvested: number;
  totalPayout: number;
  byType: Record<BetTicketType, TicketTypeStats>;
  skippedReason?: string;
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
  generatedAt: string;
};

export type RacePayoutInput = {
  raceId: string;
  classLevel: RaceClassBucket;
  /** 1着〜の馬番（ゲート番号） */
  finishOrder: number[];
  /** 馬番 → 単勝オッズ（公式払戻が無い単勝のみフォールバック） */
  winOddsByNumber: Map<number, number>;
  /** netkeiba 確定払戻（あれば馬連・3連複の推定を廃止） */
  officialPayouts?: RaceOfficialPayouts;
};
