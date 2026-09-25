// Parser for the Airbnb "Transaction history" CSV export
// (Hosting → Earnings → Transaction history → Download CSV).
// Only "Reservation" rows carry booking money; "Payout" rows are bank
// transfers and "Co-Host payout" rows are co-host share deductions —
// both are counted but not imported.

export interface AirbnbReservationRow {
  confirmationCode: string;
  guestName: string;
  listing: string;
  checkIn: string; // YYYY-MM-DD
  checkOut: string; // YYYY-MM-DD
  nights: number;
  currency: string;
  grossCents: number;
  hostFeeCents: number;
  cleaningFeeCents: number;
  payoutCents: number; // net to host (the "Amount" column)
}

export interface AirbnbCsvParseResult {
  reservations: AirbnbReservationRow[];
  listingCounts: Record<string, number>;
  currencies: string[];
  skippedPayoutRows: number;
  skippedCoHostRows: number;
  skippedOtherRows: number;
}

/** Minimal RFC-4180 CSV cell splitter for one logical line set. */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(cur);
      cur = "";
    } else cur += ch;
  }
  cells.push(cur);
  return cells;
}

/** Physical lines → logical records (quoted fields may span lines). */
function toRecords(text: string): string[][] {
  const logical: string[] = [];
  let buf = "";
  let inQuotes = false;
  for (const raw of text.split(/\r?\n/)) {
    buf = buf ? buf + "\n" + raw : raw;
    for (const ch of raw) if (ch === '"') inQuotes = !inQuotes;
    if (!inQuotes) {
      logical.push(buf);
      buf = "";
    }
  }
  if (buf.trim()) logical.push(buf);
  return logical.map(splitCsvLine);
}

/** "09/25/2026" → "2026-09-25"; returns null when unparseable. */
function usDateToIso(value: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

/** "1,234.56" / "-225.00" / "" → cents; null when blank. */
function moneyToCents(value: string): number | null {
  const v = value.trim();
  if (!v) return null;
  const n = Number(v.replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

const HEADER_HINT = "Confirmation code";

export function parseAirbnbCsv(text: string): AirbnbCsvParseResult {
  const records = toRecords(text.replace(/^﻿/, ""));
  const headerIdx = records.findIndex((r) => r.includes(HEADER_HINT));
  const empty: AirbnbCsvParseResult = {
    reservations: [], listingCounts: {}, currencies: [],
    skippedPayoutRows: 0, skippedCoHostRows: 0, skippedOtherRows: 0,
  };
  if (headerIdx < 0) return empty;

  const header = records[headerIdx].map((h) => h.trim());
  const col = (name: string) => header.indexOf(name);
  const c = {
    type: col("Type"),
    code: col("Confirmation code"),
    guest: col("Guest"),
    listing: col("Listing"),
    start: col("Start date"),
    end: col("End date"),
    nights: col("Nights"),
    currency: col("Currency"),
    amount: col("Amount"),
    serviceFee: col("Service fee"),
    cleaningFee: col("Cleaning fee"),
    gross: col("Gross earnings"),
  };

  const result = empty;
  const currencies = new Set<string>();

  for (let i = headerIdx + 1; i < records.length; i++) {
    const r = records[i];
    const type = (r[c.type] || "").trim();
    if (!type) continue;
    if (type === "Payout") { result.skippedPayoutRows++; continue; }
    if (type === "Co-Host payout" || type === "Co-host payout") { result.skippedCoHostRows++; continue; }
    if (type !== "Reservation" && type !== "Reservation Adjustment") { result.skippedOtherRows++; continue; }

    const checkIn = usDateToIso(r[c.start] || "");
    const checkOut = usDateToIso(r[c.end] || "");
    const code = (r[c.code] || "").trim();
    if (!code || !checkIn || !checkOut) { result.skippedOtherRows++; continue; }

    const currency = (r[c.currency] || "").trim();
    if (currency) currencies.add(currency);

    const listing = (r[c.listing] || "").trim();
    result.listingCounts[listing] = (result.listingCounts[listing] || 0) + 1;

    result.reservations.push({
      confirmationCode: code,
      guestName: (r[c.guest] || "").trim(),
      listing,
      checkIn,
      checkOut,
      nights: parseInt(r[c.nights] || "0", 10) || 0,
      currency,
      grossCents: moneyToCents(r[c.gross] || "") ?? 0,
      hostFeeCents: moneyToCents(r[c.serviceFee] || "") ?? 0,
      cleaningFeeCents: moneyToCents(r[c.cleaningFee] || "") ?? 0,
      payoutCents: moneyToCents(r[c.amount] || "") ?? 0,
    });
  }

  result.currencies = [...currencies];
  return result;
}
