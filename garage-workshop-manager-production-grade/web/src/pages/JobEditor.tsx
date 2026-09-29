import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { isDesk, useMe } from "../api/auth";
import { api, ApiError, errorText } from "../api/client";
import { Plate, StatusBadge, useMoney } from "../components/ui";
import { SETTINGS, TECHNICIANS } from "../config";
import { SERVICE_PACKAGES } from "../../../shared/catalog";
import { todayLocal } from "../lib/dates";
import { fmtDate, fmtHours } from "../lib/format";
import { jobTotals, labourLineCents, partLineCents } from "../lib/money";
import { useDebounced } from "../lib/useDebounced";
import type { JobDetail } from "../../../shared/schemas";
import { JOB_STATUSES, PAYMENT_METHODS, type Customer, type Job, type LabourLine, type Part, type PartLine, type PaymentMethod, type Vehicle } from "../types";

const NEW = "__new__";
let lineSeq = 0;
const lineId = () => `ln-${++lineSeq}`;

function blankJob(): Job {
  return {
    id: "",
    number: "",
    customerId: "",
    vehicleId: "",
    bookedFor: todayLocal(),
    createdAt: "",
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

type NewCustomer = Pick<Customer, "name" | "phone" | "email">;
type NewVehicle = Pick<Vehicle, "plate" | "make" | "model" | "year" | "vin" | "mileage">;

/** Quick checks before sending; the server re-checks everything. */
export function validateJob(j: Job, opts: { newCustomer?: NewCustomer | null; newVehicle?: NewVehicle | null }): string[] {
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
  if (j.status === "Completed" && !j.labour.length && !j.parts.length) e.push("Add the work done before completing the job.");
  return e;
}

const cents = (v: string) => {
  const n = Math.round(Number(v) * 100);
  return Number.isFinite(n) ? n : 0;
};

export function JobEditor() {
  const { id } = useParams();
  const detail = useQuery({ queryKey: ["job", id], queryFn: () => api<JobDetail>(`/jobs/${encodeURIComponent(id!)}`), enabled: !!id, staleTime: 0 });
  const parts = useQuery({ queryKey: ["parts"], queryFn: () => api<{ items: Part[] }>("/parts") });
  if ((id && detail.isPending) || parts.isPending) return <p className="muted">Loading…</p>;
  if (id && detail.isError) {
    const missing = detail.error instanceof ApiError && detail.error.status === 404;
    return (
      <div className="card empty">
        <h1>{missing ? "Job not found" : "Couldn't load this job"}</h1>
        {!missing && <p className="muted">{errorText(detail.error)}</p>}
        <Link to="/jobs" className="btn">
          Back to job cards
        </Link>
      </div>
    );
  }
  if (parts.isError) return <div className="notice">{errorText(parts.error)}</div>;
  return <Editor key={id ?? "new"} detail={id ? detail.data : undefined} parts={parts.data.items} />;
}

function Editor({ detail, parts }: { detail?: JobDetail; parts: Part[] }) {
  const fmt = useMoney();
  const me = useMe();
  const desk = isDesk(me.data);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const original = detail?.job;
  const [draft, setDraft] = useState<Job>(() => (original ? structuredClone(original) : blankJob()));
  const [customer, setCustomer] = useState<Pick<Customer, "id" | "name" | "phone"> | null>(() => detail?.customer ?? null);
  const [newCustomer, setNewCustomer] = useState<NewCustomer | null>(null);
  const [newVehicle, setNewVehicle] = useState<NewVehicle | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState(() => (location.state as { saved?: boolean } | null)?.saved === true);
  const [pkg, setPkg] = useState("");
  const [partPick, setPartPick] = useState("");

  const vehiclesQ = useQuery({
    queryKey: ["customer", draft.customerId],
    queryFn: () => api<{ vehicles: Vehicle[] }>(`/customers/${encodeURIComponent(draft.customerId)}`),
    enabled: !!draft.customerId,
  });
  const customerVehicles = vehiclesQ.data?.vehicles ?? detail?.customerVehicles ?? [];
  const partsById = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts]);
  const invoiced = !!original?.invoice;
  const locked = invoiced || !desk;

  const refresh = (job: Job) => {
    void qc.invalidateQueries({ queryKey: ["job", job.id] });
    void qc.invalidateQueries({ queryKey: ["jobs"] });
    void qc.invalidateQueries({ queryKey: ["board"] });
    void qc.invalidateQueries({ queryKey: ["meta"] });
    void qc.invalidateQueries({ queryKey: ["parts"] });
  };

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      original ? api<Job>(`/jobs/${original.id}`, { method: "PUT", body: { ...body, version: original.version } }) : api<Job>("/jobs", { method: "POST", body }),
    onSuccess: (job) => {
      refresh(job);
      setNewCustomer(null);
      setNewVehicle(null);
      setSaved(true);
      if (!original) navigate(`/jobs/${job.id}`, { replace: true, state: { saved: true } });
    },
    onError: (e) => setErrors(e instanceof ApiError && Object.keys(e.details).length ? [...new Set(Object.values(e.details))] : [errorText(e)]),
  });
  const pay = useMutation({
    mutationFn: (method: PaymentMethod) => api<Job>(`/jobs/${original!.id}/payment`, { method: "POST", body: { method } }),
    onSuccess: refresh,
  });
  const reopen = useMutation({
    mutationFn: (reason: string) => api<Job>(`/jobs/${original!.id}/reopen`, { method: "POST", body: { reason } }),
    onSuccess: refresh,
  });

  const set = (patch: Partial<Job>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setSaved(false);
  };
  const setLabour = (i: number, patch: Partial<LabourLine>) => set({ labour: draft.labour.map((l, k) => (k === i ? { ...l, ...patch } : l)) });
  const setPart = (i: number, patch: Partial<PartLine>) => set({ parts: draft.parts.map((p, k) => (k === i ? { ...p, ...patch } : p)) });

  function addPackage(name: string) {
    const p = SERVICE_PACKAGES.find((x) => x.name === name);
    if (!p) return;
    const bySku = new Map(parts.map((x) => [x.sku, x]));
    const extraParts: PartLine[] = p.parts.flatMap(([sku, qty]) => {
      const part = bySku.get(sku);
      return part ? [{ id: lineId(), partId: part.id, description: part.name, qty, unitPriceCents: part.priceCents, unitCostCents: part.costCents }] : [];
    });
    set({
      labour: [...draft.labour, { id: lineId(), description: p.name, hours: p.hours, rateCents: SETTINGS.labourRateCents }],
      parts: [...draft.parts, ...extraParts],
      complaint: draft.complaint || p.name,
    });
  }

  function addStockPart(partId: string) {
    const part = partsById.get(partId);
    if (!part) return;
    set({ parts: [...draft.parts, { id: lineId(), partId, description: part.name, qty: 1, unitPriceCents: part.priceCents, unitCostCents: part.costCents }] });
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
    save.mutate({
      customerId: newCustomer ? undefined : draft.customerId,
      vehicleId: newVehicle ? undefined : draft.vehicleId,
      newCustomer: newCustomer ? { name: newCustomer.name.trim(), phone: newCustomer.phone.trim(), email: newCustomer.email.trim() } : undefined,
      newVehicle: newVehicle ? { ...newVehicle, plate: newVehicle.plate.trim(), make: newVehicle.make.trim(), model: newVehicle.model.trim() } : undefined,
      bookedFor: draft.bookedFor,
      complaint: draft.complaint.trim(),
      notes: draft.notes.trim(),
      mileageIn: draft.mileageIn,
      status: draft.status,
      technicianId: draft.technicianId ?? null,
      labour: draft.labour.map((l) => ({ description: l.description.trim(), hours: Math.round(l.hours * 100) / 100, rateCents: l.rateCents })),
      parts: draft.parts.map((p) => ({ partId: p.partId ?? null, description: p.description.trim(), qty: p.qty, unitPriceCents: p.unitPriceCents, unitCostCents: p.unitCostCents })),
      discountCents: draft.discountCents,
    });
  }

  const totals = jobTotals(draft, original?.invoice?.taxPercent ?? SETTINGS.taxPercent);
  const vehicle = customerVehicles.find((v) => v.id === draft.vehicleId) ?? detail?.vehicle;

  return (
    <form onSubmit={submit} noValidate>
      <div className="page-head">
        <h1>{original ? `Job ${original.number}` : "New job card"}</h1>
        {original && <StatusBadge status={original.status} />}
        {vehicle && draft.vehicleId && <Plate plate={vehicle.plate} />}
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
      {invoiced && (
        <div className="notice" style={{ marginBottom: "1rem" }}>
          Invoice {original!.invoice!.number} {original!.invoice!.paidAt ? "has been paid" : "has been issued"}, so the work and prices are locked. You can still change the
          technician and internal notes.
        </div>
      )}
      {!desk && (
        <div className="notice" style={{ marginBottom: "1rem" }}>
          You can view this job card. Move it on the workshop board; the front desk edits work and prices.
        </div>
      )}

      <div className="detail-grid">
        <div className="stack">
          <section className="card stack">
            <h2 style={{ margin: 0 }}>Customer &amp; vehicle</h2>
            {customer && !newCustomer ? (
              <div className="row">
                <span>
                  <strong>{customer.name}</strong> · {customer.phone}
                </span>
                <span className="spacer" />
                {!locked && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      setCustomer(null);
                      set({ customerId: "", vehicleId: "" });
                    }}
                  >
                    Change
                  </button>
                )}
              </div>
            ) : newCustomer ? (
              <div className="form-grid">
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
                <div>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      setNewCustomer(null);
                      setNewVehicle(null);
                    }}
                  >
                    Pick an existing customer instead
                  </button>
                </div>
              </div>
            ) : (
              <CustomerPicker
                onPick={(c) => {
                  setCustomer(c);
                  set({ customerId: c.id, vehicleId: "" });
                }}
                onNew={() => {
                  setNewCustomer({ name: "", phone: "", email: "" });
                  set({ customerId: "", vehicleId: "" });
                  setNewVehicle({ plate: "", make: "", model: "", year: new Date().getFullYear() - 3, vin: "", mileage: 0 });
                }}
              />
            )}
            <div className="form-grid">
              <label>
                Vehicle
                <select
                  value={newVehicle ? NEW : draft.vehicleId}
                  disabled={locked || (!draft.customerId && !newCustomer)}
                  onChange={(e) => {
                    if (e.target.value === NEW) {
                      setNewVehicle({ plate: "", make: "", model: "", year: new Date().getFullYear() - 3, vin: "", mileage: 0 });
                      set({ vehicleId: "" });
                    } else {
                      setNewVehicle(null);
                      const v = customerVehicles.find((x) => x.id === e.target.value);
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
                  {(["plate", "make", "model"] as const).map((k) => (
                    <label key={k}>
                      {{ plate: "Plate", make: "Make", model: "Model" }[k]}
                      <input value={newVehicle[k]} onChange={(e) => setNewVehicle({ ...newVehicle, [k]: e.target.value })} />
                    </label>
                  ))}
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
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={!pkg}
                    onClick={() => {
                      addPackage(pkg);
                      setPkg("");
                    }}
                  >
                    Add package
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => set({ labour: [...draft.labour, { id: lineId(), description: "", hours: 1, rateCents: SETTINGS.labourRateCents }] })}>
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
                    {parts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.stock} in stock)
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={!partPick}
                    onClick={() => {
                      addStockPart(partPick);
                      setPartPick("");
                    }}
                  >
                    Add part
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => set({ parts: [...draft.parts, { id: lineId(), description: "", qty: 1, unitPriceCents: 0, unitCostCents: 0 }] })}>
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
                    const avail = p.partId && !invoiced ? available(p.partId) : null;
                    return (
                      <tr key={p.id}>
                        <td>
                          <input aria-label="Part description" value={p.description} disabled={locked} onChange={(e) => setPart(i, { description: e.target.value })} />
                          {avail !== null && avail < 0 && <div className="field-error">⚠ Only {avail + p.qty} in stock. Order more or set the job to "Waiting parts".</div>}
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
              <textarea value={draft.notes} disabled={!desk} onChange={(e) => set({ notes: e.target.value })} />
            </label>
          </section>
        </div>

        <div className="stack">
          <section className="card stack">
            <h2 style={{ margin: 0 }}>Booking</h2>
            <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <label>
                Booked for
                <input type="date" value={draft.bookedFor} disabled={locked} onChange={(e) => set({ bookedFor: e.target.value })} />
              </label>
              <label>
                Technician
                <select value={draft.technicianId ?? ""} disabled={!desk} onChange={(e) => set({ technicianId: e.target.value || undefined })}>
                  <option value="">Unassigned</option>
                  {TECHNICIANS.filter((t) => t.active || t.id === draft.technicianId).map((t) => (
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
            {draft.status === "Completed" && !invoiced && <p className="muted small" style={{ margin: 0 }}>Saving as Completed issues the invoice.</p>}
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
                  <input type="number" min={0} step={0.01} value={draft.discountCents / 100} disabled={locked} onChange={(e) => set({ discountCents: cents(e.target.value) })} style={{ width: 110, marginTop: 0 }} />
                </label>
              </span>
              <span>−{fmt(totals.discount)}</span>
              <span>Tax ({original?.invoice?.taxPercent ?? SETTINGS.taxPercent}%)</span>
              <span>{fmt(totals.tax)}</span>
              <span className="grand">Total</span>
              <span className="grand">{fmt(totals.total)}</span>
            </div>
            {desk && (
              <p className="muted small" style={{ margin: 0 }}>
                Gross profit {fmt(totals.grossProfit)} (parts cost {fmt(totals.partsCost)})
              </p>
            )}
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
          {saved && !save.isPending && errors.length === 0 && <div className="notice notice-good">Saved.</div>}
          {desk && (
            <button type="submit" className="btn btn-primary btn-block" disabled={save.isPending}>
              {save.isPending ? "Saving…" : original ? "Save job card" : "Create job card"}
            </button>
          )}

          {desk && original?.invoice && !original.invoice.paidAt && (
            <section className="card stack">
              <h3 style={{ margin: 0 }}>Invoice {original.invoice.number}</h3>
              <div className="row" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
                {PAYMENT_METHODS.map((m) => (
                  <button key={m} type="button" className="btn btn-sm btn-primary" disabled={pay.isPending} onClick={() => pay.mutate(m)}>
                    Paid by {m.toLowerCase()}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="btn btn-sm"
                disabled={reopen.isPending}
                onClick={() => {
                  const reason = window.prompt(`Reopen the job to change it? Invoice ${original.invoice!.number} will be voided and a new one issued when it's completed again.\n\nReason:`);
                  if (reason && reason.trim()) reopen.mutate(reason.trim());
                }}
              >
                Reopen job (void invoice)
              </button>
              {(pay.isError || reopen.isError) && <div className="field-error">{errorText(pay.error ?? reopen.error)}</div>}
            </section>
          )}

          {original && (
            <section className="card">
              <h3>History</h3>
              <ul className="small" style={{ margin: 0, paddingLeft: "1.1rem" }}>
                {original.statusHistory.map((e, i) => (
                  <li key={i}>
                    {e.status} · {fmtDate(e.at, true)}
                  </li>
                ))}
                {detail!.invoiceVoids.map((v) => (
                  <li key={v.number}>
                    <Link to={`/jobs/${original.id}/invoice?number=${encodeURIComponent(v.number)}`}>{v.number}</Link> voided · {fmtDate(v.voidedAt, true)} · {v.reason}
                  </li>
                ))}
                {original.invoice && (
                  <li>
                    Invoice {original.invoice.number} issued · {fmtDate(original.invoice.issuedAt, true)}
                  </li>
                )}
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

/** Type-ahead customer search: works the same with 50 customers or 50,000. */
function CustomerPicker({ onPick, onNew }: { onPick: (c: Pick<Customer, "id" | "name" | "phone">) => void; onNew: () => void }) {
  const [q, setQ] = useState("");
  const search = useDebounced(q.trim(), 250);
  const r = useQuery({
    queryKey: ["customer-search", search],
    queryFn: () => api<{ items: (Customer & { vehicles: { plate: string }[] })[] }>(`/customers?q=${encodeURIComponent(search)}&limit=8`),
    enabled: search.length >= 2,
  });
  return (
    <div className="stack" style={{ gap: "0.4rem" }}>
      <div className="row">
        <label style={{ flex: 1 }}>
          Customer
          <input type="search" placeholder="Search name, phone or plate…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        </label>
        <button type="button" className="btn btn-sm" style={{ alignSelf: "flex-end" }} onClick={onNew}>
          + New customer
        </button>
      </div>
      {search.length >= 2 && (
        <div className="picker-results" role="listbox" aria-label="Matching customers">
          {r.isPending && <div className="muted small">Searching…</div>}
          {r.data?.items.map((c) => (
            <button key={c.id} type="button" role="option" aria-selected={false} className="picker-item" onClick={() => onPick(c)}>
              <strong>{c.name}</strong> · {c.phone} <span className="muted">{c.vehicles.map((v) => v.plate).join(", ")}</span>
            </button>
          ))}
          {r.data && r.data.items.length === 0 && <div className="muted small">No match. Add them as a new customer.</div>}
        </div>
      )}
    </div>
  );
}
