import {
  ABILITY_KEYS,
  ABILITY_LABELS,
  type AbilityKey,
  type HorseAbility,
  type PastRunRecord,
  type HorseScoreResult,
  type InvestmentCommentInput,
  type RaceCondition,
  type WeightSet,
} from "./abilityTypes";
import type { AbilityGradeRow } from "./abilityGrades";
import {
  BIAS_ADJUSTMENTS,
  GROUND_ADJUSTMENTS,
  PACE_ADJUSTMENTS,
} from "./adjustments";
import { topAbilityKeysByFinalWeight, weightsToDemand0to100 } from "./fitScore";
import { BUY_LABELS } from "./lingoConstants";
import { computePaceFitLevel } from "./paceFit";
import { getBaseWeights, getFinalWeights } from "./weightResolver";
import { extractStrongAbilities } from "./strongAbilities";

function topAbilityKeysByWeight(weights: WeightSet, take: number): AbilityKey[] {
  const ranked = [...ABILITY_KEYS].sort((a, b) => weights[b] - weights[a]);
  return ranked.slice(0, take);
}

function formatStrongOverlap(
  strong: AbilityKey[],
  emphasized: AbilityKey[],
): string {
  const labels = strong.filter((k) => emphasized.includes(k)).map((k) => ABILITY_LABELS[k]);
  if (labels.length === 0) {
    return emphasized.map((k) => ABILITY_LABELS[k]).slice(0, 2).join("と");
  }
  return labels.join("と");
}

function formatStrongWeakness(strong: AbilityKey[], deemphasized: AbilityKey[]): string {
  const hit = strong.filter((k) => deemphasized.includes(k));
  if (hit.length === 0) return "";
  return hit.map((k) => ABILITY_LABELS[k]).join("と");
}

function weightDeltaVsBase(
  condition: RaceCondition,
  finalWeights: WeightSet,
): Record<AbilityKey, number> {
  const base = getBaseWeights(condition);
  const delta: Record<AbilityKey, number> = {
    speed: 0,
    stamina: 0,
    kick: 0,
    sustain: 0,
    power: 0,
  };
  for (const k of ABILITY_KEYS) {
    delta[k] = finalWeights[k] - base[k];
  }
  return delta;
}

function risingAbilities(delta: Record<AbilityKey, number>): AbilityKey[] {
  return ABILITY_KEYS.filter((k) => delta[k] > 0.001).sort((a, b) => delta[b] - delta[a]);
}

function fallingAbilities(delta: Record<AbilityKey, number>): AbilityKey[] {
  return ABILITY_KEYS.filter((k) => delta[k] < -0.001).sort((a, b) => delta[a] - delta[b]);
}

function clipReason(s: string, max: number = 200): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function appendScoreDecomposition(result: HorseScoreResult, body: string): string {
  const d = result.conditionFitDelta;
  const sign = d >= 0 ? "+" : "";
  const tail = `〔内訳〕基礎(ブレンド) ${result.baseAbilityCore.toFixed(1)}、調整後基礎 ${result.intrinsicAbilityScore.toFixed(1)}、条件適性差 ${sign}${d.toFixed(1)} → 補正後 ${result.adjustedScore.toFixed(1)}、合成素点 ${result.raceAdjustedInput.toFixed(1)}（相対 ${result.raceRelativeScore.toFixed(1)} / 最終 ${result.finalEvaluationScore.toFixed(1)}）`;
  return clipReason(`${body}\n${tail}`, 260);
}

function formatSigned(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}`;
}

export function generateScoreReason(
  result: HorseScoreResult,
  condition: RaceCondition,
  finalWeights: WeightSet,
): string {
  const br = result.baseRank ?? 0;
  const fr = result.finalRank ?? result.adjustedRank ?? 0;
  const rankDelta = br - fr;
  const biasLabel = BIAS_ADJUSTMENTS[condition.bias]?.label ?? "";
  const paceLabel = PACE_ADJUSTMENTS[condition.pace]?.label ?? "";
  const groundLabel = GROUND_ADJUSTMENTS[condition.ground]?.label ?? "";

  const deltaW = weightDeltaVsBase(condition, finalWeights);
  const upKeys = risingAbilities(deltaW);
  const downKeys = fallingAbilities(deltaW);
  const topFinal = topAbilityKeysByWeight(finalWeights, 3);

  const smallChange =
    Math.abs(result.scoreDiff) < 0.5 && Math.abs(rankDelta) <= 1;

  if (smallChange) {
    return appendScoreDecomposition(
      result,
      `補正の順位・得点差は小さく、大きな不利材料は出ていません。`,
    );
  }

  if (rankDelta > 0) {
    const overlap = formatStrongOverlap(
      result.strongAbilities,
      upKeys.length ? upKeys : topFinal,
    );
    return appendScoreDecomposition(
      result,
      `${br}位→${fr}位。${groundLabel}・${biasLabel}・${paceLabel}で${overlap}側が相対的に上乗せ。`,
    );
  }

  if (rankDelta < 0) {
    const weakPart = formatStrongWeakness(
      result.strongAbilities,
      downKeys.length ? downKeys : fallingAbilities(deltaW),
    );
    const part = weakPart !== "" ? `求め方が外れた${weakPart}が響き、` : "求め方の変化で、";
    return appendScoreDecomposition(result, `${br}位→${fr}位。${part}スコアを引き下げ。`);
  }

  return appendScoreDecomposition(
    result,
    `順位は同程度。${groundLabel}・${biasLabel}分で得点${result.scoreDiff >= 0 ? "は微増" : "を微減"}`,
  );
}

/** 今回向き枠用：能力×向き重み（40〜60文字前後、馬ごと） */
export function buildFitSupplementLine(horse: HorseAbility, condition: RaceCondition): string {
  const finalW = getFinalWeights(condition);
  const demand = weightsToDemand0to100(finalW);
  const top2 = topAbilityKeysByFinalWeight(finalW, 2);
  const a = top2[0]!;
  const b = top2[1]!;
  const da = (demand[a] ?? 0) - horse[a];
  const db = (demand[b] ?? 0) - horse[b];
  let line: string;
  if (da >= 15 && da >= db) {
    line = `今回の上乗せ中心である${ABILITY_LABELS[a]}に、持ち点が少し足りにくい。`;
  } else if (db >= 15) {
    line = `${ABILITY_LABELS[b]}面で今回重みに対して薄く、隙が出やすい。`;
  } else if (da < -5 || db < -5) {
    line = "重みが寄った能力と、値の乗りが近く噛み合いやすい枠。";
  } else {
    line = "上乗せ軸とのズレは限定的。好材料・悪材料の両方を抑え目に。";
  }
  if (line.length > 60) return line.slice(0, 60);
  if (line.length < 20) {
    return line; // 最低限の分量確保
  }
  return line;
}

/** 条件×馬の一致点1行（判断に直結。全文馬固有に寄せる） */
export function buildEvaluationCardSummaryLine(
  horse: HorseAbility,
  condition: RaceCondition,
): string {
  const finalW = getFinalWeights(condition);
  const top2 = topAbilityKeysByFinalWeight(finalW, 2);
  const strong = extractStrongAbilities(horse);
  const overlap = top2.filter((k) => strong.includes(k));
  if (overlap.length >= 1) {
    const t = `強めの${overlap
      .map((k) => ABILITY_LABELS[k])
      .join("・")}が、今回上乗せ先頭と同じ。`;
    return t.length > 60 ? t.slice(0, 60) : t;
  }
  return `上乗せ主軸は主に${ABILITY_LABELS[top2[0]!]}。直結は末脚等の抜きより総合。`.slice(
    0,
    60,
  );
}

export type HorseShortComment = {
  label: string;
  conclusion: string;
  scenario: string;
  past: string;
  scoring: string;
  tone: "top" | "rival" | "single" | "cover" | "dismiss";
};

export type ScoreReasonBrief = {
  headline: string;
  detail: string;
};

export type StructuredShortReviewInput = {
  expected_popularity: string;
  system_rank: string;
  buy_label: string;
  top_bonuses: string | string[];
  lap_fit: string;
  core_ability: string;
};

function normalizeTopBonuses(topBonuses: string | string[]): string[] {
  const items = Array.isArray(topBonuses) ? topBonuses : [topBonuses];
  return items.map((v) => v.trim()).filter((v) => v.length > 0).slice(0, 2);
}

function ensureLengthRange(text: string, buyLabel: string): string {
  const min = 80;
  const max = 120;
  if (text.length >= min && text.length <= max) return text;
  const fillers = buyLabel.includes("危険")
    ? ["過剰人気には注意が必要です。", "過信は禁物です。"]
    : buyLabel.includes("大穴") || buyLabel.includes("穴")
      ? ["人気盲点の妙味は十分です。", "高配当狙いで一考できます。"]
      : ["信頼度は高い水準です。", "馬券戦略に組み込みやすい評価です。"];
  let out = text;
  let idx = 0;
  while (out.length < min) {
    out += fillers[idx % fillers.length];
    idx += 1;
  }
  if (out.length <= max) return out;
  const clipped = out.slice(0, max);
  const lastPunctuation = Math.max(clipped.lastIndexOf("。"), clipped.lastIndexOf("、"));
  const body = lastPunctuation >= 60 ? clipped.slice(0, lastPunctuation + 1) : clipped.slice(0, max - 1) + "。";
  return body;
}

/** 指示書準拠の3段構成短評（80〜120文字） */
export function buildStructuredShortReview(input: StructuredShortReviewInput): string {
  const bonusList = normalizeTopBonuses(input.top_bonuses);
  const bonusText = bonusList.length > 0 ? bonusList.join("と") : "評価項目の総合点";
  const hook = `想定${input.expected_popularity}ですが、システム評価は${input.system_rank}です。`;
  const dangerTone = input.buy_label.includes("危険");
  const longshotTone = input.buy_label.includes("大穴") || input.buy_label.includes("穴");
  const lapText = input.lap_fit === "判定不能" ? "ラップ適性は判定不能" : `${input.lap_fit}ラップ適性`;
  const rationale = dangerTone
    ? `最大要因は${bonusText}の減点で、${lapText}も強調できません。`
    : `最大要因は${bonusText}で、${lapText}が評価を押し上げます。`;
  const conclusion = dangerTone
    ? `能力は${input.core_ability}でも、${input.buy_label}として慎重に構えるべきです。`
    : longshotTone
      ? `能力は${input.core_ability}で、${input.buy_label}として高配当狙いで積極的に買えます。`
      : `能力は${input.core_ability}で、${input.buy_label}として軸候補に据えられます。`;
  return ensureLengthRange(`${hook}${rationale}${conclusion}`, input.buy_label);
}

const VALUE_RANK_PHRASE: Record<InvestmentCommentInput["valueRank"], string> = {
  S: "明確に割安です",
  A: "市場評価が追いついていません",
  B: "過小評価されています",
  C: "適正圏です",
  D: "人気との乖離が大きい割高です",
};

const BET_TYPE_PHRASE: Record<InvestmentCommentInput["betType"], string> = {
  軸: "軸として検討できる水準で",
  相手: "相手としては十分狙える一頭で",
  ヒモ穴: "リターン狙いで押さえたい存在で",
  見送り: "積極的に手を出す根拠は薄く",
};

const VALUE_CHANGE_PHRASE: Record<InvestmentCommentInput["valueChange"], string> = {
  UP: "オッズ上昇により妙味も拡大しています",
  DOWN: "オッズ下落により妙味は低下し続けています",
  STABLE: "現在の評価水準を維持しています",
};

function compactFragment(text: string, max: number = 12): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

export function buildInvestmentShortReview(input: InvestmentCommentInput): string {
  const probabilityPct = Math.round(input.predictedProbability * 100);
  const oddsLabel = input.oddsSource === "actual" ? "実オッズ" : "推定オッズ";
  const sentence1 = `3着内${probabilityPct}%で取りこぼし余地は残り、${oddsLabel}${input.actualOdds.toFixed(1)}倍はAIの期待水準より${VALUE_RANK_PHRASE[input.valueRank]}。`;
  const keys = input.keyFactors.slice(0, 2).map((f) => compactFragment(f, 10));
  const keyText = keys.length > 0 ? keys.join("と") : "比較材料";
  const risk = compactFragment(input.riskFactors[0] ?? "展開不一致", 12);
  let sentence2 = `${keyText}は能力上位評価材料ですが、一方で${risk}でパフォーマンスを落とすリスクが残ります。`;
  const sentence3 = `${BET_TYPE_PHRASE[input.betType]}、${VALUE_CHANGE_PHRASE[input.valueChange]}。`;
  let text = `${sentence1}${sentence2}${sentence3}`;
  if (text.length > 120) {
    sentence2 = `${keyText}は上位評価材料ですが、一方で${risk}で失速リスクが残ります。`;
    text = `${sentence1}${sentence2}${sentence3}`;
  }
  if (text.length > 120) {
    sentence2 = `上位評価材料はありますが、一方で${risk}で失速リスクが残ります。`;
    text = `${sentence1}${sentence2}${sentence3}`;
  }
  if (text.length > 120) {
    sentence2 = `${keyText}は上位評価、反面${risk}で失速リスク。`;
    text = `${sentence1}${sentence2}${sentence3}`;
  }
  if (text.length > 120) {
    sentence2 = `反面${risk}で失速リスク。`;
    text = `${sentence1}${sentence2}${sentence3}`;
  }
  if (text.length < 80) {
    text = `${text}過信は禁物です。`;
  }
  if (input.oddsSource !== "actual" && text.length <= 112) {
    text = `${text}実オッズ未取得です。`;
  }
  return text;
}

function oddsPopularityLabel(horse: HorseAbility, horses: readonly HorseAbility[]): string {
  const myOdds = horse.signals?.winOdds;
  if (myOdds == null || !Number.isFinite(myOdds) || myOdds <= 0) return "人気不明";
  const odds = horses
    .map((h) => h.signals?.winOdds)
    .filter((o): o is number => o != null && Number.isFinite(o) && o > 0)
    .sort((a, b) => a - b);
  if (odds.length === 0) return "人気不明";
  const rank = odds.findIndex((o) => o >= myOdds - 1e-6) + 1;
  return rank <= 0 ? "人気不明" : `${rank}番人気`;
}

function inferTopBonuses(horse: HorseAbility, result: HorseScoreResult): string[] {
  const bonuses: string[] = [];
  const jockeyWin = horse.signals?.jockeyCourseWinRate01 ?? 0;
  const trainerWin = horse.signals?.trainerCourseWinRate01 ?? 0;
  if (jockeyWin >= 0.25) bonuses.push(`騎手コース勝率${(jockeyWin * 100).toFixed(1)}%`);
  if (trainerWin >= 0.25) bonuses.push(`厩舎コース勝率${(trainerWin * 100).toFixed(1)}%`);
  const contextual = [
    { key: "血統適性", v: result.pedigreeBonus ?? 0 },
    { key: "枠順バイアス", v: result.gateBiasBonus ?? 0 },
    { key: "枠順×脚質シナジー", v: result.gateStyleSynergyBonus ?? 0 },
    { key: "陣営評価", v: result.connectionsBonus ?? 0 },
    { key: "傾向評価", v: result.trendBonus ?? 0 },
    { key: "前後傾適性", v: result.paceBalanceBonus ?? 0 },
    { key: "不利恩恵", v: result.tripContextBonus ?? 0 },
  ].sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  for (const p of contextual) {
    if (Math.abs(p.v) < 0.8) continue;
    bonuses.push(`${p.key}${p.v >= 0 ? "加点" : "減点"}`);
    if (bonuses.length >= 2) break;
  }
  if (bonuses.length === 0) bonuses.push("総合能力バランス");
  return bonuses.slice(0, 2);
}

function inferCoreAbility(horse: HorseAbility, grades?: AbilityGradeRow): string {
  const top2 = [...ABILITY_KEYS].sort((a, b) => horse[b] - horse[a]).slice(0, 2);
  const left = top2[0] ? `${ABILITY_LABELS[top2[0]]}${grades?.[top2[0]] ?? ""}` : "総合";
  const right = top2[1] ? `${ABILITY_LABELS[top2[1]]}${grades?.[top2[1]] ?? ""}` : "能力";
  return `${left}・${right}`;
}

function inferLapFitLabel(result: HorseScoreResult, condition: RaceCondition): string {
  const lapTotal =
    (result.lapShapeFitBonus ?? 0) +
    (result.raceAnalysisBonus ?? 0) +
    (result.lapSustainBonus ?? 0) +
    (result.lapQualityBonus ?? 0);
  if ((condition.section200mSec?.length ?? 0) < 4 && Math.abs(lapTotal) < 0.1) return "判定不能";
  return result.lapProfile;
}

/** 既存評価結果を指示書形式の入力へ変換し短評を生成 */
export function buildHorseAiShortReview(
  horse: HorseAbility,
  result: HorseScoreResult,
  condition: RaceCondition,
  horses: readonly HorseAbility[],
  grades?: AbilityGradeRow,
  labelOverride?: string,
): string {
  if (horse.investment != null) {
    return buildInvestmentShortReview(horse.investment);
  }
  const systemRank = result.finalRank ?? result.adjustedRank ?? 99;
  return buildStructuredShortReview({
    expected_popularity: oddsPopularityLabel(horse, horses),
    system_rank: `${systemRank}位`,
    buy_label: labelOverride ?? result.buyLabel,
    top_bonuses: inferTopBonuses(horse, result),
    lap_fit: inferLapFitLabel(result, condition),
    core_ability: inferCoreAbility(horse, grades),
  });
}

function topAbilityKey(horse: HorseAbility): AbilityKey {
  return ABILITY_KEYS.reduce((best, key) => (horse[key] > horse[best] ? key : best), ABILITY_KEYS[0]!);
}

function scenarioFitWord(horse: HorseAbility, condition: RaceCondition): string {
  const fit = computePaceFitLevel(horse, condition);
  if (fit === "◎") return "展開直結";
  if (fit === "○") return "展開合う";
  if (fit === "△") return "展開待ち";
  return "展開逆風";
}

function summarizeSinglePastRun(run?: PastRunRecord): string {
  if (!run) return "データ不足で評価保留。";
  const place = run.place;
  const margin = run.marginToWinnerSec;
  if (margin != null && margin >= 1.5) {
    return `前走は度外視（着差${margin.toFixed(1)}秒）。`;
  }
  if (place != null && place > 0 && place <= 3) {
    return `前走は高評価（${place}着）。`;
  }
  if (place != null && place > 0) {
    return `前走は評価可能（${place}着）。`;
  }
  return "前走は着順不明で判定保留。";
}

function summarizeScoringByComponents(result: HorseScoreResult): string {
  const contextual =
    (result.pedigreeBonus ?? 0) +
    (result.gateBiasBonus ?? 0) +
    (result.gateStyleSynergyBonus ?? 0) +
    (result.connectionsBonus ?? 0) +
    (result.trendBonus ?? 0) +
    (result.paceBalanceBonus ?? 0) +
    (result.tripContextBonus ?? 0);
  const variancePenalty = Math.max(
    0,
    result.raceRelativeScore +
      result.paceFitBonus +
      result.lapShapeFitBonus +
      (result.raceAnalysisBonus ?? 0) +
      result.lapSustainBonus +
      result.lapQualityBonus +
      result.distanceFitBonus +
      result.classLevelBonus +
      result.stepPatternBonus +
      contextual -
      result.finalEvaluationScore,
  );
  return `相対${result.raceRelativeScore.toFixed(1)}を土台に、展開${formatSigned(
    result.paceFitBonus,
  )}・距離${formatSigned(result.distanceFitBonus)}・格${formatSigned(
    result.classLevelBonus + result.stepPatternBonus,
  )}・文脈${formatSigned(contextual)}・分散-${variancePenalty.toFixed(1)}で最終${result.finalEvaluationScore.toFixed(
    1,
  )}。`;
}

/** 馬カードの短評（3層構造：結論 / 展開 / 過去走） */
export function buildHorseShortComment(
  horse: HorseAbility,
  result: HorseScoreResult,
  condition: RaceCondition,
): HorseShortComment {
  const maxKey = topAbilityKey(horse);
  const paceLabel = PACE_ADJUSTMENTS[condition.pace]?.label ?? "ミドル";
  const biasLabel = BIAS_ADJUSTMENTS[condition.bias]?.label ?? "フラット";
  const fitWord = scenarioFitWord(horse, condition);
  const orderRank = result.finalRank ?? result.adjustedRank ?? 99;
  const deltaText = formatSigned(result.conditionFitDelta);

  const past = result.pastRunInsight
    ? `前走: ${summarizeSinglePastRun(horse.pastRuns?.[0])} ${result.pastRunInsight}`
    : `前走: ${summarizeSinglePastRun(horse.pastRuns?.[0])}`;

  if (result.buyLabel === BUY_LABELS.DISMISS) {
    return {
      label: "【消し】",
      conclusion: "消し",
      scenario: `${paceLabel}想定・${biasLabel}で${horse.runningStyle}は逆風。${ABILITY_LABELS[maxKey]}優位を活かし切りにくい。`,
      past,
      scoring: summarizeScoringByComponents(result),
      tone: "dismiss",
    };
  }
  if (result.buyLabel === BUY_LABELS.FAVORITE) {
    return {
      label: "【勝ち負け】",
      conclusion: "勝ち負け濃厚",
      scenario: `${paceLabel}想定・${biasLabel}で${horse.runningStyle}は${fitWord}。${ABILITY_LABELS[maxKey]}で条件適性差${deltaText}。`,
      past,
      scoring: summarizeScoringByComponents(result),
      tone: "top",
    };
  }
  if (result.buyLabel === BUY_LABELS.RIVAL) {
    return {
      label: "【頭候補】",
      conclusion: "展開ハマれば頭",
      scenario: `${paceLabel}想定・${biasLabel}で${horse.runningStyle}は${fitWord}。順位${orderRank}位で逆転余地あり。`,
      past,
      scoring: summarizeScoringByComponents(result),
      tone: "rival",
    };
  }
  if (result.buyLabel === BUY_LABELS.TAN) {
    return {
      label: "【展開待ち】",
      conclusion: "連下以上",
      scenario: `${paceLabel}想定・${biasLabel}で${horse.runningStyle}は${fitWord}。${ABILITY_LABELS[maxKey]}がハマれば浮上。`,
      past,
      scoring: summarizeScoringByComponents(result),
      tone: "single",
    };
  }
  return {
    label: "【連下】",
    conclusion: "連下まで",
    scenario: `${paceLabel}想定・${biasLabel}で${horse.runningStyle}は${fitWord}。強調軸は${ABILITY_LABELS[maxKey]}。`,
    past,
    scoring: summarizeScoringByComponents(result),
    tone: "cover",
  };
}

/** カード上で使う点数理由（数値根拠の要約） */
export function buildScoreReasonBrief(result: HorseScoreResult): ScoreReasonBrief {
  const pace = result.paceFitBonus ?? 0;
  const lap = result.lapShapeFitBonus ?? 0;
  const lapStored = result.raceAnalysisBonus ?? 0;
  const lapSustain = result.lapSustainBonus ?? 0;
  const lapQuality = result.lapQualityBonus ?? 0;
  const dist = result.distanceFitBonus ?? 0;
  const cls = result.classLevelBonus ?? 0;
  const step = result.stepPatternBonus ?? 0;
  const pedigree = result.pedigreeBonus ?? 0;
  const gate = result.gateBiasBonus ?? 0;
  const gateStyle = result.gateStyleSynergyBonus ?? 0;
  const connections = result.connectionsBonus ?? 0;
  const trend = result.trendBonus ?? 0;
  const paceBalance = result.paceBalanceBonus ?? 0;
  const trip = result.tripContextBonus ?? 0;
  const contextual = pedigree + gate + gateStyle + connections + trend + paceBalance + trip;
  const paceText =
    pace >= 1.0 ? "展開がハマって加点" : pace <= -1.0 ? "展開が噛み合わず減点" : "展開影響は小さい";
  const lapSum = lap + lapStored + lapSustain + lapQuality;
  const lapText =
    lapSum >= 1.2
      ? "ラップ適性あり"
      : lapSum <= -0.8
        ? "ラップ適性が弱い"
        : "ラップ適性は中立";
  const scoreText =
    result.finalEvaluationScore >= 70
      ? "総合評価は高い"
      : result.finalEvaluationScore >= 60
        ? "総合評価は中位"
        : "総合評価は抑えまで";
  const strong = result.strongAbilities[0] ? ABILITY_LABELS[result.strongAbilities[0]] : "総合力";

  const headline = `${paceText}・${lapText}。${scoreText}。`;
  const detail = `根拠: 相対${result.raceRelativeScore.toFixed(1)} + 展開${formatSigned(pace)} + ラップ${formatSigned(lapSum)} + 距離${formatSigned(dist)} + 実績${formatSigned(cls + step)} + 文脈補正${formatSigned(contextual)} = 最終${result.finalEvaluationScore.toFixed(1)}（強み: ${strong}）`;
  return { headline, detail };
}

/**
 * 一覧テーブル用の1行短評。
 * 「前走N着(X秒差) · 展開◎ · 末脚が武器」形式でユーザーが馬の強さを即判断できる。
 */
export function buildOneLineComment(
  horse: HorseAbility,
  _result: HorseScoreResult,
  condition: RaceCondition,
): string {
  const parts: string[] = [];

  // 前走結果
  const run0 = horse.pastRuns?.[0];
  const run1 = horse.pastRuns?.[1];
  if (run0) {
    const place = run0.place;
    const margin = run0.marginToWinnerSec;
    if (place != null && place > 0) {
      const marStr =
        place === 1
          ? "1着"
          : margin != null && Number.isFinite(margin)
            ? `${place}着(${margin.toFixed(1)}秒差)`
            : `${place}着`;
      // 前々走もある場合、連続好走 or 連続凡走をチェック
      if (run1?.place != null) {
        const good0 = place <= 3 || (margin != null && margin <= 0.5);
        const good1 = run1.place <= 3 || ((run1.marginToWinnerSec ?? 99) <= 0.5);
        if (good0 && good1) {
          parts.push(`前2走好走(${place}着・${run1.place}着)`);
        } else if (!good0 && !good1) {
          parts.push(`前2走低調(${place}着・${run1.place}着)`);
        } else {
          parts.push(`前走${marStr}`);
        }
      } else {
        parts.push(`前走${marStr}`);
      }
    }
  } else {
    parts.push("前走データなし");
  }

  // 展開適合
  const paceFit = computePaceFitLevel(horse, condition);
  const paceFitLabel: Record<string, string> = {
    "◎": "展開◎向く",
    "○": "展開○合う",
    "△": "展開△待ち",
    "×": "展開×逆風",
  };
  parts.push(paceFitLabel[paceFit] ?? "");

  // 強みの軸
  const strong = extractStrongAbilities(horse);
  const finalW = getFinalWeights(condition);
  const topCondKey = topAbilityKeysByWeight(finalW, 1)[0];
  if (strong.length > 0) {
    const hit = strong.find((k) => k === topCondKey);
    if (hit) {
      parts.push(`${ABILITY_LABELS[hit]}が今回条件にも直結`);
    } else {
      parts.push(`${ABILITY_LABELS[strong[0]!]}が武器`);
    }
  }

  return parts.filter(Boolean).join(" · ");
}

/** 消し候補ブロック用の短い根拠（根拠は全「消し」で共通） */
export function getDismissContextLine(condition: RaceCondition): string {
  if (condition.bias === "front_favor") {
    return "前残りで末脚差が出にくい想定。";
  }
  if (condition.bias === "closer_favor") {
    return "差しで前目負担が出やすい想定。";
  }
  if (condition.ground === "slow_track") {
    return "時計がかかる想定。瞬発中心は消耗に振りやすい。";
  }
  if (condition.ground === "yielding" || condition.ground === "heavy" || condition.ground === "bad") {
    return "重い馬場。パワーとスタミナ差が出やすい。";
  }
  if (condition.ground === "fast_track") {
    return "高速想定。持続とパワー差が出やすい。";
  }
  return "重み上、相対的に上乗せしにくい型。";
}
