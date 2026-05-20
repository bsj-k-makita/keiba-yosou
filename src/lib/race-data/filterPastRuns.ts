import type { PastRunRecord } from "../../domain/race-evaluation/pastRunTypes";

/**
 * 出馬表取得直後などで「当該レース」が直近走に混入した場合を除外する。
 * 評価・印・バックテストを UI と揃えるため raceDataToHorses 経由で常に適用する。
 */
export function filterPastRunsForCurrentRace(
  pastRuns: readonly PastRunRecord[] | undefined,
  raceId: string,
  meetingDate?: string,
): PastRunRecord[] {
  if (!pastRuns?.length) return [];
  return pastRuns.filter((r) => {
    if (raceId && r.raceId === raceId) return false;
    return true;
  });
}
