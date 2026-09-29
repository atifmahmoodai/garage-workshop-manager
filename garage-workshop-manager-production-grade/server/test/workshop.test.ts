import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { todayIn } from "../src/config";
import { getSettings, listTechnicians } from "../src/repo/core";
import { loadJobs } from "../src/repo/jobs";
import { DEMO_ADMIN, DEMO_ADVISOR, DEMO_TECH } from "../src/seed";
import { workshopStats } from "../../shared/analytics";
import { addDays } from "../../shared/dates";
import { jobTotals } from "../../shared/money";
import { login, makeApp, type Agent, type TestCtx } from "./helpers";

let ctx: TestCtx;
let admin: Agent;
let desk: Agent;
let tech: Agent;
const TODAY = todayIn("UTC");

beforeAll(async () => {
  ctx = await makeApp();
  admin = await login(ctx.app, DEMO_ADMIN);
  desk = await login(ctx.app, DEMO_ADVISOR);
  tech = await login(ctx.app, DEMO_TECH);
});
afterAll(() => ctx.close());

let plateSeq = 0;
const newPlate = () => `TST ${String(++plateSeq).padStart(3, "0")}${Date.now() % 1000}`;
const job = (extra: Record<string, unknown> = {}) => ({
  newCustomer: { name: "Test Customer", phone: "555 123 4567", email: "" },
  newVehicle: { plate: newPlate(), make: "Toyota", model: "Corolla", year: 2019, vin: "", mileage: 40000 },
  bookedFor: TODAY,
  complaint: "Service",
  notes: "",
  mileageIn: 41000,
  status: "In progress",
  technicianId: null,
  labour: [{ description: "Oil service", hours: 1, rateCents: 9500 }],
  parts: [],
  discountCents: 0,
  ...extra,
});
const stockOf = async (id: string) => (await ctx.app.db.query<{ stock: number }>("SELECT stock FROM parts WHERE id = $1", [id])).rows[0].stock;
const firstPart = async () => (await ctx.app.db.query<{ id: string; cost_cents: number; price_cents: number }>("SELECT id, cost_cents, price_cents FROM parts ORDER BY id LIMIT 1")).rows[0];

describe("access control", () => {
  it("requires a session, the CSRF token, and the right role", async () => {
    expect((await ctx.app.inject("/api/board")).statusCode).toBe(401);
    const noCsrf = await ctx.app.inject({ method: "POST", url: "/api/jobs", headers: { cookie: `sid=${desk.cookie}` }, payload: job() });
    expect(noCsrf.statusCode).toBe(403);
    expect((await tech.send("POST", "/api/jobs", job())).statusCode).toBe(403);
    expect((await tech.get("/api/reports?from=2026-01-01&to=2026-01-31")).statusCode).toBe(403);
    expect((await desk.get("/api/users")).statusCode).toBe(403);
  });
});

describe("job cards", () => {
  it("creates customer, vehicle and job in one step, and rolls back if any part is invalid", async () => {
    const r = await desk.send("POST", "/api/jobs", job());
    expect(r.statusCode).toBe(201);
    expect(r.json().number).toMatch(/^J-\d+$/);
    const plate = r.json().vehicleId;
    expect(plate).toBeTruthy();

    const before = (await ctx.app.db.query<{ n: number }>("SELECT count(*)::int AS n FROM customers")).rows[0].n;
    const takenPlate = (await ctx.app.db.query<{ plate: string }>("SELECT plate FROM vehicles LIMIT 1")).rows[0].plate;
    const dup = await desk.send("POST", "/api/jobs", job({ newVehicle: { plate: takenPlate.toLowerCase().replace(/\s/g, ""), make: "X", model: "Y", year: 2020, vin: "", mileage: 0 } }));
    expect(dup.statusCode).toBe(400);
    expect(dup.json().details["newVehicle.plate"]).toMatch(/already on file/);
    expect((await ctx.app.db.query<{ n: number }>("SELECT count(*)::int AS n FROM customers")).rows[0].n).toBe(before);
  });

  it("refuses a vehicle that belongs to another customer", async () => {
    const [a, b] = (await ctx.app.db.query<{ id: string; customer_id: string }>("SELECT id, customer_id FROM vehicles ORDER BY id LIMIT 2")).rows;
    const r = await desk.send("POST", "/api/jobs", job({ newCustomer: undefined, newVehicle: undefined, customerId: a.customer_id === b.customer_id ? "x" : a.customer_id, vehicleId: b.id }));
    expect(r.statusCode).toBe(400);
  });

  it("detects conflicting edits", async () => {
    const created = (await desk.send("POST", "/api/jobs", job())).json();
    const body = { ...job({ newCustomer: undefined, newVehicle: undefined, customerId: created.customerId, vehicleId: created.vehicleId }), version: created.version };
    expect((await desk.send("PUT", `/api/jobs/${created.id}`, { ...body, notes: "first" })).statusCode).toBe(200);
    expect((await admin.send("PUT", `/api/jobs/${created.id}`, { ...body, notes: "stale" })).statusCode).toBe(409);
  });
});

describe("stock follows job cards and every movement is recorded", () => {
  it("takes, adjusts and returns stock", async () => {
    const p = await firstPart();
    const start = await stockOf(p.id);
    const line = (qty: number) => ({ partId: p.id, description: "Part", qty, unitPriceCents: p.price_cents, unitCostCents: 1 });
    const created = (await desk.send("POST", "/api/jobs", job({ parts: [line(3)] }))).json();
    expect(await stockOf(p.id)).toBe(start - 3);
    // Cost of a stock item comes from the parts list, not from the browser.
    expect(created.parts[0].unitCostCents).toBe(p.cost_cents);
    const base = { ...job({ newCustomer: undefined, newVehicle: undefined, customerId: created.customerId, vehicleId: created.vehicleId }) };
    const upd = (await desk.send("PUT", `/api/jobs/${created.id}`, { ...base, parts: [line(1)], version: created.version })).json();
    expect(await stockOf(p.id)).toBe(start - 1);
    await desk.send("PUT", `/api/jobs/${created.id}`, { ...base, parts: [line(1)], status: "Cancelled", version: upd.version });
    expect(await stockOf(p.id)).toBe(start);
    const moves = (await desk.get(`/api/parts/${p.id}/movements`)).json().items.filter((m: { jobId: string }) => m.jobId === created.id);
    expect(moves.map((m: { delta: number }) => m.delta).sort()).toEqual([-3, 2, 1].sort());
  });

  it("records goods received and stocktake corrections", async () => {
    const p = await firstPart();
    const start = await stockOf(p.id);
    expect((await desk.send("POST", `/api/parts/${p.id}/stock`, { delta: 10, reason: "receive", note: "PO 123" })).json().stock).toBe(start + 10);
    expect((await desk.send("POST", `/api/parts/${p.id}/stock`, { delta: -2, reason: "adjust", note: "count" })).json().stock).toBe(start + 8);
    expect((await desk.send("POST", `/api/parts/${p.id}/stock`, { delta: 0, reason: "adjust" })).statusCode).toBe(400);
    const sum = (await ctx.app.db.query<{ s: number }>("SELECT COALESCE(sum(delta), 0)::int AS s FROM stock_movements WHERE part_id = $1", [p.id])).rows[0].s;
    // The stock figure is fully explained by its movements.
    expect(sum).toBe(await stockOf(p.id));
  });

  it("rejects duplicate SKUs regardless of case", async () => {
    const sku = (await ctx.app.db.query<{ sku: string }>("SELECT sku FROM parts LIMIT 1")).rows[0].sku;
    const r = await desk.send("POST", "/api/parts", { sku: sku.toLowerCase(), name: "Dup", category: "X", stock: 0, reorderLevel: 1, costCents: 1, priceCents: 2 });
    expect(r.statusCode).toBe(409);
  });
});

describe("invoices", () => {
  it("issues a frozen invoice on completion and locks the work", async () => {
    const created = (await desk.send("POST", "/api/jobs", job({ discountCents: 500, labour: [{ description: "Brakes", hours: 1.5, rateCents: 9500 }] }))).json();
    const done = (await desk.send("POST", `/api/jobs/${created.id}/status`, { status: "Completed" })).json();
    expect(done.invoice.number).toMatch(/^INV-\d+$/);
    const settings = await getSettings(ctx.app.db);
    expect(done.invoice.totalCents).toBe(jobTotals(done, settings.taxPercent).total);

    const base = job({ newCustomer: undefined, newVehicle: undefined, customerId: done.customerId, vehicleId: done.vehicleId, status: "Completed", discountCents: 500, labour: [{ description: "Brakes", hours: 1.5, rateCents: 9500 }] });
    const priceChange = await desk.send("PUT", `/api/jobs/${done.id}`, { ...base, discountCents: 0, version: done.version });
    expect(priceChange.statusCode).toBe(409);
    const notes = await desk.send("PUT", `/api/jobs/${done.id}`, { ...base, notes: "Customer happy", version: done.version });
    expect(notes.statusCode).toBe(200);
    expect(notes.json().notes).toBe("Customer happy");
    expect((await desk.send("POST", `/api/jobs/${done.id}/status`, { status: "Cancelled" })).statusCode).toBe(409);

    // Changing the workshop's tax rate or name later doesn't rewrite the issued invoice.
    const docBefore = (await desk.get(`/api/jobs/${done.id}/invoice`)).json();
    await admin.send("PUT", "/api/settings", { ...settings, taxPercent: settings.taxPercent + 5, name: "Renamed Garage" });
    const docAfter = (await desk.get(`/api/jobs/${done.id}/invoice`)).json();
    expect(docAfter).toEqual(docBefore);
    expect(docAfter.workshop.name).toBe(settings.name);
    await admin.send("PUT", "/api/settings", settings);
  });

  it("voids and reissues with a new number; paid invoices can't be voided", async () => {
    const created = (await desk.send("POST", "/api/jobs", job())).json();
    const first = (await desk.send("POST", `/api/jobs/${created.id}/status`, { status: "Completed" })).json().invoice.number;
    expect((await desk.send("POST", `/api/jobs/${created.id}/reopen`, { reason: "" })).statusCode).toBe(400);
    const reopened = (await desk.send("POST", `/api/jobs/${created.id}/reopen`, { reason: "Wrong labour hours" })).json();
    expect(reopened.status).toBe("In progress");
    expect(reopened.invoice).toBeUndefined();
    const second = (await desk.send("POST", `/api/jobs/${created.id}/status`, { status: "Completed" })).json().invoice.number;
    expect(second).not.toBe(first);
    const voided = (await desk.get(`/api/jobs/${created.id}/invoice?number=${first}`)).json();
    expect(voided.voidReason).toBe("Wrong labour hours");
    expect((await desk.get(`/api/jobs/${created.id}`)).json().invoiceVoids).toHaveLength(1);

    expect((await desk.send("POST", `/api/jobs/${created.id}/payment`, { method: "Card" })).json().invoice.paidAt).toBeTruthy();
    expect((await desk.send("POST", `/api/jobs/${created.id}/payment`, { method: "Card" })).statusCode).toBe(409);
    expect((await desk.send("POST", `/api/jobs/${created.id}/reopen`, { reason: "Try to void a paid one" })).statusCode).toBe(409);
  });

  it("numbers invoices without gaps even when completed at the same moment", async () => {
    const jobs = await Promise.all([1, 2, 3, 4].map(() => desk.send("POST", "/api/jobs", job()).then((r) => r.json())));
    const done = await Promise.all(jobs.map((j) => desk.send("POST", `/api/jobs/${j.id}/status`, { status: "Completed" }).then((r) => r.json())));
    const nums = done.map((j) => Number(j.invoice.number.replace(/\D/g, ""))).sort((a, b) => a - b);
    expect(new Set(nums).size).toBe(4);
    expect(nums[3] - nums[0]).toBe(3);
  });

  it("won't complete a job with no work recorded", async () => {
    const created = (await desk.send("POST", "/api/jobs", job({ labour: [] }))).json();
    expect((await desk.send("POST", `/api/jobs/${created.id}/status`, { status: "Completed" })).statusCode).toBe(400);
  });
});

describe("technicians", () => {
  it("move jobs through the workshop but can't complete or cancel", async () => {
    const created = (await desk.send("POST", "/api/jobs", job({ status: "Booked" }))).json();
    expect((await tech.send("POST", `/api/jobs/${created.id}/status`, { status: "In progress" })).json().status).toBe("In progress");
    expect((await tech.send("POST", `/api/jobs/${created.id}/status`, { status: "Ready" })).json().status).toBe("Ready");
    expect((await tech.send("POST", `/api/jobs/${created.id}/status`, { status: "Completed" })).statusCode).toBe(403);
    expect((await tech.send("POST", `/api/jobs/${created.id}/status`, { status: "Cancelled" })).statusCode).toBe(403);
  });
});

describe("lists and search", () => {
  it("finds customers by plate without spaces, and jobs by customer", async () => {
    const v = (await ctx.app.db.query<{ plate: string; customer_id: string }>("SELECT plate, customer_id FROM vehicles WHERE plate LIKE '% %' LIMIT 1")).rows[0];
    const hits = (await desk.get(`/api/customers?q=${encodeURIComponent(v.plate.replace(/\s/g, "").toLowerCase())}`)).json().items;
    expect(hits.map((c: { id: string }) => c.id)).toContain(v.customer_id);
    const detail = (await desk.get(`/api/customers/${v.customer_id}`)).json();
    expect(detail.vehicles.length).toBeGreaterThan(0);
    const unpaid = (await desk.get("/api/jobs?filter=unpaid")).json();
    expect(unpaid.items.every((j: { invoice: { paid: boolean } }) => j.invoice && !j.invoice.paid)).toBe(true);
  });

  it("keeps customers with history", async () => {
    const id = (await ctx.app.db.query<{ customer_id: string }>("SELECT customer_id FROM jobs LIMIT 1")).rows[0].customer_id;
    expect((await admin.send("DELETE", `/api/customers/${id}`)).statusCode).toBe(409);
  });

  it("board shows today's work and upcoming bookings", async () => {
    const b = (await tech.get("/api/board")).json();
    expect(b.onBoard.length).toBeGreaterThan(0);
    expect(b.upcoming.every((j: { bookedFor: string }) => j.bookedFor > b.today && j.bookedFor <= addDays(b.today, 7))).toBe(true);
    // The demo holds six months of history, so use a short service interval to get vehicles due.
    const settings = await getSettings(ctx.app.db);
    await admin.send("PUT", "/api/settings", { ...settings, serviceIntervalMonths: 3 });
    expect((await desk.get("/api/customers/due")).json().items.length).toBeGreaterThan(0);
    await admin.send("PUT", "/api/settings", settings);
  });
});

describe("reports", () => {
  it("match the shared statistics over the whole database", async () => {
    const from = addDays(TODAY, -90);
    const res = (await desk.get(`/api/reports?from=${from}&to=${TODAY}`)).json();
    const ids = (await ctx.app.db.query<{ id: string }>("SELECT id FROM jobs")).rows.map((r) => r.id);
    const [jobs, technicians, settings] = await Promise.all([loadJobs(ctx.app.db, ids), listTechnicians(ctx.app.db), getSettings(ctx.app.db)]);
    const expected = workshopStats({ settings, jobs, technicians, customers: [], vehicles: [], parts: [] }, { from, to: TODAY });
    expect(res).toEqual(JSON.parse(JSON.stringify(expected)));
    expect(res.jobsCompleted).toBeGreaterThan(50);
  });

  it("exports the invoice register as CSV", async () => {
    const r = await desk.get(`/api/reports/invoices.csv?from=${addDays(TODAY, -365)}&to=${TODAY}`);
    expect(r.headers["content-type"]).toContain("text/csv");
    const lines = r.body.trim().split("\r\n");
    expect(lines[0]).toMatch(/^Invoice,IssuedDate,Job/);
    expect(lines.length).toBeGreaterThan(50);
  });
});
