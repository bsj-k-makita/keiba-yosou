import {
  netkeibaDbRaceUrl,
  netkeibaResultUrl,
  netkeibaShutubaUrl,
} from "../../lib/netkeibaUrls";

type Props = {
  raceId: string;
  /** detail: レース詳細ヘッダ用 / cardBar: 一覧カード下の細いバー */
  variant?: "detail" | "cardBar";
};

export function NetkeibaRaceLinks({ raceId, variant = "detail" }: Props) {
  if (!raceId?.trim()) return null;

  const cls =
    variant === "cardBar"
      ? "netkeiba-links netkeiba-links--card-bar"
      : "netkeiba-links netkeiba-links--detail";

  return (
    <p className={cls}>
      <a href={netkeibaShutubaUrl(raceId)} target="_blank" rel="noopener noreferrer">
        出馬表
      </a>
      <span className="netkeiba-links__sep" aria-hidden>
        ·
      </span>
      <a href={netkeibaResultUrl(raceId)} target="_blank" rel="noopener noreferrer">
        結果
      </a>
      <span className="netkeiba-links__sep" aria-hidden>
        ·
      </span>
      <a href={netkeibaDbRaceUrl(raceId)} target="_blank" rel="noopener noreferrer">
        データ
      </a>
      <span className="netkeiba-links__suffix">（netkeiba）</span>
    </p>
  );
}
