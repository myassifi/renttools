import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { canManageProperty, listAccessiblePropertyIds } from "@/lib/ownership";
import { EXPENSE_CATEGORIES } from "@/lib/types";
import { recurringDates } from "@/lib/finance";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_REPEAT_MONTHS = 120; // 10 years of generated rows

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const sp = request.nextUrl.searchParams;
    const propertyId = sp.get("propertyId");
    const from = sp.get("from"); // YYYY-MM-DD inclusive
    const to = sp.get("to");     // YYYY-MM-DD inclusive
    const recurGroup = sp.get("recurGroup");
    const propId = propertyId ? parseInt(propertyId) : NaN;
    if (propertyId && (isNaN(propId) || propId <= 0)) {
      return NextResponse.json({ error: "Invalid propertyId" }, { status: 400 });
    }

    const accessibleIds = await listAccessiblePropertyIds(session.userId, session.role);
    const expenses = await prisma.expense.findMany({
      where: {
        propertyId: propertyId ? propId : { in: accessibleIds },
        ...(propertyId ? { property: { id: { in: accessibleIds } } } : {}),
        ...(from || to
          ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
          : {}),
        ...(recurGroup ? { recurGroup } : {}),
      },
      orderBy: [{ date: "desc" }, { id: "desc" }],
    });
    return NextResponse.json(expenses);
  } catch (err) {
    console.error("Route error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const {
      propertyId,
      date,
      category,
      amountCents,
      note,
      reservationId,
      repeatMonths,
    } = body ?? {};

    if (
      !Number.isInteger(propertyId) ||
      propertyId <= 0 ||
      typeof date !== "string" ||
      !DATE_RE.test(date) ||
      typeof category !== "string" ||
      !(EXPENSE_CATEGORIES as readonly string[]).includes(category) ||
      !Number.isInteger(amountCents) ||
      amountCents <= 0 ||
      (note !== undefined && note !== null && typeof note !== "string") ||
      (reservationId !== undefined &&
        reservationId !== null &&
        !Number.isInteger(reservationId)) ||
      (repeatMonths !== undefined &&
        (!Number.isInteger(repeatMonths) || repeatMonths < 1 || repeatMonths > MAX_REPEAT_MONTHS))
    ) {
      return NextResponse.json({ error: "Invalid expense data" }, { status: 400 });
    }

    if (!(await canManageProperty(propertyId, session.userId, session.role))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // When a reservation is attached it must belong to the same property.
    if (Number.isInteger(reservationId)) {
      const res = await prisma.reservation.findFirst({
        where: { id: reservationId, propertyId },
        select: { id: true },
      });
      if (!res) {
        return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
      }
    }

    const occurrences = repeatMonths ?? 1;
    const recurGroup = occurrences > 1 ? randomUUID() : null;
    const dates = recurringDates(date, occurrences);
    const rows = await prisma.$transaction(
      dates.map((d) =>
        prisma.expense.create({
          data: {
            propertyId,
            date: d,
            category,
            amountCents,
            note: typeof note === "string" ? note.trim() : "",
            reservationId: Number.isInteger(reservationId) ? reservationId : null,
            recurGroup,
            createdById: session.userId,
          },
        }),
      ),
    );

    await logAudit(session.userId, "create", "expense", rows[0].id, {
      propertyId,
      category,
      amountCents,
      occurrences,
    });
    return NextResponse.json(occurrences > 1 ? rows : rows[0]);
  } catch (err) {
    console.error("Route error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
