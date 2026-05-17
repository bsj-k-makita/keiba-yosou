import type { HorseAbility, HorseScoreResult, RaceCondition } from "../../domain/race-evaluation";
import { RACE_TYPE_SHORT, UI } from "../../domain/race-evaluation/lingoConstants";
import { resolveRaceTypeProfile } from "../../domain/race-evaluation/typeMatcher";

type Props = {
  results: HorseScoreResult[];
  horses: HorseAbility[];
  condition: RaceCondition;
};

function gateName(horse: HorseAbility | undefined, r: HorseScoreResult): string {
  if (!horse) return r.horseName;
  const g =
    "gate" in horse && typeof (horse as { gate?: number }).gate === "number"
      ? (horse as { gate?: number }).gate
      : undefined;
  return g != null ? `${g}番 ${r.horseName}` : r.horseName;
}

function conclusionShortTitle(condition: RaceCondition): string {
  const p = resolveRaceTypeProfile(condition);
  if (p.id === "front") return RACE_TYPE_SHORT.FRONT;
  if (p.id === "closer") return RACE_TYPE_SHORT.CLOSER;
  if (p.id === "heavy") return RACE_TYPE_SHORT.HEAVY;
  return RACE_TYPE_SHORT.BALANCED;
}

function pickConclusionTop3(
  results: HorseScoreResult[],
): [HorseScoreResult | undefined, HorseScoreResult | undefined, HorseScoreResult | undefined] {
  const pick = (mark: "◎" | "○" | "▲") => results.find((r) => r.mark === mark);
  return [pick("◎"), pick("○"), pick("▲")];
}

export function RaceConclusionPanel({ results, horses, condition }: Props) {
  const [hon, ta, an] = pickConclusionTop3(results);

  const hHorse = hon ? horses.find((h) => h.horseId === hon.horseId) : undefined;
  const tHorse = ta ? horses.find((h) => h.horseId === ta.horseId) : undefined;
  const aHorse = an ? horses.find((h) => h.horseId === an.horseId) : undefined;

  return (
    <section className="race-conclusion" aria-labelledby="race-conclusion-heading">
      <h2 className="race-conclusion__title" id="race-conclusion-heading">
        【このレースの結論】
      </h2>
      <ul className="race-conclusion__marks" role="list">
        <li>
          <span className="race-conclusion__m" aria-hidden>
            ◎
          </span>
          {hon ? gateName(hHorse, hon) : "—"}
        </li>
        <li>
          <span className="race-conclusion__m" aria-hidden>
            ○
          </span>
          {ta ? gateName(tHorse, ta) : "—"}
        </li>
        <li>
          <span className="race-conclusion__m" aria-hidden>
            ▲
          </span>
          {an ? gateName(aHorse, an) : "—"}
        </li>
      </ul>
      <p className="race-conclusion__pace">
        <span className="race-conclusion__pace-lbl">{UI.PACE_TODAY}：</span>
        {conclusionShortTitle(condition)}
      </p>
    </section>
  );
}
