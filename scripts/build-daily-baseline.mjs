/**
 * src/data/races/*.json の `analysis` を走査し、
 * 日×競馬場×芝/ダ ごとの平均ペースバランス・平均上がり・平均着差などを daily_baseline.json に書く。
 *
 *   node scripts/build-daily-baseline.mjs [racesDir] [outPath]
 */
import {
  buildDailyBaselineMaster,
  saveDailyBaseline,
  DAILY_BASELINE_PATH,
  DEFAULT_RACES_DIR,
} from "./lib/dailyBaseline.mjs";

async function main() {
  const racesDir = process.argv[2] ?? DEFAULT_RACES_DIR;
  const outPath = process.argv[3] ?? DAILY_BASELINE_PATH;
  const data = buildDailyBaselineMaster(racesDir);
  saveDailyBaseline(data, outPath);
  process.stdout.write(
    `daily_baseline: ${Object.keys(data.entries ?? {}).length} buckets from ${data.sourceRaceFiles ?? 0} race files -> ${outPath}\n`,
  );
}

main().catch((e) => {
  process.stderr.write(String(e) + "\n");
  process.exit(1);
});
