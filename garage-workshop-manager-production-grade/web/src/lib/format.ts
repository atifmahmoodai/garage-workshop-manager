import type { Settings } from "../types";

const cache = new Map<string, Intl.NumberFormat>();
function nf(locale: string, currency: string) {
  const k = `${locale}|${currency}`;
  if (!cache.has(k)) {
    try {
      cache.set(k, new Intl.NumberFormat(locale, { style: "currency", currency }));
    } catch {
      cache.set(k, new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })); // bad settings shouldn't crash the app
    }
  }
  return cache.get(k)!;
}

export const money = (cents: number, s: Pick<Settings, "locale" | "currency">) => nf(s.locale, s.currency).format((Number.isFinite(cents) ? cents : 0) / 100);

export function fmtDate(isoOrDay: string, withTime = false): string {
  const d = new Date(isoOrDay.length === 10 ? `${isoOrDay}T00:00:00Z` : isoOrDay);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
    ...(isoOrDay.length === 10 ? { timeZone: "UTC" } : {}),
  });
}

export const fmtHours = (h: number) => `${(Math.round(h * 10) / 10).toFixed(1)} h`;
export const fmtPct = (r: number) => `${(Number.isFinite(r) ? r * 100 : 0).toFixed(0)}%`;
