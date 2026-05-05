import type { HorseAbility } from "../../domain/race-evaluation";

function gateName(h: HorseAbility): string {
  const g =
    "gate" in h && typeof (h as { gate?: number }).gate === "number"
      ? (h as { gate?: number }).gate
      : undefined;
  return g != null ? `${g}番 ${h.horseName}` : h.horseName;
}

type Props = {
  peers: HorseAbility[];
};

/** L1 距離が小さい＝同タイプ（カード用） */
export function TypeMatchList({ peers }: Props) {
  if (peers.length === 0) {
    return (
      <div className="type-match-block">
        <p className="type-match">
          <strong>同タイプ：</strong>—
        </p>
      </div>
    );
  }
  return (
    <div className="type-match-block">
      <p className="type-match">
        <strong>同タイプ：</strong>
        {peers.map((h) => gateName(h)).join("、")}
      </p>
      <p className="type-match__hint">一緒に買う候補（能力プロファイルが近い馬）</p>
    </div>
  );
}
