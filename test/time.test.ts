import { describe, expect, it } from "vitest";
import { formatThai, fromLocal, nextOccurrence, parseDate, resolveFireAt, toLocal, upcomingCalendar } from "../src/time";

// พฤหัสบดี 26 พ.ย. 2026 เวลา 15:00 (เวลาไทย)
const NOW = fromLocal(2026, 11, 26, 15, 0);

describe("Bangkok time", () => {
  it("round-trips local parts", () => {
    expect(toLocal(NOW)).toMatchObject({ year: 2026, month: 11, day: 26, hour: 15, minute: 0, weekday: 4 });
    expect(new Date(NOW).toISOString()).toBe("2026-11-26T08:00:00.000Z");
  });

  it("formats Thai dates with Buddhist year", () => {
    expect(formatThai(fromLocal(2026, 11, 27, 20, 0))).toBe("ศ. 27 พ.ย. 2569 เวลา 20:00");
  });

  it("accepts Buddhist-era years", () => {
    expect(parseDate("2569-12-01")).toEqual([2026, 12, 1]);
    expect(parseDate("2026-02-30")).toBeNull();
  });

  it("lists the next days with Thai weekday names", () => {
    expect(upcomingCalendar(NOW, 2)).toBe("2026-11-26 วันพฤหัสบดี (วันนี้)\n2026-11-27 วันศุกร์ (พรุ่งนี้)");
  });
});

describe("resolveFireAt", () => {
  it("uses today when the time has not passed", () => {
    expect(resolveFireAt(NOW, "", "20:00", 0, "08:00")?.fireAt).toBe(fromLocal(2026, 11, 26, 20, 0));
  });

  it("rolls to tomorrow when the time has passed", () => {
    expect(resolveFireAt(NOW, "", "09:00", 0, "08:00")?.fireAt).toBe(fromLocal(2026, 11, 27, 9, 0));
  });

  it("handles relative minutes", () => {
    expect(resolveFireAt(NOW, "", "", 30, "08:00")?.fireAt).toBe(NOW + 30 * 60_000);
  });

  it("falls back to the default time", () => {
    const r = resolveFireAt(NOW, "2026-12-01", "", 0, "08:00");
    expect(r).toEqual({ fireAt: fromLocal(2026, 12, 1, 8, 0), usedDefaultTime: true });
  });

  it("rejects malformed values", () => {
    expect(resolveFireAt(NOW, "tomorrow", "20:00", 0, "08:00")).toBeNull();
    expect(resolveFireAt(NOW, "", "25:00", 0, "08:00")).toBeNull();
  });
});

describe("nextOccurrence", () => {
  const fri = fromLocal(2026, 11, 27, 15, 0);

  it("returns null for one-time reminders", () => {
    expect(nextOccurrence(fri, "none", null, fri)).toBeNull();
  });

  it("skips weekends for weekdays", () => {
    expect(nextOccurrence(fri, "weekdays", null, fri)).toBe(fromLocal(2026, 11, 30, 15, 0));
  });

  it("adds a week", () => {
    expect(nextOccurrence(fri, "weekly", null, fri)).toBe(fromLocal(2026, 12, 4, 15, 0));
  });

  it("clamps monthly reminders to short months and keeps the anchor day", () => {
    const jan31 = fromLocal(2027, 1, 31, 9, 0);
    const feb = nextOccurrence(jan31, "monthly", 31, jan31)!;
    expect(feb).toBe(fromLocal(2027, 2, 28, 9, 0));
    expect(nextOccurrence(feb, "monthly", 31, feb)).toBe(fromLocal(2027, 3, 31, 9, 0));
  });

  it("skips occurrences missed during downtime", () => {
    const old = fromLocal(2026, 11, 20, 9, 0);
    expect(nextOccurrence(old, "daily", null, NOW)).toBe(fromLocal(2026, 11, 27, 9, 0));
  });
});
