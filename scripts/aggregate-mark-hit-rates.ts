/**
 * 保存済みレース結果（src/data/results/{raceId}.json）と出馬表評価を突き合わせ、
 * 印ごとの的中率を標準出力する。
 *
 *   npx tsx scripts/aggregate-mark-hit-rates.ts
 *   npx tsx scripts/aggregate-mark-hit-rates.ts --strict
 *
 * `--strict` … アプリと同じ dataQualityGuards を通す（過去走が空のレースは除外）。
 * 省略時は過去走がなくても集計に含める（`--skip-past-runs` で取った JSON でも率が出る）。
 *
 * 前提: `node scripts/fetch-race-results.mjs --date=YYYY-MM-DD` 等で結果 JSON を先に取得していること。
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateRace } from "../src/domain/race-evaluation/scoreCalculator.ts";
import type { HorseScoreResult } from "../src/domain/race-evaluation/abilityTypes.ts";
import { assertRaceDataQuality } from "../src/lib/race-data/dataQualityGuards.ts";
import { convertToRaceEvaluationData } from "../src/lib/race-data/convertToRaceEvaluationData.ts";
import type { RaceResultData } from "../src/lib/race-data/raceEvaluationTypes.ts";
import { raceDataToHorses } from "../src/lib/race-data/raceDataToHorses.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const RACES_DIR = join(ROOT, "src/data/races");
const RESULTS_DIR = join(ROOT, "src/data/results");

const MARKS_SINGLE = ["◎", "○", "▲", "☆"] as const;
const MARK_TRIANGLE = "△";

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function top3WinnerSet(result: RaceResultData): Set<string> {
  const ids = result.places
    .filter((p) => p.place >= 1 && p.place <= 3 && p.horseId && p.horseId.length > 0)
    .map((p) => p.horseId);
  return new Set(ids);
}

function pct(hits: number, total: number): string {
  if (total <= 0) return "—";
  return `${((100 * hits) / total).toFixed(1)}%`;
}

function main(): void {
  const strictQuality = process.argv.includes("--strict");

  if (!existsSync(RESULTS_DIR)) {
    console.error(`結果ディレクトリがありません: ${RESULTS_DIR}`);
    console.error("例: node scripts/fetch-race-results.mjs --date=2026-05-10");
    process.exit(1);
  }

  const resultFiles = readdirSync(RESULTS_DIR).filter((f) => f.endsWith(".json"));
  if (resultFiles.length === 0) {
    console.error(`結果 JSON が1件もありません（${RESULTS_DIR}）。`);
    console.error("取得後に再実行してください: node scripts/fetch-race-results.mjs --date=YYYY-MM-DD");
    process.exit(1);
  }

  const singleTotals: Record<(typeof MARKS_SINGLE)[number], { races: number; hits: number }> = {
    "◎": { races: 0, hits: 0 },
    "○": { races: 0, hits: 0 },
    "▲": { races: 0, hits: 0 },
    "☆": { races: 0, hits: 0 },
  };
  let triangleSlots = 0;
  let triangleHits = 0;
  let skippedNoRace = 0;
  let skippedQuality = 0;
  let skippedEval = 0;

  for (const rf of resultFiles) {
    const raceId = rf.replace(/\.json$/i, "");
    const racePath = join(RACES_DIR, `${raceId}.json`);
    const resultPath = join(RESULTS_DIR, rf);
    if (!existsSync(racePath)) {
      skippedNoRace += 1;
      continue;
    }

    let resultsEval: HorseScoreResult[];
    try {
      const raw = loadJson(racePath);
      const data = convertToRaceEvaluationData(raw);
      if (strictQuality) {
        try {
          assertRaceDataQuality(data);
        } catch {
          skippedQuality += 1;
          continue;
        }
      }
      const horses = raceDataToHorses(data);
      resultsEval = evaluateRace(horses, data.condition);
    } catch {
      skippedEval += 1;
      continue;
    }

    const resultData = loadJson(resultPath) as RaceResultData;
    if (!resultData?.places || !Array.isArray(resultData.places)) {
      skippedEval += 1;
      continue;
    }

    const winners = top3WinnerSet(resultData);

    for (const m of MARKS_SINGLE) {
      const row = resultsEval.find((r) => r.mark === m);
      if (!row) continue;
      singleTotals[m].races += 1;
      if (winners.has(row.horseId)) singleTotals[m].hits += 1;
    }

    for (const row of resultsEval) {
      if (row.mark !== MARK_TRIANGLE) continue;
      triangleSlots += 1;
      if (winners.has(row.horseId)) triangleHits += 1;
    }
  }

  const processed = resultFiles.length - skippedNoRace - skippedQuality - skippedEval;

  console.log("=== 印ごとの的中率（3着以内＝複勝圏）===\n");
  console.log(
    strictQuality
      ? "モード: --strict（過去走不足のレースは除外）"
      : "モード: 既定（過去走が空でも集計に含める。アプリと揃えるには --strict）",
  );
  console.log("対象: src/data/results にあるレースのみ（現在の条件・データで evaluateRace し直し）\n");

  for (const m of MARKS_SINGLE) {
    const t = singleTotals[m];
    console.log(`${m}  ${t.hits}/${t.races}  ${pct(t.hits, t.races)}（レース数ベース・各印1頭）`);
  }
  console.log(`${MARK_TRIANGLE}  ${triangleHits}/${triangleSlots}  ${pct(triangleHits, triangleSlots)}（△印の頭数ベース・1レースに複数頭あり）`);

  console.log("\n--- メタ ---");
  console.log(`結果ファイル数: ${resultFiles.length}`);
  console.log(`評価まで完了したレース: ${processed}`);
  console.log(`スキップ: 出馬表なし=${skippedNoRace}, データ品質=${skippedQuality}, 評価/結果形式エラー=${skippedEval}`);
}

main();
