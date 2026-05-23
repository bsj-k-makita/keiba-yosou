#!/usr/bin/env npx tsx
/**
 * AI 印スナップショットを race JSON meta に保存。
 * 発走30分前を過ぎたレースは既定でスキップ（--force で上書き可）。
 *
 *   npx tsx scripts/snapshot-ai-marks.ts --date=2026-05-23
 *   npx tsx scripts/snapshot-ai-marks.ts --race-id=202608030904
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { convertToRaceEvaluationData } from "../src/lib/race-data/convertToRaceEvaluationData.ts";
import { raceDataToHorses } from "../src/lib/race-data/raceDataToHorses.ts";
import { isMarkFrozen } from "../src/domain/race-evaluation/markFreeze.ts";
import { runRaceEvaluationPipeline } from "../src/lib/pipeline/evaluationPipeline.ts";
import type { AiMarkSnapshot } from "../src/lib/race-data/raceEvaluationTypes.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RACES_DIR = join(ROOT, "src/data/races");
const INDEX_PATH = join(ROOT, "src/data/index.json");

function parseArgs(argv: string[]) {
  let date = "";
  const raceIds: string[] = [];
  let force = false;
  for (const arg of argv) {
    if (arg.startsWith("--date=")) date = arg.slice(7).trim();
    if (arg.startsWith("--race-id=")) raceIds.push(arg.slice(10).trim());
    if (arg === "--force") force = true;
  }
  return { date, raceIds, force };
}

function loadRaceIds(date: string, raceIds: string[]): string[] {
  if (raceIds.length > 0) return raceIds;
  if (!date) throw new Error("--date=YYYY-MM-DD または --race-id=... を指定してください");
  const index = JSON.parse(readFileSync(INDEX_PATH, "utf8")) as { raceId: string; date: string }[];
  return index.filter((r) => r.date === date).map((r) => r.raceId);
}

function snapshotRaceJson(raceId: string, force: boolean): "ok" | "skip" | "err" {
  const path = join(RACES_DIR, `${raceId}.json`);
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  const data = convertToRaceEvaluationData(raw);
  if (data == null) {
    process.stderr.write(`[skip] convert failed: ${raceId}\n`);
    return "err";
  }

  if (!force && isMarkFrozen(data.raceInfo)) {
    process.stderr.write(`[skip] mark frozen window: ${raceId}\n`);
    return "skip";
  }

  const horses = raceDataToHorses(data);
  const pipeline = runRaceEvaluationPipeline(horses, data.condition, {
    probabilityEngine: "ai",
    raceInfo: data.raceInfo,
    markSnapshot: data.raceInfo.aiMarkSnapshot ?? null,
  });

  const snap: AiMarkSnapshot | null = pipeline.pendingMarkSnapshot;
  if (snap == null || Object.keys(snap.marksByHorseId).length === 0) {
    process.stderr.write(`[skip] no AI marks: ${raceId}\n`);
    return "skip";
  }

  const meta = (raw.meta ?? {}) as Record<string, unknown>;
  meta.ai_mark_snapshot = snap;
  raw.meta = meta;
  writeFileSync(path, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  process.stderr.write(`[ok] ${raceId} snapshot @ ${snap.frozenAt}\n`);
  return "ok";
}

const { date, raceIds, force } = parseArgs(process.argv.slice(2));
const ids = loadRaceIds(date, raceIds);
process.stderr.write(`snapshot-ai-marks: ${ids.length} races\n`);

let ok = 0;
let skip = 0;
let err = 0;
for (const raceId of ids) {
  const r = snapshotRaceJson(raceId, force);
  if (r === "ok") ok += 1;
  else if (r === "skip") skip += 1;
  else err += 1;
}
process.stdout.write(`done. ok=${ok} skip=${skip} err=${err}\n`);
process.exit(err > 0 ? 1 : 0);
