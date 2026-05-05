#!/usr/bin/env node
/**
 * CSV から過去走の不利/恩恵データを race JSON へ反映する。
 *
 * 使用例:
 *   node scripts/apply-trip-context.mjs --csv=docs/trip-context-template.csv --dry-run
 *   node scripts/apply-trip-context.mjs --csv=data/trip-context.csv
 *
 * CSV 列:
 *   raceId,horseId,runDate,tripTrouble01,tripBenefit01,note
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join, dirname, isAbsolute } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const RACES_DIR = join(ROOT, "src/data/races");

function parseArgs(argv) {
  let csvPath = "";
  let dryRun = false;
  for (const arg of argv) {
    if (arg.startsWith("--csv=")) csvPath = arg.slice("--csv=".length).trim();
    if (arg === "--dry-run") dryRun = true;
  }
  if (!csvPath) {
    throw new Error("Usage: node scripts/apply-trip-context.mjs --csv=<path> [--dry-run]");
  }
  const absPath = isAbsolute(csvPath) ? csvPath : join(ROOT, csvPath);
  return { csvPath: absPath, dryRun };
}

function clamp01(v) {
  if (!Number.isFinite(v)) return null;
  return Math.max(0, Math.min(1, v));
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuote = !inQuote;
      }
      continue;
    }
    if (ch === "," && !inQuote) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseCsv(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
  if (lines.length === 0) return [];

  const headers = parseCsvLine(lines[0]).map((h) => h.trim());
  const idx = Object.fromEntries(headers.map((h, i) => [h, i]));
  const required = ["raceId", "horseId", "tripTrouble01", "tripBenefit01"];
  for (const k of required) {
    if (idx[k] == null) throw new Error(`CSV header missing: ${k}`);
  }

  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    const raceId = cols[idx.raceId] ?? "";
    const horseId = cols[idx.horseId] ?? "";
    const runDate = idx.runDate != null ? cols[idx.runDate] : "";
    const trouble = clamp01(parseFloat(cols[idx.tripTrouble01] ?? ""));
    const benefit = clamp01(parseFloat(cols[idx.tripBenefit01] ?? ""));
    const note = idx.note != null ? cols[idx.note] : "";
    if (!raceId || !horseId) continue;
    if (trouble == null || benefit == null) {
      throw new Error(`line ${i + 1}: tripTrouble01/tripBenefit01 must be number in [0,1]`);
    }
    rows.push({ raceId, horseId, runDate, tripTrouble01: trouble, tripBenefit01: benefit, note });
  }
  return rows;
}

function applyOneRow(row, dryRun) {
  const racePath = join(RACES_DIR, `${row.raceId}.json`);
  if (!existsSync(racePath)) {
    return { updated: false, reason: `race file not found: ${row.raceId}` };
  }
  const raw = readFileSync(racePath, "utf8");
  const data = JSON.parse(raw);
  const entry = (data.entries ?? []).find((e) => String(e?.horseId) === row.horseId);
  if (!entry) {
    return { updated: false, reason: `horse not found: ${row.raceId} ${row.horseId}` };
  }
  if (!Array.isArray(entry.pastRuns) || entry.pastRuns.length === 0) {
    return { updated: false, reason: `pastRuns missing: ${row.raceId} ${row.horseId}` };
  }

  let run = null;
  if (row.runDate) {
    run = entry.pastRuns.find((r) => String(r?.date ?? "") === row.runDate) ?? null;
  }
  if (!run) run = entry.pastRuns[0];
  if (!run || typeof run !== "object") {
    return { updated: false, reason: `target run missing: ${row.raceId} ${row.horseId}` };
  }

  run.tripTrouble01 = row.tripTrouble01;
  run.tripBenefit01 = row.tripBenefit01;
  if (row.note) run.tripContextNote = row.note;

  if (!dryRun) {
    writeFileSync(racePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  }
  return {
    updated: true,
    raceId: row.raceId,
    horseId: row.horseId,
    runDate: row.runDate || String(run.date ?? ""),
  };
}

function main() {
  const { csvPath, dryRun } = parseArgs(process.argv.slice(2));
  if (!existsSync(csvPath)) {
    throw new Error(`CSV not found: ${csvPath}`);
  }
  const rows = parseCsv(readFileSync(csvPath, "utf8"));
  if (rows.length === 0) {
    process.stdout.write("no rows.\n");
    return;
  }

  let updated = 0;
  let skipped = 0;
  for (const row of rows) {
    const res = applyOneRow(row, dryRun);
    if (res.updated) {
      updated += 1;
      process.stdout.write(
        `${dryRun ? "[dry-run] " : ""}updated: ${res.raceId} ${res.horseId} ${res.runDate}\n`,
      );
    } else {
      skipped += 1;
      process.stderr.write(`skip: ${res.reason}\n`);
    }
  }
  process.stdout.write(`done. updated=${updated}, skipped=${skipped}, dryRun=${dryRun}\n`);
}

main();
