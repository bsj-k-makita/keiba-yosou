import { useEffect, useState } from "react";
import type { AbilityPriority, RaceCondition } from "../../domain/race-evaluation";
import { ABILITY_KEYS, ABILITY_LABELS, type AbilityKey } from "../../domain/race-evaluation/abilityTypes";
import {
  ADJUSTMENT_STRENGTH,
  BIAS_ADJUSTMENTS,
  GROUND_ADJUSTMENTS,
  PACE_ADJUSTMENTS,
  TRACK_SPEED_ADJUSTMENTS,
} from "../../domain/race-evaluation/adjustments";
import { SELECTABLE_VENUES } from "../../domain/race-evaluation/courseWeights";

type Props = {
  condition: RaceCondition;
  onChange: (next: RaceCondition) => void;
  /** 外側（アコーディオン等）に見出しがある場合は h2「補正パネル」を出さない */
  embedded?: boolean;
};

const VENUES = SELECTABLE_VENUES as readonly string[];

type QuickKey = "standard" | "front_hold" | "closer_reach" | "fast_clock" | "slow_clock";

// グローバルプロファイル保存キー
const GLOBAL_PROFILE_KEY = "race-condition-global-profile";

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

type GlobalProfile = Pick<
  RaceCondition,
  "ground" | "trackSpeed" | "bias" | "pace" | "adjustmentStrength" | "userTrackBias" | "abilityPriority"
>;

function saveGlobalProfile(condition: RaceCondition): void {
  const profile: GlobalProfile = {
    ground: condition.ground,
    trackSpeed: condition.trackSpeed,
    bias: condition.bias,
    pace: condition.pace,
    adjustmentStrength: condition.adjustmentStrength,
    userTrackBias: condition.userTrackBias,
    abilityPriority: condition.abilityPriority,
  };
  try {
    localStorage.setItem(GLOBAL_PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // ignore
  }
}

function clearGlobalProfile(): void {
  try {
    localStorage.removeItem(GLOBAL_PROFILE_KEY);
  } catch {
    // ignore
  }
}

export function loadGlobalProfile(): Partial<GlobalProfile> | null {
  try {
    const raw = localStorage.getItem(GLOBAL_PROFILE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Partial<GlobalProfile>;
  } catch {
    return null;
  }
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

type AbilityPreset = {
  priority: AbilityPriority;
  label: string;
  description: string;
};

const ABILITY_PRESETS: AbilityPreset[] = [
  { priority: "speed",   label: "スピード/先行重視",  description: "先行力・速度を1.5倍重視。前が止まらない馬場向き。" },
  { priority: "stamina", label: "スタミナ/持続重視",  description: "スタミナ・持続力を1.5倍重視。重馬場・長距離戦向き。" },
  { priority: "kick",    label: "キレ（瞬発）勝負",   description: "末脚（Kick）を1.5倍重視。上がり勝負・差しが届く馬場向き。" },
  { priority: "power",   label: "パワー/急坂重視",    description: "パワーを1.5倍重視。急坂・重い馬場・タフな消耗戦向き。" },
];

export function RaceAdjustmentPanel({ condition, onChange, embedded = false }: Props) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [globalProfileOn, setGlobalProfileOn] = useState<boolean>(() => {
    try {
      return localStorage.getItem(GLOBAL_PROFILE_KEY) !== null;
    } catch {
      return false;
    }
  });
  const userBias = clamp(condition.userTrackBias ?? 0, -1, 1);

  const strengthKeys = Object.keys(ADJUSTMENT_STRENGTH) as Array<
    keyof typeof ADJUSTMENT_STRENGTH
  >;

  const currentPriority = condition.abilityPriority ?? null;

  // グローバルプロファイルの ON/OFF 切替
  function handleGlobalProfileToggle(checked: boolean): void {
    setGlobalProfileOn(checked);
    if (checked) {
      saveGlobalProfile(condition);
    } else {
      clearGlobalProfile();
    }
  }

  // condition が変わったとき、グローバルプロファイルが ON なら自動保存
  useEffect(() => {
    if (globalProfileOn) {
      saveGlobalProfile(condition);
    }
  }, [condition, globalProfileOn]);

  function handleAbilityPriority(priority: AbilityPriority): void {
    const next: RaceCondition = {
      ...condition,
      abilityPriority: priority === currentPriority ? null : priority,
    };
    onChange(next);
  }

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
        <label className="adj-panel__surface" style={{ marginLeft: "10px" }}>
          馬場
          <select
            value={condition.surface ?? "芝"}
            onChange={(e) =>
              onChange({ ...condition, surface: e.target.value as "芝" | "ダート" })
            }
          >
            <option value="芝">芝</option>
            <option value="ダート">ダート</option>
          </select>
        </label>
      </div>

      {/* ===== 能力プリセット ===== */}
      <div className="adj-panel__group">
        <h3>能力重視プリセット</h3>
        <p style={{ fontSize: "0.78em", color: "#6c757d", margin: "0 0 6px" }}>
          選択した能力ウェイトを 1.5 倍にして再正規化します。全馬の期待値とスコアが即座に更新されます。
        </p>
        <div className="adj-panel__chips">
          {ABILITY_PRESETS.map(({ priority, label, description }) => (
            <button
              key={priority}
              type="button"
              className={`chip ${currentPriority === priority ? "chip--active" : ""}`}
              title={description}
              onClick={() => handleAbilityPriority(priority)}
            >
              {label}
              {currentPriority === priority ? " ✓" : ""}
            </button>
          ))}
          {currentPriority !== null && (
            <button
              type="button"
              className="chip"
              onClick={() => onChange({ ...condition, abilityPriority: null })}
            >
              リセット
            </button>
          )}
        </div>
      </div>

      {/* ===== かんたん補正 ===== */}
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

      <div className="adj-panel__group">
        <h3>重点項目（2倍→再正規化）</h3>
        <p className="adj-panel__help">ON にした能力軸のウェイトを2倍し、合計1.0に戻して再計算します。</p>
        <div className="adj-panel__chips" role="group" aria-label="能力重点">
          {ABILITY_KEYS.map((k: AbilityKey) => (
            <button
              key={k}
              type="button"
              className={`chip ${condition.abilityFocus?.[k] ? "chip--active" : ""}`}
              onClick={() => {
                const on = condition.abilityFocus?.[k] ?? false;
                const next: NonNullable<RaceCondition["abilityFocus"]> = { ...condition.abilityFocus };
                if (on) {
                  delete next[k];
                } else {
                  next[k] = true;
                }
                onChange({
                  ...condition,
                  abilityFocus: Object.keys(next).length > 0 ? next : undefined,
                });
              }}
            >
              {ABILITY_LABELS[k]}
            </button>
          ))}
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

          {/* ===== グローバルプロファイル永続化 ===== */}
          <fieldset>
            <legend>設定の引き継ぎ</legend>
            <label
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "8px",
                fontSize: "0.85em",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={globalProfileOn}
                onChange={(e) => handleGlobalProfileToggle(e.target.checked)}
                style={{ marginTop: "2px" }}
              />
              <span>
                <strong>本日の設定を全レースに適用</strong>
                <br />
                <span style={{ color: "#6c757d", fontSize: "0.9em" }}>
                  有効にすると、馬場・展開・能力プリセット等の設定を保持し、
                  他レースへ遷移した際も自動的に適用されます（同競馬場・馬場区分を問わず）。
                </span>
              </span>
            </label>
            {globalProfileOn && (
              <p style={{ fontSize: "0.78em", color: "#27ae60", marginTop: "6px" }}>
                ✓ グローバルプロファイルが保存されています。他レースでも自動適用されます。
              </p>
            )}
          </fieldset>
        </div>
      )}
    </section>
  );
}
