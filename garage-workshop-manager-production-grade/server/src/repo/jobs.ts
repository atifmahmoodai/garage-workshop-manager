import type { Queryable } from "../db";
import { jobTotals } from "../../../shared/money";
import type { InvoiceDoc, JobRow } from "../../../shared/schemas";
import { jobStockDelta } from "../../../shared/stock";
import type { Customer, Job, JobStatus, LabourLine, PartLine, PaymentMethod, Settings, Vehicle } from "../../../shared/types";

/** Next gapless number for a document series; the row lock is held until the transaction ends. */
export async function nextNumber(c: Queryable, series: "job" | "invoice"): Promise<string> {
  const { rows } = await c.query<{ value: number }>("UPDATE counters SET value = value + 1 WHERE name = $1 RETURNING value", [series]);
  return `${series === "job" ? "J" : "INV"}-${rows[0].value}`;
}

interface JobDbRow {
  id: string;
  number: string;
  customer_id: string;
  vehicle_id: string;
  booked_for: string;
  created_at: Date;
  complaint: string;
  notes: string;
  mileage_in: number;
  status: JobStatus;
  technician_id: string | null;
  discount_cents: number;
  version: number;
}

/** Loads full jobs (lines, history, live invoice) for the given ids, in one round trip per table. */
export async function loadJobs(c: Queryable, ids: string[]): Promise<Job[]> {
  if (!ids.length) return [];
  // Sequential on purpose: `c` may be a transaction client, which runs one query at a time.
  const jobs = await c.query<JobDbRow>("SELECT * FROM jobs WHERE id = ANY($1)", [ids]);
  const labour = await c.query<{ id: string; job_id: string; description: string; hours: number; rate_cents: number }>(
      "SELECT id::text, job_id, description, hours, rate_cents FROM job_labour WHERE job_id = ANY($1) ORDER BY job_id, position",
      [ids],
    );
  const parts = await c.query<{ id: string; job_id: string; part_id: string | null; description: string; qty: number; unit_price_cents: number; unit_cost_cents: number }>(
      "SELECT id::text, job_id, part_id, description, qty, unit_price_cents, unit_cost_cents FROM job_parts WHERE job_id = ANY($1) ORDER BY job_id, position",
      [ids],
    );
  const events = await c.query<{ job_id: string; status: JobStatus; at: Date }>("SELECT job_id, status, at FROM job_status_events WHERE job_id = ANY($1) ORDER BY job_id, at, id", [ids]);
  const invoices = await c.query<{ job_id: string; number: string; issued_at: Date; paid_at: Date | null; method: string | null; tax_percent: number; total_cents: number }>(
      "SELECT job_id, number, issued_at, paid_at, method, tax_percent, total_cents FROM invoices WHERE job_id = ANY($1) AND voided_at IS NULL",
      [ids],
    );
  const group = <T extends { job_id: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(r.job_id, [...(m.get(r.job_id) ?? []), r]);
    return m;
  };
  const L = group(labour.rows);
  const P = group(parts.rows);
  const E = group(events.rows);
  const I = new Map(invoices.rows.map((r) => [r.job_id, r]));
  const byId = new Map(
    jobs.rows.map((r) => {
      const inv = I.get(r.id);
      const job: Job = {
        id: r.id,
        number: r.number,
        customerId: r.customer_id,
        vehicleId: r.vehicle_id,
        bookedFor: r.booked_for,
        createdAt: r.created_at.toISOString(),
        complaint: r.complaint,
        notes: r.notes,
        mileageIn: r.mileage_in,
        status: r.status,
        statusHistory: (E.get(r.id) ?? []).map((e) => ({ status: e.status, at: e.at.toISOString() })),
        technicianId: r.technician_id ?? undefined,
        labour: (L.get(r.id) ?? []).map((l): LabourLine => ({ id: l.id, description: l.description, hours: Number(l.hours), rateCents: l.rate_cents })),
        parts: (P.get(r.id) ?? []).map(
          (p): PartLine => ({
            id: p.id,
            partId: p.part_id ?? undefined,
            description: p.description,
            qty: p.qty,
            unitPriceCents: p.unit_price_cents,
            unitCostCents: p.unit_cost_cents,
          }),
        ),
        discountCents: r.discount_cents,
        invoice: inv
          ? {
              number: inv.number,
              issuedAt: inv.issued_at.toISOString(),
              paidAt: inv.paid_at?.toISOString(),
              method: (inv.method ?? undefined) as PaymentMethod | undefined,
              taxPercent: Number(inv.tax_percent),
              totalCents: inv.total_cents,
            }
          : undefined,
        version: r.version,
      };
      return [r.id, job];
    }),
  );
  return ids.map((id) => byId.get(id)).filter((j): j is Job => !!j);
}

export async function getJob(c: Queryable, id: string): Promise<Job | null> {
  return (await loadJobs(c, [id]))[0] ?? null;
}

/** Replaces a job's lines. Stock-item costs come from the parts list, never from the browser. */
export async function writeLines(c: Queryable, jobId: string, job: Pick<Job, "labour" | "parts">) {
  await c.query("DELETE FROM job_labour WHERE job_id = $1", [jobId]);
  await c.query("DELETE FROM job_parts WHERE job_id = $1", [jobId]);
  if (job.labour.length) {
    await c.query(
      `INSERT INTO job_labour (job_id, position, description, hours, rate_cents)
       SELECT $1, ord, d, h, r FROM unnest($2::text[], $3::numeric[], $4::int[]) WITH ORDINALITY AS t(d, h, r, ord)`,
      [jobId, job.labour.map((l) => l.description), job.labour.map((l) => l.hours), job.labour.map((l) => l.rateCents)],
    );
  }
  if (job.parts.length) {
    await c.query(
      `INSERT INTO job_parts (job_id, position, part_id, description, qty, unit_price_cents, unit_cost_cents)
       SELECT $1, ord, pid, d, q, up, COALESCE(p.cost_cents, uc)
         FROM unnest($2::text[], $3::text[], $4::int[], $5::int[], $6::int[]) WITH ORDINALITY AS t(pid, d, q, up, uc, ord)
         LEFT JOIN parts p ON p.id = t.pid`,
      [
        jobId,
        job.parts.map((p) => p.partId ?? null),
        job.parts.map((p) => p.description),
        job.parts.map((p) => p.qty),
        job.parts.map((p) => p.unitPriceCents),
        job.parts.map((p) => p.unitCostCents),
      ],
    );
  }
}

/** Moves stock for the change from `before` to `after` and records each movement. */
export async function moveStockForJob(c: Queryable, jobId: string, before: Job | undefined, after: Pick<Job, "status" | "parts">, userId: string | null) {
  const delta = jobStockDelta(before, after);
  for (const [partId, d] of delta) {
    await c.query("UPDATE parts SET stock = stock + $2, updated_at = now() WHERE id = $1", [partId, d]);
    await c.query("INSERT INTO stock_movements (part_id, delta, reason, job_id, user_id) VALUES ($1, $2, 'job', $3, $4)", [partId, d, jobId, userId]);
  }
}

export async function addStatusEvent(c: Queryable, jobId: string, status: JobStatus, userId: string | null, at?: string) {
  await c.query("INSERT INTO job_status_events (job_id, status, at, user_id) VALUES ($1, $2, COALESCE($3::timestamptz, now()), $4)", [jobId, status, at ?? null, userId]);
}

/** Issues the invoice: a frozen copy of the job, customer, vehicle and workshop details. */
export async function issueInvoice(
  c: Queryable,
  job: Job,
  ctx: { customer: Customer; vehicle: Vehicle; settings: Settings; userId: string | null; at?: string; paid?: { at: string; method: string } },
): Promise<string> {
  const t = jobTotals(job, ctx.settings.taxPercent);
  const number = await nextNumber(c, "invoice");
  const doc: Omit<InvoiceDoc, "paidAt" | "method" | "voidedAt" | "voidReason" | "issuedAt"> = {
    number,
    jobId: job.id,
    jobNumber: job.number,
    taxPercent: ctx.settings.taxPercent,
    labourCents: t.labour,
    partsCents: t.parts,
    discountCents: t.discount,
    netCents: t.net,
    taxCents: t.tax,
    totalCents: t.total,
    lines: [
      ...job.labour.map((l) => ({ kind: "labour" as const, description: l.description, qty: l.hours, unitCents: l.rateCents, amountCents: Math.round(l.hours * l.rateCents) })),
      ...job.parts.map((p) => ({ kind: "part" as const, description: p.description, qty: p.qty, unitCents: p.unitPriceCents, amountCents: Math.round(p.qty * p.unitPriceCents) })),
    ],
    customer: { name: ctx.customer.name, phone: ctx.customer.phone, email: ctx.customer.email },
    vehicle: { plate: ctx.vehicle.plate, make: ctx.vehicle.make, model: ctx.vehicle.model, year: ctx.vehicle.year, vin: ctx.vehicle.vin, mileageIn: job.mileageIn },
    workshop: { name: ctx.settings.name, address: ctx.settings.address, phone: ctx.settings.phone, email: ctx.settings.email, currency: ctx.settings.currency, locale: ctx.settings.locale },
  };
  await c.query(
    `INSERT INTO invoices (job_id, number, issued_at, tax_percent, labour_cents, parts_cents, discount_cents, net_cents, tax_cents, total_cents, document, issued_by, paid_at, method)
     VALUES ($1, $2, COALESCE($3::timestamptz, now()), $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [job.id, number, ctx.at ?? null, ctx.settings.taxPercent, t.labour, t.parts, t.discount, t.net, t.tax, t.total, JSON.stringify(doc), ctx.userId, ctx.paid?.at ?? null, ctx.paid?.method ?? null],
  );
  return number;
}

export async function getInvoiceDoc(c: Queryable, jobId: string, number?: string): Promise<InvoiceDoc | null> {
  const { rows } = await c.query<{ document: Omit<InvoiceDoc, "issuedAt" | "paidAt" | "method" | "voidedAt" | "voidReason">; issued_at: Date; paid_at: Date | null; method: string | null; voided_at: Date | null; void_reason: string | null }>(
    `SELECT document, issued_at, paid_at, method, voided_at, void_reason FROM invoices
      WHERE job_id = $1 AND ($2::text IS NULL AND voided_at IS NULL OR number = $2)`,
    [jobId, number ?? null],
  );
  const r = rows[0];
  if (!r) return null;
  return { ...r.document, issuedAt: r.issued_at.toISOString(), paidAt: r.paid_at?.toISOString() ?? null, method: r.method, voidedAt: r.voided_at?.toISOString() ?? null, voidReason: r.void_reason };
}

export interface JobFilter {
  filter: string;
  q: string;
  customerId?: string;
  limit: number;
  offset: number;
}

const ROW_SELECT = `
  SELECT j.id, j.number, j.booked_for AS "bookedFor", j.created_at AS "createdAt", j.status, j.complaint, j.technician_id AS "technicianId",
         json_build_object('id', c.id, 'name', c.name, 'phone', c.phone) AS customer,
         json_build_object('id', v.id, 'plate', v.plate, 'make', v.make, 'model', v.model, 'year', v.year) AS vehicle,
         CASE WHEN i.number IS NULL THEN NULL
              ELSE json_build_object('number', i.number, 'paid', i.paid_at IS NOT NULL, 'totalCents', i.total_cents) END AS invoice,
         COALESCE((SELECT max(e.at) FROM job_status_events e WHERE e.job_id = j.id AND e.status = j.status), j.created_at) AS "statusSince",
         COALESCE((SELECT string_agg(l.description, ', ' ORDER BY l.position) FROM job_labour l WHERE l.job_id = j.id), '') AS "workSummary",
         j.discount_cents,
         COALESCE((SELECT sum(round(l.hours * l.rate_cents)) FROM job_labour l WHERE l.job_id = j.id), 0) AS labour_cents,
         COALESCE((SELECT sum(p.qty * p.unit_price_cents) FROM job_parts p WHERE p.job_id = j.id), 0) AS parts_cents
    FROM jobs j
    JOIN customers c ON c.id = j.customer_id
    JOIN vehicles v ON v.id = j.vehicle_id
    LEFT JOIN invoices i ON i.job_id = j.id AND i.voided_at IS NULL`;

type RawRow = Omit<JobRow, "totalCents" | "statusSince" | "createdAt"> & { statusSince: Date; createdAt: Date; discount_cents: number; labour_cents: number; parts_cents: number };

function toRow(r: RawRow, taxPercent: number): JobRow {
  const { discount_cents, labour_cents, parts_cents, ...rest } = r;
  // Invoiced jobs show the invoice amount; open jobs are priced at the current tax rate.
  const net = labour_cents + parts_cents - Math.min(discount_cents, labour_cents + parts_cents);
  const total = r.invoice ? r.invoice.totalCents : net + Math.round((net * taxPercent) / 100);
  return { ...rest, createdAt: r.createdAt.toISOString(), statusSince: r.statusSince.toISOString(), totalCents: total };
}

export async function listJobRows(c: Queryable, f: JobFilter, taxPercent: number): Promise<{ items: JobRow[]; total: number }> {
  const where: string[] = [];
  const args: unknown[] = [];
  const arg = (v: unknown) => {
    args.push(v);
    return `$${args.length}`;
  };
  if (f.filter === "unpaid") where.push("i.number IS NOT NULL AND i.paid_at IS NULL");
  else if (f.filter === "open") where.push("j.status NOT IN ('Completed', 'Cancelled')");
  else if (f.filter) where.push(`j.status = ${arg(f.filter)}`);
  if (f.customerId) where.push(`j.customer_id = ${arg(f.customerId)}`);
  for (const t of f.q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8)) {
    const p = arg(t);
    where.push(`(strpos(lower(j.number || ' ' || COALESCE(i.number, '') || ' ' || v.make || ' ' || v.model || ' ' || c.name || ' ' || c.phone || ' ' || j.complaint), ${p}) > 0
                 OR strpos(upper(regexp_replace(v.plate, '\\s', '', 'g')), upper(${p})) > 0)`);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = (await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM jobs j JOIN customers c ON c.id = j.customer_id JOIN vehicles v ON v.id = j.vehicle_id LEFT JOIN invoices i ON i.job_id = j.id AND i.voided_at IS NULL ${w}`, args)).rows[0].n;
  const { rows } = await c.query<RawRow>(`${ROW_SELECT} ${w} ORDER BY j.booked_for DESC, j.number DESC LIMIT ${Number(f.limit)} OFFSET ${Number(f.offset)}`, args);
  return { total, items: rows.map((r) => toRow(r, taxPercent)) };
}

/** Everything in the building plus bookings up to `horizon` (today's, overdue and upcoming). */
export async function boardRows(c: Queryable, horizon: string, taxPercent: number): Promise<JobRow[]> {
  const { rows } = await c.query<RawRow>(
    `${ROW_SELECT} WHERE j.status IN ('In progress', 'Waiting parts', 'Ready') OR (j.status = 'Booked' AND j.booked_for <= $1)
     ORDER BY j.booked_for, j.number`,
    [horizon],
  );
  return rows.map((r) => toRow(r, taxPercent));
}
