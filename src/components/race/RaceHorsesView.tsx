import type { AbilityGradeRow } from "../../domain/race-evaluation/abilityGrades";
import type { HorseAbility, HorseScoreResult, RaceCondition } from "../../domain/race-evaluation";
import { HorseListTable } from "./HorseListTable";
import type { RaceEvaluationViewModel } from "../../viewModel/raceEvaluationViewModel";

type Props = {
  sorted: HorseScoreResult[];
  horses: HorseAbility[];
  gradesMap: Map<string, AbilityGradeRow>;
  condition: RaceCondition;
  viewModel?: RaceEvaluationViewModel;
};

export function RaceHorsesView({ sorted, horses, gradesMap, condition, viewModel }: Props) {
  return (
    <section className="race-horses-view race-horses-view--entry" aria-label="出馬表">
      <div className="race-horses-view__head">
        <h2 className="race-horses-view__title">
          出馬表 {horses.length > 0 ? `（${horses.length}頭）` : ""}
        </h2>
      </div>
      <HorseListTable
        sorted={sorted}
        horses={horses}
        gradesMap={gradesMap}
        condition={condition}
        viewModel={viewModel}
        entryMode
      />
    </section>
  );
}
