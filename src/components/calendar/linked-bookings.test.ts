import { describe, expect, it } from "vitest";
import {
  calendarEventIdentity,
  linkedSourcePlatform,
  referencesSyncedEvent,
} from "./linked-bookings";

describe("linked calendar identities", () => {
  it("keeps identical UIDs from two platform feeds distinct", () => {
    expect(calendarEventIdentity("airbnb", "shared-uid")).not.toBe(
      calendarEventIdentity("booking", "shared-uid"),
    );

    const directExtension = {
      platform: "direct",
      linkedEventUid: "shared-uid",
      linkedEventPlatform: "airbnb",
    };

    expect(
      referencesSyncedEvent(directExtension, {
        platform: "airbnb",
        eventUid: "shared-uid",
      }),
    ).toBe(true);
    expect(
      referencesSyncedEvent(directExtension, {
        platform: "booking",
        eventUid: "shared-uid",
      }),
    ).toBe(false);
  });

  it("supports legacy source-platform rows but does not guess for Direct", () => {
    expect(
      linkedSourcePlatform({
        platform: "airbnb",
        linkedEventUid: "legacy-uid",
      }),
    ).toBe("airbnb");
    expect(
      linkedSourcePlatform({
        platform: "direct",
        linkedEventUid: "missing-platform",
      }),
    ).toBeUndefined();
  });
});
