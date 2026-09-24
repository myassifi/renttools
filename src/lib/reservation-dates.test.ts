import { describe, expect, it } from "vitest";
import {
  parseReservationDate,
  reservationNights,
  toReservationDateInput,
  validateReservationDateRange,
} from "./reservation-dates";

describe("reservation date helpers", () => {
  it("normalises date-only and API ISO values to the same calendar day", () => {
    expect(parseReservationDate("2026-08-18")?.toISOString()).toBe("2026-08-18T00:00:00.000Z");
    expect(toReservationDateInput("2026-08-18T00:00:00.000Z")).toBe("2026-08-18");
  });

  it("rejects malformed and impossible calendar dates", () => {
    expect(parseReservationDate("not-a-date")).toBeNull();
    expect(parseReservationDate("2026-08-18Tnot-a-time")).toBeNull();
    expect(parseReservationDate("2026-02-30")).toBeNull();
    expect(validateReservationDateRange("2026-02-29", "2026-03-02")).toBe("invalid-check-in");
  });

  it("accepts leap day and counts nights with half-open checkout semantics", () => {
    expect(validateReservationDateRange("2028-02-29", "2028-03-02")).toBeNull();
    expect(reservationNights("2028-02-29", "2028-03-02")).toBe(2);
  });

  it("requires checkout to be strictly after check-in", () => {
    expect(validateReservationDateRange("2026-08-18", "2026-08-18")).toBe("invalid-range");
    expect(validateReservationDateRange("2026-08-19", "2026-08-18")).toBe("invalid-range");
    expect(validateReservationDateRange("", "2026-08-18")).toBe("required");
  });
});
