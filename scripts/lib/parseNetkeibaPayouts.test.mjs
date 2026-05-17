import { describe, expect, test } from "vitest";
import { fetchUtf8 } from "./netkeibaFetch.mjs";
import { parseNetkeibaPayouts } from "./parseNetkeibaPayouts.mjs";

describe("parseNetkeibaPayouts", () => {
  test("202604010301 の確定払戻をパース", () => {
    const html = fetchUtf8("https://race.netkeiba.com/race/result.html?race_id=202604010301");
    const p = parseNetkeibaPayouts(html);
    expect(p.WIN).toEqual([{ numbers: [2], dividend: 460 }]);
    expect(p.REN).toEqual([{ numbers: [2, 7], dividend: 650 }]);
    expect(p.TRI).toEqual([{ numbers: [2, 7, 13], dividend: 840 }]);
    expect(p.SHOW.length).toBe(3);
    expect(p.WREN.length).toBe(3);
  });
});
