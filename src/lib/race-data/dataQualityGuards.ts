import type { RaceEvaluationData } from "./raceEvaluationTypes";

function hasPastRuns(entry: RaceEvaluationData["entries"][number]): boolean {
  return Array.isArray(entry.pastRuns) && entry.pastRuns.length > 0;
}

function isHighClassRaceName(name: string | undefined): boolean {
  if (!name) return false;
  return /(G1|G2|G3|OP|L|\([Gg][123]\)|ステークス|天皇賞|桜花賞|皐月賞|菊花賞|大阪杯)/.test(name);
}

function isDebutRaceName(name: string | undefined): boolean {
  if (!name) return false;
  return /(新馬|メイクデビュー)/.test(name);
}

export function assertRaceDataQuality(data: RaceEvaluationData): void {
  const total = data.entries.length;
  if (total === 0) {
    throw new Error("出走馬データが空です。データを再取得してください。");
  }

  const withPastRuns = data.entries.filter(hasPastRuns).length;
  const coverage = withPastRuns / total;
  const raceName = data.raceInfo.raceName;
  const ageKnown = data.entries.filter((e) => Number.isFinite(e.age));
  const avgAge =
    ageKnown.length > 0
      ? ageKnown.reduce((s, e) => s + Number(e.age), 0) / ageKnown.length
      : 3;
  const highClass = isHighClassRaceName(raceName) || avgAge >= 4.5;
  const isDebutRace = isDebutRaceName(raceName ?? data.condition.raceName);

  if (total >= 8 && withPastRuns === 0 && !isDebutRace) {
    throw new Error(
      [
        "このレースの JSON 内で、どの馬も pastRuns が空です（画面の評価処理は netkeiba へ再取得しません）。",
        "出馬表スクレイプ時に過去走が保存されていない状態です。scripts/fetch-races-from-netkeiba.mjs を --skip-past-runs 無しで対象日だけ再取得してください。",
      ].join(" "),
    );
  }

  if (highClass && coverage < 0.5) {
    throw new Error(
      `過去走データ取得率が不足しています (${withPastRuns}/${total})。評価を停止しました。データ再取得をお願いします。`,
    );
  }
}
