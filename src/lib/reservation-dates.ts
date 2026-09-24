const DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})(?:T.*)?$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Parse a reservation date as a calendar day, not as a local timestamp.
 * API responses contain ISO timestamps while date inputs submit YYYY-MM-DD;
 * normalising both to UTC midnight keeps the chosen day stable across timezones.
 */
export function parseReservationDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const match = trimmed.match(DATE_PREFIX);
  if (!match) return null;
  if (trimmed.length > 10 && Number.isNaN(new Date(trimmed).getTime())) return null;

  const dateOnly = match[1];
  const date = new Date(`${dateOnly}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dateOnly) {
    return null;
  }
  return date;
}

export function toReservationDateInput(value: string): string {
  const parsed = parseReservationDate(value);
  return parsed ? parsed.toISOString().slice(0, 10) : "";
}

/**
 * Calendar-day key (YYYY-MM-DD) of a reservation date/timestamp value.
 * Extracts the stored calendar date without interpreting the timestamp in
 * the browser's local timezone — unlike new Date(value).getDate() etc.,
 * which shifts the day by ±1 for users west/east of UTC.
 */
export function reservationDayKey(value: unknown): string {
  const parsed = parseReservationDate(value);
  return parsed ? parsed.toISOString().slice(0, 10) : "";
}

/**
 * Local-midnight Date for the calendar day of a reservation value. Use this
 * instead of new Date(value) when the value represents a booking day, so
 * local-timezone arithmetic stays on the intended day.
 */
export function reservationLocalDate(value: unknown): Date | null {
  const key = reservationDayKey(value);
  if (!key) return null;
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function reservationNights(checkIn: string, checkOut: string): number {
  const start = parseReservationDate(checkIn);
  const end = parseReservationDate(checkOut);
  if (!start || !end || end <= start) return 0;
  return Math.round((end.getTime() - start.getTime()) / DAY_MS);
}

export type ReservationDateRangeError =
  | "required"
  | "invalid-check-in"
  | "invalid-check-out"
  | "invalid-range";

export function validateReservationDateRange(
  checkIn: string,
  checkOut: string,
): ReservationDateRangeError | null {
  if (!checkIn || !checkOut) return "required";
  const start = parseReservationDate(checkIn);
  if (!start) return "invalid-check-in";
  const end = parseReservationDate(checkOut);
  if (!end) return "invalid-check-out";
  if (end <= start) return "invalid-range";
  return null;
}
