import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { canManageProperty } from "@/lib/ownership";
import { EXPENSE_CATEGORIES } from "@/lib/types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function loadManageableExpense(id: number, userId: number, role: string) {
  const expense = await prisma.expense.findUnique({
    where: { id },
    select: { id: true, propertyId: true, recurGroup: true },
  });
  if (!expense) return null;
  if (!(await canManageProperty(expense.propertyId, userId, role))) return null;
  return expense;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const numId = parseInt(id);
    if (isNaN(numId)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });

    const owned = await loadManageableExpense(numId, session.userId, session.role);
    if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await request.json();
    const data: Record<string, unknown> = {};

    if (body.date !== undefined) {
      if (typeof body.date !== "string" || !DATE_RE.test(body.date)) {
        return NextResponse.json({ error: "Invalid date" }, { status: 400 });
      }
      data.date = body.date;
    }
    if (body.category !== undefined) {
      if (!(EXPENSE_CATEGORIES as readonly string[]).includes(body.category)) {
        return NextResponse.json({ error: "Invalid category" }, { status: 400 });
      }
      data.category = body.category;
    }
    if (body.amountCents !== undefined) {
      if (!Number.isInteger(body.amountCents) || body.amountCents <= 0) {
        return NextResponse.json(
          { error: "amountCents must be a positive integer" },
          { status: 400 },
        );
      }
      data.amountCents = body.amountCents;
    }
    if (body.note !== undefined) {
      data.note = typeof body.note === "string" ? body.note.trim() : "";
    }
    if (body.reservationId !== undefined) {
      if (body.reservationId === null) {
        data.reservationId = null;
      } else if (!Number.isInteger(body.reservationId)) {
        return NextResponse.json({ error: "Invalid reservationId" }, { status: 400 });
      } else {
        const res = await prisma.reservation.findFirst({
          where: { id: body.reservationId, propertyId: owned.propertyId },
          select: { id: true },
        });
        if (!res) {
          return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
        }
        data.reservationId = body.reservationId;
      }
    }
    // Editing a row of a recurring series detaches it from the group so
    // a later "delete series" doesn't wipe the host's manual fix.
    data.recurGroup = null;
    data.updatedAt = new Date();

    const expense = await prisma.expense.update({ where: { id: numId }, data });
    await logAudit(session.userId, "update", "expense", numId, data);
    return NextResponse.json(expense);
  } catch (err) {
    console.error("Route error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const numId = parseInt(id);
    if (isNaN(numId)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });

    const owned = await loadManageableExpense(numId, session.userId, session.role);
    if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // ?series=1 deletes every row in the recurring group; default is
    // just this one row.
    const series = request.nextUrl.searchParams.get("series") === "1";
    if (series && owned.recurGroup) {
      await prisma.expense.deleteMany({
        where: { recurGroup: owned.recurGroup, propertyId: owned.propertyId },
      });
    } else {
      await prisma.expense.delete({ where: { id: numId } });
    }

    await logAudit(session.userId, "delete", "expense", numId, { series });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Route error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
