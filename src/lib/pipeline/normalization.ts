export type ScoreRow = {
  horseId: string;
  score: number;
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function clampSoftmaxTemperature(input: number | undefined): number {
  const raw = input ?? 8.0;
  if (!Number.isFinite(raw)) return 8.0;
  return clamp(raw, 2.0, 16.0);
}

export function effectiveSoftmaxTemperature(
  baseTemperature: number | undefined,
  strength: "weak" | "middle" | "strong",
): number {
  const base = clampSoftmaxTemperature(baseTemperature);
  // 強設定は温度を半減し、確率分布を1強に寄せる（8 -> 4 の設計意図）。
  if (strength === "strong") return clampSoftmaxTemperature(base * 0.5);
  return base;
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
