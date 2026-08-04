import { describe, expect, it } from "vitest";
import { describeCron, isValidCron, matches, nextRun, parseCron } from "@/lib/cron";

const at = (y: number, mo: number, d: number, h: number, mi: number) =>
  new Date(y, mo - 1, d, h, mi, 0, 0);

describe("parseCron", () => {
  it("accepts the five-field forms people actually write", () => {
    for (const expr of [
      "* * * * *",
      "0 9 * * *",
      "*/15 * * * *",
      "0 8 * * 1-5",
      "30 6,18 * * *",
      "0 0 1 * *",
      "0 9 * * mon",
      "0 0 1 jan *",
      "15 2-6/2 * * *",
    ]) {
      expect(isValidCron(expr), expr).toBe(true);
    }
  });

  it("rejects malformed expressions rather than silently never firing", () => {
    for (const expr of [
      "",
      "* * * *",
      "* * * * * *",
      "60 * * * *",
      "* 24 * * *",
      "0 0 32 * *",
      "0 0 * 13 *",
      "0 0 * * 8",
      "*/0 * * * *",
      "9-5 * * * *",
      "abc * * * *",
    ]) {
      expect(isValidCron(expr), expr).toBe(false);
    }
  });

  it("expands the @-presets", () => {
    expect(isValidCron("@daily")).toBe(true);
    expect(matches(parseCron("@daily")!, at(2026, 8, 4, 0, 0))).toBe(true);
    expect(matches(parseCron("@daily")!, at(2026, 8, 4, 1, 0))).toBe(false);
  });

  it("treats 7 as Sunday, like every other crontab", () => {
    const sunday = at(2026, 8, 2, 9, 0);
    expect(matches(parseCron("0 9 * * 7")!, sunday)).toBe(true);
    expect(matches(parseCron("0 9 * * 0")!, sunday)).toBe(true);
  });
});

describe("matches", () => {
  it("fires only on the minute it names", () => {
    const c = parseCron("30 14 * * *")!;
    expect(matches(c, at(2026, 8, 4, 14, 30))).toBe(true);
    expect(matches(c, at(2026, 8, 4, 14, 31))).toBe(false);
    expect(matches(c, at(2026, 8, 4, 13, 30))).toBe(false);
  });

  it("handles steps", () => {
    const c = parseCron("*/15 * * * *")!;
    expect(matches(c, at(2026, 8, 4, 3, 0))).toBe(true);
    expect(matches(c, at(2026, 8, 4, 3, 15))).toBe(true);
    expect(matches(c, at(2026, 8, 4, 3, 16))).toBe(false);
  });

  it("weekday ranges skip the weekend", () => {
    const c = parseCron("0 8 * * 1-5")!;
    expect(matches(c, at(2026, 8, 3, 8, 0))).toBe(true); // Monday
    expect(matches(c, at(2026, 8, 7, 8, 0))).toBe(true); // Friday
    expect(matches(c, at(2026, 8, 8, 8, 0))).toBe(false); // Saturday
  });

  it("ORs day-of-month with day-of-week when both are restricted", () => {
    // Real crontab behaviour, and the one everybody gets wrong: this fires on
    // the 1st *or* on any Monday, not on Mondays that fall on the 1st.
    const c = parseCron("0 0 1 * 1")!;
    expect(matches(c, at(2026, 8, 1, 0, 0))).toBe(true); // the 1st, a Saturday
    expect(matches(c, at(2026, 8, 3, 0, 0))).toBe(true); // a Monday, the 3rd
    expect(matches(c, at(2026, 8, 5, 0, 0))).toBe(false); // neither
  });
});

describe("nextRun", () => {
  it("finds the next firing strictly in the future", () => {
    const from = at(2026, 8, 4, 9, 0);
    const next = nextRun("0 9 * * *", from)!;
    expect(next.getDate()).toBe(5);
    expect(next.getHours()).toBe(9);
    expect(next.getMinutes()).toBe(0);
  });

  it("crosses a month boundary", () => {
    const next = nextRun("0 0 1 * *", at(2026, 8, 20, 12, 0))!;
    expect(next.getMonth()).toBe(8); // September, zero-indexed
    expect(next.getDate()).toBe(1);
  });

  it("returns null for an unparseable expression", () => {
    expect(nextRun("nope")).toBeNull();
  });
});

describe("describeCron", () => {
  it("reads back the common shapes in English", () => {
    expect(describeCron("0 9 * * *")).toBe("daily at 9:00 am");
    expect(describeCron("0 8 * * 1-5")).toBe("weekdays at 8:00 am");
    expect(describeCron("*/30 * * * *")).toBe("every 30 minutes");
    expect(describeCron("0 13 * * *")).toBe("daily at 1:00 pm");
    expect(describeCron("0 0 * * *")).toBe("daily at 12:00 am");
  });

  it("falls back to the raw expression when it has nothing better", () => {
    expect(describeCron("7 3 */2 6 4")).toBe("7 3 */2 6 4");
  });
});
