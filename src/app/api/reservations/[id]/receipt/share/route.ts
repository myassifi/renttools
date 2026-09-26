import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { canManageProperty } from "@/lib/ownership";

export const dynamic = "force-dynamic";

/**
 * POST /api/reservations/[id]/receipt/share
 *
 * Mint (or reuse) a public token for this reservation's receipt.
 * Hosts use the returned URL to WhatsApp/SMS/email a receipt to a guest;
 * the guest can open it without a RentTools login.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const numId = parseInt(id);
    if (isNaN(numId)) {
      return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
    }

    const reservation = await prisma.reservation.findUnique({
      where: { id: numId },
      select: { id: true, propertyId: true },
    });
    if (
      !reservation ||
      !(await canManageProperty(reservation.propertyId, session.userId, session.role))
    ) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    let token = await prisma.receiptToken.findFirst({
      where: { reservationId: numId },
      select: { token: true },
      orderBy: { createdAt: "desc" },
    });

    if (!token) {
      const newToken = randomBytes(24).toString("hex");
      await prisma.receiptToken.create({
        data: { token: newToken, reservationId: numId },
      });
      token = { token: newToken };
    }

    const base = process.env.PUBLIC_APP_URL || new URL(request.url).origin;
    const shareUrl = `${base.replace(/\/$/, "")}/receipt/${token.token}`;
    return NextResponse.json({ shareUrl });
  } catch (err) {
    console.error("Route error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
