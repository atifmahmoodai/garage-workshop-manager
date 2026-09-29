// All day arithmetic is done in UTC on YYYY-MM-DD strings so results never
// shift with the viewer's timezone or daylight-saving changes.

const DAY_MS = 86_400_000;

export function parseDay(day: string): number {
  const [y, m, d] = day.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function formatDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Today's date in the viewer's local calendar, as YYYY-MM-DD. */
export function todayLocal(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(day: string, n: number): string {
  return formatDay(parseDay(day) + n * DAY_MS);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseDay(to) - parseDay(from)) / DAY_MS);
}

/** YYYY-MM key for grouping. */
export function monthKey(day: string): string {
  return day.slice(0, 7);
}

/** Inclusive list of YYYY-MM keys from the month of `from` to the month of `to`. */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.slice(0, 7).split("-").map(Number);
  const [ey, em] = to.slice(0, 7).split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[m - 1]} ${String(y).slice(2)}`;
}

/** First day of the month `n` months before the month containing `day`. */
export function startOfMonthsAgo(day: string, n: number): string {
  let [y, m] = day.slice(0, 7).split("-").map(Number);
  m -= n;
  while (m < 1) {
    m += 12;
    y--;
  }
  return `${y}-${String(m).padStart(2, "0")}-01`;
}
