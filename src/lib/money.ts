import type { Job, LabourLine, PartLine } from "../types";

// All money is stored as integer cents so totals never drift (0.1 + 0.2 problems).

export const labourLineCents = (l: LabourLine) => Math.round(l.hours * l.rateCents);
export const partLineCents = (p: PartLine) => Math.round(p.qty * p.unitPriceCents);

export interface JobTotals {
  labour: number;
  parts: number;
  subtotal: number;
  discount: number;
  net: number;
  tax: number;
  total: number;
  partsCost: number;
  /** Net revenue minus parts cost (labour counted as margin). */
  grossProfit: number;
  hours: number;
}

export function jobTotals(job: Pick<Job, "labour" | "parts" | "discountCents">, taxPercent: number): JobTotals {
  const labour = job.labour.reduce((s, l) => s + labourLineCents(l), 0);
  const parts = job.parts.reduce((s, p) => s + partLineCents(p), 0);
  const subtotal = labour + parts;
  const discount = Math.min(Math.max(0, Math.round(job.discountCents)), subtotal);
  const net = subtotal - discount;
  const tax = Math.round((net * Math.max(0, taxPercent)) / 100);
  const partsCost = job.parts.reduce((s, p) => s + Math.round(p.qty * p.unitCostCents), 0);
  return {
    labour,
    parts,
    subtotal,
    discount,
    net,
    tax,
    total: net + tax,
    partsCost,
    grossProfit: net - partsCost,
    hours: job.labour.reduce((s, l) => s + l.hours, 0),
  };
}

/** "123.45" / "123" / "1,234.5" → cents; invalid → NaN. */
export function toCents(input: string): number {
  const s = input.replace(/,/g, "").trim();
  if (!/^-?\d+(\.\d{0,2})?$/.test(s)) return NaN;
  return Math.round(Number(s) * 100);
}

export const fromCents = (c: number) => (c / 100).toFixed(2);

/**
 * How stock must change when a job's part lines go from `before` to `after`
 * (negative = taken from the shelf). Keyed by part id.
 */
export function stockDelta(before: PartLine[], after: PartLine[]): Map<string, number> {
  const d = new Map<string, number>();
  for (const p of before) if (p.partId) d.set(p.partId, (d.get(p.partId) ?? 0) + p.qty);
  for (const p of after) if (p.partId) d.set(p.partId, (d.get(p.partId) ?? 0) - p.qty);
  for (const [k, v] of d) if (v === 0) d.delete(k);
  return d;
}
