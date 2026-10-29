import { describe, expect, it } from "vitest";
import { expandSeries, seriesUntil, truncateRuleBefore, describeRule } from "@/lib/recurrence";

const TZ = "America/Toronto";

describe("recurrence across DST (America/Toronto)", () => {
  it("keeps 9:00 local time when clocks fall back on 2026-11-01", () => {
    const series = {
      start_at: "2026-10-26T13:00:00.000Z", // Mon 09:00 EDT
      end_at: "2026-10-26T14:00:00.000Z",
      all_day: false,
      timezone: TZ,
      rrule: "FREQ=WEEKLY;BYDAY=MO",
    };
    const occ = expandSeries(series, new Date("2026-10-25T00:00:00Z"), new Date("2026-11-10T00:00:00Z"));
    expect(occ.map((o) => o.start.toISOString())).toEqual([
      "2026-10-26T13:00:00.000Z", // 09:00 EDT (UTC-4)
      "2026-11-02T14:00:00.000Z", // 09:00 EST (UTC-5)
      "2026-11-09T14:00:00.000Z",
    ]);
    expect(occ[1].end.toISOString()).toBe("2026-11-02T15:00:00.000Z");
  });

  it("keeps 9:00 local time when clocks spring forward on 2027-03-14", () => {
    const series = { start_at: "2027-03-12T14:00:00.000Z", end_at: "2027-03-12T15:00:00.000Z", all_day: false, timezone: TZ, rrule: "FREQ=DAILY;COUNT=4" };
    const occ = expandSeries(series, new Date("2027-03-01T00:00:00Z"), new Date("2027-04-01T00:00:00Z"));
    expect(occ.map((o) => o.start.toISOString())).toEqual([
      "2027-03-12T14:00:00.000Z",
      "2027-03-13T14:00:00.000Z",
      "2027-03-14T13:00:00.000Z",
      "2027-03-15T13:00:00.000Z",
    ]);
  });

  it("skips excluded dates", () => {
    const series = {
      start_at: "2026-11-02T14:00:00.000Z",
      end_at: "2026-11-02T15:00:00.000Z",
      all_day: false,
      timezone: TZ,
      rrule: "FREQ=DAILY",
      exdates: ["2026-11-03T14:00:00.000Z"],
    };
    const occ = expandSeries(series, new Date("2026-11-02T00:00:00Z"), new Date("2026-11-05T05:00:00Z"));
    expect(occ.map((o) => o.start.toISOString())).toEqual(["2026-11-02T14:00:00.000Z", "2026-11-04T14:00:00.000Z"]);
  });

  it("returns occurrences that started before the range but still overlap", () => {
    const series = { start_at: "2026-11-02T14:00:00.000Z", end_at: "2026-11-02T18:00:00.000Z", all_day: false, timezone: TZ, rrule: "FREQ=DAILY" };
    const occ = expandSeries(series, new Date("2026-11-03T16:00:00Z"), new Date("2026-11-03T17:00:00Z"));
    expect(occ).toHaveLength(1);
    expect(occ[0].start.toISOString()).toBe("2026-11-03T14:00:00.000Z");
  });

  it("computes series end and truncation", () => {
    const start = new Date("2026-11-02T14:00:00.000Z");
    expect(seriesUntil("FREQ=DAILY", start, TZ)).toBeNull();
    expect(seriesUntil("FREQ=DAILY;COUNT=3", start, TZ)?.toISOString()).toBe("2026-11-04T14:00:00.000Z");
    const truncated = truncateRuleBefore("FREQ=DAILY", start, new Date("2026-11-05T14:00:00.000Z"), TZ)!;
    const occ = expandSeries({ start_at: start, end_at: new Date("2026-11-02T15:00:00Z"), all_day: false, timezone: TZ, rrule: truncated }, new Date("2026-11-01T00:00:00Z"), new Date("2026-12-01T00:00:00Z"));
    expect(occ).toHaveLength(3);
    expect(describeRule("FREQ=WEEKLY;BYDAY=MO,WE")).toBe("Chaque semaine (lun., mer.)");
  });
});
