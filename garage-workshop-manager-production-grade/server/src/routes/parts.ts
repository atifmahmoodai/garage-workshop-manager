import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { tx } from "../db";
import { notFound, parse, requireUser } from "../http";
import { audit, getPart, listParts } from "../repo/core";
import { newPartSchema, partSchema, stockMoveSchema } from "../../../shared/schemas";

export async function partRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser());
  const desk = requireUser("admin", "advisor");

  app.get("/parts", async () => ({ items: await listParts(app.db) }));

  app.post("/parts", { preHandler: desk }, async (req, reply) => {
    const p = parse(newPartSchema, req.body);
    const id = `p-${randomUUID()}`;
    await tx(app.db, async (c) => {
      await c.query("INSERT INTO parts (id, sku, name, category, stock, reorder_level, cost_cents, price_cents) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)", [
        id,
        p.sku,
        p.name,
        p.category || "Other",
        p.stock,
        p.reorderLevel,
        p.costCents,
        p.priceCents,
      ]);
      if (p.stock) await c.query("INSERT INTO stock_movements (part_id, delta, reason, user_id, note) VALUES ($1, $2, 'opening', $3, 'Opening stock')", [id, p.stock, req.session!.user.id]);
      await audit(c, { userId: req.session!.user.id, action: "part.create", entity: "part", entityId: id, details: { sku: p.sku }, ip: req.ip });
    });
    return reply.status(201).send(await getPart(app.db, id));
  });

  /** Edits details and prices. Stock changes go through /stock so every movement is recorded. */
  app.put<{ Params: { id: string } }>("/parts/:id", { preHandler: desk }, async (req) => {
    const p = parse(partSchema, req.body);
    const r = await app.db.query(
      "UPDATE parts SET sku = $2, name = $3, category = $4, reorder_level = $5, cost_cents = $6, price_cents = $7, updated_at = now() WHERE id = $1",
      [req.params.id, p.sku, p.name, p.category || "Other", p.reorderLevel, p.costCents, p.priceCents],
    );
    if (!r.rowCount) throw notFound("Part not found");
    await audit(app.db, { userId: req.session!.user.id, action: "part.update", entity: "part", entityId: req.params.id, details: p, ip: req.ip });
    return getPart(app.db, req.params.id);
  });

  /** Goods received (positive) or a stocktake correction (either sign). */
  app.post<{ Params: { id: string } }>("/parts/:id/stock", { preHandler: desk }, async (req) => {
    const m = parse(stockMoveSchema, req.body);
    return tx(app.db, async (c) => {
      const r = await c.query("UPDATE parts SET stock = stock + $2, updated_at = now() WHERE id = $1", [req.params.id, m.delta]);
      if (!r.rowCount) throw notFound("Part not found");
      await c.query("INSERT INTO stock_movements (part_id, delta, reason, note, user_id) VALUES ($1, $2, $3, $4, $5)", [req.params.id, m.delta, m.reason, m.note, req.session!.user.id]);
      await audit(c, { userId: req.session!.user.id, action: `stock.${m.reason}`, entity: "part", entityId: req.params.id, details: { delta: m.delta, note: m.note }, ip: req.ip });
      return getPart(c, req.params.id);
    });
  });

  app.get<{ Params: { id: string } }>("/parts/:id/movements", async (req) => {
    const { rows } = await app.db.query(
      `SELECT m.id, m.at, m.delta, m.reason, m.note, j.id AS "jobId", j.number AS "jobNumber", u.name AS "userName"
         FROM stock_movements m LEFT JOIN jobs j ON j.id = m.job_id LEFT JOIN users u ON u.id = m.user_id
        WHERE m.part_id = $1 ORDER BY m.at DESC, m.id DESC LIMIT 200`,
      [req.params.id],
    );
    return { items: rows };
  });
}
