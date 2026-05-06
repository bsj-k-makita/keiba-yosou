function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

function toRank(values) {
  const sorted = values
    .map((v, i) => ({ v, i }))
    .sort((a, b) => b.v - a.v);
  const rank = new Array(values.length).fill(1);
  for (let i = 0; i < sorted.length; i += 1) rank[sorted[i].i] = i + 1;
  return rank;
}

/**
 * 能力値からベーススコアを算出する。
 * コース/バイアス条件に応じたウェイトを適用し、
 * ゲートバイアス補正を Softmax 前のスコアに直接加算する。
 *
 * @param entry 馬エントリ
 * @param gateBonus 枠バイアスによる加算ポイント（例: 内有利時に内枠馬へ +2.5）
 */
function scoreFromAbilities(entry, gateBonus = 0) {
  const ab = entry?.abilities ?? {};
  const speed = Number(ab.speed ?? 50);
  const stamina = Number(ab.stamina ?? 50);
  const kick = Number(ab.kick ?? 50);
  const sustain = Number(ab.sustain ?? 50);
  const power = Number(ab.power ?? 50);
  const base = speed * 0.28 + stamina * 0.22 + kick * 0.2 + sustain * 0.18 + power * 0.12;
  return base + gateBonus;
}

/**
 * Softmax 変換。温度パラメータ T で評価差の鋭さを制御する。
 * T が小さいほど上位馬に確率が集中する（強い補正時に使用）。
 * - T=8（デフォルト）: 標準的な分布
 * - T=6（補正強度「強」時）: 評価差をより鋭く確率に反映
 *
 * @param values スコア配列
 * @param temperature 温度パラメータ（デフォルト: 8）
 */
function softmax(values, temperature = 8) {
  if (values.length === 0) return [];
  const T = Math.max(1, temperature); // 最小1で数値安定性を確保
  const max = Math.max(...values);
  const exps = values.map((v) => Math.exp((v - max) / T));
  const sum = exps.reduce((s, v) => s + v, 0);
  if (sum <= 0) return values.map(() => 1 / values.length);
  return exps.map((v) => v / sum);
}

function parseNumeric(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeSource(value) {
  const s = String(value ?? "").toLowerCase();
  if (s === "actual") return "actual";
  if (s === "estimated") return "estimated";
  return "unknown";
}

function hasObservedTimestamp(v) {
  return typeof v === "string" && v.length >= 10;
}

// ベースマージン（控除率・予測誤差の安全バッファ）
const EV_MARGIN = 0.15;
// フラクショナルケリー係数（0.25 = クォーターケリー）
const KELLY_FRACTION = 0.25;
// ケリー比率の上限（全資金の25%まで）
const KELLY_MAX = 0.25;

/**
 * 動的EVマージンを計算する。
 * レースの不確実性・信頼性に応じてベースマージン(0.15)を変動させる。
 *
 * 基準:
 *   新馬・未勝利戦  → 0.20（過去実績なし・予測困難）
 *   重賞 G1/G2/G3   → 0.10（データ蓄積・信頼性高）
 *   その他（一般戦） → 0.15（デフォルト）
 * 追加加算:
 *   多頭数（16頭以上） → +0.05（競馬場のランダム性増大）
 * 詳細補正割引:
 *   詳細補正（馬場・時計・展開・バイアス）を複数設定した場合、
 *   相場観の精度が上がったとみなしてマージンを微減（最小 0.08）。
 *
 * @param raceInfo レース情報オブジェクト
 * @param fieldSize 出走頭数
 * @param condition レース条件（補正設定数の計算に使用）
 */
function calcDynamicEvMargin(raceInfo, fieldSize, condition) {
  const raceName = String(raceInfo?.raceName ?? "");
  const raceGrade = String(raceInfo?.raceGrade ?? "");

  let margin = EV_MARGIN; // デフォルト 0.15

  // 新馬・未勝利戦: 過去実績データが少なくリスク高
  if (raceName.includes("新馬") || raceName.includes("未勝利")) {
    margin = 0.20;
  }
  // 重賞（G1/G2/G3）: データ蓄積が厚く予測精度が高い
  else if (raceGrade === "G1" || raceGrade === "G2" || raceGrade === "G3") {
    margin = 0.10;
  }

  // 多頭数（16頭以上）: 混雑・ロス・偶発的事故のリスクが上がる
  if (Number.isFinite(fieldSize) && fieldSize >= 16) {
    margin += 0.05;
  }

  // 詳細補正割引: ユーザーが複数の条件を設定するほどマージンを削減
  // 相場観の精度が上がり、モデルと市場の乖離を正確に見積もれると判断
  if (condition != null) {
    let detailCount = 0;
    const ground = String(condition.ground ?? "good");
    const trackSpeed = String(condition.trackSpeed ?? "standard");
    const bias = String(condition.bias ?? "flat");
    const pace = String(condition.pace ?? "middle");
    const userTrackBias = parseNumeric(condition.userTrackBias ?? 0) ?? 0;
    const abilityPriority = condition.abilityPriority;

    if (ground !== "good") detailCount++;
    if (trackSpeed !== "standard") detailCount++;
    if (bias !== "flat") detailCount++;
    if (pace !== "middle") detailCount++;
    if (Math.abs(userTrackBias) >= 0.3) detailCount++;
    if (abilityPriority) detailCount++;

    // 1補正につき 0.01 削減（最大 0.06 削減）、下限は 0.08
    if (detailCount >= 2) {
      const discount = Math.min(detailCount * 0.01, 0.06);
      margin = Math.max(0.08, margin - discount);
    }
  }

  // 上限 0.30（極端な値を防止）
  return round2(Math.min(margin, 0.30));
}

/**
 * 実質期待値を計算する。
 * E_effective = (P × O) - Margin
 * margin には calcDynamicEvMargin の返値を渡せる（省略時はデフォルト 0.15）。
 */
function calcEffectiveEv(prob, odds, margin = EV_MARGIN) {
  if (!Number.isFinite(prob) || !Number.isFinite(odds) || odds <= 0) return 0;
  return round2(prob * odds - margin);
}

/**
 * Fractional Kelly 基準による投資比率を算出する。
 * f* = (P × (O-1) - (1-P)) / (O-1) = (P×O - 1) / (O-1)
 * kelly_weight = max(0, f*) × kelly_fraction（上限: KELLY_MAX）
 */
function calcKellyWeight(prob, odds) {
  if (!Number.isFinite(prob) || !Number.isFinite(odds) || odds <= 1.0) return 0;
  const netOdds = odds - 1.0;
  const kellyF = (prob * netOdds - (1 - prob)) / netOdds;
  if (kellyF <= 0) return 0;
  return round2(Math.min(kellyF * KELLY_FRACTION, KELLY_MAX));
}

/**
 * 実質期待値に基づくランク（BettingEvaluator の閾値に準拠）。
 * S: effective_ev >= 1.40（強い買い推奨）
 * A: effective_ev >= 1.10
 * B: effective_ev >= 1.00
 * C: effective_ev >= 0.90（様子見）
 * D: それ以下（見送り）
 */
function toValueRank(effectiveEv) {
  if (effectiveEv >= 1.40) return "S";
  if (effectiveEv >= 1.10) return "A";
  if (effectiveEv >= 1.0) return "B";
  if (effectiveEv >= 0.90) return "C";
  return "D";
}

function toConfidenceRank(p) {
  if (p >= 0.5) return "S";
  if (p >= 0.35) return "A";
  if (p >= 0.22) return "B";
  return "C";
}

function toBetType(p, valueRank) {
  if (valueRank === "D" && p < 0.28) return "見送り";
  if (valueRank === "S" && p < 0.22) return "ヒモ穴";
  if (p >= 0.42 && valueRank !== "D") return "軸";
  if (p >= 0.24 && valueRank !== "D") return "相手";
  if (valueRank === "S") return "ヒモ穴";
  return "見送り";
}

function inferAbilityLabels(entry) {
  const ab = entry?.abilities ?? {};
  const pairs = [
    { key: "speed", label: "先行力", value: Number(ab.speed ?? 50) },
    { key: "stamina", label: "長距離実績", value: Number(ab.stamina ?? 50) },
    { key: "kick", label: "末脚性能", value: Number(ab.kick ?? 50) },
    { key: "sustain", label: "持続力", value: Number(ab.sustain ?? 50) },
    { key: "power", label: "馬場対応力", value: Number(ab.power ?? 50) },
  ].sort((a, b) => b.value - a.value);
  return pairs;
}

function inferRiskLabel(entry) {
  const ab = entry?.abilities ?? {};
  const pairs = [
    { label: "先行力不足", value: Number(ab.speed ?? 50) },
    { label: "スタミナ不安", value: Number(ab.stamina ?? 50) },
    { label: "末脚のキレ負け", value: Number(ab.kick ?? 50) },
    { label: "持続力不足", value: Number(ab.sustain ?? 50) },
    { label: "馬場適性不足", value: Number(ab.power ?? 50) },
  ].sort((a, b) => a.value - b.value);
  return pairs[0]?.label ?? "展開不一致";
}

function estimateOddsByPopularity(rank, fieldSize) {
  if (!Number.isFinite(rank) || rank <= 0) return null;
  const size = Math.max(8, Number(fieldSize) || 12);
  const normalized = clamp(rank / size, 0, 1);
  const minOdds = 1.2;
  const maxOdds = 12 + size * 0.4;
  return round2(minOdds + (maxOdds - minOdds) * Math.pow(normalized, 1.2));
}

function estimatePlaceOdds(entry, fieldSize) {
  const explicitPlace = parseNumeric(entry.actual_odds ?? entry.actualOdds);
  const explicitSourceRawBase = normalizeSource(
    entry.odds_source ??
      entry.oddsSource ??
      entry.actual_odds_source ??
      entry.actualOddsSource,
  );
  const explicitSourceRaw =
    explicitSourceRawBase === "actual"
      ? hasObservedTimestamp(entry.odds_observed_at)
        ? "actual"
        : "estimated"
      : explicitSourceRawBase;
  const explicitSource = explicitSourceRaw === "actual" ? "actual" : "estimated";
  if (explicitPlace != null && explicitPlace > 0) return { odds: explicitPlace, source: explicitSource };
  const winOdds = parseNumeric(
    entry.marketWinOdds ??
      entry.market_win_odds ??
      entry.winOdds ??
      entry?.evaluationSignals?.winOdds ??
      entry?.signals?.winOdds,
  );
  if (winOdds != null && winOdds > 0) {
    return { odds: round2(clamp(winOdds * 0.38, 1.1, 60)), source: "estimated" };
  }
  const popularity = parseNumeric(entry.marketPopularity ?? entry.market_popularity ?? entry.popularityRank);
  const byPopularity = estimateOddsByPopularity(popularity, fieldSize);
  if (byPopularity != null) return { odds: byPopularity, source: "estimated" };
  return null;
}

function computeValueChange(previousOdds, nextOdds) {
  if (!Number.isFinite(previousOdds) || previousOdds <= 0 || !Number.isFinite(nextOdds) || nextOdds <= 0) {
    return "STABLE";
  }
  if (nextOdds >= previousOdds * 1.03) return "UP";
  if (nextOdds <= previousOdds * 0.97) return "DOWN";
  return "STABLE";
}

/**
 * 当日トラックバイアス補正係数（枠番ベース）。
 * userTrackBias: -1=内有利(強) ～ 0=フラット ～ +1=外有利(強)
 * gateNumber: 馬番（1〜18）
 *
 * 計算式: P_corrected = P × BiasMultiplier
 * 内有利(bias<0) → 内枠(1〜3番)に ×1.1〜1.15、外枠に ×0.85〜0.9
 * 外有利(bias>0) → 外枠に ×1.1〜1.15、内枠に ×0.85〜0.9
 */
function calcGateBiasMultiplier(gateNumber, fieldSize, userTrackBias) {
  if (!Number.isFinite(userTrackBias) || Math.abs(userTrackBias) < 0.05) return 1.0;
  if (!Number.isFinite(gateNumber) || gateNumber <= 0) return 1.0;

  const size = Math.max(8, fieldSize || 12);
  // ゲート番号の相対位置（0.0=最内, 1.0=最外）
  const relativePos = (gateNumber - 1) / Math.max(size - 1, 1);

  // 最大補正幅: バイアス強度1.0時に ±15%（内外の差は最大30%）
  const MAX_CORRECTION = 0.15;
  // 内有利(bias<0)なら内枠(relativePos~0)を加点、外枠を減点
  const correction = -userTrackBias * (relativePos - 0.5) * MAX_CORRECTION * 2;

  return clamp(1.0 + correction, 0.75, 1.30);
}

/**
 * 展開バイアス補正係数（脚質ベース）。
 * biasSetting: "front_favor" | "closer_favor" | その他(フラット)
 *
 * 前残り(front_favor) → 逃げ・先行・好位に ×1.10、差し・追込に ×0.90
 * 差し決着(closer_favor) → 差し・追込に ×1.10、逃げ・先行に ×0.90
 */
function calcRunningStyleBiasMultiplier(runningStyle, biasSetting) {
  if (!biasSetting || biasSetting === "flat") return 1.0;
  const frontStyles = new Set(["逃げ", "先行", "好位"]);
  const closerStyles = new Set(["差し", "追込"]);

  if (biasSetting === "front_favor") {
    if (frontStyles.has(runningStyle)) return 1.10;
    if (closerStyles.has(runningStyle)) return 0.90;
  }
  if (biasSetting === "closer_favor") {
    if (closerStyles.has(runningStyle)) return 1.10;
    if (frontStyles.has(runningStyle)) return 0.90;
  }
  return 1.0;
}

/**
 * 人気バイアス（オッズの歪み）補正係数。
 * AI予測確率 > 市場内包確率（1/odds）の場合、過剰人気馬と判定して期待値を減衰。
 *
 * 乖離率 5%超: 最大 10% の減衰（decay 係数 0.90〜1.0）
 * 1倍台の圧倒的人気馬（odds < 2.0 かつ prob > 0.5）にも追加で 5% 減衰。
 */
function calcPopularityBiasDecay(prob, odds) {
  if (!Number.isFinite(prob) || !Number.isFinite(odds) || odds <= 0) return 1.0;

  const impliedProb = 1 / odds; // オッズから逆算した市場の支持確率
  const overConfidence = prob - impliedProb;

  let decay = 1.0;

  // AI確率が市場確率を 5% 超過 → 過剰人気バイアスとして最大 10% 減衰
  if (overConfidence > 0.05) {
    decay = Math.max(0.90, 1.0 - Math.min(overConfidence, 0.20) * 0.5);
  }

  // 1倍台（odds < 2.0）の圧倒的人気馬: さらに 5% 減衰（市場が過剰に収縮）
  if (odds < 2.0 && prob > 0.45) {
    decay = Math.max(0.85, decay - 0.05);
  }

  return decay;
}

/**
 * race JSON 1ファイル分を期待値短評用フィールドで埋める。
 *
 * 拡張ロジック（v2）:
 *   1. 動的EVマージン: レース種別（新馬/重賞等）と頭数に応じてマージンを変動
 *   2. トラックバイアス補正: condition.userTrackBias と脚質バイアスを確率に適用
 *   3. 人気バイアス減衰: 過剰人気馬の期待値を自動的に抑制
 */
export function enrichInvestmentSignalsInRaceData(data) {
  const entries = Array.isArray(data?.entries) ? data.entries : [];
  if (entries.length === 0) return data;

  const fieldSize = entries.length;
  const condition = data.condition ?? {};
  const userTrackBias = parseNumeric(condition.userTrackBias ?? data.userTrackBias) ?? 0;
  const biasSetting = String(condition.bias ?? "flat");
  const adjustmentStrength = String(condition.adjustmentStrength ?? "middle");

  // --- ゲートバイアスのスコア直接加算 ---
  // 「内有利」設定時: 1-3番枠に +2.5pt、「外有利」設定時: 外枠に +2.5pt をSoftmax前スコアに加算
  const GATE_BONUS_PTS = 2.5;
  function calcGateBonusPoints(gateNumber, fieldSize_, userBias) {
    if (Math.abs(userBias) < 0.3) return 0; // 弱いバイアスは加算しない
    const innerGates = 3;
    const outerGates = Math.max(fieldSize_ - 3, 3);
    if (userBias < -0.3) {
      // 内有利: 1-3番枠にボーナス
      return gateNumber <= innerGates ? GATE_BONUS_PTS * Math.abs(userBias) : 0;
    }
    if (userBias > 0.3) {
      // 外有利: 最外3枠にボーナス
      return gateNumber > outerGates ? GATE_BONUS_PTS * Math.abs(userBias) : 0;
    }
    return 0;
  }

  const scores = entries.map((e, i) => {
    const gateNumber = parseNumeric(e.horseNumber ?? e.gate) ?? (i + 1);
    const gateBonus = calcGateBonusPoints(gateNumber, fieldSize, userTrackBias);
    return scoreFromAbilities(e, gateBonus);
  });

  // --- Softmax温度: 補正強度「強」のとき T=6（鋭い評価差）、それ以外は T=8 ---
  const softmaxTemp = adjustmentStrength === "strong" ? 6 : 8;
  const rawProbs = softmax(scores, softmaxTemp);
  const modelRanks = toRank(scores);

  // 1. 動的EVマージン: レース属性 + 詳細補正設定数に応じたマージン計算
  const evMargin = calcDynamicEvMargin(data.raceInfo, fieldSize, condition);

  // 2. トラックバイアス補正: 展開バイアス（脚質）を確率に乗算して再正規化
  // ※枠番バイアスはスコアに直接加算済みのため、ここでは展開バイアスのみ適用
  const biasMultipliers = entries.map((entry) => {
    const styleBias = calcRunningStyleBiasMultiplier(entry.runningStyle, biasSetting);
    return styleBias;
  });

  const rawBiasProbs = rawProbs.map((p, i) => p * biasMultipliers[i]);
  const sumBiasProbs = rawBiasProbs.reduce((s, v) => s + v, 0);
  // バイアス補正済み確率（再正規化）
  const probs = sumBiasProbs > 0 ? rawBiasProbs.map((p) => p / sumBiasProbs) : rawProbs;

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const pWin = probs[i] ?? 1 / entries.length;
    const predictedProbability = round2(clamp(0.1 + pWin * 2.2, 0.08, 0.85));
    const expectedOdds = 1 / Math.max(predictedProbability, 0.05);
    const prevOdds = parseNumeric(entry.actual_odds ?? entry.actualOdds);
    const marketPopularitySourceBase = normalizeSource(
      entry.market_popularity_source ?? entry.marketPopularitySource,
    );
    const marketPopularitySourceRaw =
      marketPopularitySourceBase === "actual"
        ? hasObservedTimestamp(entry.market_observed_at)
          ? "actual"
          : "estimated"
        : marketPopularitySourceBase;
    const hasActualPopularity = marketPopularitySourceRaw === "actual";
    const popularity = hasActualPopularity
      ? Number(entry.marketPopularity ?? entry.market_popularity ?? entry.popularityRank)
      : modelRanks[i];
    const marketWinSourceBase = normalizeSource(
      entry.market_win_odds_source ?? entry.marketWinOddsSource,
    );
    const marketWinSourceRaw =
      marketWinSourceBase === "actual"
        ? hasObservedTimestamp(entry.market_observed_at)
          ? "actual"
          : "estimated"
        : marketWinSourceBase;
    const marketWinOddsRaw = parseNumeric(
      entry.marketWinOdds ??
        entry.market_win_odds ??
        entry.winOdds ??
        entry?.evaluationSignals?.winOdds ??
        entry?.signals?.winOdds,
    );
    const marketWinOdds =
      marketWinSourceRaw === "actual" && marketWinOddsRaw != null && marketWinOddsRaw > 0
        ? round2(marketWinOddsRaw)
        : estimateOddsByPopularity(popularity, fieldSize) ?? round2(clamp(expectedOdds * 2.4, 1.2, 99));
    const marketWinOddsSource =
      marketWinSourceRaw === "actual" && marketWinOddsRaw != null && marketWinOddsRaw > 0
        ? "actual"
        : "estimated";
    const placeOdds = estimatePlaceOdds({ ...entry, marketWinOdds, marketPopularity: popularity }, fieldSize);
    const effectiveOdds = placeOdds?.odds ?? round2(clamp(expectedOdds, 1.1, 40));
    const oddsSource = placeOdds?.source ?? "estimated";

    // 3. 人気バイアス減衰: 過剰人気馬の期待値を抑制
    const popularityDecay = calcPopularityBiasDecay(predictedProbability, effectiveOdds);

    // 実質期待値: 動的マージン + 人気バイアス減衰を適用
    // E_effective = (P × O × decay) - margin
    const valueScore = calcEffectiveEv(predictedProbability * popularityDecay, effectiveOdds, evMargin);
    const valueRank = toValueRank(valueScore);
    // ケリー基準による投資比率（Fractional Kelly 0.25倍）
    const kellyWeight = calcKellyWeight(predictedProbability * popularityDecay, effectiveOdds);
    const confidenceRank = toConfidenceRank(predictedProbability);
    const betType = toBetType(predictedProbability, valueRank);
    const valueChange = computeValueChange(prevOdds, effectiveOdds);
    const abilityLabels = inferAbilityLabels(entry).slice(0, 2).map((p) => p.label);
    const risk = inferRiskLabel(entry);

    entry.predicted_probability = predictedProbability;
    if (oddsSource === "actual") {
      entry.actual_odds = round2(effectiveOdds);
      delete entry.estimated_actual_odds;
    } else {
      delete entry.actual_odds;
      entry.estimated_actual_odds = round2(effectiveOdds);
    }
    entry.odds_source = oddsSource;
    entry.market_popularity = popularity;
    entry.market_popularity_source = hasActualPopularity ? "actual" : "estimated";
    entry.market_win_odds = marketWinOdds;
    entry.market_win_odds_source = marketWinOddsSource;
    // 実質期待値（動的マージン控除済み・人気バイアス補正済み）
    entry.value_score = valueScore;
    entry.value_rank = valueRank;
    // Fractional Kelly による投資比率（0〜0.25）
    entry.kelly_weight = kellyWeight;
    entry.confidence_rank = confidenceRank;
    entry.bet_type = betType;
    entry.value_change = valueChange;
    entry.key_factors = abilityLabels.length > 0 ? abilityLabels : ["能力上位"];
    entry.risk_factors = [risk];
    // デバッグ用: 適用したマージンと減衰係数を記録
    entry.ev_margin_applied = evMargin;
    entry.popularity_decay_applied = round2(popularityDecay);
  }
  return data;
}
