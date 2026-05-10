import { useMemo } from "react";
import type { HorseAbility } from "../../domain/race-evaluation/abilityTypes";
import {
  resolveRunningStyleStripSlot,
  RUNNING_STYLE_STRIP_SLOT_ROWS,
  type RunningStyleStripSlot,
} from "./RunningStyleStrip";

const SLOT_CLASS: Record<RunningStyleStripSlot, string> = {
  nige: "running-style-race-summary__chip--nige",
  sen: "running-style-race-summary__chip--sen",
  sashi: "running-style-race-summary__chip--sashi",
  oi: "running-style-race-summary__chip--oi",
};

type Props = {
  horses: Pick<HorseAbility, "runningStyle" | "position_x">[];
};

/** レース内の脚質（逃・先・差・追の4区分）別頭数。一覧ストリップと同一マッピング。 */
export function RunningStyleRaceSummary({ horses }: Props) {
  const counts = useMemo(() => {
    const init: Record<RunningStyleStripSlot, number> = {
      nige: 0,
      sen: 0,
      sashi: 0,
      oi: 0,
    };
    for (const h of horses) {
      const slot = resolveRunningStyleStripSlot(h.runningStyle, h.position_x);
      init[slot] += 1;
    }
    return init;
  }, [horses]);

  if (horses.length === 0) return null;

  return (
    <div className="running-style-race-summary" aria-label="当レースの脚質内訳（逃・先・差・追）">
      <span className="running-style-race-summary__label">脚質内訳</span>
      <ul className="running-style-race-summary__list">
        {RUNNING_STYLE_STRIP_SLOT_ROWS.map(({ id, label }) => {
          const n = counts[id];
          return (
            <li
              key={id}
              className={`running-style-race-summary__chip ${SLOT_CLASS[id]}${n === 0 ? " running-style-race-summary__chip--zero" : ""}`}
            >
              <span className="running-style-race-summary__name">{label}</span>
              <span className="running-style-race-summary__num">{n}</span>
              <span className="running-style-race-summary__unit">頭</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
