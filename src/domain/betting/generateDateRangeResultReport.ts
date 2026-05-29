import { writeFileSync } from "node:fs";
import { join } from "node:path";
import indexJson from "../../data/index.json";
import type { RaceIndexItem } from "../../lib/race-data/raceEvaluationTypes";
import { runRaceEvaluationPipeline } from "../../lib/pipeline/evaluationPipeline";
import { raceHasFullAiBackfill } from "../../lib/pipeline/aiMarkAssignment";
import type { HorseScoreResult } from "../race-evaluation/abilityTypes";
import {
  collectBacktestRaceInputs,
} from "./runFullBacktest";
import { runBacktestOnRace, type BacktestRaceInput } from "./runBacktest";
import { isEvSkipDetail } from "./raceDetailLog";
import type { BacktestRaceOutput, BetTicketType, RaceDetailLog } from "./types";
import { BET_TICKET_TYPES } from "./types";

const TICKET_LABEL: Record<BetTicketType, string> = {
  WIN: "単勝◎",
  MAIN_LINE: "馬連EV（◎軸）",
  WIDE: "ワイドEV（◎軸）",
  TRIFECTA_FORM: "3連複EV（◎軸）",
};

const MARK_ORDER = ["◎", "○", "▲", "△", "☆"] as const;

const metaByRaceId = new Map<string, RaceIndexItem>(
  (indexJson as RaceIndexItem[]).map((r) => [r.raceId, r]),
);

export type DateRangeReportRace = {
  input: BacktestRaceInput;
  output: BacktestRaceOutput;
  detail: RaceDetailLog;
  evaluation: HorseScoreResult[];
  engine: "ai" | "ts";
};

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

function raceRecovery(d: RaceDetailLog): string {
  return recoveryPct(d.totalInvested, d.totalPayout);
}

function marksSummary(d: RaceDetailLog): string {
  const entries = Object.entries(d.aiMarks)
    .filter(([, m]) => m && m !== "─")
    .sort((a, b) => MARK_ORDER.indexOf(a[1] as (typeof MARK_ORDER)[number]) - MARK_ORDER.indexOf(b[1] as (typeof MARK_ORDER)[number]));
  if (entries.length === 0) return "（印なし）";
  return entries.map(([num, mark]) => `${num}(${mark})`).join(" ");
}

type MarkChar = Exclude<NonNullable<HorseScoreResult["mark"]>, "">;

function hasDisplayMark(r: HorseScoreResult): r is HorseScoreResult & { mark: MarkChar } {
  return r.mark != null && r.mark !== "";
}

function formatMarkedHorses(results: readonly HorseScoreResult[]): string[] {
  const marked = results
    .filter(hasDisplayMark)
    .sort((a, b) => {
      const ma = MARK_ORDER.indexOf(a.mark as (typeof MARK_ORDER)[number]);
      const mb = MARK_ORDER.indexOf(b.mark as (typeof MARK_ORDER)[number]);
      return (ma < 0 ? 99 : ma) - (mb < 0 ? 99 : mb) || (a.finalRank ?? 99) - (b.finalRank ?? 99);
    });
  return marked.map((r) => {
    const rank = r.finalRank != null ? `#${r.finalRank}` : "";
    const score = Math.round(r.finalEvaluationScore * 10) / 10;
    return `- **${r.mark}** ${r.horseName} ${rank} 総合${score} / ${r.buyLabel} — ${r.predictionShortComment?.trim() || r.reason.slice(0, 60)}`;
  });
}

function ticketBreakdown(d: RaceDetailLog): string {
  const parts: string[] = [];
  for (const t of BET_TICKET_TYPES) {
    const slot = d.tickets[t];
    if (slot.invested <= 0) continue;
    const hit = slot.isHit && slot.payout > 0 ? "的中" : "不的中";
    parts.push(`${TICKET_LABEL[t]}: 投${formatYen(slot.invested)}→払${formatYen(slot.payout)}（${hit}）`);
  }
  if (parts.length === 0) {
    if (isEvSkipDetail(d)) return "EV見送り（投資0円）";
    if (d.skippedReason) return `集計外: ${d.skippedReason}`;
    return "購入なし";
  }
  return parts.join(" / ");
}

type DayAgg = {
  date: string;
  races: readonly DateRangeReportRace[];
  invested: number;
  payout: number;
  hitRaces: number;
  purchaseRaces: number;
  skips: number;
  honmeiWin: number;
  honmeiShow: number;
  secondRowDead: number;
  anchorMiss: number;
};

function aggregateDay(races: readonly DateRangeReportRace[]): DayAgg {
  let invested = 0;
  let payout = 0;
  let hitRaces = 0;
  let purchaseRaces = 0;
  let skips = 0;
  let honmeiWin = 0;
  let honmeiShow = 0;
  let secondRowDead = 0;
  let anchorMiss = 0;
  const date = races[0]?.detail.date ?? "";

  for (const r of races) {
    const d = r.detail;
    if (d.skippedReason === "no_marks" || d.skippedReason === "insufficient_results") continue;
    if (d.totalInvested <= 0) {
      skips += 1;
      continue;
    }
    purchaseRaces += 1;
    invested += d.totalInvested;
    payout += d.totalPayout;
    if (BET_TICKET_TYPES.some((t) => d.tickets[t].isHit && d.tickets[t].payout > 0)) hitRaces += 1;
    if (r.output.result.favoriteWinHit) honmeiWin += 1;
    if (r.output.result.favoriteShowHit) honmeiShow += 1;
    if (d.isSecondRowDead) secondRowDead += 1;
    if (!d.isAnchorHit) anchorMiss += 1;
  }

  return {
    date,
    races,
    invested,
    payout,
    hitRaces,
    purchaseRaces,
    skips,
    honmeiWin,
    honmeiShow,
    secondRowDead,
    anchorMiss,
  };
}

function collectRacesForDates(dates: readonly string[]): DateRangeReportRace[] {
  const set = new Set(dates);
  const inputs = collectBacktestRaceInputs().filter((inp) => set.has(inp.meta.date));
  inputs.sort(
    (a, b) =>
      a.meta.date.localeCompare(b.meta.date) ||
      a.meta.venue.localeCompare(b.meta.venue, "ja") ||
      a.meta.raceNumber - b.meta.raceNumber,
  );

  const out: DateRangeReportRace[] = [];
  for (const input of inputs) {
    const engine = raceHasFullAiBackfill(input.horses) ? "ai" : "ts";
    const bt = runBacktestOnRace(input, { probabilityEngine: engine });
    if (!bt) continue;
    const pipeline = runRaceEvaluationPipeline(input.horses, input.condition, {
      probabilityEngine: engine,
    });
    out.push({
      input,
      output: bt,
      detail: bt.detail,
      evaluation: pipeline.results,
      engine,
    });
  }
  return out;
}

function pushDaySummary(lines: string[], agg: DayAgg): void {
  const totalEvalRaces = agg.races.filter(
    (r) => r.detail.skippedReason !== "no_marks" && r.detail.skippedReason !== "insufficient_results",
  ).length;
  lines.push(
    `| 評価対象レース | ${totalEvalRaces} |`,
    `| 購入レース（EV推奨あり） | ${agg.purchaseRaces} |`,
    `| EV見送り | ${agg.skips} |`,
    `| 的中レース（払戻>0） | ${agg.hitRaces} |`,
    `| 的中率（購入Rベース） | ${hitRatePct(agg.hitRaces, agg.purchaseRaces)} |`,
    `| 投資合計 | ${formatYen(agg.invested)} |`,
    `| 払戻合計 | ${formatYen(agg.payout)} |`,
    `| **回収率** | **${recoveryPct(agg.invested, agg.payout)}** |`,
    `| ◎1着 | ${agg.honmeiWin}/${agg.purchaseRaces} |`,
    `| ◎3着内 | ${agg.honmeiShow}/${agg.purchaseRaces} |`,
    `| 2列目全滅 | ${agg.secondRowDead}/${agg.purchaseRaces} |`,
    `| 軸トビ（◎3着外） | ${agg.anchorMiss}/${agg.purchaseRaces} |`,
    "",
  );
}

function pushImprovementNotes(lines: string[], all: readonly DateRangeReportRace[]): void {
  const purchased = all.filter(
    (r) =>
      r.detail.totalInvested > 0 &&
      r.detail.skippedReason !== "no_marks" &&
      r.detail.skippedReason !== "insufficient_results",
  );
  const bigLoss = purchased
    .filter((r) => r.detail.totalPayout === 0 && r.detail.totalInvested >= 400)
    .sort((a, b) => b.detail.totalInvested - a.detail.totalInvested);
  const bigWin = purchased
    .filter((r) => r.detail.totalPayout > r.detail.totalInvested * 2)
    .sort((a, b) => b.detail.totalPayout - a.detail.totalPayout);

  const tsFallback = all.filter((r) => r.engine === "ts").length;
  const aiCount = all.filter((r) => r.engine === "ai").length;

  lines.push("## 改善観点メモ（自動集計）", "");
  lines.push(
    `- **AI印適用**: ${aiCount}R / TSフォールバック: ${tsFallback}R（\`ai_*\` 未バックフィルはTS印）`,
    `- **購入レース**: ${purchased.length}R、全不的中: ${purchased.filter((r) => r.detail.totalPayout === 0).length}R`,
    `- **◎1着率（購入R）**: ${hitRatePct(purchased.filter((r) => r.output.result.favoriteWinHit).length, purchased.length)}`,
    `- **2列目全滅**: ${purchased.filter((r) => r.detail.isSecondRowDead).length}R`,
    "",
  );

  if (bigWin.length > 0) {
    lines.push("### 回収に効いたレース（払戻>投資×2）", "");
    for (const r of bigWin.slice(0, 8)) {
      const d = r.detail;
      lines.push(
        `- ${d.date} ${d.venue}${d.raceNumber}R ${d.raceName}: ${raceRecovery(d)}（${formatYen(d.totalPayout)}）— ${d.finishLabel}`,
      );
    }
    lines.push("");
  }

  if (bigLoss.length > 0) {
    lines.push("### 損失が大きかったレース（投資400円以上・払戻0）", "");
    for (const r of bigLoss.slice(0, 12)) {
      const d = r.detail;
      lines.push(
        `- ${d.date} ${d.venue}${d.raceNumber}R ${d.raceName}: 投${formatYen(d.totalInvested)} — ${d.finishLabel} / ${d.diagnosisLabel}`,
      );
    }
    lines.push("");
  }

  lines.push(
    "### ロジック改善の着眼点",
    "",
    "1. **◎軸の信頼性**: 軸トビ・2列目全滅が多い日は、印付け（`ai_effective_ev` / 勝率校正）か相手選び（ワイド・馬連のEV閾値）の見直しが必要。",
    "2. **EV見送りの質**: 見送りレースの結果と比較し、見送りすべきでなかったレース（高配当）がないか確認。",
    "3. **TSフォールバック**: AI未バックフィルレースは印・EVがTS基準のため、当日分は事前に `python main.py` バックフィルを推奨。",
    "4. **券種別**: 単勝のみ回収している日は、馬連・3連複の買い目生成（相手頭数・フォーメーション）を重点調整。",
    "",
  );
}

export function buildDateRangeResultReportMarkdown(
  races: readonly DateRangeReportRace[],
  generatedAt: string,
  title: string,
): string {
  const byDate = new Map<string, DateRangeReportRace[]>();
  for (const r of races) {
    const list = byDate.get(r.detail.date) ?? [];
    list.push(r);
    byDate.set(r.detail.date, list);
  }

  const dates = [...byDate.keys()].sort();
  const dayAggs = dates.map((d) => aggregateDay(byDate.get(d)!));
  const totalInvested = dayAggs.reduce((s, a) => s + a.invested, 0);
  const totalPayout = dayAggs.reduce((s, a) => s + a.payout, 0);
  const totalHit = dayAggs.reduce((s, a) => s + a.hitRaces, 0);
  const totalPurchase = dayAggs.reduce((s, a) => s + a.purchaseRaces, 0);

  const lines: string[] = [
    `# ${title}`,
    "",
    `生成日時: ${new Date(generatedAt).toLocaleString("ja-JP")}`,
    "",
    "集計条件: 結果JSONあり・**EV推奨券**（画面の買い目タブと同一パイプライン）。",
    "印: 全頭 `ai_*` バックフィル済みなら **Python AI印**、未完了は **TS印** で再計算。",
    "",
    "## 2日間サマリ",
    "",
    "| 項目 | 値 |",
    "|------|-----|",
    `| 対象日 | ${dates.join("、")} |`,
    `| 結果確定レース数 | ${races.length} |`,
    `| 購入レース合計 | ${totalPurchase} |`,
    `| 的中レース | ${totalHit} |`,
    `| 的中率（購入R） | ${hitRatePct(totalHit, totalPurchase)} |`,
    `| 投資合計 | ${formatYen(totalInvested)} |`,
    `| 払戻合計 | ${formatYen(totalPayout)} |`,
    `| **総回収率** | **${recoveryPct(totalInvested, totalPayout)}** |`,
    "",
    "---",
    "",
  ];

  for (const agg of dayAggs) {
    const label = agg.date.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$1年$2月$3日");
    lines.push(`## ${label}`, "");
    lines.push("### 日次サマリ", "", "| 項目 | 値 |", "|------|-----|");
    pushDaySummary(lines, agg);

    lines.push("### レース一覧", "");
    lines.push(
      "| 場 | R | レース名 | 距離 | 印 | 1-3着（印付き） | 投資 | 払戻 | 回収率 | 診断 | エンジン |",
      "|----|---|----------|------|-----|----------------|------|------|--------|------|----------|",
    );

    for (const r of agg.races) {
      const d = r.detail;
      const meta = metaByRaceId.get(d.raceId);
      const dist = meta?.distance != null ? `${meta.distance}m` : "—";
      const surf = meta?.surface ?? "";
      lines.push(
        `| ${d.venue} | ${d.raceNumber} | ${d.raceName} | ${surf}${dist} | ${marksSummary(d)} | ${d.finishLabel || "—"} | ${formatYen(d.totalInvested)} | ${formatYen(d.totalPayout)} | ${raceRecovery(d)} | ${d.diagnosisLabel || "—"} | ${r.engine.toUpperCase()} |`,
      );
    }

    lines.push("", "### レース別詳細", "");

    for (const r of agg.races) {
      const d = r.detail;
      const meta = metaByRaceId.get(d.raceId);
      lines.push(
        `#### ${d.venue} ${d.raceNumber}R ${d.raceName}`,
        "",
        `- **raceId**: \`${d.raceId}\``,
        `- **クラス**: ${d.classTierLabel}`,
        `- **コース**: ${meta?.surface ?? "—"} ${meta?.distance ?? "—"}m`,
        `- **エンジン**: ${r.engine === "ai" ? "Python AI印" : "TS印（AI未バックフィル）"}`,
        "",
        "**評価（印付き馬）**",
        "",
      );
      const horseLines = formatMarkedHorses(r.evaluation);
      if (horseLines.length === 0) lines.push("- （印なし）", "");
      else lines.push(...horseLines, "");

      if (d.dominantComment) {
        lines.push(`> ◎コメント: ${d.dominantComment}`, "");
      }

      lines.push(
        "**レース結果**",
        "",
        `- 着順: ${d.finishLabel || "（着順不足）"}`,
        `- ◎的中: ${r.output.result.favoriteWinHit ? "1着" : r.output.result.favoriteShowHit ? "3着内" : "外れ"}`,
        `- 2列目: ${d.isSecondRowDead ? "全滅" : d.isAnchorHit ? "部分的中" : "—"}`,
        "",
        "**馬券（EV推奨）**",
        "",
        `- ${ticketBreakdown(d)}`,
        `- 投資 ${formatYen(d.totalInvested)} / 払戻 ${formatYen(d.totalPayout)} / 回収率 **${raceRecovery(d)}**`,
        `- 診断: ${d.diagnosisLabel || "—"}`,
        "",
      );
    }

    lines.push("---", "");
  }

  pushImprovementNotes(lines, races);

  lines.push(
    "## 凡例",
    "",
    "- 回収率 = 払戻 ÷ 投資（投資0円の見送りは日次・2日サマリの分母から除外）",
    "- 的中レース = EV推奨券のいずれかで払戻 > 0",
    "- 再生成: `npm run report:date-range -- 2026-05-23 2026-05-24`",
    "",
  );

  return lines.join("\n");
}

export function writeDateRangeResultReport(
  dates: readonly string[],
  outputPath?: string,
  title?: string,
): { path: string; raceCount: number } {
  const races = collectRacesForDates(dates);
  const generatedAt = new Date().toISOString();
  const dateLabel = dates.map((d) => d.replace(/-/g, "/")).join("・");
  const md = buildDateRangeResultReportMarkdown(
    races,
    generatedAt,
    title ?? `${dateLabel} レース結果・評価分析`,
  );
  const defaultName =
    dates.length === 1
      ? `結果分析-${dates[0]}.md`
      : `結果分析-${dates[0]}_${dates[dates.length - 1]}.md`;
  const path = outputPath ?? join(process.cwd(), "docs", defaultName);
  writeFileSync(path, `${md}\n`, "utf8");
  return { path, raceCount: races.length };
}
