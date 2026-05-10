import type { RunningStyle } from "../../domain/race-evaluation/lingoConstants";

export type RunningStyleStripSlot = "nige" | "sen" | "sashi" | "oi";

const SLOTS: readonly {
  id: RunningStyleStripSlot;
  label: string;
  barColor: string;
  activeFill: string;
}[] = [
  { id: "nige", label: "逃", barColor: "#22c55e", activeFill: "#22c55e" },
  { id: "sen", label: "先", barColor: "#ca8a04", activeFill: "#ca8a04" },
  { id: "sashi", label: "差", barColor: "#16a34a", activeFill: "#16a34a" },
  {
    id: "oi",
    label: "追",
    barColor: "linear-gradient(90deg, #2563eb 55%, #ea580c 100%)",
    activeFill: "#2563eb",
  },
];

/** 脚質表示の4区分（順序固定・レースサマリー等と共通） */
export const RUNNING_STYLE_STRIP_SLOT_ROWS: readonly { id: RunningStyleStripSlot; label: string }[] = SLOTS.map(
  ({ id, label }) => ({ id, label }),
);

/**
 * 6種の脚質ラベルと enrich の position_x（任意）から、表示用4区分へマップする。
 * position_x はバックエンド算出値のみ使用（クライアントで過去走は見ない）。
 */
export function resolveRunningStyleStripSlot(style: RunningStyle, positionX?: number): RunningStyleStripSlot {
  const px = typeof positionX === "number" && Number.isFinite(positionX) ? positionX : undefined;

  switch (style) {
    case "逃げ":
      return "nige";
    case "先行":
      return "sen";
    case "好位":
      if (px != null && px >= 55) return "sashi";
      return "sen";
    case "差し":
      return "sashi";
    case "追込":
      return "oi";
    case "自在":
      if (px == null) return "sen";
      if (px <= 34) return "nige";
      if (px <= 50) return "sen";
      if (px <= 72) return "sashi";
      return "oi";
    default:
      return "sen";
  }
}

export function stripSlotLabel(slot: RunningStyleStripSlot): string {
  return SLOTS.find((s) => s.id === slot)?.label ?? "先";
}

/** 一覧ストリップ・カードバッジなど、画面表示用の短い脚質名（逃・先・差・追） */
export function runningStyleToStripShortLabel(style: RunningStyle, positionX?: number): string {
  return stripSlotLabel(resolveRunningStyleStripSlot(style, positionX));
}

type Props = {
  runningStyle: RunningStyle;
  /** enrich が JSON に書いた隊列位置（0〜100）。無いときは脚質ラベルのみで判定 */
  position_x?: number;
};

/** netkeiba 系 UI に近い「脚質」4区分ストリップ（一覧の馬名セル内用） */
export function RunningStyleStrip({ runningStyle, position_x: positionX }: Props) {
  const active = resolveRunningStyleStripSlot(runningStyle, positionX);
  const activeMeta = SLOTS.find((s) => s.id === active);

  return (
    <div
      className="running-style-strip"
      role="group"
      aria-label={`脚質 ${activeMeta?.label ?? ""}`}
    >
      <span className="running-style-strip__title">脚質</span>
      <div className="running-style-strip__main">
        <div className="running-style-strip__bar" aria-hidden>
          {SLOTS.map((s) => (
            <span
              key={s.id}
              className="running-style-strip__bar-seg"
              style={
                s.barColor.includes("gradient")
                  ? { background: s.barColor }
                  : { backgroundColor: s.barColor }
              }
            />
          ))}
        </div>
        <div className="running-style-strip__icons">
          {SLOTS.map((s) => {
            const on = s.id === active;
            return (
              <div key={s.id} className="running-style-strip__cell">
                <span
                  className={`running-style-strip__wedge-wrap${on ? " running-style-strip__wedge-wrap--active" : ""}`}
                  style={on ? { color: s.activeFill } : undefined}
                  aria-current={on ? "true" : undefined}
                >
                  <svg
                    className="running-style-strip__wedge"
                    viewBox="0 0 32 20"
                    width={28}
                    height={18}
                    aria-hidden
                  >
                    <polygon points="2,10 26,3 26,17" fill="currentColor" />
                  </svg>
                </span>
                <span
                  className={`running-style-strip__slot-label${on ? " running-style-strip__slot-label--active" : ""}`}
                  style={on ? { color: s.activeFill } : undefined}
                >
                  {s.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
