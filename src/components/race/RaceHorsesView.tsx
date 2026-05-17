import { useState } from "react";
import type { AbilityGradeRow } from "../../domain/race-evaluation/abilityGrades";
import type { HorseAbility, HorseScoreResult, RaceCondition } from "../../domain/race-evaluation";
import { weightsToDemand0to100, getFinalWeights } from "../../domain/race-evaluation";
import { HorseEvaluationCard } from "./HorseEvaluationCard";
import { HorseListTable } from "./HorseListTable";
import { RunningStyleRaceSummary } from "./RunningStyleRaceSummary";
import { adjustedScoreToPoints100 } from "./adjustedScorePoints100";
import type { RaceEvaluationViewModel } from "../../viewModel/raceEvaluationViewModel";

type Props = {
  sorted: HorseScoreResult[];
  horses: HorseAbility[];
  gradesMap: Map<string, AbilityGradeRow>;
  condition: RaceCondition;
  viewModel?: RaceEvaluationViewModel;
  maxAdjustedScoreInRace: number;
};

export function RaceHorsesView({
  sorted,
  horses,
  gradesMap,
  condition,
  viewModel,
  maxAdjustedScoreInRace,
}: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const demand0to100 = weightsToDemand0to100(getFinalWeights(condition));

  return (
    <section className="race-horses-view" aria-label="出馬表">
      <div className="app__entries-head">
        <h2 className="app__section-title app__section-title--pop">
          出馬表 {horses.length > 0 ? `（${horses.length}頭）` : ""}
        </h2>
        <p className="app__meta">
          印・馬番・斤量・騎手・脚質を一覧。行をタップすると5軸能力・レーダー等の詳細を展開します。
        </p>
      </div>
      <RunningStyleRaceSummary horses={horses} />
      <HorseListTable
        sorted={sorted}
        horses={horses}
        gradesMap={gradesMap}
        condition={condition}
        viewModel={viewModel}
        scanMode
        expandedHorseId={expandedId}
        onToggleExpand={(horseId) =>
          setExpandedId((prev) => (prev === horseId ? null : horseId))
        }
        renderExpandedRow={(r) => {
          const horse = horses.find((h) => h.horseId === r.horseId);
          if (!horse) return null;
          const gate = "gate" in horse ? (horse as typeof horse & { gate?: number }).gate : undefined;
          const grades = gradesMap.get(r.horseId)!;
          const score100 = adjustedScoreToPoints100(r.adjustedScore, maxAdjustedScoreInRace);
          return (
            <HorseEvaluationCard
              gate={gate}
              horse={horse}
              result={r}
              grades={grades}
              demand0to100={demand0to100}
              allHorses={horses}
              condition={condition}
              viewModel={viewModel}
              compact
              scorePoints100={score100}
            />
          );
        }}
      />
    </section>
  );
}
