-- Workshop schema. Money is integer cents.

CREATE TABLE users (
  id            text PRIMARY KEY,
  email         text NOT NULL,
  name          text NOT NULL,
  role          text NOT NULL CHECK (role IN ('admin', 'advisor', 'technician')),
  password_hash text NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  failed_logins integer NOT NULL DEFAULT 0,
  locked_until  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

-- Only a hash of the session token is stored.
CREATE TABLE sessions (
  id           text PRIMARY KEY,
  user_id      text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  ip           text,
  user_agent   text
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

CREATE TABLE settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Gapless document numbers (job cards, invoices): taken under a row lock inside the same transaction.
CREATE TABLE counters (
  name  text PRIMARY KEY,
  value bigint NOT NULL
);
INSERT INTO counters (name, value) VALUES ('job', 1000), ('invoice', 5000);

CREATE TABLE customers (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  phone      text NOT NULL,
  email      text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customers_name_idx ON customers (lower(name));

CREATE TABLE vehicles (
  id          text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customers(id),
  plate       text NOT NULL,
  make        text NOT NULL,
  model       text NOT NULL,
  year        integer NOT NULL CHECK (year BETWEEN 1950 AND 2100),
  vin         text NOT NULL DEFAULT '',
  mileage     integer NOT NULL DEFAULT 0 CHECK (mileage >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
-- One record per car: plates compare without spaces or case.
CREATE UNIQUE INDEX vehicles_plate_key ON vehicles (upper(regexp_replace(plate, '\s', '', 'g')));
CREATE INDEX vehicles_customer_idx ON vehicles (customer_id);

CREATE TABLE technicians (
  id     text PRIMARY KEY,
  name   text NOT NULL,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE parts (
  id            text PRIMARY KEY,
  sku           text NOT NULL,
  name          text NOT NULL,
  category      text NOT NULL DEFAULT 'Other',
  stock         integer NOT NULL DEFAULT 0,
  reorder_level integer NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  cost_cents    integer NOT NULL CHECK (cost_cents >= 0),
  price_cents   integer NOT NULL CHECK (price_cents >= 0),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX parts_sku_key ON parts (lower(sku));

CREATE TABLE jobs (
  id             text PRIMARY KEY,
  number         text NOT NULL UNIQUE,
  customer_id    text NOT NULL REFERENCES customers(id),
  vehicle_id     text NOT NULL REFERENCES vehicles(id),
  booked_for     date NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  complaint      text NOT NULL,
  notes          text NOT NULL DEFAULT '',
  mileage_in     integer NOT NULL DEFAULT 0 CHECK (mileage_in >= 0),
  status         text NOT NULL CHECK (status IN ('Booked', 'In progress', 'Waiting parts', 'Ready', 'Completed', 'Cancelled')),
  technician_id  text REFERENCES technicians(id),
  discount_cents integer NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  version        integer NOT NULL DEFAULT 1,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_status_idx ON jobs (status, booked_for);
CREATE INDEX jobs_customer_idx ON jobs (customer_id);
CREATE INDEX jobs_vehicle_idx ON jobs (vehicle_id);
CREATE INDEX jobs_booked_idx ON jobs (booked_for DESC);

CREATE TABLE job_labour (
  id          bigserial PRIMARY KEY,
  job_id      text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  position    integer NOT NULL,
  description text NOT NULL,
  hours       numeric(8, 2) NOT NULL CHECK (hours > 0),
  rate_cents  integer NOT NULL CHECK (rate_cents >= 0)
);
CREATE INDEX job_labour_job_idx ON job_labour (job_id, position);

CREATE TABLE job_parts (
  id               bigserial PRIMARY KEY,
  job_id           text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  position         integer NOT NULL,
  part_id          text REFERENCES parts(id),
  description      text NOT NULL,
  qty              integer NOT NULL CHECK (qty > 0),
  unit_price_cents integer NOT NULL CHECK (unit_price_cents >= 0),
  unit_cost_cents  integer NOT NULL CHECK (unit_cost_cents >= 0)
);
CREATE INDEX job_parts_job_idx ON job_parts (job_id, position);

CREATE TABLE job_status_events (
  id      bigserial PRIMARY KEY,
  job_id  text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  status  text NOT NULL,
  at      timestamptz NOT NULL DEFAULT now(),
  user_id text REFERENCES users(id)
);
CREATE INDEX job_status_events_job_idx ON job_status_events (job_id, at);

-- Issued invoices are immutable documents. Changing a job after invoicing voids the invoice
-- (kept for the record) and a new number is issued when the job is completed again.
CREATE TABLE invoices (
  id             bigserial PRIMARY KEY,
  job_id         text NOT NULL REFERENCES jobs(id),
  number         text NOT NULL UNIQUE,
  issued_at      timestamptz NOT NULL DEFAULT now(),
  tax_percent    numeric(5, 2) NOT NULL,
  labour_cents   integer NOT NULL,
  parts_cents    integer NOT NULL,
  discount_cents integer NOT NULL,
  net_cents      integer NOT NULL,
  tax_cents      integer NOT NULL,
  total_cents    integer NOT NULL,
  document       jsonb NOT NULL,
  paid_at        timestamptz,
  method         text CHECK (method IN ('Cash', 'Card', 'Bank transfer')),
  voided_at      timestamptz,
  void_reason    text,
  issued_by      text REFERENCES users(id),
  CONSTRAINT paid_not_void CHECK (NOT (paid_at IS NOT NULL AND voided_at IS NOT NULL))
);
CREATE UNIQUE INDEX invoices_one_live_per_job ON invoices (job_id) WHERE voided_at IS NULL;
CREATE INDEX invoices_unpaid_idx ON invoices (issued_at) WHERE paid_at IS NULL AND voided_at IS NULL;

-- Every change to stock, with its reason: the stock figure can always be explained.
CREATE TABLE stock_movements (
  id      bigserial PRIMARY KEY,
  part_id text NOT NULL REFERENCES parts(id),
  delta   integer NOT NULL,
  reason  text NOT NULL CHECK (reason IN ('opening', 'receive', 'adjust', 'job')),
  job_id  text REFERENCES jobs(id),
  note    text NOT NULL DEFAULT '',
  user_id text REFERENCES users(id),
  at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_movements_part_idx ON stock_movements (part_id, at DESC);

CREATE TABLE audit_log (
  id        bigserial PRIMARY KEY,
  at        timestamptz NOT NULL DEFAULT now(),
  user_id   text REFERENCES users(id) ON DELETE SET NULL,
  action    text NOT NULL,
  entity    text NOT NULL,
  entity_id text,
  details   jsonb NOT NULL DEFAULT '{}',
  ip        text
);
CREATE INDEX audit_log_at_idx ON audit_log (at DESC);
