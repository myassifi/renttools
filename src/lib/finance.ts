// Finance helpers — pure functions so the report math is unit-testable
// without a DB. All money is integer cents in the account currency.

export const DEFAULT_CURRENCY = "EUR";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "2026-08-25" -> "2026-08" */
export function monthKey(date: string): string {
  return date.substring(0, 7);
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeap(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/**
 * Add `months` calendar months to a YYYY-MM-DD string, clamping the day
 * when the target month is shorter (Jan 31 + 1mo -> Feb 28/29). Used to
 * materialize recurring expenses.
 */
export function addMonthsClamped(date: string, months: number): string {
  const m = DATE_RE.exec(date);
  if (!m) return date;
  const year = parseInt(m[1], 10);
  const monthIndex = parseInt(m[2], 10) - 1;
  const day = parseInt(m[3], 10);
  const total = year * 12 + monthIndex + months;
  const y = Math.floor(total / 12);
  const mo = ((total % 12) + 12) % 12;
  const dim = mo === 1 && isLeap(y) ? 29 : DAYS_IN_MONTH[mo];
  const d = Math.min(day, dim);
  return `${y}-${String(mo + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Dates for a recurring expense: start + `occurrences - 1` monthly repeats. */
export function recurringDates(start: string, occurrences: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < Math.max(1, occurrences); i++) {
    out.push(addMonthsClamped(start, i));
  }
  return out;
}

/** "1234.56" or "1234,56" -> 123456; null on garbage/negative. */
export function parseMoneyInput(input: string): number | null {
  const t = input.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [whole, frac = ""] = t.split(".");
  const cents = parseInt(whole, 10) * 100 + parseInt(frac.padEnd(2, "0"), 10);
  return Number.isSafeInteger(cents) ? cents : null;
}

/** 123456 -> "1234.56" (for pre-filling edit inputs). */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** 123456 -> "1 234,56 €" etc, per locale + account currency. */
export function formatCents(
  cents: number,
  currency: string = DEFAULT_CURRENCY,
  locale = "en",
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/** Reservation money as carried on the API/client type. */
export interface MoneyStay {
  checkIn: string; // ISO or YYYY-MM-DD — only the first 7 chars are used
  propertyId: number;
  grossCents?: number | null;
  hostFeeCents?: number | null;
  cleaningFeeCents?: number | null;
  payoutCents?: number | null;
  // YYYY-MM-DD the platform posted the payout (cash date). When set,
  // the month buckets use it instead of the check-in month.
  payoutDate?: string | null;
}

export interface MoneyExpense {
  date: string; // YYYY-MM-DD
  propertyId: number;
  category: string;
  amountCents: number;
}

export interface FinanceMonth {
  key: string; // "YYYY-MM"
  grossCents: number;
  hostFeeCents: number;
  cleaningFeeCents: number;
  payoutCents: number;
  expenseCents: number;
  netCents: number; // payout - expenses (falls back to gross when payout unset)
}

/**
 * Bucket income by PAYOUT month (when a payout date is known — the cash
 * view) and expenses by their date's month. Stays without a payout date
 * fall back to their check-in month. When payoutCents is null but gross
 * exists, net falls back to gross so hosts who only enter the guest
 * price still get a meaningful number.
 */
export function aggregateFinance(
  stays: MoneyStay[],
  expenses: MoneyExpense[],
): Map<string, FinanceMonth> {
  const months = new Map<string, FinanceMonth>();
  const bucket = (key: string): FinanceMonth => {
    let b = months.get(key);
    if (!b) {
      b = {
        key,
        grossCents: 0,
        hostFeeCents: 0,
        cleaningFeeCents: 0,
        payoutCents: 0,
        expenseCents: 0,
        netCents: 0,
      };
      months.set(key, b);
    }
    return b;
  };

  for (const s of stays) {
    const gross = s.grossCents ?? 0;
    const payout = s.payoutCents ?? 0;
    if (gross === 0 && payout === 0 && !s.hostFeeCents && !s.cleaningFeeCents) continue;
    const b = bucket(monthKey(s.payoutDate || s.checkIn));
    b.grossCents += gross;
    b.hostFeeCents += s.hostFeeCents ?? 0;
    b.cleaningFeeCents += s.cleaningFeeCents ?? 0;
    b.payoutCents += payout !== 0 ? payout : gross;
  }
  for (const e of expenses) {
    bucket(monthKey(e.date)).expenseCents += e.amountCents;
  }
  for (const b of months.values()) {
    b.netCents = b.payoutCents - b.expenseCents;
  }
  return months;
}

export interface FinanceTotals {
  grossCents: number;
  hostFeeCents: number;
  payoutCents: number;
  expenseCents: number;
  netCents: number;
  /** Average daily rate: gross per occupied night, cents. 0 when no nights. */
  adrCents: number;
  /** Revenue per available night (past days only), cents. */
  revparCents: number;
  pricedStays: number;
}

export function financeTotals(
  months: Iterable<FinanceMonth>,
  occupiedNights: number,
  pastDays: number,
): FinanceTotals {
  const t: FinanceTotals = {
    grossCents: 0,
    hostFeeCents: 0,
    payoutCents: 0,
    expenseCents: 0,
    netCents: 0,
    adrCents: 0,
    revparCents: 0,
    pricedStays: 0,
  };
  for (const m of months) {
    t.grossCents += m.grossCents;
    t.hostFeeCents += m.hostFeeCents;
    t.payoutCents += m.payoutCents;
    t.expenseCents += m.expenseCents;
    t.netCents += m.netCents;
  }
  if (occupiedNights > 0) t.adrCents = Math.round(t.grossCents / occupiedNights);
  if (pastDays > 0) t.revparCents = Math.round(t.grossCents / pastDays);
  return t;
}
