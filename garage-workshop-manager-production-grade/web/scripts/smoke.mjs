// End-to-end smoke test of the whole production stack: a fresh PostgreSQL database with
// demo data, the built API server serving the built web app, driven in Chromium.
//   npm run build && npm run smoke        (from the project root)
// Uses SMOKE_DATABASE_URL (default postgres://postgres:postgres@localhost:5432/workshop_smoke).
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { chromium } from "playwright-core";

const PORT = 4183;
const BASE = `http://localhost:${PORT}/`;
const SHOTS = "test-results/screenshots";
const DB_URL = process.env.SMOKE_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/workshop_smoke";
const executablePath = process.env.CHROMIUM_PATH || (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
mkdirSync(SHOTS, { recursive: true });
if (!existsSync("../server/dist/server.js") || !existsSync("dist/index.html")) throw new Error("Build first: npm run build (from the project root)");

{
  const name = new URL(DB_URL).pathname.slice(1);
  if (!/^[a-z0-9_]+$/.test(name) || !name.includes("smoke")) throw new Error("SMOKE_DATABASE_URL must name a database containing 'smoke'");
  const adminUrl = new URL(DB_URL);
  adminUrl.pathname = "/postgres";
  const c = new pg.Client({ connectionString: adminUrl.toString() });
  await c.connect();
  await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await c.query(`CREATE DATABASE ${name}`);
  await c.end();
}
const env = {
  ...process.env,
  NODE_ENV: "production",
  DATABASE_URL: DB_URL,
  PORT: String(PORT),
  PUBLIC_URL: BASE,
  COOKIE_SECURE: "false",
  WEB_DIST: join(process.cwd(), "dist"),
  LOG_LEVEL: "warn",
  ALLOW_DEMO_SEED: "1",
};
const seeded = spawnSync("node", ["../server/dist/cli/seed-demo.js"], { env, encoding: "utf8" });
if (seeded.status !== 0) throw new Error(`demo seed failed: ${seeded.stderr}`);
const server = spawn("node", ["../server/dist/server.js"], { env, stdio: ["ignore", "inherit", "inherit"] });

let failures = 0;
const check = (ok, msg) => {
  console.log(`  ${ok ? "✓" : "✗"} ${msg}`);
  if (!ok) failures++;
};
// Newer Chromium returns a Promise from scrollTo(); emulate it so effect bugs show up everywhere.
const emulatePromiseScroll = (ctx) =>
  ctx.addInitScript(() => {
    const o = window.scrollTo.bind(window);
    window.scrollTo = (...a) => (o(...a), Promise.resolve());
  });
const signIn = async (p, email) => {
  await p.goto(`${BASE}login`);
  await p.fill("input[type=email]", email);
  await p.fill("input[type=password]", "demo-password-1");
  await p.click("button:has-text('Sign in')");
  await p.waitForSelector(".admin-side");
};
const signOut = async (p) => {
  await p.click("button:has-text('Sign out')");
  await p.waitForURL(/\/login/);
};
const stockOf = async (page, sku) => {
  await page.goto(`${BASE}parts`);
  await page.waitForSelector("tbody tr td.num");
  await page.fill("input[type=search]", sku);
  const cell = page.locator("tbody tr").first().locator("td").nth(3);
  return Number((await cell.innerText()).replace(/[^\d-]/g, ""));
};
const settle = (p, ms = 700) => p.waitForTimeout(ms);

let page;
try {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${BASE}readyz`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  const browser = await chromium.launch({ executablePath });
  const errors = [];
  const watch = (p) => {
    p.on("pageerror", (e) => {
      errors.push(e.stack || e.message);
      console.log(`  ! ${e.stack || e.message}`);
    });
    p.on("console", (m) => m.type() === "error" && !/status of 40[19]/.test(m.text()) && errors.push(m.text()));
    p.on("dialog", (d) => (d.type() === "prompt" ? d.accept("Customer asked for extra work") : d.accept()));
  };
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  await emulatePromiseScroll(ctx);
  page = await ctx.newPage();
  watch(page);

  console.log("Sign in");
  await page.goto(BASE);
  await page.waitForURL(/\/login/);
  check(true, "the app requires signing in");
  await signIn(page, "advisor@demo.local");

  console.log("Board");
  await page.waitForSelector(".board");
  check((await page.locator(".board-col").count()) === 4, "4 board columns");
  const kpis = (await page.locator(".kpi-value").allTextContents()).join(" | ");
  check(!/NaN|undefined/.test(kpis), `KPIs: ${kpis}`);
  await page.screenshot({ path: `${SHOTS}/board.png` });
  const bookedCol = page.locator(".board-col[aria-label='Booked jobs']");
  const progCol = page.locator(".board-col[aria-label='In progress jobs']");
  const b0 = await bookedCol.locator(".job-card").count();
  const p0 = await progCol.locator(".job-card").count();
  await bookedCol.locator("button:has-text('Check in')").first().click();
  await settle(page);
  check((await bookedCol.locator(".job-card").count()) === b0 - 1 && (await progCol.locator(".job-card").count()) === p0 + 1, "Check in moves a job to In progress");
  const unpaidBefore = Number(await page.locator(".kpi:has-text('Unpaid') .kpi-value").innerText());
  await page.locator(".board-col[aria-label='Ready jobs'] button:has-text('Collected')").first().click();
  await settle(page);
  check(Number(await page.locator(".kpi:has-text('Unpaid') .kpi-value").innerText()) === unpaidBefore + 1, "Collected issues an unpaid invoice");

  console.log("New job card");
  const padsBefore = await stockOf(page, "BRK-PAD-F");
  await page.goto(`${BASE}jobs/new`);
  await page.click("button:has-text('Create job card')");
  check(await page.locator("text=Choose a customer.").isVisible(), "empty job shows validation errors");
  await page.click("button:has-text('+ New customer')");
  await page.fill("label:has-text('Name') input", "Smoke Tester");
  await page.fill("label:has-text('Phone') input", "+1 555 123 4567");
  await page.fill("label:has-text('Plate') input", "sm0 ke1");
  await page.fill("label:has-text('Make') input", "Honda");
  await page.fill("label:has-text('Model') input", "Civic");
  await page.fill("label:has-text('Mileage in') input", "42000");
  await page.selectOption("select[aria-label='Add service package']", "Front brake pads");
  await page.click("button:has-text('Add package')");
  check((await page.locator("input[aria-label='Labour description']").inputValue()) === "Front brake pads", "service package adds labour");
  check((await page.locator("input[aria-label='Part description']").inputValue()) === "Brake pads (front set)", "service package adds parts");
  const total = await page.locator(".totals .grand").nth(1).innerText();
  check(/\$\d/.test(total), `live total ${total}`);
  await page.click("button:has-text('Create job card')");
  await page.waitForSelector("text=Saved.");
  const jobUrl = page.url();
  check(/\/jobs\/j-/.test(jobUrl), "job saved on the server and reopened");
  check((await stockOf(page, "BRK-PAD-F")) === padsBefore - 1, "adding the part took it from stock");

  console.log("Complete, invoice, pay");
  await page.goto(jobUrl);
  await page.waitForSelector(".totals");
  await page.selectOption("label:has-text('Status') select", "Completed");
  await page.click("button:has-text('Save job card')");
  await page.waitForSelector("a:has-text('Invoice INV-')");
  await page.click("a:has-text('Invoice INV-')");
  await page.waitForSelector(".invoice");
  check(await page.locator(".invoice >> text=Smoke Tester").isVisible(), "invoice shows the customer");
  check(await page.locator(".invoice >> text=SM0 KE1").isVisible(), "plate normalised to upper case");
  const invTotal = await page.locator(".invoice .totals .grand").nth(1).innerText();
  check(invTotal === total, `invoice total matches job total (${invTotal})`);
  await page.goto(jobUrl);
  await page.waitForSelector(".totals");
  check(await page.locator("input[aria-label='Hours']").isDisabled(), "invoiced job lines are locked");
  await page.click("button:has-text('Reopen job (void invoice)')");
  await page.waitForSelector("text=voided");
  check(!(await page.locator("input[aria-label='Hours']").isDisabled()), "reopening voids the invoice and unlocks the job");
  await page.selectOption("label:has-text('Status') select", "Completed");
  await page.click("button:has-text('Save job card')");
  await page.waitForSelector("a:has-text('Invoice INV-')");
  await page.click("a:has-text('Invoice INV-')");
  await page.waitForSelector(".invoice");
  await page.click("button:has-text('Mark as paid')");
  await page.waitForSelector(".invoice >> text=✓ PAID");
  check(true, "invoice marked paid");
  await page.screenshot({ path: `${SHOTS}/invoice.png` });

  console.log("Cancel returns stock");
  const oilBefore = await stockOf(page, "OIL-5W30-5L");
  await page.goto(`${BASE}jobs/new`);
  await page.click("button:has-text('+ New customer')");
  await page.fill("label:has-text('Name') input", "Second Tester");
  await page.fill("label:has-text('Phone') input", "+1 555 987 6543");
  await page.fill("label:has-text('Plate') input", "SM0 KE2");
  await page.fill("label:has-text('Make') input", "Ford");
  await page.fill("label:has-text('Model') input", "Focus");
  await page.selectOption("select[aria-label='Add service package']", "Oil & filter change");
  await page.click("button:has-text('Add package')");
  await page.click("button:has-text('Create job card')");
  await page.waitForSelector("text=Saved.");
  const cancelUrl = page.url();
  check((await stockOf(page, "OIL-5W30-5L")) === oilBefore - 1, "oil taken from stock");
  await page.goto(cancelUrl);
  await page.waitForSelector(".totals");
  await page.selectOption("label:has-text('Status') select", "Cancelled");
  await page.click("button:has-text('Save job card')");
  await page.waitForSelector("text=Saved.");
  check((await stockOf(page, "OIL-5W30-5L")) === oilBefore, "cancelling returned the oil");

  console.log("Customer search");
  await page.goto(`${BASE}jobs/new`);
  await page.fill("input[placeholder^='Search name']", "sm0ke2");
  await page.waitForSelector(".picker-item");
  check((await page.locator(".picker-item").first().innerText()).includes("Second Tester"), "customer search finds a plate typed without spaces");

  console.log("Parts");
  await page.goto(`${BASE}parts`);
  await page.waitForSelector("tbody tr td.num");
  await page.fill("input[type=search]", "BAT-60AH");
  const bat0 = Number((await page.locator("tbody tr").first().locator("td").nth(3).innerText()).replace(/[^\d-]/g, ""));
  await page.fill("input[aria-label^='Quantity received']", "5");
  await page.locator("tbody tr").first().locator("button:has-text('+ Add')").click();
  await settle(page);
  const bat1 = Number((await page.locator("tbody tr").first().locator("td").nth(3).innerText()).replace(/[^\d-]/g, ""));
  check(bat1 === bat0 + 5, `receiving stock adds to it (${bat0} → ${bat1})`);
  await page.locator("tbody tr").first().locator("button:has-text('History')").click();
  await page.waitForSelector("text=Goods received");
  check(true, "stock history lists the delivery");
  await page.click("button:has-text('Close')");
  await page.click("button:has-text('+ Add part')");
  await page.fill("label:has-text('SKU') input", "bat-60ah");
  await page.fill("label:has-text('Name') input", "Duplicate");
  await page.fill("label:has-text('Cost') input", "1");
  await page.fill("label:has-text('Sell price') input", "2");
  await page.click("button:has-text('Save part')");
  check(await page.locator("text=already used").isVisible(), "duplicate SKU rejected");

  console.log("Customers and reports");
  await page.goto(`${BASE}customers`);
  await page.waitForSelector("tbody tr");
  await page.click("role=tab[name=/Service due/]");
  await page.waitForSelector("text=Vehicles whose last service");
  check(true, "service-due tab loads");
  await page.goto(`${BASE}customers/new`);
  await page.click("button:has-text('Create customer')");
  check(await page.locator("text=Enter a name.").isVisible(), "customer form validates");
  await page.goto(`${BASE}reports`);
  await page.waitForSelector(".recharts-surface");
  const rk = (await page.locator(".kpi-value").allTextContents()).join(" | ");
  check(!/NaN|undefined/.test(rk), `report KPIs: ${rk}`);
  check((await page.locator(".recharts-bar-rectangle").count()) > 10, "weekly revenue bars render");
  await page.screenshot({ path: `${SHOTS}/reports.png`, fullPage: true });
  const [csv] = await Promise.all([page.waitForEvent("download"), page.click("a:has-text('Invoices CSV')")]);
  check(/^invoices-.*\.csv$/.test(csv.suggestedFilename()), `invoice register downloads (${csv.suggestedFilename()})`);

  console.log("Roles and settings");
  await signOut(page);
  await signIn(page, "tech@demo.local");
  await page.waitForSelector(".board");
  check((await page.locator("text=+ New job card").count()) === 0, "technicians can't create job cards");
  check((await page.locator(".board-col[aria-label='Ready jobs'] button:has-text('Collected')").count()) === 0, "technicians can't mark cars collected (invoicing)");
  check((await page.locator(".side-link:has-text('Reports')").count()) === 0, "technicians don't see reports");
  await signOut(page);
  await signIn(page, "admin@demo.local");
  await page.goto(`${BASE}settings`);
  await page.waitForSelector("text=Staff logins");
  await page.fill("label:has-text('Currency code') input", "XXXX");
  await page.click("button:has-text('Save settings')");
  check(await page.locator("text=isn't a valid currency").isVisible(), "invalid currency rejected");
  await page.fill("label:has-text('Currency code') input", "PKR");
  await page.fill("label:has-text('Locale') input", "en-PK");
  await page.click("button:has-text('Save settings')");
  await page.waitForSelector("text=Settings saved");
  await page.goto(`${BASE}jobs`);
  await page.waitForSelector("tbody tr td.r");
  check(/Rs|PKR/.test(await page.locator("tbody td.r").first().innerText()), "currency setting applies everywhere");
  await page.reload();
  await page.waitForSelector("tbody tr td.r");
  check(/Rs|PKR/.test(await page.locator("tbody td.r").first().innerText()), "settings persist after reload (stored on the server)");
  await page.goto(`${BASE}audit`);
  await page.waitForSelector("text=Voided invoice");
  check(true, "activity log shows the voided invoice");

  console.log("Phone + dark");
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark" });
  await emulatePromiseScroll(mobile);
  const m = await mobile.newPage();
  watch(m);
  await signIn(m, "advisor@demo.local");
  for (const r of ["", "jobs", "jobs/j-1001", "parts", "reports"]) {
    await m.goto(`${BASE}${r}`);
    await m.waitForTimeout(700);
    const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(overflow <= 0, `no page-level horizontal scroll on phone at "/${r}" (${overflow}px)`);
  }
  await m.goto(BASE);
  await m.waitForSelector(".board");
  await m.screenshot({ path: `${SHOTS}/mobile-dark.png` });

  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join("; ")}` : ""}`);
  await browser.close();
} catch (e) {
  failures++;
  console.error(e);
  if (page) {
    console.error("URL at failure:", page.url());
    const text = await page.evaluate(() => document.body.innerText.slice(0, 600)).catch(() => "");
    console.error(text);
    await page.screenshot({ path: `${SHOTS}/failure.png`, fullPage: true }).catch(() => {});
  }
} finally {
  server.kill("SIGTERM");
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll smoke checks passed");
process.exit(failures ? 1 : 0);
