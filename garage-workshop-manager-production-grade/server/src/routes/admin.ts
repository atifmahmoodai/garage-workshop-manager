import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { todayIn } from "../config";
import { tx } from "../db";
import { conflict, HttpError, notFound, parse, requireUser } from "../http";
import { audit, getSettings, listTechnicians, saveSettings } from "../repo/core";
import { hashPassword } from "../security/password";
import { deleteUserSessions } from "../security/sessions";
import { resetPasswordSchema, settingsSchema, technicianSchema, userCreateSchema, userUpdateSchema, type Role } from "../../../shared/schemas";

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  locked: boolean;
  created_at: Date;
}
const toUser = (r: UserRow) => ({ id: r.id, email: r.email, name: r.name, role: r.role, active: r.active, locked: r.locked, createdAt: r.created_at.toISOString() });
const USER_SELECT = "SELECT id, email, name, role, active, (locked_until IS NOT NULL AND locked_until > now()) AS locked, created_at FROM users";

export async function adminRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser());
  const admin = requireUser("admin");

  /** What every screen needs: who's signed in, workshop settings, technicians and badge counts. */
  app.get("/meta", async (req) => {
    const [settings, technicians, counts] = await Promise.all([
      getSettings(app.db),
      listTechnicians(app.db),
      app.db.query<{ in_shop: number; unpaid: number; low: number }>(
        `SELECT (SELECT count(*)::int FROM jobs WHERE status IN ('In progress', 'Waiting parts', 'Ready')) AS in_shop,
                (SELECT count(*)::int FROM invoices WHERE paid_at IS NULL AND voided_at IS NULL) AS unpaid,
                (SELECT count(*)::int FROM parts WHERE stock <= reorder_level) AS low`,
      ),
    ]);
    const c = counts.rows[0];
    return { user: req.session!.user, settings, technicians, counts: { inShop: c.in_shop, unpaid: c.unpaid, lowStock: c.low }, today: todayIn(app.config.TIMEZONE) };
  });

  app.put("/settings", { preHandler: admin }, async (req) => {
    const s = parse(settingsSchema, req.body);
    await saveSettings(app.db, s);
    await audit(app.db, { userId: req.session!.user.id, action: "settings.update", entity: "settings", entityId: "workshop", details: s, ip: req.ip });
    return s;
  });

  app.post("/technicians", { preHandler: admin }, async (req, reply) => {
    const t = parse(technicianSchema, req.body);
    const id = `t-${randomUUID().slice(0, 8)}`;
    await app.db.query("INSERT INTO technicians (id, name, active) VALUES ($1, $2, $3)", [id, t.name, t.active]);
    await audit(app.db, { userId: req.session!.user.id, action: "technician.create", entity: "technician", entityId: id, ip: req.ip });
    return reply.status(201).send({ id, ...t });
  });

  app.put<{ Params: { id: string } }>("/technicians/:id", { preHandler: admin }, async (req) => {
    const t = parse(technicianSchema, req.body);
    const r = await app.db.query("UPDATE technicians SET name = $2, active = $3 WHERE id = $1", [req.params.id, t.name, t.active]);
    if (!r.rowCount) throw notFound("Technician not found");
    await audit(app.db, { userId: req.session!.user.id, action: "technician.update", entity: "technician", entityId: req.params.id, details: t, ip: req.ip });
    return { id: req.params.id, ...t };
  });

  app.get("/users", { preHandler: admin }, async () => ({ items: (await app.db.query<UserRow>(`${USER_SELECT} ORDER BY active DESC, name`)).rows.map(toUser) }));

  app.post("/users", { preHandler: admin }, async (req, reply) => {
    const u = parse(userCreateSchema, req.body);
    const id = `u-${randomUUID()}`;
    try {
      await app.db.query("INSERT INTO users (id, email, name, role, password_hash) VALUES ($1, $2, $3, $4, $5)", [id, u.email, u.name, u.role, await hashPassword(u.password)]);
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw conflict("A user with that email already exists.");
      throw e;
    }
    await audit(app.db, { userId: req.session!.user.id, action: "user.create", entity: "user", entityId: id, details: { email: u.email, role: u.role }, ip: req.ip });
    return reply.status(201).send(toUser((await app.db.query<UserRow>(`${USER_SELECT} WHERE id = $1`, [id])).rows[0]));
  });

  app.put<{ Params: { id: string } }>("/users/:id", { preHandler: admin }, async (req) => {
    const u = parse(userUpdateSchema, req.body);
    const me = req.session!.user;
    if (req.params.id === me.id && (u.role !== "admin" || !u.active)) throw new HttpError(400, "You can't remove your own admin access.", "validation");
    return tx(app.db, async (c) => {
      const r = await c.query("UPDATE users SET name = $2, role = $3, active = $4, updated_at = now() WHERE id = $1", [req.params.id, u.name, u.role, u.active]);
      if (!r.rowCount) throw notFound("User not found");
      const admins = await c.query<{ n: number }>("SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND active");
      if (admins.rows[0].n === 0) throw new HttpError(400, "There must be at least one active admin.", "validation");
      if (!u.active) await deleteUserSessions(c, req.params.id);
      await audit(c, { userId: me.id, action: "user.update", entity: "user", entityId: req.params.id, details: u, ip: req.ip });
      return toUser((await c.query<UserRow>(`${USER_SELECT} WHERE id = $1`, [req.params.id])).rows[0]);
    });
  });

  app.post<{ Params: { id: string } }>("/users/:id/password", { preHandler: admin }, async (req) => {
    const { password } = parse(resetPasswordSchema, req.body);
    const r = await app.db.query("UPDATE users SET password_hash = $2, failed_logins = 0, locked_until = NULL, updated_at = now() WHERE id = $1", [req.params.id, await hashPassword(password)]);
    if (!r.rowCount) throw notFound("User not found");
    await deleteUserSessions(app.db, req.params.id);
    await audit(app.db, { userId: req.session!.user.id, action: "user.password_reset", entity: "user", entityId: req.params.id, ip: req.ip });
    return { ok: true };
  });

  app.get("/audit", { preHandler: admin }, async (req) => {
    const { limit, entityId } = parse(z.object({ limit: z.coerce.number().int().min(1).max(500).default(200), entityId: z.string().max(100).optional() }), req.query);
    const { rows } = await app.db.query(
      `SELECT a.id, a.at, a.action, a.entity, a.entity_id AS "entityId", a.details, a.ip, u.name AS "userName"
         FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
        WHERE ($2::text IS NULL OR a.entity_id = $2) ORDER BY a.at DESC, a.id DESC LIMIT $1`,
      [limit, entityId ?? null],
    );
    return { items: rows };
  });
}
