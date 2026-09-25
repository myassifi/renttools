import { describe, expect, it } from "vitest";
import { parseAirbnbCsv } from "@/lib/airbnb-csv";

const HEADER =
  "Date,Arriving by date,Type,Confirmation code,Booking date,Start date,End date,Nights,Guest,Listing,Details,Reference code,Currency,Amount,Paid out,Service fee,Fast pay fee,Cleaning fee,Gross earnings,Airbnb remitted tax,Earnings year";

describe("parseAirbnbCsv", () => {
  it("parses a Reservation row into cents + ISO dates", () => {
    const csv = [
      HEADER,
      '09/25/2026,,Reservation,HMAXN8TAHS,09/18/2026,09/24/2026,09/27/2026,3,Walid Aghouach,Appartement raffiné et lumineux à Marrakech,,,MAD,1550.66,,354.34,,225.00,1905.00,0.00,2026',
    ].join("\n");
    const r = parseAirbnbCsv(csv);
    expect(r.reservations).toHaveLength(1);
    const row = r.reservations[0];
    expect(row.confirmationCode).toBe("HMAXN8TAHS");
    expect(row.guestName).toBe("Walid Aghouach");
    expect(row.listing).toBe("Appartement raffiné et lumineux à Marrakech");
    expect(row.checkIn).toBe("2026-09-24");
    expect(row.checkOut).toBe("2026-09-27");
    expect(row.nights).toBe(3);
    expect(row.currency).toBe("MAD");
    expect(row.grossCents).toBe(190500);
    expect(row.hostFeeCents).toBe(35434);
    expect(row.cleaningFeeCents).toBe(22500);
    expect(row.payoutCents).toBe(155066);
    expect(r.listingCounts["Appartement raffiné et lumineux à Marrakech"]).toBe(1);
  });

  it("skips Payout and Co-Host payout rows but counts them", () => {
    const csv = [
      HEADER,
      '09/25/2026,10/02/2026,Payout,,,,,,,,"Transfer to salma, IBAN 3088 (AED)",0MS0IHwTUjAFMKzvHrqy9t0xCmi,AED,,506.54,,,,,,',
      '09/25/2026,,Co-Host payout,HMAXN8TAHS,09/18/2026,09/24/2026,09/27/2026,3,Walid,Listing A,,,MAD,-225.00,,,,0.00,,0.00,2026',
      '09/25/2026,,Reservation,HMAXN8TAHS,09/18/2026,09/24/2026,09/27/2026,3,Walid,Listing A,,,MAD,1550.66,,354.34,,225.00,1905.00,0.00,2026',
    ].join("\n");
    const r = parseAirbnbCsv(csv);
    expect(r.reservations).toHaveLength(1);
    expect(r.skippedPayoutRows).toBe(1);
    expect(r.skippedCoHostRows).toBe(1);
    // co-host payouts are captured for cleaning-expense import
    expect(r.coHostPayouts).toHaveLength(1);
    expect(r.coHostPayouts[0].confirmationCode).toBe("HMAXN8TAHS");
    expect(r.coHostPayouts[0].amountCents).toBe(22500); // abs value
    expect(r.coHostPayouts[0].date).toBe("2026-09-25");
  });

  it("handles quoted commas, negative amounts and multi-currency", () => {
    const csv = [
      HEADER,
      '09/22/2026,,Reservation,HM3RCPFXYC,09/21/2026,09/21/2026,09/30/2026,9,"Hamed, Esa","Appartement lumineux, 2e étage",,,MAD,4118.67,,941.12,,225.00,5059.80,0.00,2026',
      '09/20/2026,,Reservation,HM999,09/19/2026,09/20/2026,09/21/2026,1,A B,Listing B,,,EUR,-10.50,,1.00,,0.00,-9.50,0.00,2026',
    ].join("\n");
    const r = parseAirbnbCsv(csv);
    expect(r.reservations).toHaveLength(2);
    expect(r.reservations[0].guestName).toBe("Hamed, Esa");
    expect(r.reservations[0].listing).toBe("Appartement lumineux, 2e étage");
    expect(r.reservations[1].payoutCents).toBe(-1050);
    expect(r.currencies.sort()).toEqual(["EUR", "MAD"]);
  });

  it("returns empty result for a non-Airbnb CSV", () => {
    const r = parseAirbnbCsv("foo,bar\n1,2\n");
    expect(r.reservations).toHaveLength(0);
    expect(r.skippedPayoutRows).toBe(0);
  });
});
