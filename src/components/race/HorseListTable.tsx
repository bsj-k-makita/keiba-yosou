import { useLayoutEffect, useMemo, useRef } from "react";
import type { AbilityGradeRow } from "../../domain/race-evaluation/abilityGrades";
import type { HorseAbility, HorseScoreResult, RaceCondition } from "../../domain/race-evaluation";
import { ABILITY_KEYS } from "../../domain/race-evaluation/abilityTypes";
import { classifyLapStructure, LAP_STRUCTURE } from "../../domain/race-evaluation/lapStructure";
import { BUY_LABELS } from "../../domain/race-evaluation/lingoConstants";
import { buildHorseAiShortReview } from "../../domain/race-evaluation/reasonGenerator";
import { RadarChart } from "./RadarChart";
import { getFrameColor } from "./frameColor";
import {
  computeConnectionSpecialBadges,
  computeMarketAlertLabel,
  getLapProfileVisual,
} from "./evaluationTags";
import type { RaceEvaluationViewModel } from "../../viewModel/raceEvaluationViewModel";
import { netkeibaHorseResultUrl } from "../../lib/netkeibaUrls";

type Props = {
  sorted: HorseScoreResult[];
  horses: HorseAbility[];
  gradesMap: Map<string, AbilityGradeRow>;
  condition: RaceCondition;
  viewModel?: RaceEvaluationViewModel;
  onSelectHorse?: (horseId: string) => void;
  compact?: boolean;
  summaryMode?: boolean;
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
  compact = false,
  summaryMode = false,
}: Props) {
  const horseMap = useMemo(() => new Map(horses.map((h) => [h.horseId, h] as const)), [horses]);
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());
  const prevTopsRef = useRef<Map<string, number>>(new Map());

  useLayoutEffect(() => {
    const nextTops = new Map<string, number>();
    const timers: number[] = [];
    for (const [horseId, el] of rowRefs.current.entries()) {
      nextTops.set(horseId, el.getBoundingClientRect().top);
    }
    for (const row of sorted) {
      const el = rowRefs.current.get(row.horseId);
      const prevTop = prevTopsRef.current.get(row.horseId);
      const nextTop = nextTops.get(row.horseId);
      if (!el || prevTop == null || nextTop == null) continue;
      const delta = prevTop - nextTop;
      if (Math.abs(delta) < 1) continue;
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
  }, [sorted]);

  return (
    <div className={`horse-list-wrap${compact ? " horse-list-wrap--compact" : ""}`}>
      <table className="horse-list" aria-label="出走馬一覧">
        <thead>
          <tr>
            <th className="horse-list__th horse-list__th--mark">印</th>
            <th className="horse-list__th horse-list__th--gate">馬番</th>
            {!summaryMode && <th className="horse-list__th horse-list__th--radar">能力</th>}
            <th className="horse-list__th horse-list__th--name">{summaryMode ? "馬名" : "馬名 / 短評"}</th>
            <th className="horse-list__th horse-list__th--score">スコア</th>
            {!summaryMode && <th className="horse-list__th horse-list__th--grades" title="能力軸ごとの等級">能力等級</th>}
            <th className="horse-list__th horse-list__th--buy">買い</th>
            {!summaryMode && <th className="horse-list__th horse-list__th--role">役割</th>}
            {!summaryMode && (
              <th
                className="horse-list__th horse-list__th--lap"
                title="当日ラップ形状と過去走ラップ形状の一致度。データ不足時は判定不能。"
              >
                ラップ一致度
              </th>
            )}
            {!summaryMode && (
              <th
                className="horse-list__th horse-list__th--lap"
                title="血統・枠順・陣営・傾向・前後傾・不利恩恵の追加補正合計。"
              >
                追加補正
              </th>
            )}
          </tr>
        </thead>
        <tbody>
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
            const effectiveEv = vm?.effectiveEv;
            const radarMap = vm?.weightedRadar ?? horseToRadarMap(horse);
            const contextual = summarizeContextual(r);
            const lapStatus = inferLapStatus(horse, condition, r);
            const lapProfile = getLapProfileVisual(r.lapProfile);
            const marketAlert = computeMarketAlertLabel(horse, r, horses);
            const comment = buildHorseAiShortReview(
              horse,
              r,
              condition,
              horses,
              grades,
              marketAlert ?? undefined,
            );
            const connectionBadges = computeConnectionSpecialBadges(horse, condition);

            return (
              <tr
                key={r.horseId}
                ref={(el) => {
                  if (el) rowRefs.current.set(r.horseId, el);
                  else rowRefs.current.delete(r.horseId);
                }}
                className={`horse-list__row${isDismissMasked ? " horse-list__row--dismiss" : ""}`}
                data-buylabel={r.buyLabel}
                data-has-mark={hasMark ? "1" : undefined}
                data-ev-hot={vm?.evHot ? "1" : undefined}
                onClick={() => onSelectHorse?.(r.horseId)}
                style={{ cursor: onSelectHorse ? "pointer" : undefined }}
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

                {!summaryMode && (
                  <td className="horse-list__td horse-list__td--radar">
                    <RadarChart
                      horse={radarMap as Parameters<typeof RadarChart>[0]["horse"]}
                      grades={grades}
                      size={149}
                    />
                  </td>
                )}

                {/* 馬名 + 短評 */}
                <td className="horse-list__td horse-list__td--name">
                  <div className="horse-list__name-wrap">
                    <div className="horse-list__name-row">
                      <span className="horse-list__horse-name">{horse.horseName}</span>
                      {horse.horseId ? (
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
                      <span className="horse-list__style">{horse.runningStyle}</span>
                    </div>
                    {!summaryMode && <p className="horse-list__comment">{comment}</p>}
                  </div>
                </td>

                {/* スコア */}
                <td className="horse-list__td horse-list__td--score">
                  <span className="horse-list__score">
                    {summaryMode ? (effectiveEv != null ? effectiveEv.toFixed(2) : "—") : r.adjustedScore.toFixed(1)}
                  </span>
                </td>

                {!summaryMode && (
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

                {/* 買いラベル */}
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

                {!summaryMode && (
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

                {!summaryMode && (
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
                {!summaryMode && (
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
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
