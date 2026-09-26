import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { canManageProperty } from "@/lib/ownership";
import { reservationNights } from "@/lib/reservation-dates";
import { formatCents, DEFAULT_CURRENCY } from "@/lib/finance";

export const dynamic = "force-dynamic";

const COMPANY_NAME = "Noah Appart";
const COMPANY_ADDRESS = "";
const COMPANY_TAX_ID = "";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function platformLabel(platform: string): string {
  const p = (platform || "").toLowerCase();
  if (p === "airbnb") return "Airbnb";
  if (p === "booking") return "Booking.com";
  if (p === "direct") return "Direct booking";
  return platform;
}

/**
 * Print-ready guest receipt (HTML). Shows what the GUEST paid —
 * accommodation + cleaning fee + total (gross). Host-side numbers
 * (platform fee, payout) are deliberately never rendered here.
 * The host opens it in a tab and prints to PDF or screenshots it.
 */
export async function GET(
  _request: NextRequest,
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
      include: { property: { include: { user: { select: { currency: true, username: true } } } } },
    });
    if (
      !reservation ||
      !(await canManageProperty(reservation.propertyId, session.userId, session.role))
    ) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const currency = reservation.property.user.currency || DEFAULT_CURRENCY;
    const fmt = (c: number | null | undefined) =>
      c == null ? "—" : formatCents(c, currency, "en");

    const checkIn = new Date(reservation.checkIn).toISOString().slice(0, 10);
    const checkOut = new Date(reservation.checkOut).toISOString().slice(0, 10);
    const nights = reservationNights(checkIn, checkOut);
    const gross = reservation.grossCents;
    const cleaning = reservation.cleaningFeeCents;
    const accommodation =
      gross != null && cleaning != null ? gross - cleaning : gross != null ? gross : null;

    const fromLines = [COMPANY_ADDRESS, COMPANY_TAX_ID].filter(Boolean);

    const rows: string[] = [];
    rows.push(
      `<tr><td>Accommodation · ${nights} ${nights === 1 ? "night" : "nights"} · ${esc(checkIn)} → ${esc(checkOut)}</td><td class="amt">${fmt(accommodation)}</td></tr>`,
    );
    if (cleaning != null && cleaning > 0) {
      rows.push(`<tr><td>Cleaning fee</td><td class="amt">${fmt(cleaning)}</td></tr>`);
    }
    if (gross == null) {
      rows.push(`<tr><td>Total</td><td class="amt">—</td></tr>`);
    }

    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Receipt ${numId} — ${esc(reservation.property.name)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 40px 16px; color: #1f2937; background: #f3f4f6; }
  .sheet { max-width: 620px; margin: 0 auto; background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 48px; box-shadow: 0 4px 16px -8px rgba(0,0,0,0.08); }
  .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; margin-bottom: 36px; }
  .company-name { font-size: 24px; font-weight: 700; letter-spacing: -0.02em; color: #111827; }
  .company-meta { font-size: 12px; color: #6b7280; margin-top: 4px; line-height: 1.5; }
  .receipt-title { text-align: right; }
  .receipt-title h1 { font-size: 22px; margin: 0; color: #111827; }
  .receipt-title .receipt-no { font-size: 12px; color: #6b7280; margin-top: 4px; }
  .parties { display: flex; justify-content: space-between; gap: 32px; margin-bottom: 36px; font-size: 14px; }
  .parties .col { flex: 1; }
  .parties .lbl { color: #9ca3af; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 6px; }
  .parties .value { color: #111827; font-weight: 500; }
  .parties .sub { color: #6b7280; font-size: 13px; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; margin-top: 8px; }
  th { text-align: left; padding: 10px 0; border-bottom: 2px solid #111827; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: #6b7280; }
  td { padding: 12px 0; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
  td.amt { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .total td { border-bottom: none; border-top: 2px solid #111827; font-weight: 700; font-size: 16px; padding-top: 14px; }
  .foot { margin-top: 40px; padding-top: 20px; border-top: 1px solid #f3f4f6; font-size: 12px; color: #6b7280; text-align: center; }
  .paid { display: inline-block; margin-top: 16px; padding: 6px 14px; border: 2px solid #10b981; color: #10b981; font-weight: 700; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; border-radius: 999px; }
  @media print { body { background: #fff; padding: 0; } .sheet { border: none; border-radius: 0; box-shadow: none; } }
</style>
</head>
<body>
  <div class="sheet">
    <div class="header">
      <div>
        <div class="company-name">${esc(COMPANY_NAME)}</div>
        ${fromLines.length ? `<div class="company-meta">${fromLines.map(esc).join("<br>")}</div>` : ""}
      </div>
      <div class="receipt-title">
        <h1>Receipt</h1>
        <div class="receipt-no">№ RT-${numId} · ${esc(platformLabel(reservation.platform))}</div>
        <div class="receipt-no">Issued ${new Date().toISOString().slice(0, 10)}</div>
      </div>
    </div>

    <div class="parties">
      <div class="col">
        <div class="lbl">From</div>
        <div class="value">${esc(COMPANY_NAME)}</div>
        <div class="sub">${esc(reservation.property.name)}</div>
      </div>
      <div class="col">
        <div class="lbl">To</div>
        <div class="value">${esc(reservation.name)}</div>
        <div class="sub">${esc(checkIn)} → ${esc(checkOut)} · ${nights} ${nights === 1 ? "night" : "nights"}</div>
      </div>
    </div>

    <table>
      <thead>
        <tr><th>Description</th><th class="amt">Amount</th></tr>
      </thead>
      <tbody>
        ${rows.join("\n        ")}
        <tr class="total"><td>Total</td><td class="amt">${fmt(gross)}</td></tr>
      </tbody>
    </table>

    ${gross != null && gross > 0 ? `<div style="text-align:center"><div class="paid">Paid in full · ${esc(platformLabel(reservation.platform))}</div></div>` : ""}

    <div class="foot">
      This receipt confirms the amounts above were paid by the guest.<br>
      Generated by RentTools · ${esc(COMPANY_NAME)}
    </div>
  </div>
  <script>if (location.search.includes("print=1")) window.print();</script>
</body>
</html>`;

    return new NextResponse(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (err) {
    console.error("Route error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
