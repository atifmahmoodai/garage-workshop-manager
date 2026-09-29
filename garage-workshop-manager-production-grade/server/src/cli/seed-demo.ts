// Loads six months of demo workshop data (customers, vehicles, parts, jobs, invoices, logins).
//   npm run seed:demo            refuses if the database already has jobs
//   npm run seed:demo -- --force replaces all workshop data
// Demo staff log in with DEMO_PASSWORD (default: demo-password-1).
import { parseArgs } from "node:util";
import { loadConfig, todayIn } from "../config";
import { createPool, tx } from "../db";
import { migrate } from "../migrate";
import { seedDemo } from "../seed";

const { values } = parseArgs({ options: { force: { type: "boolean", default: false } } });
const config = loadConfig();
if (config.NODE_ENV === "production" && !process.env.ALLOW_DEMO_SEED) {
  console.error("Refusing to load demo data with NODE_ENV=production. Set ALLOW_DEMO_SEED=1 if you really mean it.");
  process.exit(1);
}
const db = createPool(config.DATABASE_URL, 2);
try {
  await migrate(db);
  const summary = await tx(db, (c) => seedDemo(c, { today: todayIn(config.TIMEZONE), force: values.force!, password: process.env.DEMO_PASSWORD ?? "demo-password-1" }));
  console.log(summary);
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await db.end();
}
