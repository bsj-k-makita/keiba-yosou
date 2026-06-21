import { Fragment, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import type { AbilityGradeRow } from "../../domain/race-evaluation/abilityGrades";
import type { HorseAbility, HorseScoreResult, RaceCondition } from "../../domain/race-evaluation";
import { ABILITY_KEYS } from "../../domain/race-evaluation/abilityTypes";
import { classifyLapStructure, LAP_STRUCTURE } from "../../domain/race-evaluation/lapStructure";
import { BUY_LABELS } from "../../domain/race-evaluation/lingoConstants";
import { RadarChart } from "./RadarChart";
import { getFrameColor } from "./frameColor";
import {
  computeConnectionSpecialBadges,
  computeMarketAlertLabel,
  getLapProfileVisual,
} from "./evaluationTags";
import type { RaceEvaluationViewModel } from "../../viewModel/raceEvaluationViewModel";
import { probabilityWinRateSuffix } from "../../lib/pipeline/probabilityEngine";
import { netkeibaHorseResultUrl } from "../../lib/netkeibaUrls";
import { adjustedScoreToPoints100 } from "./adjustedScorePoints100";
import { formatPredictedTop3Percent } from "./predictedTop3Display";
import { RunningStyleStrip } from "./RunningStyleStrip";
import { getEffectiveEvaluationSignals } from "../../domain/race-evaluation/resolveEvaluationSignals";

type Props = {
  sorted: HorseScoreResult[];
  horses: HorseAbility[];
  gradesMap: Map<string, AbilityGradeRow>;
  condition: RaceCondition;
  viewModel?: RaceEvaluationViewModel;
  onSelectHorse?: (horseId: string) => void;
  summaryMode?: boolean;
  /** 投資向けスキャン表示（斤量・騎手・脚質中心） */
  scanMode?: boolean;
  /** netkeiba 風のシンプル出馬表（印・馬番・馬名・性齢・騎手・脚質・オッズ） */
  entryMode?: boolean;
  expandedHorseId?: string | null;
  onToggleExpand?: (horseId: string) => void;
  renderExpandedRow?: (result: HorseScoreResult) => ReactNode;
  /** AI見送りレジームなど: 印列を非表示扱い */
};

function gradeClass(grade: string): string {
  if (grade === "S") return "grade-pill grade-pill--s";
  if (grade === "A") return "grade-pill grade-pill--a";
  if (grade === "B") return "grade-pill grade-pill--b";
  return "grade-pill grade-pill--c";
}

function horseToRadarMap(horse: HorseAbility): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of ABILITY_KEYS) out[k] = horse[k];
  return out;
}

function inferLapEvaluable(horse: HorseAbility, condition: RaceCondition): boolean {
  const raceSec = condition.section200mSec;
  if (!raceSec || raceSec.length < 4) return false;
  const shape = classifyLapStructure(raceSec);
  if (shape === LAP_STRUCTURE.NEUTRAL) return false;
  const runs = horse.pastRuns ?? [];
  const validRuns = runs.filter((r) => (r.section200mSec?.length ?? 0) >= 4).length;
  return validRuns >= 2;
}

function inferLapStatus(
  horse: HorseAbility,
  condition: RaceCondition,
  result: HorseScoreResult,
): "full" | "partial" | "none" {
  if (inferLapEvaluable(horse, condition)) return "full";
  const lapTotal =
    (result.lapShapeFitBonus ?? 0) +
    (result.raceAnalysisBonus ?? 0) +
    (result.lapSustainBonus ?? 0) +
    (result.lapQualityBonus ?? 0);
  if (Math.abs(lapTotal) >= 0.1 || (result.lapQualityBonus ?? 0) > 0 || (result.lapSustainBonus ?? 0) > 0) {
    return "partial";
  }
  return "none";
}

function formatSexAge(horse: HorseAbility): string {
  const sex = horse.sex ?? "";
  const age = horse.age != null ? String(horse.age) : "";
  if (!sex && !age) return "—";
  return `${sex}${age}`;
}

function runningStyleShort(style: string | undefined): string {
  const map: Record<string, string> = { 逃げ: "逃", 先行: "先", 差し: "差", 追込: "追" };
  if (style == null || style === "") return "—";
  return map[style] ?? style;
}

function summarizeContextual(result: HorseScoreResult): { total: number; detail: string } {
  const parts = [
    { key: "血統", v: result.pedigreeBonus ?? 0 },
    { key: "枠順", v: result.gateBiasBonus ?? 0 },
    { key: "枠×脚質", v: result.gateStyleSynergyBonus ?? 0 },
    { key: "陣営", v: result.connectionsBonus ?? 0 },
    { key: "傾向", v: result.trendBonus ?? 0 },
    { key: "前後傾", v: result.paceBalanceBonus ?? 0 },
    { key: "不利恩恵", v: result.tripContextBonus ?? 0 },
  ];
  const total = parts.reduce((s, p) => s + p.v, 0);
  const detail = parts
    .map((p) => `${p.key}${p.v >= 0 ? "+" : ""}${p.v.toFixed(1)}`)
    .join(" / ");
  return { total, detail };
}

export function HorseListTable({
  sorted,
  horses,
  gradesMap,
  condition,
  viewModel,
  onSelectHorse,
  summaryMode = false,
  scanMode = false,
  entryMode = false,
  expandedHorseId = null,
  onToggleExpand,
  renderExpandedRow,
}: Props) {
  const compact = scanMode || summaryMode || entryMode;
  const probabilityEngine = viewModel?.probabilityEngine ?? "ts";
  const winRateTitle =
    probabilityEngine === "ai"
      ? "ai_predicted_win_rate（Python ML・レース内正規化）"
      : "finalEvaluationScore を同一レース内で softmax した単勝確率（表示はパイプラインのみ）。合計 100%。";
  const horseMap = useMemo(() => new Map(horses.map((h) => [h.horseId, h] as const)), [horses]);
  const maxAdjustedScoreInRace = useMemo(
    () => sorted.reduce((m, row) => Math.max(m, row.adjustedScore), 0),
    [sorted],
  );
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());
  const prevTopsRef = useRef<Map<string, number>>(new Map());
  const tbodyRef = useRef<HTMLTableSectionElement>(null);
  const sortOrderKey = useMemo(() => sorted.map((r) => r.horseId).join("\0"), [sorted]);

  /** 印順の入れ替え時のみ FLIP。viewport 座標はスクロールで変わるため offsetTop を使う。 */
  useLayoutEffect(() => {
    const tbody = tbodyRef.current;
    if (!tbody) return;

    const nextTops = new Map<string, number>();
    const timers: number[] = [];
    const tbodyTop = tbody.offsetTop;

    for (const [horseId, el] of rowRefs.current.entries()) {
      nextTops.set(horseId, el.offsetTop - tbodyTop);
    }

    const hadPrevious = prevTopsRef.current.size > 0;

    for (const row of sorted) {
      const el = rowRefs.current.get(row.horseId);
      const prevTop = prevTopsRef.current.get(row.horseId);
      const nextTop = nextTops.get(row.horseId);
      if (!el || prevTop == null || nextTop == null) continue;
      const delta = prevTop - nextTop;
      if (!hadPrevious || Math.abs(delta) < 1) continue;
      el.style.transition = "none";
      el.style.transform = `translateY(${delta}px)`;
      requestAnimationFrame(() => {
        el.style.transition = "transform 320ms cubic-bezier(0.2, 0, 0, 1)";
        el.style.transform = "translateY(0)";
        const timer = window.setTimeout(() => {
          el.style.transition = "";
          el.style.transform = "";
        }, 340);
        timers.push(timer);
      });
    }
    prevTopsRef.current = nextTops;
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [sortOrderKey]);

  return (
    <div className="horse-list-wrap">
      <table className={`horse-list${entryMode ? " horse-list--entry" : ""}`} aria-label="出走馬一覧">
        <thead>
          <tr>
            <th className="horse-list__th horse-list__th--mark">印</th>
            <th className="horse-list__th horse-list__th--gate">馬番</th>
            {!compact && <th className="horse-list__th horse-list__th--radar">能力</th>}
            <th className="horse-list__th horse-list__th--name">馬名</th>
            {entryMode && <th className="horse-list__th horse-list__th--sexage">性齢</th>}
            {entryMode && <th className="horse-list__th horse-list__th--jockey">騎手</th>}
            {entryMode && <th className="horse-list__th horse-list__th--style">脚質</th>}
            {entryMode && <th className="horse-list__th horse-list__th--odds">オッズ</th>}
            {scanMode && !entryMode && <th className="horse-list__th">斤量</th>}
            {scanMode && !entryMode && <th className="horse-list__th">騎手</th>}
            {scanMode && !entryMode && <th className="horse-list__th">脚質</th>}
            {!scanMode && !entryMode && (
              <th className="horse-list__th horse-list__th--pwin" title={winRateTitle}>
                予測勝率
              </th>
            )}
            {!scanMode && !entryMode && (
              <th
                className="horse-list__th horse-list__th--potential"
                title="枠・コース適性・馬場・展開を除いたレース内ポテンシャル（0〜100）。参考表示。"
              >
                ポテンシャル
              </th>
            )}
            {!scanMode && !entryMode && (
              <th
                className="horse-list__th horse-list__th--suit"
                title="ポテンシャルは高いが予測勝率が抑えられるとき、適性側の理由。"
              >
                適性注意
              </th>
            )}
            {!scanMode && !entryMode && (
              <th
                className="horse-list__th horse-list__th--score"
                title="補正後スコアをレース内トップを100点とした比例換算（AI予想・詳細カードと同一）。適性・能力の差が点数の開きになります。"
              >
                点数
              </th>
            )}
            {!scanMode && !entryMode && (
              <th
                className="horse-list__th horse-list__th--top3"
                title="enrich の参考値（単勝確率由来の変換。点数の補正後スコアとは別計算）。AI予想・オッズ/買い目と同一。"
              >
                3着内率
              </th>
            )}
            {!compact && <th className="horse-list__th horse-list__th--grades" title="能力軸ごとの等級">能力等級</th>}
            {!scanMode && !entryMode && <th className="horse-list__th horse-list__th--buy">買い</th>}
            {!compact && <th className="horse-list__th horse-list__th--role">役割</th>}
            {!compact && (
              <th
                className="horse-list__th horse-list__th--lap"
                title="当日ラップ形状と過去走ラップ形状の一致度。データ不足時は判定不能。"
              >
                ラップ一致度
              </th>
            )}
            {!compact && (
              <th
                className="horse-list__th horse-list__th--lap"
                title="血統・枠順・陣営・傾向・前後傾・不利恩恵の追加補正合計。"
              >
                追加補正
              </th>
            )}
            {onToggleExpand && <th className="horse-list__th horse-list__th--expand" aria-label="詳細" />}
          </tr>
        </thead>
        <tbody ref={tbodyRef}>
          {sorted.map((r) => {
            const horse = horseMap.get(r.horseId);
            if (!horse) return null;

            const gate = "gate" in horse ? (horse as HorseAbility & { gate?: number }).gate : undefined;
            const frameNumber = "frameNumber" in horse ? (horse as HorseAbility & { frameNumber?: number }).frameNumber : undefined;
            const frameColor = getFrameColor(frameNumber);
            const hasMark = (r.mark ?? "") !== "";
            const isDismissMasked = r.buyLabel === BUY_LABELS.DISMISS && !hasMark;
            const lapBonus =
              (r.lapShapeFitBonus ?? 0) +
              (r.raceAnalysisBonus ?? 0) +
              (r.lapSustainBonus ?? 0) +
              (r.lapQualityBonus ?? 0);
            const grades = gradesMap.get(r.horseId);
            const vm = viewModel?.byHorseId.get(horse.horseId);
            const radarMap = vm?.weightedRadar ?? horseToRadarMap(horse);
            const score100 = adjustedScoreToPoints100(r.adjustedScore, maxAdjustedScoreInRace);
            const contextual = summarizeContextual(r);
            const lapStatus = inferLapStatus(horse, condition, r);
            const lapProfile = getLapProfileVisual(r.lapProfile);
            const marketAlert = computeMarketAlertLabel(horse, r, horses);
            const connectionBadges = computeConnectionSpecialBadges(horse, condition, horses);
            const suitFlags = horse.suitabilityFlags;
            const suitFirst = suitFlags?.[0];

            const isExpanded = expandedHorseId === r.horseId;
            const rowClickable = !entryMode && (onToggleExpand != null || onSelectHorse != null);
            const winOdds = getEffectiveEvaluationSignals(horse)?.winOdds ?? null;

            return (
              <Fragment key={r.horseId}>
              <tr
                ref={(el) => {
                  if (el) rowRefs.current.set(r.horseId, el);
                  else rowRefs.current.delete(r.horseId);
                }}
                className={`horse-list__row${isDismissMasked ? " horse-list__row--dismiss" : ""}${isExpanded ? " horse-list__row--expanded" : ""}${r.mark === "◎" ? " horse-list__row--honmei" : ""}`}
                data-buylabel={r.buyLabel}
                data-has-mark={hasMark ? "1" : undefined}
                data-mark={r.mark || undefined}
                data-ev-hot={vm?.evHot ? "1" : undefined}
                onClick={() => {
                  if (onToggleExpand) onToggleExpand(r.horseId);
                  else onSelectHorse?.(r.horseId);
                }}
                style={{ cursor: rowClickable ? "pointer" : undefined }}
              >
                {/* 印 */}
                <td className="horse-list__td horse-list__td--mark">
                  {r.mark || "・"}
                </td>

                {/* 馬番 */}
                <td className="horse-list__td horse-list__td--gate">
                  {gate != null ? (
                    <span
                      className="horse-list__gate-badge"
                      style={{
                        background: frameColor.bg,
                        color: frameColor.fg,
                        borderColor: frameColor.border,
                      }}
                      title={frameNumber != null ? `${frameNumber}枠` : undefined}
                    >
                      <span className="horse-list__gate-num">{gate}</span>
                    </span>
                  ) : "—"}
                </td>

                {!compact && (
                  <td className="horse-list__td horse-list__td--radar">
                    <RadarChart
                      horse={radarMap as Parameters<typeof RadarChart>[0]["horse"]}
                      grades={grades}
                      size={149}
                    />
                  </td>
                )}

                {/* 馬名 */}
                <td className="horse-list__td horse-list__td--name">
                  <div className="horse-list__name-wrap">
                    <div className="horse-list__name-row">
                      <span className="horse-list__horse-name">{horse.horseName}</span>
                      {!entryMode && horse.horseId ? (
                        <a
                          href={netkeibaHorseResultUrl(horse.horseId)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="netkeiba-horse-link"
                          title="netkeiba で戦績を開く"
                          onClick={(e) => e.stopPropagation()}
                        >
                          戦績
                        </a>
                      ) : null}
                    </div>
                    {!scanMode && !entryMode && (
                      <RunningStyleStrip runningStyle={horse.runningStyle} position_x={horse.position_x} />
                    )}
                  </div>
                </td>

                {entryMode && (
                  <td className="horse-list__td horse-list__td--sexage">{formatSexAge(horse)}</td>
                )}
                {entryMode && (
                  <td className="horse-list__td horse-list__td--jockey">{horse.jockey ?? "—"}</td>
                )}
                {entryMode && (
                  <td className="horse-list__td horse-list__td--style">
                    {runningStyleShort(horse.runningStyle)}
                  </td>
                )}
                {entryMode && (
                  <td className="horse-list__td horse-list__td--odds horse-list__odds">
                    {winOdds != null ? `${winOdds.toFixed(1)}` : "—"}
                  </td>
                )}

                {scanMode && !entryMode && (
                  <td className="horse-list__td">
                    {horse.bodyWeightKg != null ? `${horse.bodyWeightKg}kg` : "—"}
                  </td>
                )}
                {scanMode && !entryMode && <td className="horse-list__td">{horse.jockey ?? "—"}</td>}
                {scanMode && !entryMode && <td className="horse-list__td">{horse.runningStyle}</td>}

                {!scanMode && !entryMode && (
                <td className="horse-list__td horse-list__td--pwin">
                  {vm?.adjustedWinProbability != null && Number.isFinite(vm.adjustedWinProbability) ? (
                    <span className="horse-list__pwin" title={winRateTitle}>
                      {(vm.adjustedWinProbability * 100).toFixed(1)}%
                      <span className="horse-list__pwin-suffix">
                        {probabilityWinRateSuffix(probabilityEngine)}
                      </span>
                    </span>
                  ) : (
                    <span className="horse-list__role-na">—</span>
                  )}
                </td>
                )}
                {!scanMode && !entryMode && (
                <td className="horse-list__td horse-list__td--potential">
                  {horse.abilityIndex != null ? (
                    <span title="ability_index（適性・枠を除くレース内指数）">{horse.abilityIndex}</span>
                  ) : (
                    <span className="horse-list__role-na">—</span>
                  )}
                </td>
                )}
                {!scanMode && !entryMode && (
                <td className="horse-list__td horse-list__td--suit">
                  {suitFlags != null && suitFirst != null ? (
                    <span
                      className="horse-list__suit-hint"
                      title={suitFlags.map((f) => f.label).join(" / ")}
                    >
                      ⚠ {suitFirst.label}
                      {suitFlags.length > 1 ? ` ほか${suitFlags.length - 1}` : ""}
                    </span>
                  ) : (
                    <span className="horse-list__role-na">—</span>
                  )}
                </td>
                )}

                {!scanMode && !entryMode && (
                <td className="horse-list__td horse-list__td--score">
                  <span
                    className="horse-list__score"
                    title={
                      score100 != null
                        ? `補正後スコア ${r.adjustedScore.toFixed(1)} → 同一レース内換算`
                        : undefined
                    }
                  >
                    {score100 != null ? `${score100}点` : "—"}
                  </span>
                </td>
                )}

                {!scanMode && !entryMode && (
                <td className="horse-list__td horse-list__td--top3">
                  <span className="horse-list__top3">{formatPredictedTop3Percent(horse.investment)}</span>
                </td>
                )}

                {!compact && (
                  <td className="horse-list__td horse-list__td--grades">
                    {grades ? (
                      <span className="horse-list__grades">
                        <span className={gradeClass(grades.speed)} title="スピード">{`スピード${grades.speed}`}</span>
                        <span className={gradeClass(grades.stamina)} title="スタミナ">{`スタミナ${grades.stamina}`}</span>
                        <span className={gradeClass(grades.kick)} title="末脚">{`末脚${grades.kick}`}</span>
                        <span className={gradeClass(grades.sustain)} title="持続力">{`持続力${grades.sustain}`}</span>
                        <span className={gradeClass(grades.power)} title="パワー">{`パワー${grades.power}`}</span>
                      </span>
                    ) : "—"}
                  </td>
                )}

                {!scanMode && !entryMode && (
                <td className="horse-list__td horse-list__td--buy">
                  <span className={`horse-list__buy-label${isDismissMasked ? " horse-list__buy-label--dismiss" : ""}`}>
                    {r.buyLabel}
                  </span>
                  {marketAlert ? (
                    <span className="horse-list__alert-tag" data-alert={marketAlert}>{marketAlert}</span>
                  ) : null}
                  {connectionBadges.length > 0 ? (
                    <span
                      className="horse-list__alert-tag horse-list__alert-tag--info"
                      data-kind={connectionBadges[0]?.includes("折り合い注意") ? "temperament" : "positive"}
                      title={connectionBadges.join(" / ")}
                    >
                      {connectionBadges[0]}
                    </span>
                  ) : null}
                </td>
                )}

                {!compact && (
                  <td className="horse-list__td horse-list__td--role">
                    {r.roleHint === "頭" && (
                      <span className="horse-card__role-badge horse-card__role-badge--head" title={`stddev ${r.varianceScore.toFixed(1)}`}>頭</span>
                    )}
                    {r.roleHint === "軸" && (
                      <span className="horse-card__role-badge horse-card__role-badge--axis" title={`stddev ${r.varianceScore.toFixed(1)}`}>軸</span>
                    )}
                    {r.roleHint === "判定不能" && (
                      <span className="horse-list__role-na">—</span>
                    )}
                  </td>
                )}

                {!compact && (
                  <td className="horse-list__td horse-list__td--lap">
                    {lapStatus === "none" ? (
                      <span className="horse-list__role-na">判定不能</span>
                    ) : lapBonus !== 0 ? (
                      <span className={lapBonus > 0 ? "horse-card__lap-bonus--pos" : "horse-card__lap-bonus--neg"}>
                        {lapProfile.icon} {lapProfile.label}
                        {lapStatus === "partial" ? "（部分）" : ""}
                        {" "}
                        {lapBonus > 0 ? "+" : ""}{lapBonus.toFixed(1)}
                      </span>
                    ) : (
                      <span className="horse-list__role-na">
                        {lapProfile.icon} {lapProfile.label}
                        {lapStatus === "partial" ? "（部分）" : ""}
                        {" "}
                        0.0
                      </span>
                    )}
                  </td>
                )}
                {!compact && (
                  <td className="horse-list__td horse-list__td--lap">
                    {contextual.total !== 0 ? (
                      <span
                        className={contextual.total > 0 ? "horse-card__lap-bonus--pos" : "horse-card__lap-bonus--neg"}
                        title={contextual.detail}
                      >
                        {contextual.total > 0 ? "+" : ""}{contextual.total.toFixed(1)}
                      </span>
                    ) : (
                      <span className="horse-list__role-na" title={contextual.detail}>0.0</span>
                    )}
                  </td>
                )}
                {onToggleExpand && (
                  <td className="horse-list__td horse-list__td--expand" aria-hidden>
                    {isExpanded ? "▼" : "▶"}
                  </td>
                )}
              </tr>
              {isExpanded && renderExpandedRow ? (
                <tr className="horse-list__row horse-list__row--detail">
                  <td colSpan={20} className="horse-list__detail-cell">
                    {renderExpandedRow(r)}
                  </td>
                </tr>
              ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
