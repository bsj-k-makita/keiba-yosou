import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getRaceEvaluationById, getRaceIndex, type RaceEvaluationData, type RaceIndexItem } from "../../../lib/race-data";
import { RaceDetailView } from "../../../components/race/RaceDetailView";

export function RaceDetailPage() {
  const { raceId = "" } = useParams();
  const [race, setRace] = useState<RaceEvaluationData | null>(null);
  const [raceIndex, setRaceIndex] = useState<RaceIndexItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void getRaceIndex().then((idx) => {
      if (live) setRaceIndex(idx);
    });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    let live = true;
    void (async () => {
      if (raceId.length === 0) {
        if (live) {
          setLoadError("レースIDがありません。");
          setRace(null);
        }
        return;
      }
      setLoadError(null);
      let data: RaceEvaluationData | null = null;
      try {
        data = await getRaceEvaluationById(raceId);
      } catch (error) {
        if (live) {
          const msg = error instanceof Error ? error.message : "レース情報の取得に失敗しました。";
          setLoadError(msg);
          setRace(null);
        }
        return;
      }
      if (!live) return;
      if (data == null) {
        setLoadError("レースデータが見つかりません。");
        setRace(null);
        return;
      }
      setRace(data);
    })();
    return () => {
      live = false;
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
    <div>
      <nav className="app__nav" aria-label="パンくず">
        <Link to="/races" className="app__back-link">
          ← レース一覧
        </Link>
      </nav>
      <RaceDetailView key={race.raceId} race={race} raceIndex={raceIndex} />
    </div>
  );
}
