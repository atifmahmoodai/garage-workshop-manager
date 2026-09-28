import type { Job, JobStatus, WorkshopData } from "../types";
import { addDays, daysBetween, parseDay } from "./dates";
import { jobTotals } from "./money";

export const lastEventAt = (job: Job, status: JobStatus) => {
  for (let i = job.statusHistory.length - 1; i >= 0; i--) if (job.statusHistory[i].status === status) return job.statusHistory[i].at;
  return undefined;
};
export const firstEventAt = (job: Job, status: JobStatus) => job.statusHistory.find((e) => e.status === status)?.at;

/** Local-independent day of an ISO timestamp (UTC date). */
const dayOf = (isoTs: string) => isoTs.slice(0, 10);

export function completedOn(job: Job): string | undefined {
  const at = job.status === "Completed" ? lastEventAt(job, "Completed") : undefined;
  return at ? dayOf(at) : undefined;
}

/** Monday of the week containing `day`. */
export function weekStart(day: string): string {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(day, -((dow + 6) % 7));
}

/** Working days (Mon–Sat) in an inclusive range. */
export function workingDays(from: string, to: string): number {
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) if (new Date(`${d}T00:00:00Z`).getUTCDay() !== 0) n++;
  return n;
}

export interface Period {
  from: string;
  to: string;
}

export function workshopStats(data: WorkshopData, p: Period, hoursPerDay = 8) {
  const tax = data.settings.taxPercent;
  const done = data.jobs
    .map((j) => ({ job: j, day: completedOn(j), t: jobTotals(j, tax) }))
    .filter((x): x is { job: Job; day: string; t: ReturnType<typeof jobTotals> } => !!x.day && x.day >= p.from && x.day <= p.to);

  const sum = (f: (x: (typeof done)[number]) => number) => done.reduce((s, x) => s + f(x), 0);
  const revenue = sum((x) => x.t.net);
  // Discounts are spread over labour and parts in proportion to their share of the job.
  const labourNet = (x: (typeof done)[number]) => (x.t.subtotal ? Math.round((x.t.labour * x.t.net) / x.t.subtotal) : 0);
  const labourRevenue = sum(labourNet);
  const partsRevenue = revenue - labourRevenue;
  const partsCost = sum((x) => x.t.partsCost);

  const turnarounds = done
    .map(({ job }) => {
      const a = firstEventAt(job, "In progress");
      const b = lastEventAt(job, "Ready");
      return a && b ? (Date.parse(b) - Date.parse(a)) / 3_600_000 : NaN;
    })
    .filter((h) => Number.isFinite(h) && h >= 0);

  const avail = workingDays(p.from, p.to) * hoursPerDay;
  const technicians = data.technicians.map((t) => {
    const mine = done.filter((x) => x.job.technicianId === t.id);
    const hours = mine.reduce((s, x) => s + x.t.hours, 0);
    return {
      id: t.id,
      name: t.name,
      jobs: mine.length,
      hours,
      revenue: mine.reduce((s, x) => s + x.t.net, 0),
      utilisation: avail ? hours / avail : 0,
    };
  });

  // Weekly revenue split into labour and parts (net of discount, pro rata).
  const weeks = new Map<string, { week: string; labour: number; parts: number; jobs: number }>();
  for (let w = weekStart(p.from); w <= p.to; w = addDays(w, 7)) weeks.set(w, { week: w, labour: 0, parts: 0, jobs: 0 });
  for (const x of done) {
    const row = weeks.get(weekStart(x.day));
    if (!row) continue;
    const l = labourNet(x);
    row.labour += l;
    row.parts += x.t.net - l;
    row.jobs++;
  }

  const services = new Map<string, { name: string; count: number; revenue: number }>();
  for (const x of done) {
    for (const l of x.job.labour) {
      const name = l.description.trim() || "Other";
      const s = services.get(name) ?? { name, count: 0, revenue: 0 };
      s.count++;
      s.revenue += Math.round(l.hours * l.rateCents);
      services.set(name, s);
    }
  }

  const unpaid = data.jobs.filter((j) => j.invoice && !j.invoice.paidAt);
  return {
    jobsCompleted: done.length,
    revenue,
    labourRevenue,
    partsRevenue,
    partsMargin: partsRevenue ? (partsRevenue - partsCost) / partsRevenue : 0,
    grossProfit: revenue - partsCost,
    avgJobValue: done.length ? revenue / done.length : 0,
    avgTurnaroundHours: turnarounds.length ? turnarounds.reduce((a, b) => a + b, 0) / turnarounds.length : 0,
    hoursBilled: sum((x) => x.t.hours),
    technicians,
    weekly: [...weeks.values()],
    topServices: [...services.values()].sort((a, b) => b.count - a.count).slice(0, 8),
    unpaidCount: unpaid.length,
    unpaidTotal: unpaid.reduce((s, j) => s + jobTotals(j, tax).total, 0),
  };
}

export function lowStock(data: WorkshopData) {
  return data.parts.filter((p) => p.stock <= p.reorderLevel).sort((a, b) => a.stock - a.reorderLevel - (b.stock - b.reorderLevel));
}

/** Adds whole months, clamping to the month's last day (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  const dim = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, "0")}-${String(Math.min(d, dim)).padStart(2, "0")}`;
}

/** Vehicles whose next service falls within `withinDays` (or is overdue), soonest first. */
export function servicesDue(data: WorkshopData, today: string, withinDays = 30) {
  const last = new Map<string, string>();
  const upcoming = new Set(data.jobs.filter((j) => j.status === "Booked" || j.status === "In progress").map((j) => j.vehicleId));
  for (const j of data.jobs) {
    const d = completedOn(j);
    if (d && (!last.has(j.vehicleId) || d > last.get(j.vehicleId)!)) last.set(j.vehicleId, d);
  }
  const limit = addDays(today, withinDays);
  return data.vehicles
    .filter((v) => last.has(v.id) && !upcoming.has(v.id))
    .map((v) => {
      const lastService = last.get(v.id)!;
      const due = addMonths(lastService, data.settings.serviceIntervalMonths);
      return { vehicle: v, customer: data.customers.find((c) => c.id === v.customerId), lastService, due, overdueDays: daysBetween(due, today) };
    })
    .filter((x) => x.due <= limit)
    .sort((a, b) => parseDay(a.due) - parseDay(b.due));
}
