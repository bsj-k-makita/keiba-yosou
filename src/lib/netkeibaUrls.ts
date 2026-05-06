/** netkeiba のレースページ URL（race_id は12桁） */

export function netkeibaShutubaUrl(raceId: string): string {
  return `https://race.netkeiba.com/race/shutuba.html?race_id=${encodeURIComponent(raceId)}`;
}

export function netkeibaResultUrl(raceId: string): string {
  return `https://race.netkeiba.com/race/result.html?race_id=${encodeURIComponent(raceId)}`;
}

/** DB のレース詳細（ラップ・全馬着順など） */
export function netkeibaDbRaceUrl(raceId: string): string {
  return `https://db.netkeiba.com/race/${encodeURIComponent(raceId)}/`;
}

/** 馬の戦績・過去走（JSON に horseId があれば追加取得なしでリンク可能） */
export function netkeibaHorseResultUrl(horseId: string): string {
  return `https://db.netkeiba.com/horse/result/${encodeURIComponent(horseId)}/`;
}
