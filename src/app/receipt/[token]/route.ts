import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { renderReceiptHtml } from "@/lib/receipt-html";

export const dynamic = "force-dynamic";

/**
 * Public receipt view. A host shares /receipt/<token> with a guest via
 * WhatsApp/SMS/email; the guest can open it without a RentTools login.
 * The token is opaque, single-use per reservation, and revocable by
 * deleting the ReceiptToken row.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    if (!token || token.length > 128) {
      return NextResponse.json({ error: "Invalid token" }, { status: 400 });
    }

    const receiptToken = await prisma.receiptToken.findUnique({
      where: { token },
      select: { reservationId: true },
    });
    if (!receiptToken) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const reservation = await prisma.reservation.findUnique({
      where: { id: receiptToken.reservationId },
      include: { property: { include: { user: { select: { currency: true, username: true } } } } },
    });
    if (!reservation) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const html = renderReceiptHtml(reservation);
    return new NextResponse(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (err) {
    console.error("Route error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
