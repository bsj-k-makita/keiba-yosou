import { describe, expect, it } from "vitest";
import {
  estimatePostTimeHm,
  isMarkFrozen,
  markFreezeStartsAtMs,
  parsePostTimeHm,
  racePostTimeMs,
} from "./markFreeze";

describe("markFreeze", () => {
  it("parses HH:MM post time", () => {
    expect(parsePostTimeHm("10:30")).toEqual({ hour: 10, minute: 30 });
  });

  it("estimates post time from race number", () => {
    expect(estimatePostTimeHm(1)).toEqual({ hour: 10, minute: 0 });
    expect(estimatePostTimeHm(4)).toEqual({ hour: 11, minute: 30 });
  });

  it("freezes 30 minutes before post", () => {
    const info = { date: "2026-05-23", raceNumber: 4, postTime: "11:30" };
    const postMs = racePostTimeMs(info);
    const freezeMs = markFreezeStartsAtMs(info);
    expect(freezeMs).toBe(postMs - 30 * 60 * 1000);
    expect(isMarkFrozen(info, new Date(freezeMs))).toBe(true);
    expect(isMarkFrozen(info, new Date(freezeMs - 60_000))).toBe(false);
  });
});
