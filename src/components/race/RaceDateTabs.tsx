import { useEffect, useMemo, useRef } from "react";
import { isDateInWeek } from "../../domain/race-evaluation/weeklyTopEvRaces";

type Props = {
  dates: readonly string[];
  activeDate: string | null;
  todayIso: string;
  formatDateTab: (dateStr: string) => string;
  onDateChange: (date: string) => void;
};

function splitDatesByWeek(dates: readonly string[], todayIso: string) {
  const currentWeekDates: string[] = [];
  const otherDates: string[] = [];
  for (const date of dates) {
    if (isDateInWeek(date, todayIso)) currentWeekDates.push(date);
    else otherDates.push(date);
  }
  return { currentWeekDates, otherDates };
}

function DateTabButton({
  date,
  activeDate,
  formatDateTab,
  onDateChange,
}: {
  date: string;
  activeDate: string | null;
  formatDateTab: (dateStr: string) => string;
  onDateChange: (date: string) => void;
}) {
  const isActive = date === activeDate;
  return (
    <button
      type="button"
      role="tab"
      data-date={date}
      aria-selected={isActive}
      className={`rl-date-tab border border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100${isActive ? " rl-date-tab--active border-cyan-500/70 bg-zinc-800 text-cyan-300" : ""}`}
      onClick={() => onDateChange(date)}
    >
      {formatDateTab(date)}
    </button>
  );
}

export function RaceDateTabs({ dates, activeDate, todayIso, formatDateTab, onDateChange }: Props) {
  const carouselRef = useRef<HTMLDivElement>(null);
  const { currentWeekDates, otherDates } = useMemo(
    () => splitDatesByWeek(dates, todayIso),
    [dates, todayIso],
  );

  useEffect(() => {
    if (activeDate == null || !otherDates.includes(activeDate)) return;
    const track = carouselRef.current;
    if (track == null) return;
    const tab = track.querySelector<HTMLElement>(`[data-date="${activeDate}"]`);
    tab?.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
  }, [activeDate, otherDates]);

  const scrollCarousel = (direction: -1 | 1) => {
    carouselRef.current?.scrollBy({ left: direction * 220, behavior: "smooth" });
  };

  if (dates.length === 0) return null;

  return (
    <div className="rl-date-picker border-y border-zinc-800 bg-zinc-950/90">
      {currentWeekDates.length > 0 ? (
        <section className="rl-date-picker__week" aria-label="当週の開催日">
          <p className="rl-date-picker__label">当週</p>
          <div className="rl-date-picker__week-tabs" role="tablist">
            {currentWeekDates.map((date) => (
              <DateTabButton
                key={date}
                date={date}
                activeDate={activeDate}
                formatDateTab={formatDateTab}
                onDateChange={onDateChange}
              />
            ))}
          </div>
        </section>
      ) : null}

      {otherDates.length > 0 ? (
        <section className="rl-date-picker__carousel-wrap" aria-label="その他の開催日">
          <p className="rl-date-picker__label">その他</p>
          <button
            type="button"
            className="rl-date-carousel__btn"
            aria-label="前の開催日"
            onClick={() => scrollCarousel(-1)}
          >
            ‹
          </button>
          <div ref={carouselRef} className="rl-date-carousel__track" role="tablist">
            {otherDates.map((date) => (
              <DateTabButton
                key={date}
                date={date}
                activeDate={activeDate}
                formatDateTab={formatDateTab}
                onDateChange={onDateChange}
              />
            ))}
          </div>
          <button
            type="button"
            className="rl-date-carousel__btn"
            aria-label="次の開催日"
            onClick={() => scrollCarousel(1)}
          >
            ›
          </button>
        </section>
      ) : null}
    </div>
  );
}
