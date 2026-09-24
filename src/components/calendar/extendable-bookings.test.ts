import { describe, expect, it } from "vitest";
import type { Reservation } from "@/lib/types";
import type { CalendarEvent } from "./types";
import {
  buildManualExtensionPatch,
  buildSyncedExtensionReservation,
  getExtendableBookings,
  getExtendedStayRange,
} from "./extendable-bookings";

const stay = (
  overrides: Partial<Reservation> = {}
): Reservation => ({
  id: 1,
  name: "Rob and Joanne",
  checkIn: "2026-08-19T12:00:00.000Z",
  checkOut: "2026-08-23T12:00:00.000Z",
  platform: "direct",
  propertyId: 68,
  createdAt: "2026-08-01T12:00:00.000Z",
  ...overrides,
});

const syncedStay = (
  overrides: Partial<CalendarEvent> = {}
): CalendarEvent => ({
  id: 1,
  uid: "airbnb-rob-and-joanne",
  summary: "Rob and Joanne",
  platform: "airbnb",
  startDate: "2026-08-19",
  endDate: "2026-08-23",
  ...overrides,
});

describe("getExtendableBookings", () => {
  it("offers a manual stay immediately before its check-in", () => {
    expect(
      getExtendableBookings("2026-08-18", "2026-08-18", [], [stay()])
    ).toEqual([
      {
        name: "Rob and Joanne",
        platform: "direct",
        reservationId: 1,
        bookingStart: "2026-08-19",
        bookingEnd: "2026-08-23",
        side: "before",
      },
    ]);
  });

  it("treats the half-open checkout date as the first extendable night after a manual stay", () => {
    expect(
      getExtendableBookings("2026-08-23", "2026-08-23", [], [stay()])
    ).toEqual([
      {
        name: "Rob and Joanne",
        platform: "direct",
        reservationId: 1,
        bookingStart: "2026-08-19",
        bookingEnd: "2026-08-23",
        side: "after",
      },
    ]);
  });

  it("supports contiguous multi-night selections on either side", () => {
    expect(
      getExtendableBookings("2026-08-17", "2026-08-18", [], [stay()])
    ).toMatchObject([{ reservationId: 1, side: "before" }]);

    expect(
      getExtendableBookings("2026-08-23", "2026-08-24", [], [stay()])
    ).toMatchObject([{ reservationId: 1, side: "after" }]);
  });

  it("does not offer a stay when the selected range is not adjacent", () => {
    expect(
      getExtendableBookings("2026-08-16", "2026-08-16", [], [stay()])
    ).toEqual([]);
    expect(
      getExtendableBookings("2026-08-24", "2026-08-24", [], [stay()])
    ).toEqual([]);
  });

  it("offers synced stays both before check-in and from the checkout date", () => {
    expect(
      getExtendableBookings("2026-08-18", "2026-08-18", [syncedStay()], [])
    ).toMatchObject([
      {
        sourceEventUid: "airbnb-rob-and-joanne",
        sourcePlatform: "airbnb",
        bookingStart: "2026-08-19",
        bookingEnd: "2026-08-23",
        side: "before",
      },
    ]);

    expect(
      getExtendableBookings("2026-08-23", "2026-08-23", [syncedStay()], [])
    ).toMatchObject([
      {
        sourceEventUid: "airbnb-rob-and-joanne",
        sourcePlatform: "airbnb",
        bookingStart: "2026-08-19",
        bookingEnd: "2026-08-23",
        side: "after",
      },
    ]);
  });

  it.each(["Not available", "Blocked", "CLOSED - Not available"])(
    "filters host-block summary %s",
    (summary) => {
      expect(
        getExtendableBookings(
          "2026-08-23",
          "2026-08-23",
          [syncedStay({ summary })],
          []
        )
      ).toEqual([]);
    }
  );

  it("prefers one linked local claim, including its guest name and the union of source dates", () => {
    const source = syncedStay({
      uid: "claimed-stay",
      summary: "Reserved",
      startDate: "2026-08-19",
      endDate: "2026-08-23",
    });
    const claim = stay({
      id: 44,
      name: "Dasha",
      platform: "airbnb",
      linkedEventUid: "claimed-stay",
      linkedEventPlatform: "airbnb",
      linkedEventRole: "claim",
      checkIn: "2026-08-20T12:00:00.000Z",
      checkOut: "2026-08-23T12:00:00.000Z",
    });

    expect(
      getExtendableBookings("2026-08-18", "2026-08-18", [source], [claim])
    ).toEqual([
      {
        name: "Dasha",
        platform: "airbnb",
        reservationId: 44,
        sourceEventUid: "claimed-stay",
        sourcePlatform: "airbnb",
        bookingStart: "2026-08-19",
        bookingEnd: "2026-08-23",
        side: "before",
      },
    ]);
  });

  it("keeps a non-overlapping linked extension editable as its own local segment", () => {
    const source = syncedStay({ uid: "base-stay" });
    const extension = stay({
      id: 45,
      name: "Rob and Joanne",
      platform: "direct",
      linkedEventUid: "base-stay",
      linkedEventPlatform: "airbnb",
      linkedEventRole: "extension",
      checkIn: "2026-08-23T12:00:00.000Z",
      checkOut: "2026-08-25T12:00:00.000Z",
    });

    expect(
      getExtendableBookings("2026-08-25", "2026-08-25", [source], [extension])
    ).toEqual([
      {
        name: "Rob and Joanne",
        platform: "direct",
        reservationId: 45,
        bookingStart: "2026-08-23",
        bookingEnd: "2026-08-25",
        side: "after",
      },
    ]);
  });

  it("matches linked claims by the exact platform and uid pair", () => {
    const airbnb = syncedStay({
      id: 10,
      uid: "shared-uid",
      summary: "Airbnb source",
      platform: "airbnb",
    });
    const booking = syncedStay({
      id: 11,
      uid: "shared-uid",
      summary: "Booking source",
      platform: "booking",
    });
    const airbnbClaim = stay({
      id: 46,
      name: "Named Airbnb guest",
      platform: "airbnb",
      linkedEventUid: "shared-uid",
      linkedEventPlatform: "airbnb",
      linkedEventRole: "claim",
    });

    const candidates = getExtendableBookings(
      "2026-08-23",
      "2026-08-23",
      [airbnb, booking],
      [airbnbClaim]
    );

    expect(candidates).toHaveLength(2);
    expect(candidates).toContainEqual({
      name: "Named Airbnb guest",
      platform: "airbnb",
      reservationId: 46,
      sourceEventUid: "shared-uid",
      sourcePlatform: "airbnb",
      bookingStart: "2026-08-19",
      bookingEnd: "2026-08-23",
      side: "after",
    });
    expect(candidates).toContainEqual({
      name: "Booking source",
      platform: "booking",
      sourceEventUid: "shared-uid",
      sourcePlatform: "booking",
      bookingStart: "2026-08-19",
      bookingEnd: "2026-08-23",
      side: "after",
    });
  });

  it("extends an implicit legacy pair from the union shown in the calendar", () => {
    const source = syncedStay({ uid: "legacy-source" });
    const local = stay({
      id: 47,
      name: "Named legacy guest",
      platform: "airbnb",
      checkOut: "2026-08-25T12:00:00.000Z",
    });

    expect(
      getExtendableBookings("2026-08-25", "2026-08-25", [source], [local])
    ).toEqual([
      {
        name: "Named legacy guest",
        platform: "airbnb",
        reservationId: 47,
        sourceEventUid: "legacy-source",
        sourcePlatform: "airbnb",
        bookingStart: "2026-08-19",
        bookingEnd: "2026-08-25",
        side: "after",
      },
    ]);
  });
});

describe("extension date payloads", () => {
  const booking = {
    name: "Rob and Joanne",
    platform: "direct",
    reservationId: 1,
    bookingStart: "2026-08-19",
    bookingEnd: "2026-08-23",
  };

  it("moves check-in to the first selected night when extending before", () => {
    const before = { ...booking, side: "before" as const };

    expect(getExtendedStayRange("2026-08-17", "2026-08-18", before)).toEqual({
      checkIn: "2026-08-17",
      checkOut: "2026-08-23",
    });
    expect(buildManualExtensionPatch("2026-08-17", "2026-08-18", before)).toEqual({
      checkIn: "2026-08-17",
    });
  });

  it("moves checkout one day past the last selected night when extending after", () => {
    const after = { ...booking, side: "after" as const };

    expect(getExtendedStayRange("2026-08-23", "2026-08-24", after)).toEqual({
      checkIn: "2026-08-19",
      checkOut: "2026-08-25",
    });
    expect(buildManualExtensionPatch("2026-08-23", "2026-08-24", after)).toEqual({
      checkOut: "2026-08-25",
    });
  });

  it("creates a separate Direct row with the exact synced source identity", () => {
    expect(
      buildSyncedExtensionReservation(
        "2026-08-23",
        "2026-08-24",
        {
          ...booking,
          platform: "airbnb",
          sourceEventUid: "source-uid",
          sourcePlatform: "airbnb",
          side: "after",
        },
        68,
      ),
    ).toEqual({
      name: "Rob and Joanne",
      checkIn: "2026-08-23",
      checkOut: "2026-08-25",
      platform: "direct",
      propertyId: 68,
      linkedEventUid: "source-uid",
      linkedEventPlatform: "airbnb",
      linkedEventRole: "extension",
    });
  });
});
