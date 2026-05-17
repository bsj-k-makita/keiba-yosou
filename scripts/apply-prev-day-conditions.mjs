/**
 * 前日レースの結果分析（ラップ・バイアス）を、**同じ競馬場・同 surface・同距離**の翌日レース condition にのみ引き継ぐ。
 * 場が違うレース（例: 東京←新潟）へのフォールバックは行わない。
 *
 * 使い方:
 *   node scripts/apply-prev-day-conditions.mjs --source=2026-05-16 --target=2026-05-17
 *   node scripts/apply-prev-day-conditions.mjs --source=2026-05-16 --target=2026-05-17 --refresh-source-analysis
 */

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { attachRaceAnalysisOrLeave } from "./lib/raceAnalysis.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const RACES_DIR = join(ROOT, "src/data/races");
const INDEX_PATH = join(ROOT, "src/data/index.json");

function parseOptions() {
  const args = process.argv.slice(2);
  let source = null;
  let target = null;
  let refreshSourceAnalysis = false;
  for (const arg of args) {
    if (arg.startsWith("--source=")) source = arg.slice(9).trim();
    if (arg.startsWith("--target=")) target = arg.slice(9).trim();
    if (arg === "--refresh-source-analysis") refreshSourceAnalysis = true;
  }
  if (!source || !target) {
    throw new Error("--source=YYYY-MM-DD と --target=YYYY-MM-DD を指定してください");
  }
  return { source, target, refreshSourceAnalysis };
}

function loadRaceJson(raceId) {
  const p = join(RACES_DIR, `${raceId}.json`);
  return JSON.parse(readFileSync(p, "utf8"));
}

function saveRaceJson(raceId, data) {
  const p = join(RACES_DIR, `${raceId}.json`);
  writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function raceKeyVenue(meta) {
  const venue = meta?.venue ?? "";
  const surface = meta?.surface === "ダート" ? "ダート" : "芝";
  const distance = Number(meta?.distance);
  if (!venue || !Number.isFinite(distance)) return null;
  return `${venue}|${surface}|${distance}`;
}

function innerOuterToBiasPreset(innerOuter) {
  if (innerOuter == null || !Number.isFinite(innerOuter)) return null;
  if (innerOuter >= 0.75) return "inside_favor";
  if (innerOuter <= -0.75) return "outside_favor";
  return null;
}

function frontCloserToBiasPreset(frontCloser) {
  if (frontCloser == null || !Number.isFinite(frontCloser)) return null;
  if (frontCloser >= 0.75) return "front_favor";
  if (frontCloser <= -0.75) return "closer_favor";
  return null;
}

function pickBiasPreset(snap) {
  const io = snap?.bias?.innerOuter;
  const fc = snap?.bias?.frontCloser;
  const fromIo = innerOuterToBiasPreset(io);
  const fromFc = frontCloserToBiasPreset(fc);
  if (fromIo != null && fromFc == null) return fromIo;
  if (fromFc != null && fromIo == null) return fromFc;
  if (fromIo != null && fromFc != null) {
    if (Math.abs(io) >= Math.abs(fc)) return fromIo;
    return fromFc;
  }
  return "flat";
}

function buildConditionFromSnapshot(data, snap, sourceRaceId, sourceDate) {
  const meta = data.meta ?? {};
  const section200mSec = snap.section200mSec ?? data.condition?.section200mSec;
  const biasPreset = pickBiasPreset(snap);
  return {
    ...(data.condition ?? {}),
    venue: data.condition?.venue ?? meta.venue,
    raceName: data.condition?.raceName ?? meta.raceName,
    surface:
      data.condition?.surface ?? (meta.surface === "ダート" ? "ダート" : "芝"),
    distance: data.condition?.distance ?? meta.distance,
    meetingDate: meta.date,
    ground: data.condition?.ground ?? "good",
    bias: biasPreset,
    pace: data.condition?.pace ?? "middle",
    adjustmentStrength: data.condition?.adjustmentStrength ?? "middle",
    ...(section200mSec != null && section200mSec.length >= 4 ? { section200mSec } : {}),
    raceAnalysis: {
      bias: snap.bias,
      lapType: snap.lapType,
      paceBalance: snap.paceBalance,
      medianFinal3fSec: snap.medianFinal3fSec,
      meanMarginFieldSec: snap.meanMarginFieldSec,
      lapStructureLabel: snap.lapStructure,
      ...(snap.peerBaseline != null ? { peerBaseline: snap.peerBaseline } : {}),
      source: snap.source,
      computedAt: snap.computedAt,
      appliedFromRaceId: sourceRaceId,
      appliedFromDate: sourceDate,
    },
  };
}

function listRaceIdsForDate(date) {
  const index = JSON.parse(readFileSync(INDEX_PATH, "utf8"));
  return index.filter((r) => r.date === date).map((r) => r.raceId);
}

/** スクリプトが付与した前日引き継ぎ条件を除去（場違い誤反映の巻き戻し用） */
function clearAppliedPrevDayCondition(data) {
  const ra = data.condition?.raceAnalysis;
  if (ra?.appliedFromRaceId == null && ra?.appliedFromDate == null) return data;
  const meta = data.meta ?? {};
  const next = { ...data };
  const base = { ...(data.condition ?? {}) };
  delete base.raceAnalysis;
  delete base.section200mSec;
  next.condition = {
    ...base,
    venue: base.venue ?? meta.venue,
    raceName: base.raceName ?? meta.raceName,
    surface: base.surface ?? (meta.surface === "ダート" ? "ダート" : "芝"),
    distance: base.distance ?? meta.distance,
    meetingDate: meta.date,
    ground: base.ground ?? "good",
    bias: "flat",
    pace: base.pace ?? "middle",
    adjustmentStrength: base.adjustmentStrength ?? "middle",
  };
  if (data.analysis?.source === "netkeiba_result") {
    delete next.analysis;
  }
  return next;
}

function main() {
  const { source, target, refreshSourceAnalysis } = parseOptions();
  const sourceIds = listRaceIdsForDate(source);
  const targetIds = listRaceIdsForDate(target);
  if (sourceIds.length === 0) throw new Error(`index に ${source} のレースがありません`);
  if (targetIds.length === 0) throw new Error(`index に ${target} のレースがありません`);

  const byVenueKey = new Map();
  let sourceAnalysisOk = 0;
  let sourceAnalysisFail = 0;

  for (const raceId of sourceIds) {
    let data = loadRaceJson(raceId);
    if (refreshSourceAnalysis || data.analysis == null) {
      try {
        data = attachRaceAnalysisOrLeave({ ...data });
        saveRaceJson(raceId, data);
        if (data.analysis != null) sourceAnalysisOk += 1;
        else sourceAnalysisFail += 1;
      } catch (e) {
        sourceAnalysisFail += 1;
        process.stderr.write(`  ${raceId} analysis skip: ${e?.message ?? e}\n`);
      }
    } else {
      sourceAnalysisOk += 1;
    }

    const vKey = raceKeyVenue(data.meta);
    if (data.condition?.raceAnalysis == null) continue;
    const payload = {
      raceId,
      sourceDate: data.meta?.date ?? source,
      snap: {
        ...data.condition.raceAnalysis,
        section200mSec: data.condition.section200mSec,
      },
      analysis: data.analysis,
    };
    if (vKey != null) byVenueKey.set(vKey, payload);
  }

  process.stderr.write(
    `${source}: analysis ok=${sourceAnalysisOk} fail/skip=${sourceAnalysisFail}, venue+surface+distance keys=${byVenueKey.size}\n`,
  );

  let applied = 0;
  let unmatched = 0;
  let cleared = 0;
  for (const raceId of targetIds) {
    const data = loadRaceJson(raceId);
    const vKey = raceKeyVenue(data.meta);
    if (vKey == null) {
      unmatched += 1;
      continue;
    }
    const src = byVenueKey.get(vKey);
    if (src == null) {
      const hadApplied = data.condition?.raceAnalysis?.appliedFromRaceId != null;
      if (hadApplied) {
        saveRaceJson(raceId, clearAppliedPrevDayCondition(data));
        cleared += 1;
        process.stderr.write(`  cleared stale apply: ${raceId} (${vKey})\n`);
      } else {
        process.stderr.write(`  no match: ${raceId} (${vKey})\n`);
      }
      unmatched += 1;
      continue;
    }
    const next = {
      ...data,
      ...(src.analysis != null ? { analysis: src.analysis } : {}),
      condition: buildConditionFromSnapshot(data, src.snap, src.raceId, src.sourceDate),
    };
    saveRaceJson(raceId, next);
    applied += 1;
    process.stderr.write(`  applied ${src.raceId} → ${raceId} (${vKey})\n`);
  }

  process.stdout.write(
    `done. ${target}: ${applied} 件に前日条件を反映, ${unmatched} 件はマッチなし, ${cleared} 件は誤反映を除去.\n`,
  );
}

main();
