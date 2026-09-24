import { describe, expect, it } from "vitest";
import type { Property, Reservation } from "@/lib/types";
import {
  buildStaysForProperty,
  countUpcomingCleaningBoundaries,
  type CalendarEventRow,
} from "./reports-panel";

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

function event(overrides: Partial<CalendarEventRow> = {}): CalendarEventRow {
  return {
    id: 10,
    propertyId: 68,
    uid: "shared-uid",
    platform: "airbnb",
    summary: "Airbnb guest",
    startDate: "2026-08-19",
    endDate: "2026-08-23",
    ...overrides,
  };
}

describe("buildStaysForProperty linked source roles", () => {
  it("dedupes an explicit claim by exact platform+UID", () => {
    const claim = reservation({
      id: 41,
      linkedEventUid: "shared-uid",
      linkedEventPlatform: "airbnb",
      linkedEventRole: "claim",
    });
    const bookingWithSameUid = event({
      id: 11,
      platform: "booking",
      startDate: "2026-08-25",
      endDate: "2026-08-28",
    });

    const stays = buildStaysForProperty(
      property([claim]),
      [event(), bookingWithSameUid],
    );

    expect(stays).toHaveLength(2);
    expect(stays).toContainEqual({
      start: "2026-08-19",
      end: "2026-08-23",
      platform: "airbnb",
      propertyId: 68,
      cleaningGroupKey: "airbnb\u0000shared-uid",
    });
    expect(stays).toContainEqual({
      start: "2026-08-25",
      end: "2026-08-28",
      platform: "booking",
      propertyId: 68,
      cleaningGroupKey: "booking\u0000shared-uid",
    });
  });

  it("keeps original source nights and reports extension nights as Direct", () => {
    const extension = reservation({
      id: 45,
      checkIn: "2026-08-23T00:00:00",
      checkOut: "2026-08-25T00:00:00",
      platform: "direct",
      linkedEventUid: "shared-uid",
      linkedEventPlatform: "airbnb",
      linkedEventRole: "extension",
    });

    expect(buildStaysForProperty(property([extension]), [event()])).toEqual([
      {
        start: "2026-08-19",
        end: "2026-08-23",
        platform: "airbnb",
        propertyId: 68,
        cleaningGroupKey: "airbnb\u0000shared-uid",
      },
      {
        start: "2026-08-23",
        end: "2026-08-25",
        platform: "direct",
        propertyId: 68,
        cleaningGroupKey: "airbnb\u0000shared-uid",
      },
    ]);
  });

  it("infers legacy linked rows without hiding an adjacent source", () => {
    const legacyClaim = reservation({
      id: 51,
      linkedEventUid: "claimed-uid",
      linkedEventRole: null,
    });
    const claimedSource = event({ uid: "claimed-uid" });
    expect(buildStaysForProperty(property([legacyClaim]), [claimedSource])).toHaveLength(1);

    const legacyExtension = reservation({
      id: 52,
      checkIn: "2026-08-23T00:00:00",
      checkOut: "2026-08-25T00:00:00",
      platform: "airbnb",
      linkedEventUid: "shared-uid",
      linkedEventRole: null,
    });

    expect(buildStaysForProperty(property([legacyExtension]), [event()])).toEqual([
      {
        start: "2026-08-19",
        end: "2026-08-23",
        platform: "airbnb",
        propertyId: 68,
        cleaningGroupKey: "airbnb\u0000shared-uid",
      },
      {
        start: "2026-08-23",
        end: "2026-08-25",
        platform: "direct",
        propertyId: 68,
        cleaningGroupKey: "airbnb\u0000shared-uid",
      },
    ]);
  });

  it("dedupes only the internal linked boundary for upcoming cleaning KPIs", () => {
    const extension = reservation({
      id: 60,
      checkIn: "2026-08-23T00:00:00",
      checkOut: "2026-08-25T00:00:00",
      platform: "direct",
      linkedEventUid: "shared-uid",
      linkedEventPlatform: "airbnb",
      linkedEventRole: "extension",
    });
    const stays = buildStaysForProperty(property([extension]), [event()]);

    // Reports still retain two booking/channel rows.
    expect(stays).toHaveLength(2);
    expect(
      countUpcomingCleaningBoundaries(
        stays,
        68,
        new Date("2026-08-18T00:00:00"),
        new Date("2027-03-01T00:00:00"),
      ),
    ).toBe(1);
  });

  it("does not dedupe equal UIDs from different platform namespaces", () => {
    const stays = buildStaysForProperty(property([]), [
      event(),
      event({
        id: 71,
        platform: "booking",
        startDate: "2026-08-23",
        endDate: "2026-08-25",
      }),
    ]);

    expect(
      countUpcomingCleaningBoundaries(
        stays,
        68,
        new Date("2026-08-18T00:00:00"),
        new Date("2027-03-01T00:00:00"),
      ),
    ).toBe(2);
  });
});
