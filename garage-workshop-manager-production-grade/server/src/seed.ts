import type { PoolClient } from "pg";
import { hashPassword } from "./security/password";
import { issueInvoice } from "./repo/jobs";
import { generateDemoData } from "../../shared/generate";

export const DEMO_ADMIN = "admin@demo.local";
export const DEMO_ADVISOR = "advisor@demo.local";
export const DEMO_TECH = "tech@demo.local";

/** Six months of demo history. Invoices are issued exactly as the app would issue them. */
export async function seedDemo(c: PoolClient, opts: { today: string; force: boolean; password: string }) {
  const existing = (await c.query<{ n: number }>("SELECT count(*)::int AS n FROM jobs")).rows[0].n;
  if (existing && !opts.force) throw new Error(`The database already has ${existing} jobs. Re-run with --force to replace everything with demo data.`);
  if (opts.force) {
    for (const t of ["stock_movements", "invoices", "job_status_events", "job_parts", "job_labour", "jobs", "vehicles", "customers", "parts", "technicians"]) await c.query(`DELETE FROM ${t}`);
    await c.query("UPDATE counters SET value = CASE name WHEN 'job' THEN 1000 ELSE 5000 END");
  }

  const hash = await hashPassword(opts.password);
  for (const [id, email, name, role] of [
    ["u-demo-admin", DEMO_ADMIN, "Demo Admin", "admin"],
    ["u-demo-advisor", DEMO_ADVISOR, "Demo Advisor", "advisor"],
    ["u-demo-tech", DEMO_TECH, "Demo Technician", "technician"],
  ]) {
    await c.query(
      `INSERT INTO users (id, email, name, role, password_hash) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, role = EXCLUDED.role, password_hash = EXCLUDED.password_hash, active = true, failed_logins = 0, locked_until = NULL`,
      [id, email, name, role, hash],
    );
  }

  const d = generateDemoData(opts.today);
  await c.query("INSERT INTO settings (key, value) VALUES ('workshop', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [JSON.stringify(d.settings)]);
  const json = (rows: unknown[]) => JSON.stringify(rows);
  await c.query("INSERT INTO technicians SELECT * FROM json_populate_recordset(NULL::technicians, $1)", [json(d.technicians)]);
  await c.query("INSERT INTO customers (id, name, phone, email) SELECT id, name, phone, email FROM json_populate_recordset(NULL::customers, $1)", [json(d.customers)]);
  await c.query(
    "INSERT INTO vehicles (id, customer_id, plate, make, model, year, vin, mileage) SELECT id, customer_id, plate, make, model, year, vin, mileage FROM json_populate_recordset(NULL::vehicles, $1)",
    [json(d.vehicles.map((v) => ({ ...v, customer_id: v.customerId })))],
  );
  await c.query(
    "INSERT INTO parts (id, sku, name, category, stock, reorder_level, cost_cents, price_cents) SELECT id, sku, name, category, stock, reorder_level, cost_cents, price_cents FROM json_populate_recordset(NULL::parts, $1)",
    [json(d.parts.map((p) => ({ ...p, reorder_level: p.reorderLevel, cost_cents: p.costCents, price_cents: p.priceCents })))],
  );
  await c.query("INSERT INTO stock_movements (part_id, delta, reason, note) SELECT id, stock, 'opening', 'Opening stock (demo)' FROM parts WHERE stock <> 0");

  await c.query(
    `INSERT INTO jobs (id, number, customer_id, vehicle_id, booked_for, created_at, complaint, notes, mileage_in, status, technician_id, discount_cents)
     SELECT id, number, customer_id, vehicle_id, booked_for, created_at, complaint, notes, mileage_in, status, technician_id, discount_cents FROM json_populate_recordset(NULL::jobs, $1)`,
    [
      json(
        d.jobs.map((j) => ({
          id: j.id,
          number: j.number,
          customer_id: j.customerId,
          vehicle_id: j.vehicleId,
          booked_for: j.bookedFor,
          created_at: j.createdAt,
          complaint: j.complaint,
          notes: j.notes,
          mileage_in: j.mileageIn,
          status: j.status,
          technician_id: j.technicianId ?? null,
          discount_cents: j.discountCents,
        })),
      ),
    ],
  );
  const lab = d.jobs.flatMap((j) => j.labour.map((l, i) => ({ job_id: j.id, position: i + 1, description: l.description, hours: l.hours, rate_cents: l.rateCents })));
  await c.query("INSERT INTO job_labour (job_id, position, description, hours, rate_cents) SELECT job_id, position, description, hours, rate_cents FROM json_populate_recordset(NULL::job_labour, $1)", [json(lab)]);
  const prt = d.jobs.flatMap((j) =>
    j.parts.map((p, i) => ({ job_id: j.id, position: i + 1, part_id: p.partId ?? null, description: p.description, qty: p.qty, unit_price_cents: p.unitPriceCents, unit_cost_cents: p.unitCostCents })),
  );
  await c.query(
    "INSERT INTO job_parts (job_id, position, part_id, description, qty, unit_price_cents, unit_cost_cents) SELECT job_id, position, part_id, description, qty, unit_price_cents, unit_cost_cents FROM json_populate_recordset(NULL::job_parts, $1)",
    [json(prt)],
  );
  const ev = d.jobs.flatMap((j) => j.statusHistory.map((e) => ({ job_id: j.id, status: e.status, at: e.at })));
  await c.query("INSERT INTO job_status_events (job_id, status, at) SELECT job_id, status, at FROM json_populate_recordset(NULL::job_status_events, $1)", [json(ev)]);

  const byId = <T extends { id: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x]));
  const customers = byId(d.customers);
  const vehicles = byId(d.vehicles);
  // Issue in date order so invoice numbers run with time, like real ones.
  const invoiced = d.jobs.filter((j) => j.invoice).sort((a, b) => a.invoice!.issuedAt.localeCompare(b.invoice!.issuedAt));
  for (const j of invoiced) {
    await issueInvoice(c, j, {
      customer: customers.get(j.customerId)!,
      vehicle: vehicles.get(j.vehicleId)!,
      settings: d.settings,
      userId: null,
      at: j.invoice!.issuedAt,
      paid: j.invoice!.paidAt ? { at: j.invoice!.paidAt, method: j.invoice!.method! } : undefined,
    });
  }
  const maxJob = Math.max(1000, ...d.jobs.map((j) => Number(j.number.replace(/\D/g, ""))));
  await c.query("UPDATE counters SET value = $1 WHERE name = 'job'", [maxJob]);
  return { customers: d.customers.length, vehicles: d.vehicles.length, jobs: d.jobs.length, invoices: invoiced.length, logins: [DEMO_ADMIN, DEMO_ADVISOR, DEMO_TECH] };
}
