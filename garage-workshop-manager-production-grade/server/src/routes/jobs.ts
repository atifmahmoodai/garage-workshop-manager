import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { todayIn } from "../config";
import { tx, type Queryable } from "../db";
import { badRequest, conflict, HttpError, notFound, parse, requireUser } from "../http";
import { audit, customerVehicles, getCustomer, getSettings, getVehicle, listParts, listTechnicians } from "../repo/core";
import { addStatusEvent, boardRows, getInvoiceDoc, getJob, issueInvoice, listJobRows, moveStockForJob, nextNumber, writeLines } from "../repo/jobs";
import { addDays } from "../../../shared/dates";
import { jobTotals } from "../../../shared/money";
import { jobSchema, normalisePlate, paymentSchema, reopenSchema, statusSchema, type JobDetail, type JobInput } from "../../../shared/schemas";
import { BOARD_STATUSES, JOB_STATUSES, type Job, type JobStatus } from "../../../shared/types";

const listSchema = z.object({
  filter: z.union([z.literal(""), z.literal("unpaid"), z.literal("open"), z.enum(JOB_STATUSES)]).default(""),
  q: z.string().max(200).default(""),
  customerId: z.string().max(64).optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
const versionSchema = z.object({ version: z.number().int().min(1) });

/** Statuses a technician may move a job between (the front desk handles completion and cancellation). */
const TECH_STATUSES: JobStatus[] = ["In progress", "Waiting parts", "Ready"];

export async function jobRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser());
  const desk = requireUser("admin", "advisor");
  const today = () => todayIn(app.config.TIMEZONE);
  const uid = (req: FastifyRequest) => req.session!.user.id;

  app.get("/board", async () => {
    const t = today();
    const settings = await getSettings(app.db);
    const [rows, unpaid, low] = await Promise.all([
      boardRows(app.db, addDays(t, 7), settings.taxPercent),
      app.db.query<{ n: number; total: number }>("SELECT count(*)::int AS n, COALESCE(sum(total_cents), 0) AS total FROM invoices WHERE paid_at IS NULL AND voided_at IS NULL"),
      app.db.query<{ name: string }>("SELECT name FROM parts WHERE stock <= reorder_level ORDER BY stock - reorder_level, name"),
    ]);
    return {
      today: t,
      onBoard: rows.filter((r) => r.status !== "Booked" || r.bookedFor <= t),
      upcoming: rows.filter((r) => r.status === "Booked" && r.bookedFor > t),
      unpaid: { count: unpaid.rows[0].n, totalCents: unpaid.rows[0].total },
      lowStock: low.rows.map((r) => r.name),
    };
  });

  app.get("/jobs", async (req) => {
    const f = parse(listSchema, req.query);
    const settings = await getSettings(app.db);
    return listJobRows(app.db, { filter: f.filter, q: f.q, customerId: f.customerId, limit: f.limit, offset: f.offset }, settings.taxPercent);
  });

  app.get<{ Params: { id: string } }>("/jobs/:id", async (req): Promise<JobDetail> => {
    const job = await getJob(app.db, req.params.id);
    if (!job) throw notFound("Job not found");
    const [customer, vehicle, vehicles, settings, voids] = await Promise.all([
      getCustomer(app.db, job.customerId),
      getVehicle(app.db, job.vehicleId),
      customerVehicles(app.db, job.customerId),
      getSettings(app.db),
      app.db.query<{ number: string; voided_at: Date; void_reason: string }>(
        "SELECT number, voided_at, void_reason FROM invoices WHERE job_id = $1 AND voided_at IS NOT NULL ORDER BY voided_at",
        [job.id],
      ),
    ]);
    return {
      job,
      customer: customer!,
      vehicle: vehicle!,
      customerVehicles: vehicles,
      totals: jobTotals(job, job.invoice?.taxPercent ?? settings.taxPercent),
      invoiceVoids: voids.rows.map((v) => ({ number: v.number, voidedAt: v.voided_at.toISOString(), reason: v.void_reason })),
    };
  });

  /** Checks references and business rules, creating the customer / vehicle when the job brings new ones. */
  async function resolveParties(c: Queryable, input: JobInput, req: FastifyRequest): Promise<{ customerId: string; vehicleId: string }> {
    const errors: Record<string, string> = {};
    let customerId = input.customerId ?? "";
    if (input.newCustomer) {
      customerId = `c-${randomUUID()}`;
      await c.query("INSERT INTO customers (id, name, phone, email) VALUES ($1, $2, $3, $4)", [customerId, input.newCustomer.name, input.newCustomer.phone, input.newCustomer.email]);
      await audit(c, { userId: uid(req), action: "customer.create", entity: "customer", entityId: customerId, ip: req.ip });
    } else if (!customerId || !(await getCustomer(c, customerId))) errors.customerId = "Choose a customer.";

    let vehicleId = input.vehicleId ?? "";
    if (input.newVehicle) {
      const v = input.newVehicle;
      if (v.year > Number(today().slice(0, 4)) + 1) errors["newVehicle.year"] = "Check the year.";
      const dup = await c.query<{ plate: string }>("SELECT plate FROM vehicles WHERE upper(regexp_replace(plate, '\\s', '', 'g')) = $1", [normalisePlate(v.plate)]);
      if (dup.rows[0]) errors["newVehicle.plate"] = `Plate ${dup.rows[0].plate} is already on file. Pick it from the customer's vehicles.`;
      if (!Object.keys(errors).length && customerId) {
        vehicleId = `v-${randomUUID()}`;
        await c.query("INSERT INTO vehicles (id, customer_id, plate, make, model, year, vin, mileage) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)", [
          vehicleId,
          customerId,
          v.plate,
          v.make,
          v.model,
          v.year,
          v.vin,
          Math.max(v.mileage, input.mileageIn),
        ]);
      }
    } else {
      const v = vehicleId ? await getVehicle(c, vehicleId) : null;
      if (!v) errors.vehicleId = "Choose a vehicle.";
      else if (v.customerId !== customerId) errors.vehicleId = "That vehicle belongs to another customer.";
    }

    if (input.technicianId && !(await listTechnicians(c)).some((t) => t.id === input.technicianId)) errors.technicianId = "Unknown technician.";
    const partIds = new Set((await listParts(c)).map((p) => p.id));
    input.parts.forEach((p, i) => {
      if (p.partId && !partIds.has(p.partId)) errors[`parts.${i}.partId`] = "That stock item no longer exists.";
    });
    if (input.bookedFor > addDays(today(), 730)) errors.bookedFor = "Bookings can be at most two years ahead.";
    if (input.status === "Completed" && !input.labour.length && !input.parts.length) errors.status = "Add the work done before completing the job.";
    if (Object.keys(errors).length) throw badRequest("Please check the job card.", errors);
    return { customerId, vehicleId };
  }

  async function bumpMileage(c: Queryable, vehicleId: string, mileage: number) {
    await c.query("UPDATE vehicles SET mileage = GREATEST(mileage, $2), updated_at = now() WHERE id = $1", [vehicleId, mileage]);
  }

  async function complete(c: Queryable, job: Job, req: FastifyRequest) {
    const customer = await getCustomer(c, job.customerId);
    const vehicle = await getVehicle(c, job.vehicleId);
    const settings = await getSettings(c);
    const number = await issueInvoice(c, job, { customer: customer!, vehicle: vehicle!, settings, userId: uid(req) });
    await audit(c, { userId: uid(req), action: "invoice.issue", entity: "job", entityId: job.id, details: { number, totalCents: jobTotals(job, settings.taxPercent).total }, ip: req.ip });
  }

  const toJob = (input: JobInput, ids: { customerId: string; vehicleId: string }, base: Pick<Job, "id" | "number" | "createdAt" | "statusHistory">): Job => ({
    ...base,
    customerId: ids.customerId,
    vehicleId: ids.vehicleId,
    bookedFor: input.bookedFor,
    complaint: input.complaint,
    notes: input.notes,
    mileageIn: input.mileageIn,
    status: input.status,
    technicianId: input.technicianId ?? undefined,
    labour: input.labour.map((l, i) => ({ id: String(i), ...l })),
    parts: input.parts.map((p, i) => ({ id: String(i), ...p, partId: p.partId ?? undefined })),
    discountCents: input.discountCents,
  });

  app.post("/jobs", { preHandler: desk }, async (req, reply) => {
    const input = parse(jobSchema, req.body);
    const job = await tx(app.db, async (c) => {
      const ids = await resolveParties(c, input, req);
      const id = `j-${randomUUID()}`;
      const number = await nextNumber(c, "job");
      const job = toJob(input, ids, { id, number, createdAt: new Date().toISOString(), statusHistory: [] });
      await c.query(
        `INSERT INTO jobs (id, number, customer_id, vehicle_id, booked_for, complaint, notes, mileage_in, status, technician_id, discount_cents)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [id, number, ids.customerId, ids.vehicleId, input.bookedFor, input.complaint, input.notes, input.mileageIn, input.status, input.technicianId ?? null, input.discountCents],
      );
      await writeLines(c, id, job);
      await addStatusEvent(c, id, "Booked", uid(req));
      if (input.status !== "Booked") await addStatusEvent(c, id, input.status, uid(req));
      await moveStockForJob(c, id, undefined, job, uid(req));
      await bumpMileage(c, ids.vehicleId, input.mileageIn);
      await audit(c, { userId: uid(req), action: "job.create", entity: "job", entityId: id, details: { number }, ip: req.ip });
      if (input.status === "Completed") await complete(c, (await getJob(c, id))!, req);
      return (await getJob(c, id))!;
    });
    return reply.status(201).send(job);
  });

  app.put<{ Params: { id: string } }>("/jobs/:id", { preHandler: desk }, async (req) => {
    const { version } = parse(versionSchema, req.body);
    const input = parse(jobSchema, req.body);
    return tx(app.db, async (c) => {
      const lock = await c.query<{ version: number }>("SELECT version FROM jobs WHERE id = $1 FOR UPDATE", [req.params.id]);
      if (!lock.rows[0]) throw notFound("Job not found");
      if (lock.rows[0].version !== version) throw conflict("Someone else saved this job card since you opened it. Reload to see their changes.");
      const before = (await getJob(c, req.params.id))!;

      if (before.invoice) {
        // An issued invoice is a financial record. Only internal notes and the technician can change;
        // anything on the invoice needs the job reopened (which voids the invoice) first.
        const money = (j: Pick<Job, "labour" | "parts" | "discountCents" | "status" | "customerId" | "vehicleId">) =>
          JSON.stringify([j.labour.map((l) => [l.description, l.hours, l.rateCents]), j.parts.map((p) => [p.partId ?? null, p.description, p.qty, p.unitPriceCents]), j.discountCents, j.status, j.customerId, j.vehicleId]);
        const incoming = toJob(input, { customerId: input.customerId ?? "", vehicleId: input.vehicleId ?? "" }, before);
        if (input.newCustomer || input.newVehicle || money(incoming) !== money(before)) {
          throw conflict(`Invoice ${before.invoice.number} has been issued, so the work and prices are locked. ${before.invoice.paidAt ? "It's paid." : "Reopen the job to change them (this voids the invoice)."}`);
        }
        await c.query("UPDATE jobs SET notes = $2, technician_id = $3, version = version + 1, updated_at = now() WHERE id = $1", [before.id, input.notes, input.technicianId ?? null]);
        await audit(c, { userId: uid(req), action: "job.update", entity: "job", entityId: before.id, details: { notesOnly: true }, ip: req.ip });
        return (await getJob(c, before.id))!;
      }

      const ids = await resolveParties(c, input, req);
      const after = toJob(input, ids, before);
      await c.query(
        `UPDATE jobs SET customer_id = $2, vehicle_id = $3, booked_for = $4, complaint = $5, notes = $6, mileage_in = $7, status = $8,
                technician_id = $9, discount_cents = $10, version = version + 1, updated_at = now() WHERE id = $1`,
        [before.id, ids.customerId, ids.vehicleId, input.bookedFor, input.complaint, input.notes, input.mileageIn, input.status, input.technicianId ?? null, input.discountCents],
      );
      await writeLines(c, before.id, after);
      await moveStockForJob(c, before.id, before, after, uid(req));
      await bumpMileage(c, ids.vehicleId, input.mileageIn);
      if (before.status !== input.status) await addStatusEvent(c, before.id, input.status, uid(req));
      await audit(c, { userId: uid(req), action: "job.update", entity: "job", entityId: before.id, details: before.status !== input.status ? { status: { from: before.status, to: input.status } } : {}, ip: req.ip });
      if (input.status === "Completed") await complete(c, (await getJob(c, before.id))!, req);
      return (await getJob(c, before.id))!;
    });
  });

  /** One-click moves from the board (check in, parts arrived, ready, collected). */
  app.post<{ Params: { id: string } }>("/jobs/:id/status", async (req) => {
    const { status } = parse(statusSchema, req.body);
    const role = req.session!.user.role;
    return tx(app.db, async (c) => {
      const lock = await c.query("SELECT 1 FROM jobs WHERE id = $1 FOR UPDATE", [req.params.id]);
      if (!lock.rowCount) throw notFound("Job not found");
      const before = (await getJob(c, req.params.id))!;
      if (before.status === status) return before;
      if (role === "technician" && (!TECH_STATUSES.includes(status) || !BOARD_STATUSES.includes(before.status))) {
        throw new HttpError(403, "Technicians can move jobs between In progress, Waiting parts and Ready. The front desk completes and cancels jobs.", "forbidden");
      }
      if (before.invoice) throw conflict(`Invoice ${before.invoice.number} has been issued. Reopen the job to change its status.`);
      if (status === "Completed" && !before.labour.length && !before.parts.length) throw badRequest("Add the work done before completing the job.", { status: "No work recorded" });
      const after = { ...before, status };
      await c.query("UPDATE jobs SET status = $2, version = version + 1, updated_at = now() WHERE id = $1", [before.id, status]);
      await moveStockForJob(c, before.id, before, after, uid(req));
      await addStatusEvent(c, before.id, status, uid(req));
      await audit(c, { userId: uid(req), action: "job.status", entity: "job", entityId: before.id, details: { from: before.status, to: status }, ip: req.ip });
      if (status === "Completed") await complete(c, (await getJob(c, before.id))!, req);
      return (await getJob(c, before.id))!;
    });
  });

  app.post<{ Params: { id: string } }>("/jobs/:id/payment", { preHandler: desk }, async (req) => {
    const { method } = parse(paymentSchema, req.body);
    return tx(app.db, async (c) => {
      const r = await c.query<{ number: string; total_cents: number }>(
        "UPDATE invoices SET paid_at = now(), method = $2 WHERE job_id = $1 AND voided_at IS NULL AND paid_at IS NULL RETURNING number, total_cents",
        [req.params.id, method],
      );
      if (!r.rows[0]) {
        const job = await getJob(c, req.params.id);
        if (!job) throw notFound("Job not found");
        throw conflict(job.invoice ? "This invoice is already paid." : "Complete the job to issue its invoice first.");
      }
      await audit(c, { userId: uid(req), action: "invoice.paid", entity: "job", entityId: req.params.id, details: { number: r.rows[0].number, method, totalCents: r.rows[0].total_cents }, ip: req.ip });
      return (await getJob(c, req.params.id))!;
    });
  });

  /** Voids the unpaid invoice so the job can be corrected; a new invoice number is issued when it's completed again. */
  app.post<{ Params: { id: string } }>("/jobs/:id/reopen", { preHandler: desk }, async (req) => {
    const { reason } = parse(reopenSchema, req.body);
    return tx(app.db, async (c) => {
      const lock = await c.query("SELECT 1 FROM jobs WHERE id = $1 FOR UPDATE", [req.params.id]);
      if (!lock.rowCount) throw notFound("Job not found");
      const job = (await getJob(c, req.params.id))!;
      if (!job.invoice) throw conflict("This job has no invoice to void.");
      if (job.invoice.paidAt) throw conflict("A paid invoice can't be voided here. Record a refund with your accounting system instead.");
      await c.query("UPDATE invoices SET voided_at = now(), void_reason = $2 WHERE job_id = $1 AND voided_at IS NULL", [job.id, reason]);
      await c.query("UPDATE jobs SET status = 'In progress', version = version + 1, updated_at = now() WHERE id = $1", [job.id]);
      await addStatusEvent(c, job.id, "In progress", uid(req));
      await audit(c, { userId: uid(req), action: "invoice.void", entity: "job", entityId: job.id, details: { number: job.invoice.number, reason }, ip: req.ip });
      return (await getJob(c, job.id))!;
    });
  });

  app.get<{ Params: { id: string }; Querystring: { number?: string } }>("/jobs/:id/invoice", async (req) => {
    const doc = await getInvoiceDoc(app.db, req.params.id, req.query.number?.slice(0, 40));
    if (!doc) throw notFound("Invoice not found");
    return doc;
  });
}
