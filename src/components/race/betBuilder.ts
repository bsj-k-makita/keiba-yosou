import type { HorseAbility, HorseScoreResult, RaceCondition } from "../../domain/race-evaluation";
import { BUY_LABELS } from "../../domain/race-evaluation/lingoConstants";
import { computeMarketAlertLabel } from "./evaluationTags";

export type BetMode = "conservative" | "aggressive";

export type BetItem = {
  combo: string;
  stake: number;
  estimatedOdds: number;
  estimatedReturn: number;
};

export type BetTicket = {
  type: "馬連" | "3連複";
  items: BetItem[];
  points: number;
  totalStake: number;
  note: string;
  minEstimatedReturn: number;
  maxEstimatedReturn: number;
};

export type BetPlan = {
  axisHorse: HorseScoreResult;
  mode: BetMode;
  antiGami: boolean;
  budget: number;
  tickets: BetTicket[];
  totalStake: number;
  remaining: number;
};

function selectAxis(sorted: HorseScoreResult[]): HorseScoreResult | null {
  const favorite = sorted.find((r) => r.buyLabel === BUY_LABELS.FAVORITE);
  return favorite ?? sorted[0] ?? null;
}

function validTargets(
  sorted: HorseScoreResult[],
  horses: readonly HorseAbility[],
): HorseScoreResult[] {
  const horseMap = new Map(horses.map((h) => [h.horseId, h] as const));
  return sorted.filter((r) => {
    if (r.buyLabel === BUY_LABELS.DISMISS) return false;
    const horse = horseMap.get(r.horseId);
    if (!horse) return true;
    const alert = computeMarketAlertLabel(horse, r, horses);
    return alert !== "危険な人気馬";
  });
}

function horseNameMap(horses: readonly HorseAbility[]): Map<string, string> {
  return new Map(horses.map((h) => [h.horseId, h.horseName] as const));
}

function paceKey(condition: RaceCondition): "high" | "slow" | "middle" {
  if (condition.pace === "high" || condition.pace === "many_front_runners") return "high";
  if (condition.pace === "slow" || condition.pace === "no_front_runner") return "slow";
  return "middle";
}

function paceAdaptiveScore(horse: HorseAbility, result: HorseScoreResult, condition: RaceCondition): number {
  const baseRank = result.finalRank ?? result.adjustedRank ?? 99;
  let score = 110 - baseRank * 7 + result.finalEvaluationScore * 0.7;
  const pace = paceKey(condition);
  if (pace === "high") {
    score += horse.stamina * 0.35 + horse.sustain * 0.35 + result.paceFitBonus * 5;
    if (horse.runningStyle === "差し" || horse.runningStyle === "追込") score += 8;
    if (horse.runningStyle === "逃げ" || horse.runningStyle === "先行") score -= 5;
  } else if (pace === "slow") {
    score += horse.speed * 0.3 + horse.kick * 0.35 + result.paceFitBonus * 3;
    if (horse.runningStyle === "逃げ" || horse.runningStyle === "先行") score += 7;
    if (horse.runningStyle === "追込") score -= 6;
  } else {
    score += horse.speed * 0.25 + horse.stamina * 0.2 + horse.kick * 0.2 + horse.sustain * 0.2;
  }
  return score;
}

function normalizedWinProbabilities(
  targets: HorseScoreResult[],
  horses: readonly HorseAbility[],
): Map<string, number> {
  const horseMap = new Map(horses.map((h) => [h.horseId, h] as const));
  const raw = targets.map((r, idx) => {
    const odds = horseMap.get(r.horseId)?.signals?.winOdds;
    const rank = r.finalRank ?? r.adjustedRank ?? idx + 1;
    const base = odds != null && Number.isFinite(odds) && odds > 0 ? 1 / odds : 1 / (rank + 2);
    return { horseId: r.horseId, value: Math.max(0.0001, base) };
  });
  const sum = raw.reduce((s, r) => s + r.value, 0);
  const normalized = new Map<string, number>();
  for (const r of raw) normalized.set(r.horseId, r.value / sum);
  return normalized;
}

function estimateComboOdds(
  type: "馬連" | "3連複",
  probs: number[],
): number {
  const takeRate = 0.78;
  const baseProb = probs.reduce((p, v) => p * v, 1);
  const combinational = type === "馬連" ? 2.2 : 5.2;
  const estimatedProb = Math.max(0.000001, baseProb * combinational);
  const odds = takeRate / estimatedProb;
  return Math.min(9999, Math.max(type === "馬連" ? 2 : 8, Number(odds.toFixed(1))));
}

function distributeBudget(rawWeights: number[], budget: number): number[] {
  if (rawWeights.length === 0 || budget < 100) return [];
  const maxCount = Math.min(rawWeights.length, Math.floor(budget / 100));
  const indices = rawWeights
    .map((w, i) => ({ i, w }))
    .sort((a, b) => b.w - a.w)
    .slice(0, maxCount)
    .map((x) => x.i);
  const pickedSet = new Set(indices);
  const weights = rawWeights.map((w, i) => (pickedSet.has(i) ? w : 0));
  const activeWeight = weights.reduce((s, w) => s + w, 0);
  const stakes = new Array(rawWeights.length).fill(0);
  if (activeWeight <= 0) return stakes;
  for (const idx of indices) {
    const target = (budget * weights[idx]!) / activeWeight;
    stakes[idx] = Math.max(100, Math.floor(target / 100) * 100);
  }
  let used = stakes.reduce((s, v) => s + v, 0);
  while (used + 100 <= budget) {
    let bestIdx = indices[0]!;
    let bestDeficit = -Infinity;
    for (const idx of indices) {
      const target = (budget * weights[idx]!) / activeWeight;
      const deficit = target - stakes[idx]!;
      if (deficit > bestDeficit) {
        bestDeficit = deficit;
        bestIdx = idx;
      }
    }
    stakes[bestIdx] = (stakes[bestIdx] ?? 0) + 100;
    used += 100;
  }
  return stakes;
}

function buildTicket(
  type: "馬連" | "3連複",
  comboHorseIds: string[][],
  names: Map<string, string>,
  probMap: Map<string, number>,
  budget: number,
  antiGami: boolean,
  note: string,
): BetTicket {
  const oddsList = comboHorseIds.map((ids) => estimateComboOdds(type, ids.map((id) => probMap.get(id) ?? 0.001)));
  const weights = antiGami ? oddsList.map((odds) => 1 / Math.max(1, odds)) : oddsList.map(() => 1);
  const stakes = distributeBudget(weights, budget);
  const items: BetItem[] = comboHorseIds
    .map((ids, idx) => {
      const combo = ids.map((id) => names.get(id) ?? id).join(" - ");
      const stake = stakes[idx] ?? 0;
      const estimatedOdds = oddsList[idx]!;
      const estimatedReturn = Math.round(stake * estimatedOdds);
      return { combo, stake, estimatedOdds, estimatedReturn };
    })
    .filter((item) => item.stake > 0);
  const totalStake = items.reduce((s, i) => s + i.stake, 0);
  const minEstimatedReturn = items.length > 0 ? Math.min(...items.map((i) => i.estimatedReturn)) : 0;
  const maxEstimatedReturn = items.length > 0 ? Math.max(...items.map((i) => i.estimatedReturn)) : 0;
  return {
    type,
    items,
    points: items.length,
    totalStake,
    note,
    minEstimatedReturn,
    maxEstimatedReturn,
  };
}

export function buildBetPlan(
  sorted: HorseScoreResult[],
  horses: readonly HorseAbility[],
  condition: RaceCondition,
  mode: BetMode,
  budget: number,
  antiGami: boolean = false,
): BetPlan | null {
  const targets = validTargets(sorted, horses);
  const axis = selectAxis(targets);
  if (axis == null) return null;
  const names = horseNameMap(horses);
  const horseMap = new Map(horses.map((h) => [h.horseId, h] as const));
  const others = targets
    .filter((r) => r.horseId !== axis.horseId)
    .sort((a, b) => {
      const ha = horseMap.get(a.horseId);
      const hb = horseMap.get(b.horseId);
      if (!ha || !hb) return 0;
      return paceAdaptiveScore(hb, b, condition) - paceAdaptiveScore(ha, a, condition);
    });
  const umarenCount = mode === "conservative" ? 3 : 5;
  const sanrenCount = mode === "conservative" ? 4 : 6;
  const umarenTargets = others.slice(0, umarenCount);
  const sanrenTargets = others.slice(0, sanrenCount);

  const umarenCombos = umarenTargets.map((r) => [axis.horseId, r.horseId]);
  const sanrenCombos: string[][] = [];
  for (let i = 0; i < sanrenTargets.length; i += 1) {
    for (let j = i + 1; j < sanrenTargets.length; j += 1) {
      sanrenCombos.push([axis.horseId, sanrenTargets[i]!.horseId, sanrenTargets[j]!.horseId]);
    }
  }

  const budgetSafe = Math.max(1000, budget);
  const umarenRatio = mode === "conservative" ? 0.6 : 0.35;
  const sanrenRatio = mode === "conservative" ? 0.4 : 0.65;
  const probMap = normalizedWinProbabilities(targets, horses);
  const tickets: BetTicket[] = [
    buildTicket(
      "馬連",
      umarenCombos,
      names,
      probMap,
      Math.round(budgetSafe * umarenRatio),
      antiGami,
      mode === "conservative"
        ? "本命軸の取りこぼしを抑える守備的な流しです。"
        : "相手を広げて中穴まで拾う攻撃的な流しです。",
    ),
    buildTicket(
      "3連複",
      sanrenCombos,
      names,
      probMap,
      Math.round(budgetSafe * sanrenRatio),
      antiGami,
      mode === "conservative"
        ? "軸1頭固定で点数を絞り、回収の安定を重視します。"
        : "軸1頭で相手を広げ、高配当レンジを狙う構成です。",
    ),
  ];
  const totalStake = tickets.reduce((sum, t) => sum + t.totalStake, 0);

  return {
    axisHorse: axis,
    mode,
    antiGami,
    budget: budgetSafe,
    tickets,
    totalStake,
    remaining: Math.max(0, budgetSafe - totalStake),
  };
}
