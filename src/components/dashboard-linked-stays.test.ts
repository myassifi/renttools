import { describe, expect, it } from "vitest";
import type { Property, Reservation } from "@/lib/types";
import {
  buildUnifiedStays,
  type CalendarEvent,
  type UnifiedStay,
} from "./dashboard";

type LinkedReservation = Reservation & {
  linkedEventPlatform?: string | null;
  linkedEventRole?: "claim" | "extension" | null;
};

function reservation(overrides: Partial<LinkedReservation> = {}): LinkedReservation {
  return {
    id: 1,
    name: "Joanne",
    checkIn: "2026-08-19T00:00:00",
    checkOut: "2026-08-23T00:00:00",
    platform: "airbnb",
    propertyId: 68,
    createdAt: "2026-08-01T00:00:00",
    ...overrides,
  };
}

function property(reservations: LinkedReservation[]): Property {
  return {
    id: 68,
    userId: 3,
    name: "Apt 68",
    minNights: 1,
    checkInTime: "14:00",
    checkOutTime: "12:00",
    bookingWindow: 365,
    cleaningEnabled: true,
    feedToken: null,
    createdAt: "2026-01-01T00:00:00",
    reservations,
  };
}

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 10,
    platform: "airbnb",
    uid: "shared-uid",
    summary: "Airbnb guest",
    startDate: "2026-08-19",
    endDate: "2026-08-23",
    ...overrides,
  };
}

function localDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function project(stays: UnifiedStay[]) {
  return stays.map((stay) => ({
    start: localDate(stay.start),
    end: localDate(stay.end),
    name: stay.name,
    platform: stay.platform,
    reservationId: stay.reservationId,
  }));
}

describe("buildUnifiedStays linked source roles", () => {
  it("lets an explicit claim replace only the exact platform+UID source", () => {
    const claim = reservation({
      id: 41,
      name: "Named Airbnb guest",
      linkedEventUid: "shared-uid",
      linkedEventPlatform: "airbnb",
      linkedEventRole: "claim",
    });
    const bookingWithSameUid = event({
      id: 11,
      platform: "booking",
      summary: "Independent Booking guest",
      startDate: "2026-08-25",
      endDate: "2026-08-28",
    });

    expect(project(buildUnifiedStays(property([claim]), [event(), bookingWithSameUid]))).toEqual([
      {
        start: "2026-08-19",
        end: "2026-08-23",
        name: "Named Airbnb guest",
        platform: "airbnb",
        reservationId: 41,
      },
      {
        start: "2026-08-25",
        end: "2026-08-28",
        name: "Independent Booking guest",
        platform: "booking",
        reservationId: undefined,
      },
    ]);
  });

  it("retains the source stay and projects an explicit extension as Direct", () => {
    const extension = reservation({
      id: 45,
      name: "Joanne · direct extension",
      checkIn: "2026-08-23T00:00:00",
      checkOut: "2026-08-25T00:00:00",
      platform: "direct",
      linkedEventUid: "shared-uid",
      linkedEventPlatform: "airbnb",
      linkedEventRole: "extension",
    });

    expect(project(buildUnifiedStays(property([extension]), [event()]))).toEqual([
      {
        start: "2026-08-19",
        end: "2026-08-23",
        name: "Airbnb guest",
        platform: "airbnb",
        reservationId: undefined,
      },
      {
        start: "2026-08-23",
        end: "2026-08-25",
        name: "Joanne · direct extension",
        platform: "direct",
        reservationId: 45,
      },
    ]);
  });

  it("infers legacy overlap as claim and legacy adjacency as Direct extension", () => {
    const legacyClaim = reservation({
      id: 51,
      linkedEventUid: "claimed-uid",
      linkedEventRole: null,
    });
    const claimedSource = event({ uid: "claimed-uid" });
    expect(project(buildUnifiedStays(property([legacyClaim]), [claimedSource]))).toHaveLength(1);

    const legacyExtension = reservation({
      id: 52,
      checkIn: "2026-08-23T00:00:00",
      checkOut: "2026-08-25T00:00:00",
      platform: "airbnb",
      linkedEventUid: "shared-uid",
      linkedEventRole: null,
    });
    const projected = project(buildUnifiedStays(property([legacyExtension]), [event()]));
    expect(projected).toHaveLength(2);
    expect(projected).toContainEqual(expect.objectContaining({
      start: "2026-08-19",
      platform: "airbnb",
      reservationId: undefined,
    }));
    expect(projected).toContainEqual(expect.objectContaining({
      start: "2026-08-23",
      platform: "direct",
      reservationId: 52,
    }));
  });
});
