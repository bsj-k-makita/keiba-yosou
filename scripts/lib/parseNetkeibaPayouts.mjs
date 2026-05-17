import { load } from "cheerio";

/**
 * @typedef {{ numbers: number[]; dividend: number }} PayoutRow
 * @typedef {{
 *   WIN: PayoutRow[];
 *   SHOW: PayoutRow[];
 *   REN: PayoutRow[];
 *   WREN: PayoutRow[];
 *   TRI: PayoutRow[];
 * }} NetkeibaPayouts
 */

function parseYenList(raw) {
  const matches = String(raw ?? "").match(/\d[\d,]*円/g) ?? [];
  return matches.map((m) => parseInt(m.replace(/[^\d]/g, ""), 10)).filter((n) => Number.isFinite(n) && n > 0);
}

function parseHorseNumbers(raw) {
  return String(raw ?? "")
    .trim()
    .split(/\s+/)
    .map((t) => parseInt(t.replace(/[^\d]/g, ""), 10))
    .filter((n) => Number.isFinite(n) && n >= 1);
}

function sortNums(nums) {
  return [...nums].sort((a, b) => a - b);
}

/**
 * race.netkeiba.com の result.html から確定払戻を抽出する。
 * @param {string} html
 * @returns {NetkeibaPayouts}
 */
export function parseNetkeibaPayouts(html) {
  const $ = load(html);
  /** @type {NetkeibaPayouts} */
  const payouts = {
    WIN: [],
    SHOW: [],
    REN: [],
    WREN: [],
    TRI: [],
  };

  $("table.Payout_Detail_Table tr").each((_, tr) => {
    const cells = $(tr)
      .find("th,td")
      .toArray()
      .map((c) =>
        $(c)
          .text()
          .replace(/\s+/g, " ")
          .trim(),
      );
    if (cells.length < 3) return;

    const kind = cells[0];
    const numsRaw = cells[1];
    const payRaw = cells[2];
    const dividends = parseYenList(payRaw);
    if (dividends.length === 0) return;

    if (kind === "単勝") {
      const nums = parseHorseNumbers(numsRaw);
      if (nums[0] != null && dividends[0] != null) {
        payouts.WIN.push({ numbers: [nums[0]], dividend: dividends[0] });
      }
      return;
    }

    if (kind === "複勝") {
      const nums = parseHorseNumbers(numsRaw);
      nums.forEach((n, i) => {
        if (dividends[i] != null) payouts.SHOW.push({ numbers: [n], dividend: dividends[i] });
      });
      return;
    }

    if (kind === "馬連") {
      const nums = parseHorseNumbers(numsRaw);
      if (nums.length >= 2 && dividends[0] != null) {
        payouts.REN.push({ numbers: sortNums(nums.slice(0, 2)), dividend: dividends[0] });
      }
      return;
    }

    if (kind === "ワイド") {
      const nums = parseHorseNumbers(numsRaw);
      const pairs = [];
      for (let i = 0; i + 1 < nums.length; i += 2) {
        pairs.push(sortNums([nums[i], nums[i + 1]]));
      }
      pairs.forEach((p, i) => {
        if (dividends[i] != null) payouts.WREN.push({ numbers: p, dividend: dividends[i] });
      });
      return;
    }

    if (kind === "3連複") {
      const nums = parseHorseNumbers(numsRaw);
      if (nums.length >= 3 && dividends[0] != null) {
        payouts.TRI.push({ numbers: sortNums(nums.slice(0, 3)), dividend: dividends[0] });
      }
    }
  });

  return payouts;
}
