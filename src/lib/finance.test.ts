import { describe, expect, it } from "vitest";
import {
  addMonthsClamped,
  aggregateFinance,
  centsToInput,
  financeTotals,
  monthKey,
  parseMoneyInput,
  recurringDates,
} from "./finance";

describe("monthKey", () => {
  it("extracts YYYY-MM from date and ISO strings", () => {
    expect(monthKey("2026-08-25")).toBe("2026-08");
    expect(monthKey("2026-08-25T00:00:00.000Z")).toBe("2026-08");
  });
});

describe("addMonthsClamped", () => {
  it("adds months within a year", () => {
    expect(addMonthsClamped("2026-01-15", 1)).toBe("2026-02-15");
  });
  it("crosses year boundaries", () => {
    expect(addMonthsClamped("2026-11-10", 3)).toBe("2027-02-10");
    expect(addMonthsClamped("2026-01-31", 12)).toBe("2027-01-31");
  });
  it("clamps to short months", () => {
    expect(addMonthsClamped("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsClamped("2024-01-31", 1)).toBe("2024-02-29"); // leap
  });
});

describe("recurringDates", () => {
  it("generates start + N-1 monthly repeats", () => {
    expect(recurringDates("2026-03-15", 3)).toEqual([
      "2026-03-15",
      "2026-04-15",
      "2026-05-15",
    ]);
  });
  it("returns just the start for 1 occurrence", () => {
    expect(recurringDates("2026-03-31", 1)).toEqual(["2026-03-31"]);
  });
});

describe("parseMoneyInput", () => {
  it("parses decimals to cents", () => {
    expect(parseMoneyInput("145.90")).toBe(14590);
    expect(parseMoneyInput("145,90")).toBe(14590);
    expect(parseMoneyInput("145")).toBe(14500);
    expect(parseMoneyInput("0.05")).toBe(5);
  });
  it("rejects garbage and negatives", () => {
    expect(parseMoneyInput("abc")).toBeNull();
    expect(parseMoneyInput("-10")).toBeNull();
    expect(parseMoneyInput("12.345")).toBeNull();
    expect(parseMoneyInput("")).toBeNull();
  });
});

describe("centsToInput", () => {
  it("formats cents for inputs", () => {
    expect(centsToInput(14590)).toBe("145.90");
    expect(centsToInput(0)).toBe("0.00");
  });
});

describe("aggregateFinance", () => {
  it("buckets income by check-in month and expenses by date month", () => {
    const months = aggregateFinance(
      [
        { checkIn: "2026-08-10", propertyId: 1, grossCents: 50000, payoutCents: 42000 },
        { checkIn: "2026-08-20", propertyId: 1, grossCents: 30000, payoutCents: 25000 },
        { checkIn: "2026-09-01", propertyId: 2, grossCents: 10000, payoutCents: 9000 },
      ],
      [{ date: "2026-08-05", propertyId: 1, category: "cleaning", amountCents: 4000 }],
    );
    const aug = months.get("2026-08")!;
    expect(aug.grossCents).toBe(80000);
    expect(aug.payoutCents).toBe(67000);
    expect(aug.expenseCents).toBe(4000);
    expect(aug.netCents).toBe(63000);
    expect(months.get("2026-09")!.payoutCents).toBe(9000);
  });

  it("falls back to gross for net when payout is unset", () => {
    const months = aggregateFinance(
      [{ checkIn: "2026-08-10", propertyId: 1, grossCents: 50000 }],
      [],
    );
    expect(months.get("2026-08")!.payoutCents).toBe(50000);
  });

  it("skips money-free stays but still creates expense-only months", () => {
    const months = aggregateFinance(
      [{ checkIn: "2026-08-10", propertyId: 1 }],
      [{ date: "2026-07-01", propertyId: 1, category: "electricity", amountCents: 90000 }],
    );
    expect(months.has("2026-08")).toBe(false);
    expect(months.get("2026-07")!.netCents).toBe(-90000);
  });
});

describe("financeTotals", () => {
  it("sums months and derives ADR / RevPAR", () => {
    const months = aggregateFinance(
      [{ checkIn: "2026-08-01", propertyId: 1, grossCents: 30000, payoutCents: 27000 }],
      [{ date: "2026-08-02", propertyId: 1, category: "other", amountCents: 5000 }],
    );
    const t = financeTotals(months.values(), 3, 31);
    expect(t.payoutCents).toBe(27000);
    expect(t.netCents).toBe(22000);
    expect(t.adrCents).toBe(10000); // 30000/3 nights
    expect(t.revparCents).toBe(Math.round(30000 / 31));
  });

  it("returns zero rates with no nights/days", () => {
    const t = financeTotals([], 0, 0);
    expect(t.adrCents).toBe(0);
    expect(t.revparCents).toBe(0);
  });
});
