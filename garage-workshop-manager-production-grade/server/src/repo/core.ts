import type { Queryable } from "../db";
import { settingsSchema } from "../../../shared/schemas";
import { DEFAULT_SETTINGS } from "../../../shared/settings-defaults";
import type { Customer, Part, Settings, Technician, Vehicle } from "../../../shared/types";

export async function getSettings(db: Queryable): Promise<Settings> {
  const { rows } = await db.query<{ value: unknown }>("SELECT value FROM settings WHERE key = 'workshop'");
  const parsed = settingsSchema.safeParse(rows[0]?.value);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export async function saveSettings(db: Queryable, s: Settings) {
  await db.query(
    "INSERT INTO settings (key, value) VALUES ('workshop', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
    [JSON.stringify(s)],
  );
}

export async function audit(
  db: Queryable,
  e: { userId: string | null; action: string; entity: string; entityId?: string | null; details?: Record<string, unknown>; ip?: string },
) {
  await db.query("INSERT INTO audit_log (user_id, action, entity, entity_id, details, ip) VALUES ($1, $2, $3, $4, $5, $6)", [
    e.userId,
    e.action,
    e.entity,
    e.entityId ?? null,
    JSON.stringify(e.details ?? {}),
    e.ip ?? null,
  ]);
}

export async function getCustomer(db: Queryable, id: string): Promise<Customer | null> {
  const { rows } = await db.query<Customer>("SELECT id, name, phone, email FROM customers WHERE id = $1", [id]);
  return rows[0] ?? null;
}

interface VehicleRow {
  id: string;
  customer_id: string;
  plate: string;
  make: string;
  model: string;
  year: number;
  vin: string;
  mileage: number;
}
const toVehicle = (r: VehicleRow): Vehicle => ({ id: r.id, customerId: r.customer_id, plate: r.plate, make: r.make, model: r.model, year: r.year, vin: r.vin, mileage: r.mileage });

export async function getVehicle(db: Queryable, id: string): Promise<Vehicle | null> {
  const { rows } = await db.query<VehicleRow>("SELECT * FROM vehicles WHERE id = $1", [id]);
  return rows[0] ? toVehicle(rows[0]) : null;
}

export async function customerVehicles(db: Queryable, customerId: string): Promise<Vehicle[]> {
  return (await db.query<VehicleRow>("SELECT * FROM vehicles WHERE customer_id = $1 ORDER BY created_at, id", [customerId])).rows.map(toVehicle);
}

export async function allVehicles(db: Queryable): Promise<Vehicle[]> {
  return (await db.query<VehicleRow>("SELECT * FROM vehicles ORDER BY id")).rows.map(toVehicle);
}

export interface CustomerRow extends Customer {
  vehicles: { id: string; plate: string; make: string; model: string }[];
  lastVisit: string | null;
}

/** Search by name, phone, email, plate (spaces ignored) or car. */
export async function searchCustomers(db: Queryable, q: string, limit: number, offset: number): Promise<{ items: CustomerRow[]; total: number }> {
  const where: string[] = [];
  const args: unknown[] = [];
  for (const t of q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8)) {
    args.push(t);
    const p = `$${args.length}`;
    where.push(`(strpos(lower(c.name || ' ' || c.phone || ' ' || c.email), ${p}) > 0
                 OR strpos(regexp_replace(c.phone, '\\D', '', 'g'), regexp_replace(${p}, '\\D', '', 'g')) > 0 AND ${p} ~ '\\d{3,}'
                 OR EXISTS (SELECT 1 FROM vehicles v WHERE v.customer_id = c.id
                            AND (strpos(lower(v.make || ' ' || v.model), ${p}) > 0 OR strpos(upper(regexp_replace(v.plate, '\\s', '', 'g')), upper(${p})) > 0)))`);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM customers c ${w}`, args)).rows[0].n;
  const { rows } = await db.query<CustomerRow & { last_visit: string | null }>(
    `SELECT c.id, c.name, c.phone, c.email,
            COALESCE((SELECT json_agg(json_build_object('id', v.id, 'plate', v.plate, 'make', v.make, 'model', v.model) ORDER BY v.created_at)
                        FROM vehicles v WHERE v.customer_id = c.id), '[]') AS vehicles,
            (SELECT to_char(max((i.issued_at AT TIME ZONE 'UTC')::date), 'YYYY-MM-DD') FROM invoices i JOIN jobs j ON j.id = i.job_id
              WHERE j.customer_id = c.id AND i.voided_at IS NULL) AS last_visit
       FROM customers c ${w}
      ORDER BY lower(c.name), c.id LIMIT ${Number(limit)} OFFSET ${Number(offset)}`,
    args,
  );
  return { total, items: rows.map(({ last_visit, ...r }) => ({ ...r, lastVisit: last_visit })) };
}

export async function listTechnicians(db: Queryable): Promise<Technician[]> {
  return (await db.query<Technician>("SELECT id, name, active FROM technicians ORDER BY active DESC, name")).rows;
}

interface PartRow {
  id: string;
  sku: string;
  name: string;
  category: string;
  stock: number;
  reorder_level: number;
  cost_cents: number;
  price_cents: number;
}
const toPart = (r: PartRow): Part => ({ id: r.id, sku: r.sku, name: r.name, category: r.category, stock: r.stock, reorderLevel: r.reorder_level, costCents: r.cost_cents, priceCents: r.price_cents });

export async function listParts(db: Queryable): Promise<Part[]> {
  return (await db.query<PartRow>("SELECT * FROM parts ORDER BY category, name")).rows.map(toPart);
}

export async function getPart(db: Queryable, id: string): Promise<Part | null> {
  const { rows } = await db.query<PartRow>("SELECT * FROM parts WHERE id = $1", [id]);
  return rows[0] ? toPart(rows[0]) : null;
}
