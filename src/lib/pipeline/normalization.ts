export type ScoreRow = {
  horseId: string;
  score: number;
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function clampSoftmaxTemperature(input: number | undefined): number {
  const raw = input ?? 1.5;
  if (!Number.isFinite(raw)) return 1.5;
  return clamp(raw, 1.0, 16.0);
}

/** 期待値計算用 softmax 温度（T=1.5: 分布を適度に尖らせ EV のメリハリを出す） */
export const FIXED_SOFTMAX_TEMPERATURE = 1.5;

/**
 * 勝率の softmax 温度。常に T=1.5 を使用する。
 * `softmaxTemperature` / `adjustmentStrength` は後方互換のため受け取るが無視する。
 */
export function effectiveSoftmaxTemperature(
  _baseTemperature: number | undefined,
  _strength: "weak" | "middle" | "strong",
): number {
  return FIXED_SOFTMAX_TEMPERATURE;
}

/**
 * 温度付き softmax。温度を下げるほど1強になりやすい。
 * 競馬では「展開読みが刺さる日」に温度を下げ、確率を尖らせる。
 */
export function softmaxDistribution(rows: readonly ScoreRow[], temperature: number): Map<string, number> {
  const out = new Map<string, number>();
  if (rows.length === 0) return out;
  const temp = clampSoftmaxTemperature(temperature);
  const maxScore = Math.max(...rows.map((r) => r.score));
  const exps = rows.map((r) => {
    const stabilized = (r.score - maxScore) / temp;
    const value = Math.exp(stabilized);
    return { horseId: r.horseId, value };
  });
  const denom = exps.reduce((sum, row) => sum + row.value, 0);
  if (denom <= 1e-9) {
    const uniform = 1 / rows.length;
    for (const row of rows) out.set(row.horseId, uniform);
    return out;
  }
  for (const row of exps) {
    out.set(row.horseId, row.value / denom);
  }
  return out;
}
