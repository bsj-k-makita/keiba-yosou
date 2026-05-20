import { writeFileSync } from "node:fs";
import { join } from "node:path";
import indexJson from "../../data/index.json";
import type { RaceGradeLabel, RaceIndexItem } from "../../lib/race-data/raceEvaluationTypes";
import type { BetTicketType, RaceDetailLog } from "./types";
import { BET_TICKET_TYPES } from "./types";
import { runFullBettingBacktest } from "./runFullBacktest";

const TICKET_LABEL: Record<BetTicketType, string> = {
  WIN: "単勝◎",
  MAIN_LINE: "馬連EV（◎軸）",
  WIDE: "ワイドEV（◎軸）",
  TRIFECTA_FORM: "3連複EV（◎軸）",
};

const GRADE_ORDER: readonly (RaceGradeLabel | "（グレードなし）")[] = [
  "G1",
  "G2",
  "G3",
  "L",
  "S",
  "（グレードなし）",
];

const metaByRaceId = new Map<string, RaceIndexItem>(
  (indexJson as RaceIndexItem[]).map((r) => [r.raceId, r]),
);

type VenueAgg = {
  venue: string;
  races: number;
  hitRaces: number;
  invested: number;
  payout: number;
  hitLogs: RaceDetailLog[];
};

type DimAgg = {
  key: string;
  races: number;
  hitRaces: number;
  invested: number;
  payout: number;
  skips: number;
};

function hitTickets(d: RaceDetailLog): { type: BetTicketType; label: string; payout: number }[] {
  const out: { type: BetTicketType; label: string; payout: number }[] = [];
  for (const t of BET_TICKET_TYPES) {
    const slot = d.tickets[t];
    if (slot.isHit && slot.payout > 0) {
      out.push({ type: t, label: TICKET_LABEL[t], payout: slot.payout });
    }
  }
  return out;
}

function hasPurchaseHit(d: RaceDetailLog): boolean {
  return hitTickets(d).length > 0;
}

function isExcludedDetail(d: RaceDetailLog): boolean {
  return d.skippedReason === "no_marks" || d.skippedReason === "insufficient_results";
}

function formatYen(n: number): string {
  return `${Math.round(n).toLocaleString("ja-JP")}円`;
}

function recoveryPct(invested: number, payout: number): string {
  if (invested <= 0) return "—";
  return `${Math.round((payout / invested) * 1000) / 10}%`;
}

function hitRatePct(hitRaces: number, races: number): string {
  if (races <= 0) return "0%";
  return `${Math.round((hitRaces / races) * 1000) / 10}%`;
}

function distanceKey(raceId: string): string {
  const dist = metaByRaceId.get(raceId)?.distance;
  return dist != null && dist > 0 ? `${dist}m` : "（距離不明）";
}

function gradeKey(raceId: string): string {
  return metaByRaceId.get(raceId)?.raceGrade ?? "（グレードなし）";
}

function parseDistanceM(key: string): number {
  const m = /^(\d+)m$/.exec(key);
  return m ? Number(m[1]) : 99999;
}

function pushDimensionTable(
  lines: string[],
  title: string,
  rows: DimAgg[],
  minRaces = 1,
): void {
  const filtered = rows.filter((r) => r.races >= minRaces);
  lines.push(`## ${title}`, "");
  lines.push("| 区分 | レース数 | 的中R | 的中率 | 投資 | 払戻 | 回収率 | 見送り |");
  lines.push("|------|--------:|------:|-------:|------|------|--------|------:|");
  for (const r of filtered) {
    lines.push(
      `| ${r.key} | ${r.races} | ${r.hitRaces} | ${hitRatePct(r.hitRaces, r.races)} | ${formatYen(r.invested)} | ${formatYen(r.payout)} | ${recoveryPct(r.invested, r.payout)} | ${r.skips} |`,
    );
  }
  lines.push("", "---", "");
}

function accumulateDim(map: Map<string, DimAgg>, key: string, d: RaceDetailLog): void {
  let agg = map.get(key);
  if (!agg) {
    agg = { key, races: 0, hitRaces: 0, invested: 0, payout: 0, skips: 0 };
    map.set(key, agg);
  }
  agg.races += 1;
  agg.invested += d.totalInvested;
  agg.payout += d.totalPayout;
  if (d.totalInvested === 0) agg.skips += 1;
  else if (hasPurchaseHit(d)) agg.hitRaces += 1;
}

export function buildVenueHitReportMarkdown(details: readonly RaceDetailLog[], generatedAt: string): string {
  const byVenue = new Map<string, VenueAgg>();
  const byDistance = new Map<string, DimAgg>();
  const byGrade = new Map<string, DimAgg>();
  const byVenueDistance = new Map<string, DimAgg>();

  for (const d of details) {
    if (isExcludedDetail(d)) continue;

    let agg = byVenue.get(d.venue);
    if (!agg) {
      agg = { venue: d.venue, races: 0, hitRaces: 0, invested: 0, payout: 0, hitLogs: [] };
      byVenue.set(d.venue, agg);
    }
    agg.races += 1;
    agg.invested += d.totalInvested;
    agg.payout += d.totalPayout;
    if (hasPurchaseHit(d)) {
      agg.hitRaces += 1;
      agg.hitLogs.push(d);
    }

    const dist = distanceKey(d.raceId);
    const grade = gradeKey(d.raceId);
    accumulateDim(byDistance, dist, d);
    accumulateDim(byGrade, grade, d);
    accumulateDim(byVenueDistance, `${d.venue} / ${dist}`, d);
  }

  const venues = [...byVenue.values()].sort((a, b) => b.payout - a.payout);
  const totalInvested = venues.reduce((s, v) => s + v.invested, 0);
  const totalPayout = venues.reduce((s, v) => s + v.payout, 0);
  const totalHitRaces = venues.reduce((s, v) => s + v.hitRaces, 0);
  const totalRaces = venues.reduce((s, v) => s + v.races, 0);
  const totalSkips = details.filter(
    (d) => !isExcludedDetail(d) && d.totalInvested === 0,
  ).length;

  const distanceRows = [...byDistance.values()].sort(
    (a, b) => parseDistanceM(a.key) - parseDistanceM(b.key) || b.payout - a.payout,
  );
  const gradeRows = [...byGrade.values()].sort((a, b) => {
    const ai = GRADE_ORDER.indexOf(a.key as (typeof GRADE_ORDER)[number]);
    const bi = GRADE_ORDER.indexOf(b.key as (typeof GRADE_ORDER)[number]);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });
  const venueDistanceRows = [...byVenueDistance.values()].sort(
    (a, b) => b.payout - a.payout || b.hitRaces - a.hitRaces,
  );

  const lines: string[] = [
    "# 競馬場別 的中実績（バックテスト）",
    "",
    `生成日時: ${new Date(generatedAt).toLocaleString("ja-JP")}`,
    "",
    "集計条件: 結果JSONありレース・**Python AI印**（`ai_*` 全頭バックフィル済みのみ）・**EV推奨券**のみ。",
    "画面の買い目タブと同一パイプライン（`runRaceEvaluationPipeline` + `buildRaceBettingContext`）。",
    "",
    "## 全体サマリ",
    "",
    "| 項目 | 値 |",
    "|------|-----|",
    `| 集計レース数 | ${totalRaces} |`,
    `| 的中レース数（購入券で1点以上払戻） | ${totalHitRaces} |`,
    `| 的中率（レース単位） | ${hitRatePct(totalHitRaces, totalRaces)} |`,
    `| 総投資 | ${formatYen(totalInvested)} |`,
    `| 総払戻 | ${formatYen(totalPayout)} |`,
    `| 総回収率 | ${recoveryPct(totalInvested, totalPayout)} |`,
    `| EV見送り（投資0円） | ${totalSkips} |`,
    "",
    "## 競馬場別サマリ",
    "",
    "| 競馬場 | レース数 | 的中R | 的中率 | 投資 | 払戻 | 回収率 |",
    "|--------|---------|-------|--------|------|------|--------|",
  ];

  for (const v of venues) {
    lines.push(
      `| ${v.venue} | ${v.races} | ${v.hitRaces} | ${hitRatePct(v.hitRaces, v.races)} | ${formatYen(v.invested)} | ${formatYen(v.payout)} | ${recoveryPct(v.invested, v.payout)} |`,
    );
  }

  lines.push("", "---", "");
  pushDimensionTable(lines, "距離別サマリ", distanceRows);
  pushDimensionTable(lines, "グレード別サマリ", gradeRows);
  pushDimensionTable(lines, "競馬場×距離（5R以上）", venueDistanceRows, 5);

  for (const v of venues) {
    lines.push(`## ${v.venue}`, "");
    lines.push(
      `投資 ${formatYen(v.invested)} / 払戻 ${formatYen(v.payout)} / 回収率 **${recoveryPct(v.invested, v.payout)}** / 的中 **${v.hitRaces}**/${v.races}R`,
      "",
    );

    if (v.hitLogs.length === 0) {
      lines.push("_この競馬場では購入券の的中（払戻>0）はありませんでした。_", "", "---", "");
      continue;
    }

    const sortedHits = [...v.hitLogs].sort((a, b) => b.totalPayout - a.totalPayout || a.date.localeCompare(b.date));

    lines.push("### 的中レース一覧（馬券種 × 払戻）", "");
    lines.push("| 日付 | R | レース名 | 的中馬券（払戻） | レース払戻合計 | 診断 |");
    lines.push("|------|---|----------|------------------|----------------|------|");

    for (const d of sortedHits) {
      const hits = hitTickets(d);
      const hitCell = hits.map((h) => `**${h.label}** ${formatYen(h.payout)}`).join("<br>");
      lines.push(
        `| ${d.date} | ${d.raceNumber}R | ${d.raceName} | ${hitCell} | **${formatYen(d.totalPayout)}** | ${d.diagnosisLabel} |`,
      );
    }

    lines.push("", "### 券種別内訳（当競馬場）", "");
    lines.push("| 券種 | 的中回数 | 払戻合計 |");
    lines.push("|------|----------|----------|");

    for (const t of BET_TICKET_TYPES) {
      let count = 0;
      let sum = 0;
      for (const d of v.hitLogs) {
        const slot = d.tickets[t];
        if (slot.isHit && slot.payout > 0) {
          count += 1;
          sum += slot.payout;
        }
      }
      if (count > 0) {
        lines.push(`| ${TICKET_LABEL[t]} | ${count} | ${formatYen(sum)} |`);
      }
    }

    lines.push("", "---", "");
  }

  lines.push(
    "",
    "## 凡例",
    "",
    "- **的中馬券**: EV推奨券の組み合わせが的中し、`payout > 0` のもの",
    "- **見送り**（EV推奨0点・投資0円）は的中一覧・競馬場別詳細に含めません（距離/グレード表の「見送り」列に件数のみ）",
    "- **距離・グレード**: `src/data/index.json` の `distance` / `raceGrade` をレースIDで紐付け",
    "- 馬連・3連複は netkeiba 確定配当を優先（未取得時は払戻0のため的中に見えない場合あり）",
    "- 再生成: `npm run report:venue-hits`",
    "",
  );

  return lines.join("\n");
}

export function writeVenueHitReport(outputPath?: string): { path: string; raceCount: number } {
  const summary = runFullBettingBacktest("ai");
  const details = summary.raceDetails;
  const md = buildVenueHitReportMarkdown(details, summary.generatedAt);
  const path = outputPath ?? join(process.cwd(), "docs/競馬場別的中実績.md");
  writeFileSync(path, `${md}\n`, "utf8");
  return { path, raceCount: details.length };
}
