/**
 * EV推奨券バックテストの的中実績を 競馬場・距離・グレード別に集計する。
 * 実行: node scripts/aggregate-hit-stats.mjs
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const summary = JSON.parse(
  readFileSync(join(root, "src/data/backtest_summary.json"), "utf8"),
);
const index = JSON.parse(readFileSync(join(root, "src/data/index.json"), "utf8"));

const metaById = new Map(index.map((r) => [r.raceId, r]));

function bucketDistance(m) {
  if (m <= 1200) return `${m}m`;
  if (m <= 1400) return `${m}m`;
  if (m <= 1600) return `${m}m`;
  if (m <= 1800) return `${m}m`;
  if (m <= 2000) return `${m}m`;
  if (m <= 2200) return `${m}m`;
  if (m <= 2400) return `${m}m`;
  return `${m}m`;
}

function gradeLabel(item) {
  return item?.raceGrade ?? "（グレードなし）";
}

function init() {
  return { races: 0, invested: 0, payout: 0, hits: 0, skips: 0 };
}

function add(acc, d) {
  acc.races += 1;
  acc.invested += d.totalInvested ?? 0;
  acc.payout += d.totalPayout ?? 0;
  if ((d.totalInvested ?? 0) === 0) acc.skips += 1;
  else if ((d.totalPayout ?? 0) > 0) acc.hits += 1;
}

function finalize(acc) {
  const betRaces = acc.races - acc.skips;
  return {
    ...acc,
    betRaces,
    hitRate: betRaces > 0 ? Math.round((acc.hits / betRaces) * 1000) / 10 : 0,
    recovery:
      acc.invested > 0 ? Math.round((acc.payout / acc.invested) * 1000) / 10 : 0,
  };
}

function sortByPayout(a, b) {
  return b[1].payout - a[1].payout || b[1].recovery - a[1].recovery;
}

const details = summary.raceDetailsForHitList ?? summary.raceDetails ?? [];
const byVenue = new Map();
const byDistance = new Map();
const byGrade = new Map();
const byVenueDistance = new Map();

for (const d of details) {
  const meta = metaById.get(d.raceId);
  const dist = meta?.distance ?? 0;
  const distKey = dist > 0 ? `${dist}m` : "（距離不明）";
  const grade = gradeLabel(meta);
  const venue = d.venue || meta?.venue || "（場不明）";

  for (const [map, key] of [
    [byVenue, venue],
    [byDistance, distKey],
    [byGrade, grade],
  ]) {
    if (!map.has(key)) map.set(key, init());
    add(map.get(key), d);
  }

  const vdKey = `${venue} / ${distKey}`;
  if (!byVenueDistance.has(vdKey)) byVenueDistance.set(vdKey, init());
  add(byVenueDistance.get(vdKey), d);
}

function printTable(title, map, minRaces = 1) {
  const rows = [...map.entries()]
    .map(([k, v]) => [k, finalize(v)])
    .filter(([, v]) => v.races >= minRaces)
    .sort(sortByPayout);

  console.log(`\n## ${title}`);
  console.log("| 区分 | レース数 | 購入あり | 的中R | 的中率 | 投資 | 払戻 | 回収率 | 見送り |");
  console.log("|------|--------:|--------:|------:|------:|-----:|-----:|------:|------:|");
  for (const [k, v] of rows) {
    console.log(
      `| ${k} | ${v.races} | ${v.betRaces} | ${v.hits} | ${v.hitRate}% | ${v.invested.toLocaleString()} | ${v.payout.toLocaleString()} | ${v.recovery}% | ${v.skips} |`,
    );
  }
  return rows;
}

console.log("# EV推奨券 的中実績（バックテスト）");
console.log(`生成: ${summary.generatedAt}`);
console.log(
  `全体: ${summary.totalRacesMatched}R集計 / 投資${summary.totalInvestedSum?.toLocaleString()}円 / 払戻${summary.totalPayoutSum?.toLocaleString()}円 / 回収${summary.totalRecoveryRate}%`,
);
console.log(`対象: raceDetailsForHitList ${details.length}R（結果JSON確定済み）`);
console.log("※的中 = EV推奨券で払戻>0円。見送り = 投資0円。");

printTable("競馬場別", byVenue);
printTable("距離別", byDistance);
printTable("グレード別", byGrade);
printTable("競馬場×距離（5R以上のみ）", byVenueDistance, 5);
