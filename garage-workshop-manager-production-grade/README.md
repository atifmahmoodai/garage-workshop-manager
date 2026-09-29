# Workshop manager: production version

The production build of the workshop manager in the parent folder. The demo keeps everything in one browser. This version runs on a server with a PostgreSQL database, staff logins, legally sound invoices and a stock ledger, so a real garage can run on it.

| | Demo (parent folder) | Production (this folder) |
|---|---|---|
| Data | Browser `localStorage`, one device | PostgreSQL, shared by the front desk and the workshop floor |
| Access | Anyone who opens the page | Logins with roles: admin, service advisor, technician |
| Invoices | Recalculated from the job whenever it's viewed | Frozen when issued: totals, tax rate, customer, vehicle and workshop details. Gapless numbers. A mistake is corrected by voiding (kept on record) and reissuing, never by editing |
| Stock | A number that jobs change | Every movement recorded (job, delivery, stocktake, opening balance), so the stock figure is always explainable |
| Lists | Everything loaded into the browser | Server-side search and paging (jobs, customers) that stays fast after years of history |
| Accountant | — | Invoice register CSV (issued, paid, voided) for any period |
| Deployment | Static files | Docker image, `docker-compose.yml`, health checks, CI with a real database |

## Roles

- **Service advisor:** the front desk. Handles job cards, customers, vehicles, parts, prices, invoices, payments and reports.
- **Technician:** sees the board and job cards, and moves jobs between *In progress*, *Waiting parts* and *Ready*. Cannot complete jobs (which issues the invoice), cancel them or change prices.
- **Admin:** everything an advisor can do, plus workshop settings, technicians, staff logins and the activity log.

## Run it with Docker

```bash
cp .env.example .env              # set POSTGRES_PASSWORD, PUBLIC_URL, TIMEZONE
docker compose up -d --build
docker compose exec app node dist/cli/create-admin.js --email owner@yourgarage.com --name "Owner Name"
```

Open http://localhost:8080 and sign in. Under **Settings & users**, set your workshop details, tax rate and labour rate, and add technicians and staff logins.

Demo data (six months of history) is optional:

```bash
docker compose exec -e ALLOW_DEMO_SEED=1 app node dist/cli/seed-demo.js
# Logins: admin@demo.local, advisor@demo.local, tech@demo.local … password: demo-password-1
```

## Development

Requirements: Node 22+ and PostgreSQL 14+.

```bash
npm install
cp .env.example .env    # set DATABASE_URL, NODE_ENV=development, COOKIE_SECURE=false
npm run migrate
npm run seed:demo       # optional
npm run dev             # API on :8080, app with hot reload on :5173
```

## Tests

```bash
npm run typecheck
npm test                        # shared maths, API integration tests on a real PostgreSQL, form validation
npm run build && npm run smoke  # whole stack in Chromium: fresh database, real server, real browser
```

`TEST_DATABASE_URL` (default `…/workshop_test`) and `SMOKE_DATABASE_URL` (default `…/workshop_smoke`) are **dropped and recreated** on each run. The tests refuse to run unless the database name contains `test` or `smoke`.

What the tests prove:

- **Invoices:**
  - Completing a job issues an invoice that matches the job's totals.
  - Once issued, changing the work or prices is refused; notes and technician can still change.
  - Changing the tax rate or workshop name later leaves issued invoices exactly as they were.
  - Voiding keeps the old invoice and issues a new number.
  - Paid invoices can't be voided.
  - Four jobs completed at the same moment get four consecutive invoice numbers.
- **Stock:**
  - Parts come out of stock when added to a job, and go back if it's cancelled or the quantity drops.
  - Every movement is recorded, and the stock figure equals the sum of its movements.
  - Stock-item cost comes from the parts list, not from the browser.
- **Access and editing:**
  - Technicians can't complete, cancel, price or invoice.
  - Every change needs a session and a CSRF token.
  - Two people editing the same job get a conflict warning instead of overwriting each other.
- **Data integrity:**
  - A new customer, vehicle and job are created together or not at all (duplicate plate → nothing saved).
  - Plates are matched ignoring spaces and case.
  - Customers with history can't be deleted.
- **Reports:** reports equal the shared statistics computed over the whole database.

## Security

Same foundation as the production showroom:
- **Passwords:** scrypt hashes, with account lockout after repeated failures.
- **Sessions:** `httpOnly` / `SameSite` / `Secure` cookies. Only a hash of each session token is stored.
- **Cross-site attacks:** a CSRF token on every change, plus an `Origin` check.
- **Headers:** Helmet sets strict headers, including a Content-Security-Policy.
- **Input and database:** zod validation on every input, and parameterised SQL.
- **Rate limits:** a global limit, plus a tighter limit on login.
- **Audit log:** records who did what and when.

## Operations

See [docs/OPERATIONS.md](docs/OPERATIONS.md) for deployment, https, backups, monitoring and upgrades.

## Known limits

- **Payments:** a job is paid in one payment (no part payments or deposits) and there's no card terminal integration. Record the method used.
- **Refunds:** a paid invoice can't be voided in the app. Handle refunds in your accounting system.
- **Customer contact:** no SMS or email reminders are sent. The *Service due* list shows whom to contact.
- **Rate limits are per server:** they are counted in memory, per app instance.
