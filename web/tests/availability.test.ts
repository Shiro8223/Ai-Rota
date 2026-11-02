import { describe, expect, it } from "vitest";
import { activeTemporary, availabilityFor } from "@/lib/availability";
import { tempRange, windowsText } from "@/lib/format";
import { anyWeek, emptyWeek } from "@/lib/time";
import type { Availability } from "@/lib/types";

const base = (over: Partial<Availability>): Availability => ({
  id: Math.random().toString(36), storeId: "s", employeeId: "harry", kind: "default", startWeek: null, endWeek: null, days: anyWeek(),
  status: "approved", note: "", requestedBy: "x", decidedBy: "x", decidedAt: "2026-01-01", updatedAt: "2026-01-01", ...over,
});
const exams = { ...emptyWeek(), sat: [{ from: "00:00", to: "24:00" }] };

describe("availabilityFor", () => {
  const rows = [
    base({}),
    base({ kind: "temporary", startWeek: "2026-11-09", endWeek: "2026-11-23", days: exams, note: "Exams" }),
    base({ kind: "default", status: "pending", days: emptyWeek() }),
    base({ employeeId: "grace", kind: "temporary", startWeek: "2026-11-09", endWeek: "2026-11-09", status: "pending", days: emptyWeek() }),
  ];
  it("uses the usual pattern outside a temporary period", () => {
    expect(availabilityFor(rows, "2026-11-02").harry.mon).toHaveLength(1);
    expect(availabilityFor(rows, "2026-11-30").harry.mon).toHaveLength(1); // reverted by itself
  });
  it("uses the approved temporary pattern inside its weeks", () => {
    expect(availabilityFor(rows, "2026-11-16").harry.mon).toEqual([]);
    expect(availabilityFor(rows, "2026-11-23").harry.sat).toHaveLength(1);
  });
  it("ignores pending requests", () => {
    expect(availabilityFor(rows, "2026-11-02").harry).toEqual(anyWeek());
    expect(availabilityFor(rows, "2026-11-09").grace).toBeUndefined();
  });
  it("labels the active temporary period", () => {
    expect(activeTemporary(rows, "harry", "2026-11-16")?.note).toBe("Exams");
    expect(tempRange(rows[1])).toBe("9 Nov – 29 Nov · 3 weeks");
  });
  it("formats windows", () => {
    expect(windowsText([])).toBe("Off");
    expect(windowsText([{ from: "00:00", to: "24:00" }])).toBe("Any time");
    expect(windowsText([{ from: "16:00", to: "23:00" }])).toBe("16:00–23:00");
  });
});
