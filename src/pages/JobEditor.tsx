import { useMemo, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { Plate, StatusBadge, useMoney } from "../components/ui";
import { SERVICE_PACKAGES } from "../data/catalog";
import { todayLocal } from "../lib/dates";
import { fmtDate, fmtHours } from "../lib/format";
import { jobTotals, labourLineCents, partLineCents } from "../lib/money";
import { newId, nextInvoiceNumber, nextJobNumber, useStore } from "../store/store";
import { JOB_STATUSES, type Customer, type Job, type LabourLine, type PartLine, type Vehicle } from "../types";

const NEW = "__new__";

export function JobEditor() {
  const { id } = useParams();
  return <Editor key={id ?? "new"} id={id} />;
}

function blankJob(): Job {
  return {
    id: newId("j"),
    number: "",
    customerId: "",
    vehicleId: "",
    bookedFor: todayLocal(),
    createdAt: new Date().toISOString(),
    complaint: "",
    notes: "",
    mileageIn: 0,
    status: "Booked",
    statusHistory: [],
    labour: [],
    parts: [],
    discountCents: 0,
  };
}

export function validateJob(
  j: Job,
  opts: { newCustomer?: Pick<Customer, "name" | "phone"> | null; newVehicle?: Pick<Vehicle, "plate" | "make" | "model" | "year"> | null },
): string[] {
  const e: string[] = [];
  if (!j.customerId && !opts.newCustomer) e.push("Choose a customer.");
  if (opts.newCustomer && opts.newCustomer.name.trim().length < 2) e.push("Enter the new customer's name.");
  if (opts.newCustomer && opts.newCustomer.phone.replace(/\D/g, "").length < 7) e.push("Enter the new customer's phone number.");
  if (!j.vehicleId && !opts.newVehicle) e.push("Choose a vehicle.");
  if (opts.newVehicle) {
    if (!opts.newVehicle.plate.trim()) e.push("Enter the vehicle's registration plate.");
    if (!opts.newVehicle.make.trim() || !opts.newVehicle.model.trim()) e.push("Enter the vehicle's make and model.");
    const maxYear = new Date().getFullYear() + 1;
    if (!(opts.newVehicle.year >= 1950 && opts.newVehicle.year <= maxYear)) e.push(`Vehicle year must be 1950–${maxYear}.`);
  }
  if (!j.bookedFor) e.push("Pick a booking date.");
  if (!j.complaint.trim()) e.push("Describe the customer's request or the fault.");
  if (!(j.mileageIn >= 0)) e.push("Mileage can't be negative.");
  j.labour.forEach((l, i) => {
    if (!l.description.trim()) e.push(`Labour line ${i + 1} needs a description.`);
    if (!(l.hours > 0)) e.push(`Labour line ${i + 1}: hours must be more than 0.`);
    if (!(l.rateCents >= 0)) e.push(`Labour line ${i + 1}: rate can't be negative.`);
  });
  j.parts.forEach((p, i) => {
    if (!p.description.trim()) e.push(`Part line ${i + 1} needs a description.`);
    if (!(p.qty > 0) || !Number.isInteger(p.qty)) e.push(`Part line ${i + 1}: quantity must be a whole number above 0.`);
    if (!(p.unitPriceCents >= 0)) e.push(`Part line ${i + 1}: price can't be negative.`);
  });
  if (!(j.discountCents >= 0)) e.push("Discount can't be negative.");
  return e;
}

const cents = (v: string) => {
  const n = Math.round(Number(v) * 100);
  return Number.isFinite(n) ? n : 0;
};

function Editor({ id }: { id?: string }) {
  const { data, saveJob, saveCustomer, saveVehicle } = useStore();
  const fmt = useMoney();
  const navigate = useNavigate();
  const location = useLocation();
  const original = id ? data.jobs.find((j) => j.id === id) : undefined;
  const [draft, setDraft] = useState<Job>(() => (original ? structuredClone(original) : blankJob()));
  const [newCustomer, setNewCustomer] = useState<Customer | null>(null);
  const [newVehicle, setNewVehicle] = useState<Vehicle | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState(() => (location.state as { saved?: boolean } | null)?.saved === true);
  const [pkg, setPkg] = useState("");
  const [partPick, setPartPick] = useState("");

  const customers = useMemo(() => [...data.customers].sort((a, b) => a.name.localeCompare(b.name)), [data.customers]);
  const customerVehicles = data.vehicles.filter((v) => v.customerId === draft.customerId);
  const partsById = useMemo(() => new Map(data.parts.map((p) => [p.id, p])), [data.parts]);
  const locked = !!original?.invoice?.paidAt;

  if (id && !original) {
    return (
      <div className="card empty">
        <h1>Job not found</h1>
        <Link to="/jobs" className="btn">
          Back to job cards
        </Link>
      </div>
    );
  }

  const set = (patch: Partial<Job>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setSaved(false);
  };
  const setLabour = (i: number, patch: Partial<LabourLine>) => set({ labour: draft.labour.map((l, k) => (k === i ? { ...l, ...patch } : l)) });
  const setPart = (i: number, patch: Partial<PartLine>) => set({ parts: draft.parts.map((p, k) => (k === i ? { ...p, ...patch } : p)) });

  function addPackage(name: string) {
    const p = SERVICE_PACKAGES.find((x) => x.name === name);
    if (!p) return;
    const bySku = new Map(data.parts.map((x) => [x.sku, x]));
    const extraParts: PartLine[] = p.parts.flatMap(([sku, qty]) => {
      const part = bySku.get(sku);
      return part ? [{ id: newId("ln"), partId: part.id, description: part.name, qty, unitPriceCents: part.priceCents, unitCostCents: part.costCents }] : [];
    });
    set({
      labour: [...draft.labour, { id: newId("ln"), description: p.name, hours: p.hours, rateCents: data.settings.labourRateCents }],
      parts: [...draft.parts, ...extraParts],
      complaint: draft.complaint || p.name,
    });
  }

  function addStockPart(partId: string) {
    const part = partsById.get(partId);
    if (!part) return;
    set({ parts: [...draft.parts, { id: newId("ln"), partId, description: part.name, qty: 1, unitPriceCents: part.priceCents, unitCostCents: part.costCents }] });
  }

  /** Stock available to this job: shelf stock plus what this job already holds. */
  function available(partId: string): number {
    const held = original && original.status !== "Cancelled" ? original.parts.filter((p) => p.partId === partId).reduce((s, p) => s + p.qty, 0) : 0;
    const wanted = draft.parts.filter((p) => p.partId === partId).reduce((s, p) => s + p.qty, 0);
    return (partsById.get(partId)?.stock ?? 0) + held - wanted;
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const errs = validateJob(draft, { newCustomer, newVehicle });
    setErrors(errs);
    if (errs.length) return;

    let job = { ...draft, complaint: draft.complaint.trim(), notes: draft.notes.trim() };
    if (newCustomer) {
      saveCustomer({ ...newCustomer, name: newCustomer.name.trim() });
      job.customerId = newCustomer.id;
    }
    if (newVehicle) {
      saveVehicle({ ...newVehicle, customerId: job.customerId, plate: newVehicle.plate.trim().toUpperCase(), mileage: Math.max(newVehicle.mileage, job.mileageIn) });
    } else {
      const v = data.vehicles.find((x) => x.id === job.vehicleId);
      if (v && job.mileageIn > v.mileage) saveVehicle({ ...v, mileage: job.mileageIn });
    }
    if (newVehicle) job.vehicleId = newVehicle.id;
    const now = new Date().toISOString();
    if (!original) {
      job = { ...job, number: nextJobNumber(data), createdAt: now, statusHistory: [{ status: "Booked", at: now }] };
      if (job.status !== "Booked") job.statusHistory.push({ status: job.status, at: now });
    } else if (original.status !== job.status) {
      job.statusHistory = [...original.statusHistory, { status: job.status, at: now }];
    }
    if (job.status === "Completed" && !job.invoice) job.invoice = { number: nextInvoiceNumber(data), issuedAt: now };
    saveJob(job);
    setNewCustomer(null);
    setNewVehicle(null);
    setDraft(job);
    setSaved(true);
    if (!original) navigate(`/jobs/${job.id}`, { replace: true, state: { saved: true } });
  }

  const totals = jobTotals(draft, data.settings.taxPercent);
  const vehicle = data.vehicles.find((v) => v.id === draft.vehicleId);

  return (
    <form onSubmit={submit} noValidate>
      <div className="page-head">
        <h1>{original ? `Job ${original.number}` : "New job card"}</h1>
        {original && <StatusBadge status={original.status} />}
        {vehicle && <Plate plate={vehicle.plate} />}
        <span className="spacer" />
        {original?.invoice && (
          <Link to={`/jobs/${original.id}/invoice`} className="btn btn-sm">
            Invoice {original.invoice.number}
          </Link>
        )}
        <Link to="/jobs" className="btn btn-sm">
          All jobs
        </Link>
      </div>
      {locked && <div className="notice" style={{ marginBottom: "1rem" }}>This job's invoice has been paid, so its lines are locked.</div>}

      <div className="detail-grid">
        <div className="stack">
          <section className="card stack">
            <h2 style={{ margin: 0 }}>Customer &amp; vehicle</h2>
            <div className="form-grid">
              <label>
                Customer
                <select
                  value={newCustomer ? NEW : draft.customerId}
                  disabled={locked}
                  onChange={(e) => {
                    if (e.target.value === NEW) {
                      setNewCustomer({ id: newId("c"), name: "", phone: "", email: "" });
                      set({ customerId: "", vehicleId: "" });
                      setNewVehicle({ id: newId("v"), customerId: "", plate: "", make: "", model: "", year: new Date().getFullYear() - 3, vin: "", mileage: 0 });
                    } else {
                      setNewCustomer(null);
                      setNewVehicle(null);
                      const vs = data.vehicles.filter((v) => v.customerId === e.target.value);
                      set({ customerId: e.target.value, vehicleId: vs.length === 1 ? vs[0].id : "", mileageIn: vs.length === 1 ? vs[0].mileage : draft.mileageIn });
                    }
                  }}
                >
                  <option value="">Choose…</option>
                  <option value={NEW}>+ New customer</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {c.phone}
                    </option>
                  ))}
                </select>
              </label>
              {newCustomer && (
                <>
                  <label>
                    Name
                    <input value={newCustomer.name} onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })} />
                  </label>
                  <label>
                    Phone
                    <input type="tel" value={newCustomer.phone} onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })} />
                  </label>
                  <label>
                    Email
                    <input type="email" value={newCustomer.email} onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })} />
                  </label>
                </>
              )}
              <label>
                Vehicle
                <select
                  value={newVehicle ? NEW : draft.vehicleId}
                  disabled={locked || (!draft.customerId && !newCustomer)}
                  onChange={(e) => {
                    if (e.target.value === NEW) {
                      setNewVehicle({ id: newId("v"), customerId: draft.customerId, plate: "", make: "", model: "", year: new Date().getFullYear() - 3, vin: "", mileage: 0 });
                      set({ vehicleId: "" });
                    } else {
                      setNewVehicle(null);
                      const v = data.vehicles.find((x) => x.id === e.target.value);
                      set({ vehicleId: e.target.value, mileageIn: v ? Math.max(v.mileage, original ? draft.mileageIn : 0) : draft.mileageIn });
                    }
                  }}
                >
                  <option value="">Choose…</option>
                  <option value={NEW}>+ New vehicle</option>
                  {customerVehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.plate} · {v.year} {v.make} {v.model}
                    </option>
                  ))}
                </select>
              </label>
              {newVehicle && (
                <>
                  <label>
                    Plate
                    <input value={newVehicle.plate} onChange={(e) => setNewVehicle({ ...newVehicle, plate: e.target.value })} />
                  </label>
                  <label>
                    Make
                    <input value={newVehicle.make} onChange={(e) => setNewVehicle({ ...newVehicle, make: e.target.value })} />
                  </label>
                  <label>
                    Model
                    <input value={newVehicle.model} onChange={(e) => setNewVehicle({ ...newVehicle, model: e.target.value })} />
                  </label>
                  <label>
                    Year
                    <input type="number" value={newVehicle.year} onChange={(e) => setNewVehicle({ ...newVehicle, year: Number(e.target.value) })} />
                  </label>
                  <label>
                    VIN (optional)
                    <input maxLength={17} value={newVehicle.vin} onChange={(e) => setNewVehicle({ ...newVehicle, vin: e.target.value.toUpperCase() })} />
                  </label>
                </>
              )}
              <label>
                Mileage in
                <input type="number" min={0} value={draft.mileageIn} disabled={locked} onChange={(e) => set({ mileageIn: Number(e.target.value) })} />
              </label>
            </div>
            {draft.customerId && !newCustomer && (
              <p className="small" style={{ margin: 0 }}>
                <Link to={`/customers/${draft.customerId}`}>Customer history →</Link>
              </p>
            )}
          </section>

          <section className="card stack">
            <h2 style={{ margin: 0 }}>Work</h2>
            <label>
              Customer request / fault
              <textarea value={draft.complaint} disabled={locked} onChange={(e) => set({ complaint: e.target.value })} placeholder="e.g. Squealing when braking" />
            </label>

            <div className="row">
              <strong>Labour</strong>
              <span className="spacer" />
              {!locked && (
                <>
                  <select aria-label="Add service package" value={pkg} onChange={(e) => setPkg(e.target.value)} style={{ width: "auto", marginTop: 0 }}>
                    <option value="">Service package…</option>
                    {SERVICE_PACKAGES.map((p) => (
                      <option key={p.name}>{p.name}</option>
                    ))}
                  </select>
                  <button type="button" className="btn btn-sm" disabled={!pkg} onClick={() => { addPackage(pkg); setPkg(""); }}>
                    Add package
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => set({ labour: [...draft.labour, { id: newId("ln"), description: "", hours: 1, rateCents: data.settings.labourRateCents }] })}
                  >
                    + Labour line
                  </button>
                </>
              )}
            </div>
            <div className="table-wrap">
              <table className="lines">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th className="r">Hours</th>
                    <th className="r">Rate</th>
                    <th className="r">Amount</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {draft.labour.map((l, i) => (
                    <tr key={l.id}>
                      <td>
                        <input aria-label="Labour description" value={l.description} disabled={locked} onChange={(e) => setLabour(i, { description: e.target.value })} />
                      </td>
                      <td className="w-num">
                        <input aria-label="Hours" type="number" min={0} step={0.1} value={l.hours} disabled={locked} onChange={(e) => setLabour(i, { hours: Number(e.target.value) })} />
                      </td>
                      <td className="w-num">
                        <input aria-label="Rate" type="number" min={0} step={0.01} value={l.rateCents / 100} disabled={locked} onChange={(e) => setLabour(i, { rateCents: cents(e.target.value) })} />
                      </td>
                      <td className="r">{fmt(labourLineCents(l))}</td>
                      <td>
                        {!locked && (
                          <button type="button" className="btn btn-sm btn-danger" aria-label="Remove labour line" onClick={() => set({ labour: draft.labour.filter((_, k) => k !== i) })}>
                            ✕
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {draft.labour.length === 0 && (
                    <tr>
                      <td colSpan={5} className="muted">
                        No labour yet. Add a service package or a line.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="row">
              <strong>Parts</strong>
              <span className="spacer" />
              {!locked && (
                <>
                  <select aria-label="Add part from stock" value={partPick} onChange={(e) => setPartPick(e.target.value)} style={{ width: "auto", marginTop: 0, maxWidth: 260 }}>
                    <option value="">Part from stock…</option>
                    {data.parts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.stock} in stock)
                      </option>
                    ))}
                  </select>
                  <button type="button" className="btn btn-sm" disabled={!partPick} onClick={() => { addStockPart(partPick); setPartPick(""); }}>
                    Add part
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => set({ parts: [...draft.parts, { id: newId("ln"), description: "", qty: 1, unitPriceCents: 0, unitCostCents: 0 }] })}
                  >
                    + Other item
                  </button>
                </>
              )}
            </div>
            <div className="table-wrap">
              <table className="lines">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th className="r">Qty</th>
                    <th className="r">Unit price</th>
                    <th className="r">Amount</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {draft.parts.map((p, i) => {
                    const avail = p.partId ? available(p.partId) : null;
                    return (
                      <tr key={p.id}>
                        <td>
                          <input aria-label="Part description" value={p.description} disabled={locked} onChange={(e) => setPart(i, { description: e.target.value })} />
                          {avail !== null && avail < 0 && (
                            <div className="field-error">⚠ Only {avail + p.qty} in stock. Order more or set the job to "Waiting parts".</div>
                          )}
                          {!p.partId && <div className="muted small">Not a stock item</div>}
                        </td>
                        <td className="w-num">
                          <input aria-label="Quantity" type="number" min={1} step={1} value={p.qty} disabled={locked} onChange={(e) => setPart(i, { qty: Number(e.target.value) })} />
                        </td>
                        <td className="w-num">
                          <input aria-label="Unit price" type="number" min={0} step={0.01} value={p.unitPriceCents / 100} disabled={locked} onChange={(e) => setPart(i, { unitPriceCents: cents(e.target.value) })} />
                        </td>
                        <td className="r">{fmt(partLineCents(p))}</td>
                        <td>
                          {!locked && (
                            <button type="button" className="btn btn-sm btn-danger" aria-label="Remove part line" onClick={() => set({ parts: draft.parts.filter((_, k) => k !== i) })}>
                              ✕
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {draft.parts.length === 0 && (
                    <tr>
                      <td colSpan={5} className="muted">
                        No parts.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <label>
              Internal notes <span className="muted">(not on the invoice)</span>
              <textarea value={draft.notes} onChange={(e) => set({ notes: e.target.value })} />
            </label>
          </section>
        </div>

        <div className="stack">
          <section className="card stack">
            <h2 style={{ margin: 0 }}>Booking</h2>
            <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <label>
                Booked for
                <input type="date" value={draft.bookedFor} onChange={(e) => set({ bookedFor: e.target.value })} />
              </label>
              <label>
                Technician
                <select value={draft.technicianId ?? ""} onChange={(e) => set({ technicianId: e.target.value || undefined })}>
                  <option value="">Unassigned</option>
                  {data.technicians
                    .filter((t) => t.active || t.id === draft.technicianId)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="span-all">
                Status
                <select value={draft.status} disabled={locked} onChange={(e) => set({ status: e.target.value as Job["status"] })}>
                  {JOB_STATUSES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
            </div>
            {draft.status === "Completed" && !original?.invoice && <p className="muted small" style={{ margin: 0 }}>Saving as Completed issues the invoice.</p>}
            {draft.status === "Cancelled" && original?.status !== "Cancelled" && draft.parts.some((p) => p.partId) && (
              <p className="muted small" style={{ margin: 0 }}>Cancelling returns this job's parts to stock.</p>
            )}
          </section>

          <section className="card stack">
            <h2 style={{ margin: 0 }}>Totals</h2>
            <div className="totals">
              <span>Labour ({fmtHours(totals.hours)})</span>
              <span>{fmt(totals.labour)}</span>
              <span>Parts</span>
              <span>{fmt(totals.parts)}</span>
              <span>
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontWeight: 400 }}>
                  Discount
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={draft.discountCents / 100}
                    disabled={locked}
                    onChange={(e) => set({ discountCents: cents(e.target.value) })}
                    style={{ width: 110, marginTop: 0 }}
                  />
                </label>
              </span>
              <span>−{fmt(totals.discount)}</span>
              <span>Tax ({data.settings.taxPercent}%)</span>
              <span>{fmt(totals.tax)}</span>
              <span className="grand">Total</span>
              <span className="grand">{fmt(totals.total)}</span>
            </div>
            <p className="muted small" style={{ margin: 0 }}>
              Gross profit {fmt(totals.grossProfit)} (parts cost {fmt(totals.partsCost)})
            </p>
          </section>

          {errors.length > 0 && (
            <div className="notice" role="alert">
              <strong>Please fix:</strong>
              <ul style={{ margin: "0.3rem 0 0", paddingLeft: "1.1rem" }}>
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          )}
          {saved && <div className="notice notice-good">Saved.</div>}
          <button type="submit" className="btn btn-primary btn-block">
            {original ? "Save job card" : "Create job card"}
          </button>

          {original && (
            <section className="card">
              <h3>History</h3>
              <ul className="small" style={{ margin: 0, paddingLeft: "1.1rem" }}>
                {original.statusHistory.map((e, i) => (
                  <li key={i}>
                    {e.status} · {fmtDate(e.at, true)}
                  </li>
                ))}
                {original.invoice?.paidAt && (
                  <li>
                    Paid ({original.invoice.method}) · {fmtDate(original.invoice.paidAt, true)}
                  </li>
                )}
              </ul>
            </section>
          )}
        </div>
      </div>
    </form>
  );
}
