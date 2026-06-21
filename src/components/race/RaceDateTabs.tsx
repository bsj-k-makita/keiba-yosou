import { useMemo } from "react";
import { isDateInWeek } from "../../domain/race-evaluation/weeklyTopEvRaces";

type Props = {
  dates: readonly string[];
  activeDate: string | null;
  todayIso: string;
  formatDateTab: (dateStr: string) => string;
  onDateChange: (date: string) => void;
};

export function RaceDateTabs({ dates, activeDate, todayIso, formatDateTab, onDateChange }: Props) {
  const orderedDates = useMemo(() => {
    const currentWeek: string[] = [];
    const other: string[] = [];
    for (const date of dates) {
      if (isDateInWeek(date, todayIso)) currentWeek.push(date);
      else other.push(date);
    }
    return [...currentWeek, ...other];
  }, [dates, todayIso]);

  if (dates.length === 0) return null;

  return (
    <div className="rl-simple-tabs" role="tablist" aria-label="開催日">
      {orderedDates.map((date) => {
        const isActive = date === activeDate;
        return (
          <button
            key={date}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`rl-simple-tab${isActive ? " is-active" : ""}`}
            onClick={() => onDateChange(date)}
          >
            {formatDateTab(date)}
          </button>
        );
      })}
    </div>
  );
}
