import { describe, expect, test } from "vitest";
import { computeFormationHits } from "./markFormationHits";

describe("computeFormationHits", () => {
  const marks = [
    { horseNumber: 10, mark: "◎" },
    { horseNumber: 9, mark: "○" },
    { horseNumber: 7, mark: "▲" },
    { horseNumber: 14, mark: "☆" },
  ];

  test("◎○が1-2着なら単勝・馬連が印的中", () => {
    const hits = computeFormationHits(marks, [10, 9, 7], "CONDITIONAL_LOWER");
    expect(hits.WIN).toBe(true);
    expect(hits.MAIN_LINE).toBe(true);
  });

  test("○→◎の順でも馬連は印的中", () => {
    const hits = computeFormationHits(marks, [9, 10, 7], "CONDITIONAL_LOWER");
    expect(hits.WIN).toBe(false);
    expect(hits.MAIN_LINE).toBe(true);
  });

  test("202605020803: ◎4番1着・○2番2着なら単勝・馬連が印的中", () => {
    const marks = [
      { horseNumber: 4, mark: "◎" },
      { horseNumber: 2, mark: "○" },
      { horseNumber: 8, mark: "▲" },
      { horseNumber: 7, mark: "☆" },
    ];
    const hits = computeFormationHits(marks, [4, 2, 9], "MAIDEN_NEW");
    expect(hits.WIN).toBe(true);
    expect(hits.MAIN_LINE).toBe(true);
  });

  test("☆◎○が3着内なら3連複フォーメーションのいずれかが印的中", () => {
    const triMarks = [
      { horseNumber: 14, mark: "☆" },
      { horseNumber: 5, mark: "◎" },
      { horseNumber: 4, mark: "○" },
      { horseNumber: 10, mark: "▲" },
    ];
    const hits = computeFormationHits(triMarks, [14, 5, 4], "MAIDEN_NEW");
    expect(hits.TRIFECTA_FORM).toBe(true);
  });
});
