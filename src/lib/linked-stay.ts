import { prisma } from "@/lib/prisma";

export interface LinkedStayRange {
  startDate: string;
  endDate: string;
}

function reservationDate(value: Date): string {
  return value.toISOString().substring(0, 10);
}

function overlaps(
  startA: string,
  endA: string,
  startB: string,
  endB: string,
): boolean {
  return startA < endB && endA > startB;
}

/**
 * Resolve the visible/effective stay represented by one synced event plus
 * local claim metadata. A claim may legitimately extend beyond a truncated
 * iCal range; a new Direct segment should abut that visible union.
 *
 * Direct extension rows are deliberately excluded. They remain separately
 * cancellable and must not recursively move the source boundary. Legacy
 * implicit claims are accepted only when an unlinked, same-platform row
 * overlaps the raw source event, matching the calendar's narrow fallback.
 */
export async function loadEffectiveLinkedStayRange(args: {
  propertyId: number;
  sourcePlatform: string;
  sourceUid: string;
  source: LinkedStayRange;
}): Promise<LinkedStayRange> {
  const { propertyId, sourcePlatform, sourceUid, source } = args;
  const rawStart = new Date(`${source.startDate}T00:00:00.000Z`);
  const rawEnd = new Date(`${source.endDate}T00:00:00.000Z`);

  const candidates = await prisma.reservation.findMany({
    where: {
      propertyId,
      OR: [
        // Explicit link candidates are filtered by exact source platform and
        // durable role below. UID alone is not globally unique.
        { linkedEventUid: sourceUid },
        // Legacy implicit claim: same platform and overlapping raw event.
        {
          linkedEventUid: null,
          platform: sourcePlatform,
          checkIn: { lt: rawEnd },
          checkOut: { gt: rawStart },
        },
      ],
    },
    select: {
      platform: true,
      linkedEventUid: true,
      linkedEventPlatform: true,
      linkedEventRole: true,
      checkIn: true,
      checkOut: true,
    },
  });

  let startDate = source.startDate;
  let endDate = source.endDate;
  for (const reservation of candidates) {
    const start = reservationDate(reservation.checkIn);
    const end = reservationDate(reservation.checkOut);
    const overlapsRawSource = overlaps(
      start,
      end,
      source.startDate,
      source.endDate,
    );
    const exactSource =
      reservation.linkedEventUid === sourceUid &&
      (reservation.linkedEventPlatform || reservation.platform) ===
        sourcePlatform;
    const explicitClaim =
      exactSource &&
      reservation.linkedEventRole === "claim" &&
      overlapsRawSource;
    const legacyLinkedClaim =
      exactSource &&
      reservation.linkedEventRole == null &&
      overlapsRawSource;
    const implicitClaim =
      reservation.linkedEventUid == null &&
      reservation.platform === sourcePlatform &&
      overlapsRawSource;

    if (!explicitClaim && !legacyLinkedClaim && !implicitClaim) continue;
    if (start < startDate) startDate = start;
    if (end > endDate) endDate = end;
  }

  return { startDate, endDate };
}
