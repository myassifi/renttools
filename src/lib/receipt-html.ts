import { reservationNights } from "@/lib/reservation-dates";
import { formatCents, DEFAULT_CURRENCY } from "@/lib/finance";
import type { Prisma } from "@/generated/prisma/client";

export const COMPANY_NAME = "Noah Appart";
export const COMPANY_ADDRESS = "";
export const COMPANY_TAX_ID = "";

type ReceiptReservation = Prisma.ReservationGetPayload<{
  include: { property: { include: { user: { select: { currency: true; username: true } } } } };
}>;

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

export function renderReceiptHtml(
  reservation: ReceiptReservation,
  opts: { publicUrl?: string | null; showShareButtons?: boolean } = {},
): string {
  const { publicUrl, showShareButtons = false } = opts;
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

  const shareButtons = showShareButtons
    ? `<div class="share-bar">
        <button id="rt-whatsapp" class="share-btn" type="button">WhatsApp</button>
        <button id="rt-sms" class="share-btn" type="button">SMS</button>
        <button id="rt-copy" class="share-btn" type="button">Copy link</button>
        <span id="rt-status" class="share-status"></span>
      </div>
      <script>
        (function() {
          const shareUrl = ${publicUrl ? JSON.stringify(publicUrl) : "null"};
          const msg = "Hi, here is your receipt from ${esc(COMPANY_NAME)}: ";
          const full = shareUrl ? msg + shareUrl : location.href;
          function setStatus(t){ document.getElementById('rt-status').textContent = t; setTimeout(()=>document.getElementById('rt-status').textContent='',2000); }
          document.getElementById('rt-whatsapp').addEventListener('click', function(){
            if(!shareUrl){ setStatus('Generate a share link first'); return; }
            window.open('https://wa.me/?text=' + encodeURIComponent(full), '_blank', 'noopener,noreferrer');
          });
          document.getElementById('rt-sms').addEventListener('click', function(){
            if(!shareUrl){ setStatus('Generate a share link first'); return; }
            window.open('sms:?body=' + encodeURIComponent(full), '_blank');
          });
          document.getElementById('rt-copy').addEventListener('click', async function(){
            if(!shareUrl){ setStatus('Generate a share link first'); return; }
            try { await navigator.clipboard.writeText(shareUrl); setStatus('Copied'); }
            catch(e) { setStatus('Copy failed'); }
          });
        })();
      </script>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Receipt ${reservation.id} — ${esc(reservation.property.name)}</title>
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
  .share-bar { margin-top: 32px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: center; }
  .share-btn { border: 1px solid #e5e7eb; background: #fff; color: #374151; border-radius: 8px; padding: 8px 14px; font-size: 13px; cursor: pointer; transition: background .15s; }
  .share-btn:hover { background: #f9fafb; }
  .share-status { font-size: 12px; color: #10b981; margin-left: 4px; }
  @media print { body { background: #fff; padding: 0; } .sheet { border: none; border-radius: 0; box-shadow: none; } .share-bar { display: none; } }
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
        <div class="receipt-no">№ RT-${reservation.id} · ${esc(platformLabel(reservation.platform))}</div>
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

    ${shareButtons}

    <div class="foot">
      This receipt confirms the amounts above were paid by the guest.<br>
      Generated by RentTools · ${esc(COMPANY_NAME)}
    </div>
  </div>
  <script>if (location.search.includes("print=1")) window.print();</script>
</body>
</html>`;
}
