import { ABILITY_KEYS, ABILITY_LABELS, type HorseAbility } from "../../domain/race-evaluation";
import { gradeToColorToken, type AbilityGradeRow } from "../../domain/race-evaluation/abilityGrades";

type Props = {
  horse: HorseAbility;
  grades: AbilityGradeRow;
};

/**
 * 詳細用：能力を横棒（0〜100%）＋等級で表示。数値は出さない。
 */
export function AbilityBar({ horse, grades }: Props) {
  return (
    <div className="ability-bar" role="img" aria-label="能力の相対的な強さ">
      {ABILITY_KEYS.map((k) => {
        const pct = Math.max(0, Math.min(100, horse[k]));
        return (
          <div key={k} className="ability-bar__row">
            <span className="ability-bar__name">{ABILITY_LABELS[k]}</span>
            <div className="ability-bar__track" aria-hidden>
              <div className="ability-bar__fill" style={{ width: `${pct}%` }} />
            </div>
            <span
              className={`ability-bar__grade ability-bar__grade--${gradeToColorToken(grades[k] ?? "C")}`}
              aria-label={`${ABILITY_LABELS[k]}等級`}
            >
              {grades[k]}
            </span>
          </div>
        );
      })}
    </div>
  );
}
