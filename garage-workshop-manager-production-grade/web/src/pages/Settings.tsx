import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useMe, useMeta } from "../api/auth";
import { api, ApiError, errorText } from "../api/client";
import { TECHNICIANS } from "../config";
import { money } from "../lib/format";
import { fromCents, toCents } from "../lib/money";
import type { Role } from "../../../shared/schemas";
import type { Settings } from "../types";

const ROLES: { id: Role; label: string }[] = [
  { id: "admin", label: "Admin (everything, incl. users)" },
  { id: "advisor", label: "Service advisor (front desk)" },
  { id: "technician", label: "Technician (board only)" },
];

export function validateSettings(s: Settings, rate: string): string[] {
  const e: string[] = [];
  if (!s.name.trim()) e.push("Workshop name is required.");
  if (!(s.taxPercent >= 0 && s.taxPercent <= 50)) e.push("Tax must be between 0 and 50%.");
  if (!(toCents(rate) > 0)) e.push("Enter a labour rate above 0.");
  if (!(Number.isInteger(s.serviceIntervalMonths) && s.serviceIntervalMonths >= 1 && s.serviceIntervalMonths <= 36)) e.push("Service interval must be 1–36 months.");
  try {
    new Intl.NumberFormat(s.locale, { style: "currency", currency: s.currency });
  } catch {
    e.push(`"${s.currency}" / "${s.locale}" isn't a valid currency / locale (e.g. USD / en-US, PKR / en-PK, AED / en-AE).`);
  }
  return e;
}

export function SettingsPage() {
  const me = useMe();
  const meta = useMeta();
  if (me.data && me.data.role !== "admin") return <Navigate to="/" replace />;
  if (!meta.data) return <p className="muted">Loading…</p>;
  return (
    <>
      <div className="page-head">
        <h1>Settings &amp; users</h1>
      </div>
      <div className="detail-grid">
        {/* Not keyed on the settings: a save refreshes them, and remounting would hide the "saved" message. */}
        <WorkshopForm initial={meta.data.settings} />
        <div className="stack">
          <Technicians />
          <Users />
        </div>
      </div>
    </>
  );
}

function WorkshopForm({ initial }: { initial: Settings }) {
  const qc = useQueryClient();
  const [s, setS] = useState<Settings>(initial);
  const [rate, setRate] = useState(fromCents(initial.labourRateCents));
  const [errors, setErrors] = useState<string[]>([]);
  const save = useMutation({
    mutationFn: () => api<Settings>("/settings", { method: "PUT", body: { ...s, name: s.name.trim(), currency: s.currency.trim().toUpperCase(), labourRateCents: toCents(rate) } }),
    onSuccess: () => void qc.invalidateQueries(),
    onError: (e) => setErrors(e instanceof ApiError && Object.keys(e.details).length ? Object.entries(e.details).map(([k, v]) => `${k}: ${v}`) : [errorText(e)]),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const errs = validateSettings(s, rate);
    setErrors(errs);
    if (!errs.length) save.mutate();
  }

  const field = (key: keyof Settings, label: string, type = "text") => (
    <label>
      {label}
      <input type={type} value={String(s[key])} onChange={(e) => setS({ ...s, [key]: type === "number" ? Number(e.target.value) : e.target.value })} />
    </label>
  );

  return (
    <form className="card stack" onSubmit={submit} noValidate>
      <h2 style={{ margin: 0 }}>Workshop</h2>
      <div className="form-grid">
        {field("name", "Workshop name")}
        {field("phone", "Phone")}
        {field("email", "Email")}
        <label className="span-all">
          Address
          <input value={s.address} onChange={(e) => setS({ ...s, address: e.target.value })} />
        </label>
        {field("currency", "Currency code")}
        {field("locale", "Locale")}
        {field("taxPercent", "Tax %", "number")}
        <label>
          Labour rate per hour
          <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
        </label>
        {field("serviceIntervalMonths", "Service reminder (months)", "number")}
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Preview: {money(Number.isFinite(toCents(rate)) ? toCents(rate) : 0, s)} per hour. Issued invoices keep the tax rate they were issued with.
      </p>
      {errors.map((er) => (
        <div key={er} className="field-error">
          {er}
        </div>
      ))}
      {save.isSuccess && !errors.length && <div className="notice notice-good">Settings saved. New labour lines use the new rate; existing jobs keep theirs.</div>}
      <div>
        <button className="btn btn-primary" type="submit" disabled={save.isPending}>
          Save settings
        </button>
      </div>
    </form>
  );
}

function Technicians() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const saveTech = useMutation({
    mutationFn: (t: { id?: string; name: string; active: boolean }) =>
      t.id ? api(`/technicians/${t.id}`, { method: "PUT", body: { name: t.name, active: t.active } }) : api("/technicians", { method: "POST", body: { name: t.name, active: true } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["meta"] });
      setName("");
    },
  });
  return (
    <section className="card stack">
      <h2 style={{ margin: 0 }}>Technicians</h2>
      <p className="muted small" style={{ margin: 0 }}>
        People jobs are assigned to. Untick someone who has left; their past jobs keep their name.
      </p>
      {TECHNICIANS.map((t) => (
        <label key={t.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontWeight: 500 }}>
          <input type="checkbox" checked={t.active} onChange={(e) => saveTech.mutate({ ...t, active: e.target.checked })} />
          {t.name} {!t.active && <span className="muted">(inactive)</span>}
        </label>
      ))}
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim().length >= 2) saveTech.mutate({ name: name.trim(), active: true });
        }}
      >
        <input aria-label="New technician name" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1, marginTop: 0 }} />
        <button className="btn btn-sm" type="submit" disabled={name.trim().length < 2 || saveTech.isPending}>
          + Add
        </button>
      </form>
      {saveTech.isError && <div className="field-error">{errorText(saveTech.error)}</div>}
    </section>
  );
}

interface StaffUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  locked: boolean;
}

function Users() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["users"], queryFn: () => api<{ items: StaffUser[] }>("/users") });
  const [editing, setEditing] = useState<StaffUser | "new" | null>(null);
  return (
    <section className="card stack">
      <div className="row">
        <h2 style={{ margin: 0 }}>Staff logins</h2>
        <span className="spacer" />
        <button className="btn btn-primary btn-sm" onClick={() => setEditing("new")}>
          + Add user
        </button>
      </div>
      {q.isError && <div className="notice">{errorText(q.error)}</div>}
      {q.data?.items.map((u) => (
        <div key={u.id} className="row" style={{ justifyContent: "space-between" }}>
          <span>
            <strong>{u.name}</strong> <span className="muted small">{u.email} · {u.role}</span>{" "}
            {!u.active ? <span className="badge">Disabled</span> : u.locked ? <span className="badge badge-bad">Locked</span> : null}
          </span>
          <button className="btn btn-sm" onClick={() => setEditing(u)}>
            Edit
          </button>
        </div>
      ))}
      {editing && <UserDialog user={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => void qc.invalidateQueries({ queryKey: ["users"] })} />}
    </section>
  );
}

function UserDialog({ user, onClose, onSaved }: { user: StaffUser | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: user?.name ?? "", email: user?.email ?? "", role: user?.role ?? ("advisor" as Role), active: user?.active ?? true, password: "" });
  const [done, setDone] = useState("");
  const save = useMutation({
    mutationFn: async () => {
      if (!user) return api("/users", { method: "POST", body: { email: f.email, name: f.name, role: f.role, password: f.password } });
      await api(`/users/${user.id}`, { method: "PUT", body: { name: f.name, role: f.role, active: f.active } });
      if (f.password) await api(`/users/${user.id}/password`, { method: "POST", body: { password: f.password } });
    },
    onSuccess: () => {
      onSaved();
      if (user && f.password) setDone("Saved. The new password is active and their other sessions were signed out.");
      else onClose();
    },
  });
  const errs = save.error instanceof ApiError ? save.error.details : {};
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={user ? "Edit user" : "Add user"} onClick={onClose}>
      <form
        className="card modal stack"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
        noValidate
      >
        <h2 style={{ margin: 0 }}>{user ? `Edit ${user.name}` : "Add user"}</h2>
        <label>
          Name
          <input value={f.name} onChange={(e) => set("name", e.target.value)} />
          {errs.name && <div className="field-error">{errs.name}</div>}
        </label>
        <label>
          Email
          <input type="email" value={f.email} disabled={!!user} onChange={(e) => set("email", e.target.value)} />
          {errs.email && <div className="field-error">{errs.email}</div>}
        </label>
        <label>
          Role
          <select value={f.role} onChange={(e) => set("role", e.target.value)}>
            {ROLES.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          {user ? "New password (leave blank to keep)" : "Password"}
          <input type="password" autoComplete="new-password" value={f.password} onChange={(e) => set("password", e.target.value)} />
          <span className="muted small">At least 10 characters with letters and a number.</span>
          {errs.password && <div className="field-error">{errs.password}</div>}
        </label>
        {user && (
          <label style={{ display: "flex", alignItems: "center" }}>
            <input type="checkbox" checked={f.active} onChange={(e) => set("active", e.target.checked)} /> Active (untick when someone leaves)
          </label>
        )}
        {save.isError && !Object.keys(errs).length && <div className="field-error">{errorText(save.error)}</div>}
        {done && <div className="notice notice-good">{done}</div>}
        <div className="row">
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button type="submit" className="btn btn-primary" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
