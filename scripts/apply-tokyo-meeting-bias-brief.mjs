/**
 * 5/16 東京開催の馬場観察（手動ブリーフ）を、5/17 東京全レースの condition に反映する。
 * 場違いフォールバックは行わない（東京のみ）。
 *
 *   node scripts/apply-tokyo-meeting-bias-brief.mjs --target=2026-05-17
 */

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const RACES_DIR = join(ROOT, "src/data/races");
const INDEX_PATH = join(ROOT, "src/data/index.json");

const BRIEF_SOURCE = "manual_meeting_brief_20260516_tokyo";

/** 渗透計 9.7 → trackCushion01（RaceAdjustmentPanel と同式） */
function penetrationToTrackCushion01(penetration) {
  return Math.max(0, Math.min(1, (11.6 - penetration) / 4.8));
}

const TOKYO_TURF_BRIEF = {
  bias: "closer_favor",
  pace: "slow",
  trackSpeed: "fast",
  trackCushion01: penetrationToTrackCushion01(9.7),
  ground: "good",
  adjustmentStrength: "middle",
  raceAnalysis: {
    bias: {
      innerOuter: -1.8,
      frontCloser: -1.8,
      innerShare: 0.25,
      outerSashiShare: 0.67,
    },
    lapType: "late_accelerated",
    lapStructureLabel: "瞬発戦（超後傾ラップ・外差し）",
    source: BRIEF_SOURCE,
    computedAt: new Date().toISOString(),
    meetingBriefSummary:
      "Bコース初週・クッション9.7・超高速。5R除き超後傾ラップだが前有利展開でも差しが届く外差し馬場。上がり32〜33秒台前半のキレで外から捕まる。内枠先行は罠。",
  },
};

const TOKYO_DIRT_BRIEF = {
  bias: "front_favor",
  pace: "middle",
  trackSpeed: "standard",
  trackCushion01: penetrationToTrackCushion01(11.2),
  ground: "good",
  adjustmentStrength: "middle",
  raceAnalysis: {
    bias: {
      innerOuter: 0.4,
      frontCloser: 1.6,
      innerShare: 0.5,
      outerSashiShare: 0.15,
    },
    lapType: "early_pressured",
    lapStructureLabel: "前残り（パサパサ乾燥）",
    source: BRIEF_SOURCE,
    computedAt: new Date().toISOString(),
    meetingBriefSummary:
      "含水率ゴール前2.3%・4角2.7%の超乾燥ダート。砂が軽く深くキックバック厳しい。逃げ先行・外枠先行・パワー馬有利。",
  },
};

function parseOptions() {
  const target = process.argv.find((a) => a.startsWith("--target="))?.slice(9)?.trim();
  if (!target || !/^\d{4}-\d{2}-\d{2}$/.test(target)) {
    throw new Error("--target=YYYY-MM-DD を指定してください");
  }
  return { target };
}

function loadRace(raceId) {
  return JSON.parse(readFileSync(join(RACES_DIR, `${raceId}.json`), "utf8"));
}

function saveRace(raceId, data) {
  writeFileSync(join(RACES_DIR, `${raceId}.json`), `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function mergeCondition(data, brief, { abilityPriority } = {}) {
  const meta = data.meta ?? {};
  const surface = meta.surface === "ダート" ? "ダート" : "芝";
  return {
    ...(data.condition ?? {}),
    venue: meta.venue ?? "東京",
    raceName: meta.raceName,
    surface,
    distance: meta.distance,
    meetingDate: meta.date,
    ground: brief.ground,
    bias: brief.bias,
    pace: brief.pace,
    trackSpeed: brief.trackSpeed,
    trackCushion01: brief.trackCushion01,
    adjustmentStrength: brief.adjustmentStrength,
    raceAnalysis: { ...brief.raceAnalysis },
    ...(abilityPriority != null ? { abilityPriority } : {}),
  };
}

function main() {
  const { target } = parseOptions();
  const index = JSON.parse(readFileSync(INDEX_PATH, "utf8"));
  const tokyo = index.filter((r) => r.date === target && r.venue === "東京");
  if (tokyo.length === 0) throw new Error(`${target} の東京レースがありません`);

  let turfN = 0;
  let dirtN = 0;
  for (const row of tokyo) {
    const data = loadRace(row.raceId);
    const isTurf = row.surface !== "ダート";
    const brief = isTurf ? TOKYO_TURF_BRIEF : TOKYO_DIRT_BRIEF;
    const isVm = row.raceId === "202605020811";
    const next = {
      ...data,
      condition: mergeCondition(data, brief, isVm ? { abilityPriority: "kick" } : {}),
    };
    saveRace(row.raceId, next);
    if (isTurf) turfN += 1;
    else dirtN += 1;
    process.stderr.write(
      `  ${row.raceId} R${row.raceNumber} ${row.surface} → bias=${brief.bias} pace=${brief.pace}${isVm ? " [VM:kick]" : ""}\n`,
    );
  }
  process.stdout.write(
    `done. 東京 ${target}: 芝${turfN} / ダート${dirtN} に 5/16 馬場ブリーフを反映.\n`,
  );
}

main();
