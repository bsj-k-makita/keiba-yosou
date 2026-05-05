import { UI } from "../../domain/race-evaluation/lingoConstants";
import type { FitLevel } from "../../domain/race-evaluation/fitScore";

type Props = {
  level: FitLevel;
  /** 1行。条件と重みに基づく解説（グラフの補足） */
  supplement?: string;
};

/** 今回向き：高/中/低 ＋任意の1行解説 */
export function FitLabel({ level, supplement }: Props) {
  return (
    <div className="fit-label-block">
      <p
        className={`fit-label fit-label--${
          level === "高" ? "hi" : level === "中" ? "mid" : "lo"
        }`}
      >
        <span className="fit-label__k">{UI.FIT_COLON}</span>
        <strong className="fit-label__v">{level}</strong>
      </p>
      {supplement ? <p className="fit-label__sub">{supplement}</p> : null}
    </div>
  );
}
