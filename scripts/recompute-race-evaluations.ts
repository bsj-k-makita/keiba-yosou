/**
 * 保存済み `src/data/races/*.json` を現在の `evaluateRace`（buildEvaluationData）で上書きする。
 * 実行後は `node scripts/enrich-investment-signals.mjs --all` で期待値系フィールドを再生成すること。
 *
 *   npx tsx scripts/recompute-race-evaluations.ts
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { convertToRaceEvaluationData } from "../src/lib/race-data/convertToRaceEvaluationData.ts";
import { recomputeEvaluationData } from "../src/lib/race-data/buildEvaluationData.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const RACES_DIR = join(ROOT, "src/data/races");

function main(): void {
  if (!existsSync(RACES_DIR)) {
    process.stderr.write(`not found: ${RACES_DIR}\n`);
    process.exit(1);
  }
  const files = readdirSync(RACES_DIR).filter((f) => f.endsWith(".json"));
  let ok = 0;
  let failed = 0;
  for (const name of files) {
    const path = join(RACES_DIR, name);
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
      const stage = convertToRaceEvaluationData(raw);
      const next = recomputeEvaluationData(stage);
      writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
      ok += 1;
    } catch (e) {
      failed += 1;
      process.stderr.write(`${name}: ${String((e as Error)?.message ?? e)}\n`);
    }
  }
  process.stdout.write(`recompute-race-evaluations: ok=${ok} failed=${failed} total=${files.length}\n`);
  if (failed > 0) process.exit(1);
}

main();
