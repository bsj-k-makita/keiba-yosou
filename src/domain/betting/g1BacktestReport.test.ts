import { describe, test } from "vitest";
import { collectBacktestRaceInputs } from "./runFullBacktest";
import { runBacktestOnRace } from "./runBacktest";
import { resolveClassTier } from "../race-evaluation/raceClassLevel";
import { resolvePlaceToHorseId } from "../race-evaluation/markHitAnalysis";
import { computeFormationHits, hasAnyFormationHit } from "./markFormationHits";
import type { MarkedHorseRef } from "./bettingRules";
import type { BetTicketType } from "./types";

const resultJsonLoaders = import.meta.glob<{ default: { places?: { place: number; horseId?: string; horseNumber?: number }[] } }>(
  "../../data/results/*.json",
  { eager: true },
);

function resultPlaces(raceId: string) {
  const key = Object.keys(resultJsonLoaders).find((k) => k.endsWith(`/${raceId}.json`));
  if (!key) return [];
  return resultJsonLoaders[key]!.default.places ?? [];
}

function favoriteFinishPlace(
  places: { place: number; horseId?: string; horseNumber?: number }[],
  horses: { horseId: string; gate?: number }[],
  favoriteGate: number | undefined,
): number | null {
  if (favoriteGate == null) return null;
  const favHorse = horses.find((h) => h.gate === favoriteGate);
  if (!favHorse) return null;
  for (const p of places) {
    const hid = resolvePlaceToHorseId(p, horses as never);
    if (hid === favHorse.horseId) return p.place;
    if (p.horseNumber === favoriteGate) return p.place;
  }
  return null;
}

describe("G1 backtest report", () => {
  test("print G1 formation hit rates and favorite finish", () => {
    const inputs = collectBacktestRaceInputs();
    const g1Outputs: {
      raceName: string;
      date: string;
      detail: ReturnType<typeof runBacktestOnRace> extends infer O ? (O extends { detail: infer D } ? D : never) : never;
      favoritePlace: number | null;
      favoriteGate: number | undefined;
    }[] = [];

    const formationCounts: Record<BetTicketType, number> = {
      WIN: 0,
      MAIN_LINE: 0,
      WIDE: 0,
      TRIFECTA_FORM: 0,
    };
    const purchasedHitCounts: Record<BetTicketType, number> = {
      WIN: 0,
      MAIN_LINE: 0,
      WIDE: 0,
      TRIFECTA_FORM: 0,
    };
    let anyFormation = 0;
    let races = 0;
    let favWin = 0;
    let favShow = 0;
    let markedHorsesTotal = 0;
    let markedHorsesTop3 = 0;

    for (const input of inputs) {
      if (resolveClassTier(input.condition) !== "G1_CLASS") continue;
      const out = runBacktestOnRace(input, { probabilityEngine: "ai" });
      if (!out || out.result.skippedReason === "no_marks" || out.result.skippedReason === "insufficient_results") {
        continue;
      }
      races += 1;
      const d = out.detail;
      const tickets = d.tickets;
      const marksFromDetail: MarkedHorseRef[] = Object.entries(d.aiMarks)
        .filter(([, m]) => m && m !== "─")
        .map(([gate, mark]) => ({
          horseNumber: Number(gate),
          mark: mark as MarkedHorseRef["mark"],
        }));
      const formationHits = computeFormationHits(
        marksFromDetail,
        d.actualResults,
        d.classTier,
        "ai",
      );
      for (const t of ["WIN", "MAIN_LINE", "WIDE", "TRIFECTA_FORM"] as const) {
        if (formationHits[t]) formationCounts[t] += 1;
        if (tickets[t].isHit) purchasedHitCounts[t] += 1;
      }
      if (hasAnyFormationHit(formationHits)) {
        anyFormation += 1;
      }
      if (out.result.favoriteWinHit) favWin += 1;
      if (out.result.favoriteShowHit) favShow += 1;

      const horses = input.horses.map((h) => ({
        horseId: h.horseId,
        gate: (h as { gate?: number }).gate,
      }));
      const favGate = Object.entries(d.aiMarks).find(([, m]) => m === "◎")?.[0];
      const favoriteGate = favGate != null ? Number(favGate) : undefined;
      const places = resultPlaces(input.raceId);
      const favoritePlace = favoriteFinishPlace(places, horses, favoriteGate);

      const top3HorseIds = new Set(
        [...places]
          .sort((a, b) => a.place - b.place)
          .slice(0, 3)
          .map((p) => resolvePlaceToHorseId(p, input.horses))
          .filter((id): id is string => id != null),
      );
      for (const [gateStr, mark] of Object.entries(d.aiMarks)) {
        if (!mark || mark === "─") continue;
        const gate = Number(gateStr);
        const h = input.horses.find((x) => (x as { gate?: number }).gate === gate);
        if (!h) continue;
        markedHorsesTotal += 1;
        if (top3HorseIds.has(h.horseId)) markedHorsesTop3 += 1;
      }

      g1Outputs.push({
        raceName: input.meta.raceName ?? input.raceId,
        date: input.meta.date,
        detail: d,
        favoritePlace,
        favoriteGate,
      });
    }

    g1Outputs.sort((a, b) => a.date.localeCompare(b.date) || a.raceName.localeCompare(b.raceName));

    const pct = (n: number) => (races > 0 ? Math.round((n / races) * 1000) / 10 : 0);

    // eslint-disable-next-line no-console
    console.log("\n=== G1 集計（AI印・結果JSONあり） ===");
    // eslint-disable-next-line no-console
    console.log(`対象: ${races}レース`);
    // eslint-disable-next-line no-console
    console.log("\n【印フォーメーション的中率】レース単位（購入有無と独立）");
    // eslint-disable-next-line no-console
    console.log(`  単勝◎:     ${formationCounts.WIN}/${races} = ${pct(formationCounts.WIN)}%`);
    // eslint-disable-next-line no-console
    console.log(`  馬連◎○:   ${formationCounts.MAIN_LINE}/${races} = ${pct(formationCounts.MAIN_LINE)}%`);
    // eslint-disable-next-line no-console
    console.log(`  ワイド◎-印: ${formationCounts.WIDE}/${races} = ${pct(formationCounts.WIDE)}%`);
    // eslint-disable-next-line no-console
    console.log(`  3連複フォーメ: ${formationCounts.TRIFECTA_FORM}/${races} = ${pct(formationCounts.TRIFECTA_FORM)}%`);
    // eslint-disable-next-line no-console
    console.log(`  いずれか印的中: ${anyFormation}/${races} = ${pct(anyFormation)}%`);

    // eslint-disable-next-line no-console
    console.log("\n【購入券的中率】レース単位（その券種で1点でも払戻あり）");
    // eslint-disable-next-line no-console
    console.log(`  単勝◎:     ${purchasedHitCounts.WIN}/${races} = ${pct(purchasedHitCounts.WIN)}%`);
    // eslint-disable-next-line no-console
    console.log(`  馬連◎○:   ${purchasedHitCounts.MAIN_LINE}/${races} = ${pct(purchasedHitCounts.MAIN_LINE)}%`);
    // eslint-disable-next-line no-console
    console.log(`  ワイド◎-印: ${purchasedHitCounts.WIDE}/${races} = ${pct(purchasedHitCounts.WIDE)}%`);
    // eslint-disable-next-line no-console
    console.log(`  3連複フォーメ: ${purchasedHitCounts.TRIFECTA_FORM}/${races} = ${pct(purchasedHitCounts.TRIFECTA_FORM)}%`);

    // eslint-disable-next-line no-console
    console.log("\n【◎本命】");
    // eslint-disable-next-line no-console
    console.log(`  勝率(1着): ${favWin}/${races} = ${pct(favWin)}%`);
    // eslint-disable-next-line no-console
    console.log(`  3着内率:   ${favShow}/${races} = ${pct(favShow)}%`);

    const markedTop3Pct =
      markedHorsesTotal > 0 ? Math.round((markedHorsesTop3 / markedHorsesTotal) * 1000) / 10 : 0;
    // eslint-disable-next-line no-console
    console.log("\n【印付き馬の3着内率】（◎○▲☆△の各頭）");
    // eslint-disable-next-line no-console
    console.log(`  ${markedHorsesTop3}/${markedHorsesTotal}頭 = ${markedTop3Pct}%`);

    // eslint-disable-next-line no-console
    console.log("\n【G1レース別 ◎着順】");
    for (const r of g1Outputs) {
      const place =
        r.favoritePlace != null
          ? r.favoritePlace === 1
            ? "1着"
            : `${r.favoritePlace}着`
          : "着順不明";
      // eslint-disable-next-line no-console
      console.log(`${r.raceName}：${place}`);
    }
  });
});
