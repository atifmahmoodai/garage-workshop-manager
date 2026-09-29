import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { todayIn } from "../config";
import { tx } from "../db";
import { badRequest, conflict, notFound, parse, requireUser } from "../http";
import { allVehicles, audit, customerVehicles, getCustomer, getSettings, getVehicle, searchCustomers } from "../repo/core";
import { listJobRows, loadJobs } from "../repo/jobs";
import { servicesDue } from "../../../shared/analytics";
import { customerSchema, normalisePlate, vehicleSchema } from "../../../shared/schemas";

const listSchema = z.object({
  q: z.string().max(200).default(""),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export async function customerRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser());
  const desk = requireUser("admin", "advisor");

  app.get("/customers", async (req) => {
    const f = parse(listSchema, req.query);
    return searchCustomers(app.db, f.q, f.limit, f.offset);
  });

  /** Vehicles due (or overdue) for their periodic service and not already booked in. */
  app.get("/customers/due", async () => {
    const settings = await getSettings(app.db);
    // Only completed and still-open jobs matter for this, and only their dates and vehicles.
    const ids = (await app.db.query<{ id: string }>("SELECT id FROM jobs WHERE status IN ('Completed', 'Booked', 'In progress')")).rows.map((r) => r.id);
    const [jobs, vehicles, customers] = await Promise.all([
      loadJobs(app.db, ids),
      allVehicles(app.db),
      app.db.query<{ id: string; name: string; phone: string; email: string }>("SELECT id, name, phone, email FROM customers"),
    ]);
    const due = servicesDue({ settings, jobs, vehicles, customers: customers.rows, technicians: [], parts: [] }, todayIn(app.config.TIMEZONE));
    return { items: due, intervalMonths: settings.serviceIntervalMonths };
  });

  app.get<{ Params: { id: string } }>("/customers/:id", async (req) => {
    const customer = await getCustomer(app.db, req.params.id);
    if (!customer) throw notFound("Customer not found");
    const settings = await getSettings(app.db);
    const [vehicles, jobs, spent] = await Promise.all([
      customerVehicles(app.db, customer.id),
      listJobRows(app.db, { filter: "", q: "", customerId: customer.id, limit: 200, offset: 0 }, settings.taxPercent),
      app.db.query<{ total: number }>(
        "SELECT COALESCE(sum(i.total_cents), 0) AS total FROM invoices i JOIN jobs j ON j.id = i.job_id WHERE j.customer_id = $1 AND i.voided_at IS NULL",
        [customer.id],
      ),
    ]);
    return { customer, vehicles, jobs: jobs.items, visits: jobs.total, spentCents: spent.rows[0].total };
  });

  app.post("/customers", { preHandler: desk }, async (req, reply) => {
    const c = parse(customerSchema, req.body);
    const id = `c-${randomUUID()}`;
    await app.db.query("INSERT INTO customers (id, name, phone, email) VALUES ($1, $2, $3, $4)", [id, c.name, c.phone, c.email]);
    await audit(app.db, { userId: req.session!.user.id, action: "customer.create", entity: "customer", entityId: id, ip: req.ip });
    return reply.status(201).send({ id, ...c });
  });

  app.put<{ Params: { id: string } }>("/customers/:id", { preHandler: desk }, async (req) => {
    const c = parse(customerSchema, req.body);
    const r = await app.db.query("UPDATE customers SET name = $2, phone = $3, email = $4, updated_at = now() WHERE id = $1", [req.params.id, c.name, c.phone, c.email]);
    if (!r.rowCount) throw notFound("Customer not found");
    await audit(app.db, { userId: req.session!.user.id, action: "customer.update", entity: "customer", entityId: req.params.id, ip: req.ip });
    return { id: req.params.id, ...c };
  });

  const checkVehicle = async (plate: string, year: number, exceptId?: string) => {
    const errors: Record<string, string> = {};
    if (year > Number(todayIn(app.config.TIMEZONE).slice(0, 4)) + 1) errors.year = "Check the year.";
    const dup = await app.db.query<{ plate: string }>("SELECT plate FROM vehicles WHERE upper(regexp_replace(plate, '\\s', '', 'g')) = $1 AND id <> $2", [
      normalisePlate(plate),
      exceptId ?? "",
    ]);
    if (dup.rows[0]) errors.plate = `Plate ${dup.rows[0].plate} is already on file.`;
    if (Object.keys(errors).length) throw badRequest("Please check the vehicle.", errors);
  };

  app.post<{ Params: { id: string } }>("/customers/:id/vehicles", { preHandler: desk }, async (req, reply) => {
    const v = parse(vehicleSchema, req.body);
    if (!(await getCustomer(app.db, req.params.id))) throw notFound("Customer not found");
    await checkVehicle(v.plate, v.year);
    const id = `v-${randomUUID()}`;
    await app.db.query("INSERT INTO vehicles (id, customer_id, plate, make, model, year, vin, mileage) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)", [
      id,
      req.params.id,
      v.plate,
      v.make,
      v.model,
      v.year,
      v.vin,
      v.mileage,
    ]);
    await audit(app.db, { userId: req.session!.user.id, action: "vehicle.create", entity: "vehicle", entityId: id, details: { plate: v.plate }, ip: req.ip });
    return reply.status(201).send(await getVehicle(app.db, id));
  });

  app.put<{ Params: { id: string } }>("/vehicles/:id", { preHandler: desk }, async (req) => {
    const v = parse(vehicleSchema, req.body);
    return tx(app.db, async (c) => {
      const before = await getVehicle(c, req.params.id);
      if (!before) throw notFound("Vehicle not found");
      // Odometers only go forward; a lower reading is almost always a typo.
      if (v.mileage < before.mileage) throw badRequest("Mileage can't go down.", { mileage: `Last recorded: ${before.mileage}` });
      await checkVehicle(v.plate, v.year, before.id);
      await c.query("UPDATE vehicles SET plate = $2, make = $3, model = $4, year = $5, vin = $6, mileage = $7, updated_at = now() WHERE id = $1", [
        before.id,
        v.plate,
        v.make,
        v.model,
        v.year,
        v.vin,
        v.mileage,
      ]);
      await audit(c, { userId: req.session!.user.id, action: "vehicle.update", entity: "vehicle", entityId: before.id, ip: req.ip });
      return getVehicle(c, before.id);
    });
  });

  app.delete<{ Params: { id: string } }>("/customers/:id", { preHandler: requireUser("admin") }, async (req) => {
    return tx(app.db, async (c) => {
      const jobs = await c.query("SELECT 1 FROM jobs WHERE customer_id = $1 LIMIT 1", [req.params.id]);
      if (jobs.rowCount) throw conflict("This customer has job history, which is kept for your records. Edit their details instead.");
      await c.query("DELETE FROM vehicles WHERE customer_id = $1", [req.params.id]);
      const r = await c.query("DELETE FROM customers WHERE id = $1", [req.params.id]);
      if (!r.rowCount) throw notFound("Customer not found");
      await audit(c, { userId: req.session!.user.id, action: "customer.delete", entity: "customer", entityId: req.params.id, ip: req.ip });
      return { ok: true };
    });
  });
}
