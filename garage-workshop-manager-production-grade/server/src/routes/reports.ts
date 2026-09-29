import type { FastifyInstance } from "fastify";
import { parse, requireUser } from "../http";
import { getSettings, listTechnicians } from "../repo/core";
import { loadJobs } from "../repo/jobs";
import { workshopStats } from "../../../shared/analytics";
import { periodSchema } from "../../../shared/schemas";

const csvCell = (v: unknown) => {
  if (v === null || v === undefined) return "";
  let s = String(v);
  // Neutralise spreadsheet formulas (CSV injection).
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function reportRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser("admin", "advisor"));

  app.get("/reports", async (req) => {
    const p = parse(periodSchema, req.query);
    const [from, to] = p.from <= p.to ? [p.from, p.to] : [p.to, p.from];
    // Jobs completed around the period (the day boundary is re-checked by the shared stats), plus unpaid invoices.
    const ids = (
      await app.db.query<{ id: string }>(
        `SELECT DISTINCT j.id FROM jobs j JOIN job_status_events e ON e.job_id = j.id AND e.status = 'Completed'
          WHERE j.status = 'Completed' AND e.at >= $1::date - 1 AND e.at < $2::date + 2
         UNION SELECT job_id FROM invoices WHERE paid_at IS NULL AND voided_at IS NULL`,
        [from, to],
      )
    ).rows.map((r) => r.id);
    const [jobs, technicians, settings] = await Promise.all([loadJobs(app.db, ids), listTechnicians(app.db), getSettings(app.db)]);
    return workshopStats({ settings, jobs, technicians, customers: [], vehicles: [], parts: [] }, { from, to });
  });

  /** Invoice register for the accountant: one row per invoice issued in the period, voids included. */
  app.get("/reports/invoices.csv", async (req, reply) => {
    const p = parse(periodSchema, req.query);
    const { rows } = await app.db.query(
      `SELECT i.number, to_char(i.issued_at AT TIME ZONE $3, 'YYYY-MM-DD') AS issued, j.number AS job, c.name AS customer, v.plate,
              i.labour_cents, i.parts_cents, i.discount_cents, i.net_cents, i.tax_percent, i.tax_cents, i.total_cents,
              to_char(i.paid_at AT TIME ZONE $3, 'YYYY-MM-DD') AS paid, i.method,
              to_char(i.voided_at AT TIME ZONE $3, 'YYYY-MM-DD') AS voided, i.void_reason
         FROM invoices i JOIN jobs j ON j.id = i.job_id JOIN customers c ON c.id = j.customer_id JOIN vehicles v ON v.id = j.vehicle_id
        WHERE (i.issued_at AT TIME ZONE $3)::date BETWEEN $1 AND $2
        ORDER BY i.id`,
      [p.from, p.to, app.config.TIMEZONE],
    );
    const money = (c: number) => (c / 100).toFixed(2);
    const header = ["Invoice", "IssuedDate", "Job", "Customer", "Plate", "Labour", "Parts", "Discount", "Net", "TaxPercent", "Tax", "Total", "PaidDate", "Method", "VoidedDate", "VoidReason"];
    const lines = rows.map((r) =>
      [r.number, r.issued, r.job, r.customer, r.plate, money(r.labour_cents), money(r.parts_cents), money(r.discount_cents), money(r.net_cents), Number(r.tax_percent), money(r.tax_cents), money(r.total_cents), r.paid, r.method, r.voided, r.void_reason]
        .map(csvCell)
        .join(","),
    );
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="invoices-${p.from}-to-${p.to}.csv"`)
      .send([header.join(","), ...lines].join("\r\n") + "\r\n");
  });

}
