type Props = {
  horseNumber?: number;
  horseName: string;
  mark?: string;
  className?: string;
};

/** 確定着順行: 馬番・馬名・AI印（◎○▲等） */
export function FinishPlaceLabel({ horseNumber, horseName, mark, className }: Props) {
  return (
    <span className={className ?? "finish-place-label"}>
      {horseNumber != null ? `${horseNumber}番 ` : ""}
      {horseName}
      {mark ? (
        <span className="finish-place-label__mark" aria-label={`印 ${mark}`}>
          {mark}
        </span>
      ) : null}
    </span>
  );
}
