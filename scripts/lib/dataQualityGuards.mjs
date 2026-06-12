/**
 * 出馬表取得時の pastRuns 品質判定。
 * フロント `src/lib/race-data/dataQualityGuards.ts` と新馬戦の扱いを揃える。
 */

export function isDebutRaceName(name) {
  if (!name) return false;
  return /(新馬|メイクデビュー)/.test(String(name));
}

/**
 * @param {object} data - { meta?: { raceName?: string }, entries?: object[] }
 * @param {{ successCount: number }} stats
 */
export function shouldFailByPastRunQuality(data, stats) {
  const total = data.entries?.length ?? 0;
  if (total < 8) return false;
  const successRate = total > 0 ? stats.successCount / total : 0;
  const raceName = String(data?.meta?.raceName ?? "");
  const isGradedOrOpen = /(G1|G2|G3|OP|L|\([Gg][123]\)|ステークス|天皇賞|桜花賞|皐月賞|菊花賞|大阪杯)/.test(
    raceName,
  );
  const ageKnown = data.entries.filter((e) => Number.isFinite(e.age));
  const avgAge =
    ageKnown.length > 0
      ? ageKnown.reduce((s, e) => s + Number(e.age), 0) / ageKnown.length
      : 3;

  // 新馬戦は出走馬全頭が過去走ゼロが正常。能力・EV は neutral 推定で計算する。
  if (stats.successCount === 0 && isDebutRaceName(raceName)) return false;

  if (stats.successCount === 0) return true;
  if ((isGradedOrOpen || avgAge >= 4.5) && successRate < 0.6) return true;
  return false;
}
