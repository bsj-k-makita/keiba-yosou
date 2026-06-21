import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getRaceEvaluationById, type RaceEvaluationData } from "../../../lib/race-data";
import { RaceDetailView } from "../../../components/race/RaceDetailView";

/** 開発時: JSON を書き換えたあとも画面が追従するよう間隔（ms）。本番ではポーリングしない。 */
const DEV_RACE_POLL_MS = 4000;

export function RaceDetailPage() {
  const { raceId = "" } = useParams();
  const [race, setRace] = useState<RaceEvaluationData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const initialLoadDone = useRef(false);

  useEffect(() => {
    let live = true;
    initialLoadDone.current = false;

    const loadOnce = async (isInitial: boolean) => {
      if (raceId.length === 0) {
        if (live && isInitial) {
          setLoadError("レースIDがありません。");
          setRace(null);
        }
        return;
      }
      if (isInitial) {
        setLoadError(null);
      }
      try {
        const data = await getRaceEvaluationById(raceId);
        if (!live) return;
        if (data == null) {
          if (isInitial) {
            setLoadError("レースデータが見つかりません。");
            setRace(null);
          }
          return;
        }
        setLoadError(null);
        setRace(data);
        initialLoadDone.current = true;
      } catch (error) {
        if (!live) return;
        if (isInitial || !initialLoadDone.current) {
          const msg = error instanceof Error ? error.message : "レース情報の取得に失敗しました。";
          setLoadError(msg);
          setRace(null);
        }
      }
    };

    void loadOnce(true);

    let interval: ReturnType<typeof setInterval> | undefined;
    if (import.meta.env.DEV) {
      interval = setInterval(() => {
        void loadOnce(false);
      }, DEV_RACE_POLL_MS);
    }

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void loadOnce(false);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      live = false;
      if (interval != null) clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [raceId]);

  if (loadError != null) {
    return (
      <div className="app app--loading" role="alert">
        <p className="app__lead">{loadError}</p>
        <p className="app__meta">
          <Link to="/races">← レース一覧</Link>
        </p>
      </div>
    );
  }

  if (race == null) {
    return (
      <div className="app app--loading" aria-busy="true">
        <p className="app__lead">出馬表を読み込み中…</p>
        <p className="app__meta">
          <Link to="/races">← レース一覧</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="rl-page rl-page--simple rl-page--full-width">
      <nav className="rl-simple-head rl-simple-head--back" aria-label="パンくず">
        <Link to="/races" className="rl-simple-back">
          ← レース一覧
        </Link>
      </nav>
      {import.meta.env.DEV ? (
        <p className="rl-simple-message" aria-live="polite">
          開発モード: レースJSONの変更は約 {DEV_RACE_POLL_MS / 1000} 秒ごとに自動反映されます。
        </p>
      ) : null}
      <RaceDetailView key={race.raceId} race={race} />
    </div>
  );
}
