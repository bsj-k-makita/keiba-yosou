#!/usr/bin/env node
/**
 * リポジトリ内のレース JSON + 結果 JSON から種牡馬×馬場×距離帯の複勝圏率を集計する。
 * 出力: src/data/sire_stats.json
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));

function distanceBandKey(distance) {
  const d = distance ?? 0;
  if (d <= 0) return "unknown";
  if (d <= 1400) return "sprint";
  if (d <= 1800) return "mile";
  if (d <= 2200) return "middle";
  return "stayer";
}
const ROOT = join(__dirname, "..");
const RACES_DIR = join(ROOT, "src/data/races");
const RESULTS_DIR = join(ROOT, "src/data/results");
const OUT_PATH = join(ROOT, "src/data/sire_stats.json");

function bucketKey(surface, distance) {
  const s = surface === "ダート" ? "ダ" : "芝";
  return `${s}_${distanceBandKey(distance)}`;
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function main() {
  const stats = {};

  if (!existsSync(RACES_DIR) || !existsSync(RESULTS_DIR)) {
    writeFileSync(OUT_PATH, "{}\n", "utf8");
    process.stdout.write("no races/results dirs; wrote empty sire_stats.json\n");
    return;
  }

  const resultFiles = readdirSync(RESULTS_DIR).filter((f) => f.endsWith(".json"));
  let samples = 0;

  for (const file of resultFiles) {
    const raceId = file.replace(/\.json$/, "");
    const racePath = join(RACES_DIR, `${raceId}.json`);
    const resultPath = join(RESULTS_DIR, file);
    if (!existsSync(racePath)) continue;

    const race = loadJson(racePath);
    const result = loadJson(resultPath);
    const places = Array.isArray(result.places) ? result.places : [];
    if (places.length === 0) continue;

    const meta = race.meta ?? race.raceInfo ?? {};
    const surface = meta.surface ?? "芝";
    const distance = meta.distance ?? 0;
    const bk = bucketKey(surface, distance);

    const sireByHorse = new Map();
    for (const e of race.entries ?? []) {
      const sid = e.pedigree?.sireId;
      if (sid) sireByHorse.set(String(e.horseId), String(sid));
    }
    if (sireByHorse.size === 0) continue;

    for (const p of places) {
      const hid = String(p.horseId ?? "");
      const sireId = sireByHorse.get(hid);
      if (!sireId) continue;
      const place = Number(p.place);
      if (!Number.isFinite(place) || place < 1) continue;

      stats[sireId] ??= {};
      stats[sireId][bk] ??= { runs: 0, top3: 0, top3Rate: 0 };
      const row = stats[sireId][bk];
      row.runs += 1;
      if (place <= 3) row.top3 += 1;
      samples += 1;
    }
  }

  for (const sireId of Object.keys(stats)) {
    for (const bk of Object.keys(stats[sireId])) {
      const row = stats[sireId][bk];
      row.top3Rate = row.runs > 0 ? Math.round((row.top3 / row.runs) * 1000) / 1000 : 0;
    }
  }

  writeFileSync(OUT_PATH, `${JSON.stringify(stats, null, 2)}\n`, "utf8");
  process.stdout.write(
    `wrote ${OUT_PATH}: ${Object.keys(stats).length} sires, ${samples} result rows matched.\n`,
  );
}

main();
