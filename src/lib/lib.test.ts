import { describe, expect, it } from "vitest";
import { generateDemoData } from "../data/generate";
import { applyStock } from "../store/store";
import type { Job, PartLine } from "../types";
import { addMonths, completedOn, servicesDue, weekStart, workingDays, workshopStats } from "./analytics";
import { jobTotals, stockDelta, toCents } from "./money";

const line = (partId: string | undefined, qty: number, price = 1000, cost = 600): PartLine => ({ id: `${partId}${qty}`, partId, description: "x", qty, unitPriceCents: price, unitCostCents: cost });

describe("money", () => {
  it("totals a job in cents with discount and tax", () => {
    const t = jobTotals(
      { labour: [{ id: "a", description: "Service", hours: 1.5, rateCents: 9500 }], parts: [line("p1", 2, 1299, 700)], discountCents: 1000 },
      8,
    );
    expect(t.labour).toBe(14250);
    expect(t.parts).toBe(2598);
    expect(t.net).toBe(14250 + 2598 - 1000);
    expect(t.tax).toBe(Math.round(15848 * 0.08));
    expect(t.total).toBe(15848 + 1268);
    expect(t.grossProfit).toBe(15848 - 1400);
  });
  it("never discounts below zero", () => {
    const t = jobTotals({ labour: [], parts: [line("p", 1, 500)], discountCents: 99999 }, 10);
    expect(t.net).toBe(0);
    expect(t.total).toBe(0);
  });
  it("parses money input strictly", () => {
    expect(toCents("1,234.5")).toBe(123450);
    expect(toCents("12")).toBe(1200);
    expect(toCents("0.1")).toBe(10);
    expect(Number.isNaN(toCents("12.345"))).toBe(true);
    expect(Number.isNaN(toCents("abc"))).toBe(true);
  });
  it("computes stock movements between part lists", () => {
    const d = stockDelta([line("a", 2), line("b", 1), line(undefined, 5)], [line("a", 3), line("c", 1)]);
    expect(Object.fromEntries(d)).toEqual({ a: -1, b: 1, c: -1 });
  });
});

describe("stock follows jobs", () => {
  const parts = [{ id: "a", sku: "A", name: "A", category: "", stock: 10, reorderLevel: 2, costCents: 1, priceCents: 2 }];
  const job = (status: Job["status"], qty: number): Job => ({
    id: "j", number: "J-1", customerId: "c", vehicleId: "v", bookedFor: "2026-09-01", createdAt: "", complaint: "", notes: "", mileageIn: 0,
    status, statusHistory: [], labour: [], parts: [line("a", qty)], discountCents: 0,
  });
  it("takes, adjusts and returns stock", () => {
    let p = applyStock(parts, undefined, job("In progress", 3));
    expect(p[0].stock).toBe(7);
    p = applyStock(p, job("In progress", 3), job("In progress", 1));
    expect(p[0].stock).toBe(9);
    p = applyStock(p, job("In progress", 1), job("Cancelled", 1));
    expect(p[0].stock).toBe(10);
    p = applyStock(p, job("Cancelled", 1), job("Booked", 1));
    expect(p[0].stock).toBe(9);
  });
});

describe("dates & analytics", () => {
  it("handles calendar edges", () => {
    expect(weekStart("2026-09-27")).toBe("2026-09-21"); // Sunday → previous Monday
    expect(weekStart("2026-09-28")).toBe("2026-09-28");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2023-12-15", 12)).toBe("2024-12-15");
    expect(workingDays("2026-09-21", "2026-09-27")).toBe(6);
  });

  const today = "2026-09-28";
  const data = generateDemoData(today);

  it("generates consistent demo data", () => {
    expect(generateDemoData(today)).toEqual(data);
    const ids = new Set(data.vehicles.map((v) => v.id));
    const custs = new Set(data.customers.map((c) => c.id));
    const invoices = new Set<string>();
    for (const j of data.jobs) {
      expect(ids.has(j.vehicleId)).toBe(true);
      expect(custs.has(j.customerId)).toBe(true);
      expect(data.vehicles.find((v) => v.id === j.vehicleId)!.customerId).toBe(j.customerId);
      const times = j.statusHistory.map((e) => Date.parse(e.at));
      expect([...times].sort((a, b) => a - b)).toEqual(times);
      expect(j.statusHistory.at(-1)!.status).toBe(j.status);
      expect(j.createdAt.slice(0, 10) <= today).toBe(true);
      if (j.status === "Completed") {
        expect(j.invoice).toBeTruthy();
        expect(invoices.has(j.invoice!.number)).toBe(false);
        invoices.add(j.invoice!.number);
      } else expect(j.invoice).toBeUndefined();
      if (j.bookedFor > today) expect(j.status).toBe("Booked");
    }
    expect(data.jobs.some((j) => j.bookedFor === today && j.status === "In progress")).toBe(true);
  });

  it("produces sensible workshop numbers", () => {
    const s = workshopStats(data, { from: "2026-09-01", to: today });
    expect(s.jobsCompleted).toBeGreaterThan(50);
    expect(s.labourRevenue + s.partsRevenue).toBe(s.revenue);
    expect(s.weekly.reduce((a, w) => a + w.labour + w.parts, 0)).toBe(s.revenue);
    expect(s.weekly.reduce((a, w) => a + w.jobs, 0)).toBe(s.jobsCompleted);
    expect(s.partsMargin).toBeGreaterThan(0.3);
    expect(s.avgTurnaroundHours).toBeGreaterThan(0.5);
    expect(s.technicians.every((t) => t.utilisation >= 0 && t.utilisation < 1.2)).toBe(true);
    const inRange = data.jobs.filter((j) => { const d = completedOn(j); return d && d >= "2026-09-01" && d <= today; }).length;
    expect(s.jobsCompleted).toBe(inRange);
  });

  it("lists vehicles due for service, skipping ones already booked", () => {
    const due = servicesDue({ ...data, settings: { ...data.settings, serviceIntervalMonths: 3 } }, today);
    expect(due.length).toBeGreaterThan(0);
    for (const d of due) expect(d.due <= "2026-10-28").toBe(true);
    const booked = new Set(data.jobs.filter((j) => j.status === "Booked").map((j) => j.vehicleId));
    expect(due.some((d) => booked.has(d.vehicle.id))).toBe(false);
  });
});
