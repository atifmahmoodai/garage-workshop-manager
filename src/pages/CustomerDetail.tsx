import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Plate, StatusBadge, useMoney } from "../components/ui";
import { fmtDate } from "../lib/format";
import { jobTotals } from "../lib/money";
import { newId, useStore } from "../store/store";
import type { Customer, Vehicle } from "../types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateCustomer(c: Pick<Customer, "name" | "phone" | "email">): string[] {
  const e: string[] = [];
  if (c.name.trim().length < 2) e.push("Enter a name.");
  if (c.phone.replace(/\D/g, "").length < 7) e.push("Enter a phone number.");
  if (c.email.trim() && !EMAIL_RE.test(c.email.trim())) e.push("That email address doesn't look right.");
  return e;
}

export function CustomerDetail() {
  const { id } = useParams();
  return <Detail key={id} id={id!} />;
}

function Detail({ id }: { id: string }) {
  const { data, saveCustomer, saveVehicle } = useStore();
  const fmt = useMoney();
  const navigate = useNavigate();
  const isNew = id === "new";
  const existing = data.customers.find((c) => c.id === id);
  const [form, setForm] = useState<Customer>(() => existing ?? { id: newId("c"), name: "", phone: "", email: "" });
  const [errors, setErrors] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  const [vForm, setVForm] = useState<Vehicle | null>(null);
  const [vErrors, setVErrors] = useState<string[]>([]);

  if (!isNew && !existing) {
    return (
      <div className="card empty">
        <h1>Customer not found</h1>
        <Link to="/customers" className="btn">
          Back to customers
        </Link>
      </div>
    );
  }

  const vehicles = data.vehicles.filter((v) => v.customerId === form.id);
  const jobs = data.jobs.filter((j) => j.customerId === form.id).sort((a, b) => b.bookedFor.localeCompare(a.bookedFor));
  const spent = jobs.filter((j) => j.invoice).reduce((s, j) => s + jobTotals(j, data.settings.taxPercent).total, 0);

  function save(e: FormEvent) {
    e.preventDefault();
    const errs = validateCustomer(form);
    setErrors(errs);
    if (errs.length) return;
    saveCustomer({ ...form, name: form.name.trim(), phone: form.phone.trim(), email: form.email.trim() });
    setMsg("Saved.");
    if (isNew) navigate(`/customers/${form.id}`, { replace: true });
  }

  function saveV(e: FormEvent) {
    e.preventDefault();
    if (!vForm) return;
    const errs: string[] = [];
    if (!vForm.plate.trim()) errs.push("Enter the plate.");
    if (!vForm.make.trim() || !vForm.model.trim()) errs.push("Enter make and model.");
    if (!(vForm.year >= 1950 && vForm.year <= new Date().getFullYear() + 1)) errs.push("Check the year.");
    if (!(vForm.mileage >= 0)) errs.push("Mileage can't be negative.");
    const dup = data.vehicles.find((v) => v.id !== vForm.id && v.plate.replace(/\s/g, "").toUpperCase() === vForm.plate.replace(/\s/g, "").toUpperCase());
    if (dup) errs.push(`Plate ${dup.plate} is already on file.`);
    setVErrors(errs);
    if (errs.length) return;
    saveVehicle({ ...vForm, plate: vForm.plate.trim().toUpperCase(), make: vForm.make.trim(), model: vForm.model.trim() });
    setVForm(null);
  }

  return (
    <>
      <div className="page-head">
        <h1>{isNew ? "New customer" : form.name || "Customer"}</h1>
        <span className="spacer" />
        {!isNew && (
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
          <form className="card stack" onSubmit={save} noValidate>
            <h2 style={{ margin: 0 }}>Details</h2>
            <div className="form-grid">
              <label>
                Name
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>
              <label>
                Phone
                <input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </label>
              <label>
                Email
                <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </label>
            </div>
            {errors.map((er) => (
              <div key={er} className="field-error">
                {er}
              </div>
            ))}
            {msg && !errors.length && <div className="notice notice-good">{msg}</div>}
            <div>
              <button className="btn btn-primary" type="submit">
                {isNew ? "Create customer" : "Save"}
              </button>
            </div>
          </form>

          {!isNew && (
            <section className="card">
              <h2>Service history</h2>
              <p className="muted small">
                {jobs.length} visits · {fmt(spent)} invoiced
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
                    {jobs.map((j) => {
                      const v = data.vehicles.find((x) => x.id === j.vehicleId);
                      return (
                        <tr key={j.id}>
                          <td>{fmtDate(j.bookedFor)}</td>
                          <td>
                            <Link to={`/jobs/${j.id}`}>{j.number}</Link>
                          </td>
                          <td>{v && <Plate plate={v.plate} />}</td>
                          <td style={{ whiteSpace: "normal" }}>{j.labour.map((l) => l.description).join(", ") || j.complaint}</td>
                          <td>
                            <StatusBadge status={j.status} />
                          </td>
                          <td className="r">{fmt(jobTotals(j, data.settings.taxPercent).total)}</td>
                        </tr>
                      );
                    })}
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
              <button
                className="btn btn-sm"
                onClick={() => {
                  setVErrors([]);
                  setVForm({ id: newId("v"), customerId: form.id, plate: "", make: "", model: "", year: new Date().getFullYear() - 3, vin: "", mileage: 0 });
                }}
              >
                + Add vehicle
              </button>
            </div>
            {vehicles.map((v) => (
              <div key={v.id} className="row" style={{ justifyContent: "space-between" }}>
                <span>
                  <Plate plate={v.plate} /> {v.year} {v.make} {v.model} <span className="muted small">· {v.mileage.toLocaleString("en-US")} mi</span>
                </span>
                <button className="btn btn-sm" onClick={() => { setVErrors([]); setVForm({ ...v }); }}>
                  Edit
                </button>
              </div>
            ))}
            {vehicles.length === 0 && <p className="muted">No vehicles yet.</p>}
            {vForm && (
              <form className="stack" onSubmit={saveV} noValidate style={{ borderTop: "1px solid var(--border)", paddingTop: "0.8rem" }}>
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
                  <button className="btn btn-primary btn-sm" type="submit">
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
