#!/usr/bin/env node
/**
 * 外部ソース（JRA/主催者/手入力集計）のオッズを race JSON に反映する。
 *
 * CSVヘッダ例:
 * raceId,horseNumber,actualOdds,marketWinOdds,marketPopularity,observedAt,source
 * 202605020401,5,3.4,8.9,3,2026-05-03T09:20:00+09:00,jra
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join, dirname, isAbsolute } from "path";
import { fileURLToPath } from "url";
import { enrichInvestmentSignalsInRaceData } from "./lib/investmentSignals.mjs";

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
    throw new Error("Usage: node scripts/apply-external-odds.mjs --csv=<path> [--dry-run]");
  }
  return {
    csvPath: isAbsolute(csvPath) ? csvPath : join(ROOT, csvPath),
    dryRun,
  };
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

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseCsvRows(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]);
  const idx = Object.fromEntries(headers.map((h, i) => [h, i]));
  if (idx.raceId == null) throw new Error("CSV header missing: raceId");
  if (idx.horseNumber == null && idx.horseId == null) {
    throw new Error("CSV header requires horseNumber or horseId");
  }
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    const raceId = String(cols[idx.raceId] ?? "");
    if (!raceId) continue;
    rows.push({
      raceId,
      horseNumber: idx.horseNumber != null ? toNum(cols[idx.horseNumber]) : null,
      horseId: idx.horseId != null ? String(cols[idx.horseId] ?? "") : "",
      actualOdds: idx.actualOdds != null ? toNum(cols[idx.actualOdds]) : null,
      marketWinOdds: idx.marketWinOdds != null ? toNum(cols[idx.marketWinOdds]) : null,
      marketPopularity: idx.marketPopularity != null ? toNum(cols[idx.marketPopularity]) : null,
      observedAt:
        idx.observedAt != null && String(cols[idx.observedAt] ?? "").length > 0
          ? String(cols[idx.observedAt]).trim()
          : new Date().toISOString(),
      source: idx.source != null ? String(cols[idx.source] ?? "").trim() : "external",
    });
  }
  return rows;
}

function entryByRow(entries, row) {
  if (row.horseId) {
    return entries.find((e) => String(e.horseId) === row.horseId) ?? null;
  }
  if (row.horseNumber != null) {
    return entries.find((e) => Number(e.horseNumber) === Number(row.horseNumber)) ?? null;
  }
  return null;
}

function applyRowToRaceData(data, row) {
  const entry = entryByRow(data.entries ?? [], row);
  if (!entry) return false;
  if (row.actualOdds != null && row.actualOdds > 0) {
    entry.actual_odds = row.actualOdds;
    entry.odds_source = "actual";
    entry.actual_odds_source = row.source || "external";
    entry.odds_observed_at = row.observedAt;
  }
  if (row.marketWinOdds != null && row.marketWinOdds > 0) {
    entry.market_win_odds = row.marketWinOdds;
    entry.market_win_odds_source = "actual";
    entry.market_observed_at = row.observedAt;
  }
  if (row.marketPopularity != null && row.marketPopularity > 0) {
    entry.market_popularity = Math.round(row.marketPopularity);
    entry.market_popularity_source = "actual";
    entry.market_observed_at = row.observedAt;
  }
  return true;
}

function main() {
  const { csvPath, dryRun } = parseArgs(process.argv.slice(2));
  if (!existsSync(csvPath)) throw new Error(`CSV not found: ${csvPath}`);
  const rows = parseCsvRows(readFileSync(csvPath, "utf8"));
  if (rows.length === 0) {
    process.stdout.write("no rows.\n");
    return;
  }
  const byRace = new Map();
  for (const r of rows) {
    const list = byRace.get(r.raceId) ?? [];
    list.push(r);
    byRace.set(r.raceId, list);
  }
  let updatedRows = 0;
  let updatedRaces = 0;
  for (const [raceId, raceRows] of byRace.entries()) {
    const filePath = join(RACES_DIR, `${raceId}.json`);
    if (!existsSync(filePath)) continue;
    const data = JSON.parse(readFileSync(filePath, "utf8"));
    let changed = false;
    for (const row of raceRows) {
      if (applyRowToRaceData(data, row)) {
        updatedRows += 1;
        changed = true;
      }
    }
    if (changed) {
      enrichInvestmentSignalsInRaceData(data);
      updatedRaces += 1;
      if (!dryRun) {
        writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
      }
    }
  }
  process.stdout.write(
    `done. updated rows=${updatedRows}, races=${updatedRaces}, dryRun=${dryRun}\n`,
  );
}

main();
