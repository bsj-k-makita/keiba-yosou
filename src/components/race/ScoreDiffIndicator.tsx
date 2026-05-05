type Props = {
  diff: number;
};

/**
 * +2 以上: ▲ 大幅上昇
 * -2 以下: ▼ 大幅下降
 * 0: 変化なし
 * 以外: 変化小
 */
export function ScoreDiffIndicator({ diff }: Props) {
  const s = diff >= 0 ? "+" : "";
  const n = diff.toFixed(1);

  if (diff === 0) {
    return (
      <p className="score-diff score-diff--flat" role="status">
        <span className="score-diff__arr" aria-hidden>
          →
        </span>
        変化なし
      </p>
    );
  }
  if (diff >= 2) {
    return (
      <p className="score-diff score-diff--up" role="status">
        <span className="score-diff__arr" aria-hidden>
          ▲
        </span>
        大幅上昇（{s}
        {n}）
      </p>
    );
  }
  if (diff <= -2) {
    return (
      <p className="score-diff score-diff--down" role="status">
        <span className="score-diff__arr" aria-hidden>
          ▼
        </span>
        大幅下降（{n}）
      </p>
    );
  }
  return (
    <p className="score-diff score-diff--small" role="status">
      <span className="score-diff__arr" aria-hidden>
        →
      </span>
      変化小（{s}
      {n}）
    </p>
  );
}
