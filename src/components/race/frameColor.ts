export type FrameColorTone = {
  bg: string;
  fg: string;
  border: string;
  key: number;
};

const FRAME_COLORS: Record<number, FrameColorTone> = {
  1: { key: 1, bg: "#ffffff", fg: "#1d1d1f", border: "#b8b8bd" }, // 白
  2: { key: 2, bg: "#202124", fg: "#ffffff", border: "#202124" }, // 黒
  3: { key: 3, bg: "#d92027", fg: "#ffffff", border: "#b71c1c" }, // 赤
  4: { key: 4, bg: "#1d4ed8", fg: "#ffffff", border: "#1e40af" }, // 青
  5: { key: 5, bg: "#facc15", fg: "#1d1d1f", border: "#ca8a04" }, // 黄
  6: { key: 6, bg: "#16a34a", fg: "#ffffff", border: "#15803d" }, // 緑
  7: { key: 7, bg: "#f97316", fg: "#ffffff", border: "#c2410c" }, // 橙
  8: { key: 8, bg: "#f9a8d4", fg: "#1d1d1f", border: "#db2777" }, // 桃
};

const FALLBACK: FrameColorTone = { key: 0, bg: "#f5f5f7", fg: "#1d1d1f", border: "#d2d2d7" };

export function getFrameColor(frameNumber?: number): FrameColorTone {
  if (frameNumber == null) return FALLBACK;
  return FRAME_COLORS[frameNumber] ?? FALLBACK;
}
