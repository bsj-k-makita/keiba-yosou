import type { HorseAbility, HorseScoreResult } from "./abilityTypes";
import { BUY_LABELS } from "./lingoConstants";

type StyleGroup = "front" | "mid" | "back";

function styleGroup(style: string): StyleGroup {
  if (style === "逃げ" || style === "先行") return "front";
  if (style === "差し" || style === "追込") return "back";
  return "mid";
}

function frameBand(frame: number | undefined): "inner" | "mid" | "outer" {
  if (frame == null || !Number.isFinite(frame)) return "mid";
  if (frame <= 3) return "inner";
  if (frame >= 6) return "outer";
  return "mid";
}

function byFinalRank(results: HorseScoreResult[]): HorseScoreResult[] {
  return [...results].sort((a, b) => {
    const ra = a.finalRank ?? a.adjustedRank ?? 99;
    const rb = b.finalRank ?? b.adjustedRank ?? 99;
    if (ra !== rb) return ra - rb;
    return b.finalEvaluationScore - a.finalEvaluationScore;
  });
}

function pickDiverseCandidate(
  pool: HorseScoreResult[],
  horseById: Map<string, HorseAbility>,
  avoid: { styles: Set<StyleGroup>; frames: Set<string> },
): HorseScoreResult | null {
  for (const r of pool) {
    if (r.buyLabel === BUY_LABELS.DISMISS) continue;
    const h = horseById.get(r.horseId);
    if (!h) continue;
    const sg = styleGroup(h.runningStyle);
    const fb = frameBand(h.frameNumber);
    if (avoid.styles.has(sg) && avoid.styles.size < 3) continue;
    if (avoid.frames.has(fb) && avoid.frames.size < 2) continue;
    return r;
  }
  return pool.find((r) => r.buyLabel !== BUY_LABELS.DISMISS) ?? null;
}

/**
 * ◎○▲ の脚質・枠の縦目化を緩和し、異ベクトルの馬を ○▲ に配備する。
 * assignMarks 直後（4角振替前）に呼ぶ想定。
 */
export function distributeMarkPortfolio(
  results: HorseScoreResult[],
  horses: readonly HorseAbility[],
): void {
  const horseById = new Map(horses.map((h) => [h.horseId, h] as const));
  const ranked = byFinalRank(results.filter((r) => r.buyLabel !== BUY_LABELS.DISMISS));
  if (ranked.length < 3) return;

  const honmei = ranked[0]!;
  const honmeiHorse = horseById.get(honmei.horseId);
  if (!honmeiHorse) return;

  honmei.mark = "◎";

  const avoidStyles = new Set<StyleGroup>([styleGroup(honmeiHorse.runningStyle)]);
  const avoidFrames = new Set<string>([frameBand(honmeiHorse.frameNumber)]);

  const taikoPool = ranked.slice(1);
  let taiko = taikoPool[0]!;
  const taikoHorse = horseById.get(taiko.horseId);
  if (
    taikoHorse &&
    styleGroup(taikoHorse.runningStyle) === styleGroup(honmeiHorse.runningStyle) &&
    frameBand(taikoHorse.frameNumber) === frameBand(honmeiHorse.frameNumber)
  ) {
    const alt = pickDiverseCandidate(taikoPool, horseById, {
      styles: avoidStyles,
      frames: avoidFrames,
    });
    if (alt) taiko = alt;
  }
  if (taikoHorse) {
    avoidStyles.add(styleGroup(taikoHorse.runningStyle));
    avoidFrames.add(frameBand(taikoHorse.frameNumber));
  }
  taiko.mark = "○";

  const anaPool = ranked.filter((r) => r.horseId !== honmei.horseId && r.horseId !== taiko.horseId);
  let ana = anaPool[0] ?? ranked[2]!;
  const altAna = pickDiverseCandidate(anaPool, horseById, { styles: avoidStyles, frames: avoidFrames });
  if (altAna) ana = altAna;
  ana.mark = "▲";

  for (const r of results) {
    if (r.horseId === honmei.horseId || r.horseId === taiko.horseId || r.horseId === ana.horseId) continue;
    if (r.mark === "◎" || r.mark === "▲" || r.mark === "○") r.mark = "";
  }
}
