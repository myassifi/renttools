import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { canManageProperty, listAccessiblePropertyIds } from "@/lib/ownership";
import { parseAirbnbCsv } from "@/lib/airbnb-csv";
import { parseReservationDate, reservationDayKey } from "@/lib/reservation-dates";

export const dynamic = "force-dynamic";

const MAX_CSV_BYTES = 10 * 1024 * 1024; // 10 MB — plenty for a year of bookings
const CSV_UID_PREFIX = "airbnb-csv:";

/**
 * POST /api/import/airbnb — Airbnb "Transaction history" CSV import.
 *
 * Preview:  { csv }              → listing names + row counts, nothing saved
 * Commit:   { csv, commit: true, mapping: { [listing]: propertyId } }
 *
 * Rows are matched to existing reservations by property + check-in/out
 * dates (iCal imports already create those rows) — a match updates the
 * money fields only. Unmatched rows create a reservation keyed by
 * linkedEventUid = "airbnb-csv:<confirmation code>" so re-imports are
 * idempotent.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const csv = typeof body?.csv === "string" ? body.csv : "";
    if (!csv.trim()) {
      return NextResponse.json({ error: "CSV content is required" }, { status: 400 });
    }
    if (csv.length > MAX_CSV_BYTES) {
      return NextResponse.json({ error: "CSV file too large (max 10 MB)" }, { status: 400 });
    }

    const parsed = parseAirbnbCsv(csv);
    if (parsed.reservations.length === 0 && parsed.skippedPayoutRows === 0) {
      return NextResponse.json(
        { error: "Not an Airbnb transaction-history CSV (missing 'Confirmation code' column)" },
        { status: 400 },
      );
    }

    if (!body?.commit) {
      // Listings previously mapped are remembered on the Property row —
      // pre-fill them so the host only picks for brand-new listings.
      const accessibleIds = await listAccessiblePropertyIds(session.userId, session.role);
      const props = await prisma.property.findMany({
        where: { id: { in: accessibleIds }, airbnbListing: { in: parsed.reservations.map((r) => r.listing) } },
        select: { id: true, airbnbListing: true },
      });
      const suggestedMapping: Record<string, number> = {};
      for (const p of props) if (p.airbnbListing) suggestedMapping[p.airbnbListing] = p.id;
      return NextResponse.json({
        listings: Object.entries(parsed.listingCounts).map(([listing, count]) => ({ listing, count })),
        currencies: parsed.currencies,
        reservationRows: parsed.reservations.length,
        skippedPayoutRows: parsed.skippedPayoutRows,
        skippedCoHostRows: parsed.skippedCoHostRows,
        suggestedMapping,
      });
    }

    const mapping = body?.mapping && typeof body.mapping === "object" ? body.mapping : {};
    const listingToProperty = new Map<string, number>();
    for (const [listing, pid] of Object.entries(mapping)) {
      const id = Number(pid);
      if (!Number.isInteger(id) || id <= 0) continue;
      if (!(await canManageProperty(id, session.userId, session.role))) {
        return NextResponse.json(
          { error: `No access to property ${id}` },
          { status: 403 },
        );
      }
      listingToProperty.set(listing, id);
    }

    let created = 0;
    let updated = 0;
    let skippedNoMapping = 0;
    let coHostExpenses = 0;
    const errors: string[] = [];
    const codeToReservationId = new Map<string, number>();

    for (const row of parsed.reservations) {
      const propertyId = listingToProperty.get(row.listing);
      if (!propertyId) { skippedNoMapping++; continue; }

      const checkIn = parseReservationDate(row.checkIn);
      const checkOut = parseReservationDate(row.checkOut);
      if (!checkIn || !checkOut || checkOut <= checkIn) {
        errors.push(`${row.confirmationCode}: invalid dates`);
        continue;
      }

      const money = {
        grossCents: row.grossCents,
        hostFeeCents: row.hostFeeCents,
        cleaningFeeCents: row.cleaningFeeCents,
        payoutCents: row.payoutCents,
        payoutDate: row.payoutDate,
        name: row.guestName || "Airbnb guest",
      };

      // 1) Already imported once → refresh money fields (idempotent re-import)
      const existingImport = await prisma.reservation.findFirst({
        where: { linkedEventUid: `${CSV_UID_PREFIX}${row.confirmationCode}` },
      });
      if (existingImport) {
        await prisma.reservation.update({ where: { id: existingImport.id }, data: money });
        codeToReservationId.set(row.confirmationCode, existingImport.id);
        updated++;
        continue;
      }

      // 2) Match the iCal-imported booking by property + stay dates
      const stayMatch = await prisma.reservation.findFirst({
        where: {
          propertyId,
          checkIn: { gte: checkIn },
          checkOut: { lte: checkOut },
        },
        orderBy: { checkIn: "asc" },
      });
      const sameDayStay = stayMatch &&
        reservationDayKey(stayMatch.checkIn) === row.checkIn &&
        reservationDayKey(stayMatch.checkOut) === row.checkOut
        ? stayMatch : null;

      if (sameDayStay) {
        // Only touch money/name — keep linkedEventUid intact, it's the
        // feed's dedupe key and overwriting it would break iCal sync.
        await prisma.reservation.update({ where: { id: sameDayStay.id }, data: money });
        codeToReservationId.set(row.confirmationCode, sameDayStay.id);
        updated++;
        continue;
      }

      // 3) No booking on record (old stays age out of iCal feeds) → create
      const newRes = await prisma.reservation.create({
        data: {
          propertyId,
          platform: "airbnb",
          checkIn,
          checkOut,
          bookedGuestCount: null,
          linkedEventUid: `${CSV_UID_PREFIX}${row.confirmationCode}`,
          linkedEventPlatform: "airbnb",
          ...money,
        },
      });
      codeToReservationId.set(row.confirmationCode, newRes.id);
      created++;
    }

    // Co-Host payout rows (negative share going to the co-host/cleaner)
    // become cleaning expenses on the reservation they belong to.
    const COHOST_NOTE_PREFIX = "Co-host payout · Airbnb ";
    for (const row of parsed.coHostPayouts) {
      const reservationId = codeToReservationId.get(row.confirmationCode);
      if (!reservationId) continue;
      const reservation = await prisma.reservation.findUnique({
        where: { id: reservationId },
        select: { propertyId: true },
      });
      if (!reservation) continue;
      const note = `${COHOST_NOTE_PREFIX}${row.confirmationCode}`;
      const dupe = await prisma.expense.findFirst({
        where: { reservationId, note },
        select: { id: true },
      });
      if (dupe) continue;
      await prisma.expense.create({
        data: {
          propertyId: reservation.propertyId,
          reservationId,
          date: row.date,
          category: "cleaning" as const,
          amountCents: row.amountCents,
          note,
          createdById: session.userId,
        },
      });
      coHostExpenses++;
    }

    // Remember the listing→property mapping for next time.
    for (const [listing, propertyId] of listingToProperty) {
      await prisma.property.updateMany({
        where: { id: propertyId, airbnbListing: { not: listing } },
        data: { airbnbListing: listing },
      });
    }

    await logAudit(session.userId, "create", "reservation", 0, {
      source: "airbnb-csv",
      created,
      updated,
      skippedNoMapping,
      coHostExpenses,
    });

    return NextResponse.json({ created, updated, skippedNoMapping, coHostExpenses, errors });
  } catch (err) {
    console.error("Route error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
