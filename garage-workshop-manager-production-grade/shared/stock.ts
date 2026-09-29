import { stockDelta } from "./money";
import type { Job, Part } from "./types";

/** Parts a job currently takes off the shelf (a cancelled job holds none). */
export const heldParts = (j: Pick<Job, "status" | "parts"> | undefined) => (j && j.status !== "Cancelled" ? j.parts : []);

/** Stock change per part id when a job goes from `before` to `after` (negative = taken from the shelf). */
export const jobStockDelta = (before: Pick<Job, "status" | "parts"> | undefined, after: Pick<Job, "status" | "parts"> | undefined) =>
  stockDelta(heldParts(before), heldParts(after));

/** Applies that change to a parts list (used by the demo generator and tests; the server does it in SQL). */
export function applyStock(parts: Part[], before: Job | undefined, after: Job | undefined): Part[] {
  const delta = jobStockDelta(before, after);
  if (!delta.size) return parts;
  return parts.map((p) => (delta.has(p.id) ? { ...p, stock: p.stock + delta.get(p.id)! } : p));
}
