import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { isDesk, useMe } from "../api/auth";
import { api, ApiError, errorText } from "../api/client";
import { Plate, StatusBadge, useMoney } from "../components/ui";
import { fmtDate } from "../lib/format";
import type { JobRow } from "../../../shared/schemas";
import type { Customer, Vehicle } from "../types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateCustomer(c: Pick<Customer, "name" | "phone" | "email">): string[] {
  const e: string[] = [];
  if (c.name.trim().length < 2) e.push("Enter a name.");
  if (c.phone.replace(/\D/g, "").length < 7) e.push("Enter a phone number.");
  if (c.email.trim() && !EMAIL_RE.test(c.email.trim())) e.push("That email address doesn't look right.");
  return e;
}

interface CustomerData {
  customer: Customer;
  vehicles: Vehicle[];
  jobs: JobRow[];
  visits: number;
  spentCents: number;
}

const messages = (e: unknown) => (e instanceof ApiError && Object.keys(e.details).length ? [...new Set(Object.values(e.details))] : [errorText(e)]);

export function CustomerDetail() {
  const { id } = useParams();
  const isNew = id === "new";
  const q = useQuery({ queryKey: ["customer", id], queryFn: () => api<CustomerData>(`/customers/${encodeURIComponent(id!)}`), enabled: !isNew });
  if (!isNew && q.isPending) return <p className="muted">Loading…</p>;
  if (!isNew && q.isError) {
    const missing = q.error instanceof ApiError && q.error.status === 404;
    return (
      <div className="card empty">
        <h1>{missing ? "Customer not found" : "Couldn't load this customer"}</h1>
        {!missing && <p className="muted">{errorText(q.error)}</p>}
        <Link to="/customers" className="btn">
          Back to customers
        </Link>
      </div>
    );
  }
  return <Detail key={id} data={isNew ? undefined : q.data} />;
}

function Detail({ data }: { data?: CustomerData }) {
  const fmt = useMoney();
  const me = useMe();
  const desk = isDesk(me.data);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const isNew = !data;
  const [form, setForm] = useState(() => ({ name: data?.customer.name ?? "", phone: data?.customer.phone ?? "", email: data?.customer.email ?? "" }));
  const [errors, setErrors] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  const [vForm, setVForm] = useState<(Omit<Vehicle, "id" | "customerId"> & { id?: string }) | null>(null);
  const [vErrors, setVErrors] = useState<string[]>([]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["customer"] });
    void qc.invalidateQueries({ queryKey: ["customers"] });
  };
  const save = useMutation({
    mutationFn: () => (isNew ? api<Customer>("/customers", { method: "POST", body: form }) : api<Customer>(`/customers/${data.customer.id}`, { method: "PUT", body: form })),
    onSuccess: (c) => {
      refresh();
      setMsg("Saved.");
      if (isNew) navigate(`/customers/${c.id}`, { replace: true });
    },
    onError: (e) => setErrors(messages(e)),
  });
  const saveVehicle = useMutation({
    mutationFn: (v: NonNullable<typeof vForm>) => {
      const body = { plate: v.plate.trim(), make: v.make.trim(), model: v.model.trim(), year: v.year, vin: v.vin.trim(), mileage: v.mileage };
      return v.id ? api(`/vehicles/${v.id}`, { method: "PUT", body }) : api(`/customers/${data!.customer.id}/vehicles`, { method: "POST", body });
    },
    onSuccess: () => {
      refresh();
      setVForm(null);
    },
    onError: (e) => setVErrors(messages(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const errs = validateCustomer(form);
    setErrors(errs);
    setMsg("");
    if (!errs.length) save.mutate();
  }

  function submitVehicle(e: FormEvent) {
    e.preventDefault();
    if (!vForm) return;
    const errs: string[] = [];
    if (!vForm.plate.trim()) errs.push("Enter the plate.");
    if (!vForm.make.trim() || !vForm.model.trim()) errs.push("Enter make and model.");
    if (!(vForm.year >= 1950 && vForm.year <= new Date().getFullYear() + 1)) errs.push("Check the year.");
    if (!(vForm.mileage >= 0)) errs.push("Mileage can't be negative.");
    setVErrors(errs);
    if (!errs.length) saveVehicle.mutate(vForm);
  }

  const vehicles = data?.vehicles ?? [];
  const jobs = data?.jobs ?? [];

  return (
    <>
      <div className="page-head">
        <h1>{isNew ? "New customer" : form.name || "Customer"}</h1>
        <span className="spacer" />
        {!isNew && desk && (
          <Link to="/jobs/new" className="btn btn-sm">
            + New job card
          </Link>
        )}
        <Link to="/customers" className="btn btn-sm">
          All customers
        </Link>
      </div>
      <div className="detail-grid">
        <div className="stack">
          <form className="card stack" onSubmit={submit} noValidate>
            <h2 style={{ margin: 0 }}>Details</h2>
            <div className="form-grid">
              <label>
                Name
                <input value={form.name} disabled={!desk} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>
              <label>
                Phone
                <input type="tel" value={form.phone} disabled={!desk} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </label>
              <label>
                Email
                <input type="email" value={form.email} disabled={!desk} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </label>
            </div>
            {errors.map((er) => (
              <div key={er} className="field-error">
                {er}
              </div>
            ))}
            {msg && !errors.length && <div className="notice notice-good">{msg}</div>}
            {desk && (
              <div>
                <button className="btn btn-primary" type="submit" disabled={save.isPending}>
                  {isNew ? "Create customer" : "Save"}
                </button>
              </div>
            )}
          </form>

          {!isNew && (
            <section className="card">
              <h2>Service history</h2>
              <p className="muted small">
                {data.visits} visits · {fmt(data.spentCents)} invoiced
              </p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Job</th>
                      <th>Vehicle</th>
                      <th>Work</th>
                      <th>Status</th>
                      <th className="r">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((j) => (
                      <tr key={j.id}>
                        <td>{fmtDate(j.bookedFor)}</td>
                        <td>
                          <Link to={`/jobs/${j.id}`}>{j.number}</Link>
                        </td>
                        <td>
                          <Plate plate={j.vehicle.plate} />
                        </td>
                        <td style={{ whiteSpace: "normal" }}>{j.workSummary || j.complaint}</td>
                        <td>
                          <StatusBadge status={j.status} />
                        </td>
                        <td className="r">{fmt(j.totalCents)}</td>
                      </tr>
                    ))}
                    {jobs.length === 0 && (
                      <tr>
                        <td colSpan={6} className="muted">
                          No visits yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>

        {!isNew && (
          <section className="card stack">
            <div className="row">
              <h2 style={{ margin: 0 }}>Vehicles</h2>
              <span className="spacer" />
              {desk && (
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    setVErrors([]);
                    setVForm({ plate: "", make: "", model: "", year: new Date().getFullYear() - 3, vin: "", mileage: 0 });
                  }}
                >
                  + Add vehicle
                </button>
              )}
            </div>
            {vehicles.map((v) => (
              <div key={v.id} className="row" style={{ justifyContent: "space-between" }}>
                <span>
                  <Plate plate={v.plate} /> {v.year} {v.make} {v.model} <span className="muted small">· {v.mileage.toLocaleString("en-US")} mi</span>
                </span>
                {desk && (
                  <button
                    className="btn btn-sm"
                    onClick={() => {
                      setVErrors([]);
                      setVForm({ ...v });
                    }}
                  >
                    Edit
                  </button>
                )}
              </div>
            ))}
            {vehicles.length === 0 && <p className="muted">No vehicles yet.</p>}
            {vForm && (
              <form className="stack" onSubmit={submitVehicle} noValidate style={{ borderTop: "1px solid var(--border)", paddingTop: "0.8rem" }}>
                <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
                  <label>
                    Plate
                    <input value={vForm.plate} onChange={(e) => setVForm({ ...vForm, plate: e.target.value })} />
                  </label>
                  <label>
                    Year
                    <input type="number" value={vForm.year} onChange={(e) => setVForm({ ...vForm, year: Number(e.target.value) })} />
                  </label>
                  <label>
                    Make
                    <input value={vForm.make} onChange={(e) => setVForm({ ...vForm, make: e.target.value })} />
                  </label>
                  <label>
                    Model
                    <input value={vForm.model} onChange={(e) => setVForm({ ...vForm, model: e.target.value })} />
                  </label>
                  <label>
                    Mileage
                    <input type="number" min={0} value={vForm.mileage} onChange={(e) => setVForm({ ...vForm, mileage: Number(e.target.value) })} />
                  </label>
                  <label>
                    VIN
                    <input maxLength={17} value={vForm.vin} onChange={(e) => setVForm({ ...vForm, vin: e.target.value.toUpperCase() })} />
                  </label>
                </div>
                {vErrors.map((er) => (
                  <div key={er} className="field-error">
                    {er}
                  </div>
                ))}
                <div className="row">
                  <button className="btn btn-primary btn-sm" type="submit" disabled={saveVehicle.isPending}>
                    Save vehicle
                  </button>
                  <button className="btn btn-sm" type="button" onClick={() => setVForm(null)}>
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </section>
        )}
      </div>
    </>
  );
}
