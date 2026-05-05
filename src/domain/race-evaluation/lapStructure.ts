/**
 * 200m 分割（スタート → ゴール）の通過秒。秒が大きいほど遅い。
 * netkeiba の L1＝**ゴール前200m** = 配列の最後の要素、と対応させる。
 */
export const LAP_STRUCTURE = {
  SPRINT: "瞬発戦",
  SUSTAIN: "持続戦",
  GRIND: "消耗戦",
  CRUISE: "高速巡航戦",
  NEUTRAL: "中間",
} as const;
export type LapStructureKind = (typeof LAP_STRUCTURE)[keyof typeof LAP_STRUCTURE];

function last4(s: readonly number[]): { l1: number; l2: number; l3: number; l4: number; l5: number | null } {
  const n = s.length;
  const l1 = s[n - 1]!;
  const l2 = s[n - 2]!;
  const l3 = s[n - 3]!;
  const l4 = s[n - 4]!;
  const l5 = n >= 5 ? s[n - 5]! : null;
  return { l1, l2, l3, l4, l5 };
}

function mean(a: number[]): number {
  return a.length === 0 ? 0 : a.reduce((x, y) => x + y, 0) / a.length;
}

function stdev(a: number[]): number {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length);
}

/**
 * 4ハロン以上の 200m 通過。3 点以下は原則「中間」。
 */
export function classifyLapStructure(section200mSec: readonly number[]): LapStructureKind {
  const s = section200mSec;
  if (s.length < 4) {
    return LAP_STRUCTURE.NEUTRAL;
  }
  const { l1, l2, l3, l4, l5 } = last4(s);
  const n = s.length;

  /** 瞬発: 直線手前200m → 最終200m で 0.5s 以上前詰まり + 上がり目が速い */
  if (l3 - l2 >= 0.45 && l2 <= 11.5) {
    return LAP_STRUCTURE.SPRINT;
  }

  /** 6 区間以上: 前半600m 合計が後半600m 合計より 1.0s 以上速い ＆ 最終200m だけ遅化 */
  if (n >= 6) {
    const f3 = s[0]! + s[1]! + s[2]!;
    const b3 = s[n - 3]! + s[n - 2]! + s[n - 1]!;
    if (f3 + 1.0 <= b3 && l1 > l2 + 0.12) {
      return LAP_STRUCTURE.GRIND;
    }
  }

  /** 持続: 上がり3〜4 ハロンが均一に速く、末に伸び */
  if (n >= 5 && l5 != null) {
    const last4m = stdev([l1, l2, l3, l4]);
    if (last4m < 0.32 && l1 < l2 - 0.02 && l2 < l3 - 0.02) {
      return LAP_STRUCTURE.SUSTAIN;
    }
  }

  /** 高速巡航: 全体的に遅延が小さく、序・中盤が速い */
  const mAll = mean([...s]);
  const head3 = s.length >= 3 ? mean(s.slice(0, 3) as number[]) : mAll;
  if (mAll < 11.85 && head3 < 12.0 && mAll < 12.0) {
    return LAP_STRUCTURE.CRUISE;
  }

  return LAP_STRUCTURE.NEUTRAL;
}
