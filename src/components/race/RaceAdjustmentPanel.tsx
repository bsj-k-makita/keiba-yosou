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

type GlobalProfile = Pick<
  RaceCondition,
  | "ground"
  | "trackSpeed"
  | "bias"
  | "pace"
  | "adjustmentStrength"
  | "abilityPriority"
  | "paceInference"
  | "meetingPhase"
  | "favoredHorseNumbers"
  | "disfavoredHorseNumbers"
  | "trackCushion01"
>;

function saveGlobalProfile(condition: RaceCondition): void {
  const profile: GlobalProfile = {
    ground: condition.ground,
    trackSpeed: condition.trackSpeed,
    bias: condition.bias,
    pace: condition.pace,
    adjustmentStrength: condition.adjustmentStrength,
    abilityPriority: condition.abilityPriority,
    paceInference: condition.paceInference,
    meetingPhase: condition.meetingPhase,
    favoredHorseNumbers: condition.favoredHorseNumbers,
    disfavoredHorseNumbers: condition.disfavoredHorseNumbers,
    trackCushion01: condition.trackCushion01,
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

/** 渗透計目安（高いほど柔軟）→ trackCushion01（低いほど柔・坂負荷大） */
function jraPenetrationToTrackCushion01(raw: number): number {
  return clamp((11.6 - raw) / 4.8, 0, 1);
}

function trackCushion01ToJraPenetration(c01: number | undefined): string {
  if (c01 == null || !Number.isFinite(c01)) return "";
  const v = clamp(11.6 - clamp(c01, 0, 1) * 4.8, 7.0, 12.5);
  return v.toFixed(1);
}

/** 馬番 1〜18: 中立 → 有利 → 不利 → 中立 */
function cycleHorseGate(num: number, condition: RaceCondition): RaceCondition {
  const fav = new Set(condition.favoredHorseNumbers ?? []);
  const dis = new Set(condition.disfavoredHorseNumbers ?? []);
  if (!fav.has(num) && !dis.has(num)) {
    fav.add(num);
  } else if (fav.has(num)) {
    fav.delete(num);
    dis.add(num);
  } else {
    dis.delete(num);
  }
  return {
    ...condition,
    favoredHorseNumbers: fav.size > 0 ? [...fav].sort((a, b) => a - b) : undefined,
    disfavoredHorseNumbers: dis.size > 0 ? [...dis].sort((a, b) => a - b) : undefined,
  };
}

function clearHorseGatePinpoints(condition: RaceCondition): RaceCondition {
  const next = { ...condition };
  delete next.favoredHorseNumbers;
  delete next.disfavoredHorseNumbers;
  delete next.favoredGateNumbers;
  delete next.disfavoredGateNumbers;
  return next;
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
        favoredHorseNumbers: undefined,
        disfavoredHorseNumbers: undefined,
        paceInference: undefined,
      };
    case "front_hold":
      return {
        ...base,
        ground: "good",
        trackSpeed: "standard",
        bias: "front_favor",
        pace: "high",
        adjustmentStrength: "middle",
      };
    case "closer_reach":
      return {
        ...base,
        ground: "good",
        trackSpeed: "standard",
        bias: "closer_favor",
        pace: "slow",
        adjustmentStrength: "middle",
      };
    case "fast_clock":
      return {
        ...base,
        trackSpeed: "fast",
        bias: "flat",
        pace: "middle",
        adjustmentStrength: "middle",
      };
    case "slow_clock":
      return {
        ...base,
        trackSpeed: "slow",
        bias: "flat",
        pace: "middle",
        adjustmentStrength: "middle",
      };
    default:
      return base;
  }
}

function detectQuickPreset(condition: RaceCondition): QuickKey | null {
  if (
    condition.ground === "good" &&
    (condition.trackSpeed ?? "standard") === "standard" &&
    condition.bias === "flat" &&
    condition.pace === "middle"
  ) {
    if (
      condition.adjustmentStrength === "middle" &&
      !(condition.favoredHorseNumbers?.length || condition.disfavoredHorseNumbers?.length)
    ) {
      return "standard";
    }
  }
  if (condition.bias === "front_favor" && condition.pace === "high") return "front_hold";
  if (condition.bias === "closer_favor" && condition.pace === "slow") return "closer_reach";
  if (condition.trackSpeed === "fast" && condition.bias === "flat") return "fast_clock";
  if (condition.trackSpeed === "slow" && condition.bias === "flat") return "slow_clock";
  return null;
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
  const strengthKeys = Object.keys(ADJUSTMENT_STRENGTH) as Array<
    keyof typeof ADJUSTMENT_STRENGTH
  >;

  const currentPriority = condition.abilityPriority ?? null;
  const activeQuickPreset = detectQuickPreset(condition);

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
          選択した能力ウェイトを 1.5 倍にして再正規化します。全馬の評価スコアが即座に更新されます。
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
            className={`chip ${activeQuickPreset === "standard" ? "chip--active" : ""}`}
            onClick={() => onChange(applyQuickPreset("standard", condition))}
          >
            標準
          </button>
          <button
            type="button"
            className={`chip ${activeQuickPreset === "front_hold" ? "chip--active" : ""}`}
            onClick={() => onChange(applyQuickPreset("front_hold", condition))}
          >
            前が止まらない
          </button>
          <button
            type="button"
            className={`chip ${activeQuickPreset === "closer_reach" ? "chip--active" : ""}`}
            onClick={() => onChange(applyQuickPreset("closer_reach", condition))}
          >
            差しが届く
          </button>
          <button
            type="button"
            className={`chip ${activeQuickPreset === "fast_clock" ? "chip--active" : ""}`}
            onClick={() => onChange(applyQuickPreset("fast_clock", condition))}
          >
            時計が速い
          </button>
          <button
            type="button"
            className={`chip ${activeQuickPreset === "slow_clock" ? "chip--active" : ""}`}
            onClick={() => onChange(applyQuickPreset("slow_clock", condition))}
          >
            時計がかかる
          </button>
        </div>
      </div>

      <div className="adj-panel__group">
        <h3>重点項目（3倍→再正規化）</h3>
        <p className="adj-panel__help">ON にした能力軸のウェイトを3倍し、合計1.0に戻して再計算します。</p>
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
            <legend>クッション値（渗透計・目安）</legend>
            <p className="adj-panel__help" style={{ fontSize: "0.78em", color: "#6c757d", margin: "0 0 6px" }}>
              JRA の渗透計に近い目安（例 9.5）。数値が高いほど柔軟で坂・踏み込み負荷が乗りやすい想定として扱います。未入力時は坂連動なし。
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
              <input
                type="number"
                step={0.1}
                min={7}
                max={12.5}
                placeholder="例 9.5"
                value={trackCushion01ToJraPenetration(condition.trackCushion01)}
                onChange={(e) => {
                  const t = e.target.value.trim();
                  if (t === "") {
                    const next = { ...condition };
                    delete next.trackCushion01;
                    onChange(next);
                    return;
                  }
                  const raw = Number.parseFloat(t);
                  if (!Number.isFinite(raw)) return;
                  onChange({ ...condition, trackCushion01: jraPenetrationToTrackCushion01(raw) });
                }}
                aria-label="クッション値"
                style={{ width: "7rem" }}
              />
              <button
                type="button"
                className="chip"
                onClick={() => {
                  const next = { ...condition };
                  delete next.trackCushion01;
                  onChange(next);
                }}
              >
                クリア
              </button>
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
            <legend>開催時期（4角・後方脚質）</legend>
            <p className="adj-panel__help" style={{ fontSize: "0.78em", color: "#6c757d", margin: "0 0 6px" }}>
              開幕は前寄り・最終週は差し伸びやすい寄りに内部補正。「おまかせ」はレース名・クッション等の自動判定を使います。
            </p>
            <div className="adj-panel__chips">
              {(
                [
                  { id: undefined, label: "おまかせ" },
                  { id: "opening" as const, label: "開幕直後" },
                  { id: "mid" as const, label: "中盤" },
                  { id: "closing" as const, label: "最終週寄り" },
                ] as const
              ).map(({ id, label }) => (
                <button
                  key={label}
                  type="button"
                  className={`chip ${(condition.meetingPhase ?? undefined) === id ? "chip--active" : ""}`}
                  onClick={() => {
                    const next = { ...condition };
                    if (id === undefined) {
                      delete next.meetingPhase;
                    } else {
                      next.meetingPhase = id;
                    }
                    onChange(next);
                  }}
                >
                  {label}
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
              <p className="adj-panel__user-bias-label">馬番ゲート補正（1〜18）</p>
              <p className="adj-panel__user-bias-help" style={{ marginTop: "4px", marginBottom: "6px" }}>
                各番をクリックして「中立 → この馬番を有利（赤）→ 不利（青）→ 中立」と切り替えます。上の「馬場傾向」（内有利・外有利など）によるグラデーションに加算されます。番号に色がついていないとき、内有利／外有利なら端の番号がハイライトされます。
              </p>
              <div className="adj-panel__gate-grid" role="group" aria-label="馬番ゲート補正">
                {Array.from({ length: 18 }, (_, idx) => {
                  const gate = idx + 1;
                  const fav = condition.favoredHorseNumbers?.includes(gate) ?? false;
                  const dis = condition.disfavoredHorseNumbers?.includes(gate) ?? false;
                  const presetGlowInner =
                    !fav &&
                    !dis &&
                    condition.bias === "inside_favor" &&
                    gate <= 3;
                  const presetGlowOuter =
                    !fav &&
                    !dis &&
                    condition.bias === "outside_favor" &&
                    gate >= 16;
                  const cls = [
                    "adj-panel__gate-cell",
                    fav ? "adj-panel__gate-cell--pick-fav" : "",
                    dis ? "adj-panel__gate-cell--pick-dis" : "",
                    presetGlowInner || presetGlowOuter ? "adj-panel__gate-cell--glow" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <button
                      key={`horse-gate-${gate}`}
                      type="button"
                      className={cls}
                      title="クリックで切替: 中立→有利→不利→中立"
                      onClick={() => onChange(cycleHorseGate(gate, condition))}
                    >
                      {gate}
                    </button>
                  );
                })}
              </div>
              <div className="adj-panel__chips" style={{ marginTop: "4px" }}>
                <button type="button" className="chip" onClick={() => onChange(clearHorseGatePinpoints(condition))}>
                  ゲート指定クリア
                </button>
              </div>
            </div>
          </fieldset>

          <fieldset>
            <legend>展開想定</legend>
            <label
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "8px",
                alignItems: "center",
                fontSize: "0.85em",
                marginBottom: "10px",
              }}
            >
              <span>ペース反映:</span>
              <select
                value={condition.paceInference ?? "auto"}
                onChange={(e) => {
                  const v = e.target.value as "auto" | "manual";
                  onChange({
                    ...condition,
                    paceInference: v === "auto" ? undefined : "manual",
                  });
                }}
                aria-label="ペース自動推計か手動固定か"
              >
                <option value="auto">自動（ミドル時は脚質から推計）</option>
                <option value="manual">手動（選んだ展開をそのまま）</option>
              </select>
            </label>
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
