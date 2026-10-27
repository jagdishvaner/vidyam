/** Budgets run by calendar month in India time (IST, UTC+05:30, no daylight saving). */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

export function currentMonth(now: Date): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 7);
}

/** The month's start and the next month's start, as instants. */
export function monthRange(month: string): { start: Date; end: Date } {
  const [year, m] = month.split("-").map(Number) as [number, number];
  const start = new Date(Date.UTC(year, m - 1, 1) - IST_OFFSET_MS);
  const end = new Date(Date.UTC(year, m, 1) - IST_OFFSET_MS);
  return { start, end };
}
