import { useState } from "react";
import type { RaceCondition } from "../../domain/race-evaluation";
import {
  ADJUSTMENT_STRENGTH,
  BIAS_ADJUSTMENTS,
  GROUND_ADJUSTMENTS,
  PACE_ADJUSTMENTS,
  TRACK_SPEED_ADJUSTMENTS,
} from "../../domain/race-evaluation/adjustments";
import { BASE_COURSE_WEIGHTS } from "../../domain/race-evaluation/courseWeights";

type Props = {
  condition: RaceCondition;
  onChange: (next: RaceCondition) => void;
  /** 外側（アコーディオン等）に見出しがある場合は h2「補正パネル」を出さない */
  embedded?: boolean;
};

const VENUES = Object.keys(BASE_COURSE_WEIGHTS);

type QuickKey = "standard" | "front_hold" | "closer_reach" | "fast_clock" | "slow_clock";

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function biasText(v: number): string {
  if (v <= -0.8) return "内有利（強）";
  if (v <= -0.3) return "内有利（弱）";
  if (v >= 0.8) return "外有利（強）";
  if (v >= 0.3) return "外有利（弱）";
  return "補正なし";
}

function applyQuickPreset(key: QuickKey, base: RaceCondition): RaceCondition {
  switch (key) {
    case "standard":
      return {
        ...base,
        ground: "good",
        trackSpeed: "standard",
        bias: "flat",
        pace: "middle",
        adjustmentStrength: "middle",
        userTrackBias: 0,
      };
    case "front_hold":
      return {
        ...base,
        ground: "good",
        trackSpeed: "standard",
        bias: "front_favor",
        pace: "high",
        adjustmentStrength: "middle",
        userTrackBias: 0,
      };
    case "closer_reach":
      return {
        ...base,
        ground: "good",
        trackSpeed: "standard",
        bias: "closer_favor",
        pace: "slow",
        adjustmentStrength: "middle",
        userTrackBias: 0,
      };
    case "fast_clock":
      return {
        ...base,
        trackSpeed: "fast",
        bias: "flat",
        pace: "middle",
        adjustmentStrength: "middle",
        userTrackBias: 0,
      };
    case "slow_clock":
      return {
        ...base,
        trackSpeed: "slow",
        bias: "flat",
        pace: "middle",
        adjustmentStrength: "middle",
        userTrackBias: 0,
      };
    default:
      return base;
  }
}

export function RaceAdjustmentPanel({ condition, onChange, embedded = false }: Props) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const userBias = clamp(condition.userTrackBias ?? 0, -1, 1);

  const strengthKeys = Object.keys(ADJUSTMENT_STRENGTH) as Array<
    keyof typeof ADJUSTMENT_STRENGTH
  >;

  return (
    <section className={`adj-panel${embedded ? " adj-panel--embedded" : ""}`}>
      <div className="adj-panel__header">
        {!embedded ? <h2 className="adj-panel__title">補正パネル</h2> : null}
        <label className="adj-panel__venue">
          競馬場
          <select
            value={condition.venue}
            onChange={(e) => onChange({ ...condition, venue: e.target.value })}
          >
            {VENUES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="adj-panel__group">
        <h3>かんたん補正</h3>
        <div className="adj-panel__chips">
          <button
            type="button"
            className="chip"
            onClick={() => onChange(applyQuickPreset("standard", condition))}
          >
            標準
          </button>
          <button
            type="button"
            className="chip"
            onClick={() => onChange(applyQuickPreset("front_hold", condition))}
          >
            前が止まらない
          </button>
          <button
            type="button"
            className="chip"
            onClick={() => onChange(applyQuickPreset("closer_reach", condition))}
          >
            差しが届く
          </button>
          <button
            type="button"
            className="chip"
            onClick={() => onChange(applyQuickPreset("fast_clock", condition))}
          >
            時計が速い
          </button>
          <button
            type="button"
            className="chip"
            onClick={() => onChange(applyQuickPreset("slow_clock", condition))}
          >
            時計がかかる
          </button>
        </div>
      </div>

      <button
        type="button"
        className="adj-panel__toggle"
        onClick={() => setAdvancedOpen((o) => !o)}
        aria-expanded={advancedOpen}
      >
        詳細補正 {advancedOpen ? "▼" : "▶"}
      </button>

      {advancedOpen && (
        <div className="adj-panel__advanced">
          <fieldset>
            <legend>馬場状態</legend>
            <div className="adj-panel__chips">
              {Object.entries(GROUND_ADJUSTMENTS)
                .filter(([id]) => id !== "fast_track" && id !== "slow_track")
                .map(([id, def]) => (
                  <button
                    key={id}
                    type="button"
                    className={`chip ${condition.ground === id ? "chip--active" : ""}`}
                    onClick={() => onChange({ ...condition, ground: id })}
                  >
                    {def.label}
                  </button>
                ))}
            </div>
          </fieldset>

          <fieldset>
            <legend>時計傾向</legend>
            <div className="adj-panel__chips">
              {Object.entries(TRACK_SPEED_ADJUSTMENTS).map(([id, def]) => (
                <button
                  key={id}
                  type="button"
                  className={`chip ${(condition.trackSpeed ?? "standard") === id ? "chip--active" : ""}`}
                  onClick={() =>
                    onChange({
                      ...condition,
                      trackSpeed: id as "standard" | "fast" | "slow",
                    })
                  }
                >
                  {def.label}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend>馬場傾向</legend>
            <div className="adj-panel__chips">
              {Object.entries(BIAS_ADJUSTMENTS).map(([id, def]) => (
                <button
                  key={id}
                  type="button"
                  className={`chip ${condition.bias === id ? "chip--active" : ""}`}
                  onClick={() => onChange({ ...condition, bias: id })}
                >
                  {def.label}
                </button>
              ))}
            </div>
            <div className="adj-panel__user-bias">
              <p className="adj-panel__user-bias-label">
                枠バイアス補正（手動）: {userBias.toFixed(1)}（{biasText(userBias)}）
              </p>
              <p className="adj-panel__user-bias-help">
                内外の有利不利を手動で上書きします（-1.0=内有利、+1.0=外有利、0.0=補正なし）。
              </p>
              <input
                type="range"
                min={-1}
                max={1}
                step={0.1}
                value={userBias}
                onChange={(e) =>
                  onChange({
                    ...condition,
                    userTrackBias: Number.parseFloat(e.target.value),
                  })
                }
                aria-label="ユーザー馬場バイアス"
              />
              <div className="adj-panel__chips">
                {[-1, -0.5, 0, 0.5, 1].map((v) => (
                  <button
                    key={`user-bias-${v}`}
                    type="button"
                    className={`chip ${Math.abs(userBias - v) < 0.05 ? "chip--active" : ""}`}
                    onClick={() => onChange({ ...condition, userTrackBias: v })}
                  >
                    {v.toFixed(1)}
                  </button>
                ))}
              </div>
            </div>
          </fieldset>

          <fieldset>
            <legend>展開想定</legend>
            <div className="adj-panel__chips">
              {Object.entries(PACE_ADJUSTMENTS).map(([id, def]) => (
                <button
                  key={id}
                  type="button"
                  className={`chip ${condition.pace === id ? "chip--active" : ""}`}
                  onClick={() => onChange({ ...condition, pace: id })}
                >
                  {def.label}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend>補正強度</legend>
            <div className="adj-panel__chips">
              {strengthKeys.map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`chip ${condition.adjustmentStrength === k ? "chip--active" : ""}`}
                  onClick={() => onChange({ ...condition, adjustmentStrength: k })}
                >
                  {k === "weak" ? "弱" : k === "middle" ? "中" : "強"}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
      )}
    </section>
  );
}
