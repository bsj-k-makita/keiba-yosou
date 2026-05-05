import { ABILITY_KEYS, ABILITY_LABELS } from "../../domain/race-evaluation";
import {
  gradeToColorToken,
  type AbilityGradeRow,
} from "../../domain/race-evaluation/abilityGrades";

type Props = {
  grades: AbilityGradeRow;
};

/**
 * 等級（S/A+/A/B/C）を色分け付きで一覧。グラフが読めなくても足がかりに。
 */
export function AbilityLabelList({ grades }: Props) {
  return (
    <ul className="ability-label-list" aria-label="各能力の相対等級（出走内）">
      {ABILITY_KEYS.map((k) => {
        const g = grades[k] ?? "C";
        return (
          <li
            key={k}
            className={`ability-label-list__row ability-label-list__row--${gradeToColorToken(g)}`}
          >
            <span className="ability-label-list__k">{ABILITY_LABELS[k]}</span>
            <span className="ability-label-list__g" aria-label={`等級${g}`}>
              {g}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
