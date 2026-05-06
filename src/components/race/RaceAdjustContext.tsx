import { createContext, useContext, type ReactNode } from "react";
import type { HorseAbility, HorseScoreResult, RaceCondition } from "../../domain/race-evaluation";
import type { RaceEvaluationViewModel } from "../../viewModel/raceEvaluationViewModel";
import type { QuickAdjustmentKey } from "../../domain/race-evaluation/abilityTypes";

export type RaceAdjustContextValue = {
  condition: RaceCondition;
  horses: HorseAbility[];
  results: HorseScoreResult[];
  viewModel?: RaceEvaluationViewModel;
  onConditionChange?: (next: RaceCondition) => void;
  onQuickAdjustmentToggle?: (key: QuickAdjustmentKey) => void;
};

const RaceAdjustContext = createContext<RaceAdjustContextValue | null>(null);

export function RaceAdjustProvider({
  value,
  children,
}: {
  value: RaceAdjustContextValue;
  children: ReactNode;
}) {
  return <RaceAdjustContext.Provider value={value}>{children}</RaceAdjustContext.Provider>;
}

export function useRaceAdjustOptional(): RaceAdjustContextValue | null {
  return useContext(RaceAdjustContext);
}
