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

function scoreFromAbilities(entry) {
  const ab = entry?.abilities ?? {};
  const speed = Number(ab.speed ?? 50);
  const stamina = Number(ab.stamina ?? 50);
  const kick = Number(ab.kick ?? 50);
  const sustain = Number(ab.sustain ?? 50);
  const power = Number(ab.power ?? 50);
  return speed * 0.28 + stamina * 0.22 + kick * 0.2 + sustain * 0.18 + power * 0.12;
}

function softmax(values) {
  if (values.length === 0) return [];
  const max = Math.max(...values);
  const exps = values.map((v) => Math.exp((v - max) / 8));
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

// マージン（控除率・予測誤差の安全バッファ）
const EV_MARGIN = 0.15;
// フラクショナルケリー係数（0.25 = クォーターケリー）
const KELLY_FRACTION = 0.25;
// ケリー比率の上限（全資金の25%まで）
const KELLY_MAX = 0.25;

/**
 * 実質期待値を計算する。
 * E_effective = (P × O) - Margin
 * 単純な P×O ではなく、控除率・予測誤差のバッファを差し引く。
 */
function calcEffectiveEv(prob, odds) {
  if (!Number.isFinite(prob) || !Number.isFinite(odds) || odds <= 0) return 0;
  return round2(prob * odds - EV_MARGIN);
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
 * A: effective_ev >= 1.20
 * B: effective_ev >= 1.05（最低ライン）
 * C: effective_ev >= 0.90（様子見）
 * D: それ以下（見送り）
 */
function toValueRank(effectiveEv) {
  if (effectiveEv >= 1.40) return "S";
  if (effectiveEv >= 1.20) return "A";
  if (effectiveEv >= 1.05) return "B";
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
 * race JSON 1ファイル分を期待値短評用フィールドで埋める。
 */
export function enrichInvestmentSignalsInRaceData(data) {
  const entries = Array.isArray(data?.entries) ? data.entries : [];
  if (entries.length === 0) return data;
  const scores = entries.map((e) => scoreFromAbilities(e));
  const probs = softmax(scores);
  const modelRanks = toRank(scores);
  const fieldSize = entries.length;
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
    // 実質期待値: E_effective = (P × O) - Margin（単純な P×O ではなくマージン控除）
    const valueScore = calcEffectiveEv(predictedProbability, effectiveOdds);
    const valueRank = toValueRank(valueScore);
    // ケリー基準による投資比率（Fractional Kelly 0.25倍）
    const kellyWeight = calcKellyWeight(predictedProbability, effectiveOdds);
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
    // 実質期待値（マージン控除済み）
    entry.value_score = valueScore;
    entry.value_rank = valueRank;
    // Fractional Kelly による投資比率（0〜0.25）
    entry.kelly_weight = kellyWeight;
    entry.confidence_rank = confidenceRank;
    entry.bet_type = betType;
    entry.value_change = valueChange;
    entry.key_factors = abilityLabels.length > 0 ? abilityLabels : ["能力上位"];
    entry.risk_factors = [risk];
  }
  return data;
}
