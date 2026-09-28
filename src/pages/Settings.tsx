import { useEffect, useRef, useState, type FormEvent } from "react";
import { todayLocal } from "../lib/dates";
import { money } from "../lib/format";
import { fromCents, toCents } from "../lib/money";
import { isWorkshopData, newId, useStore } from "../store/store";
import type { Settings } from "../types";

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

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function SettingsPage() {
  const { data, saveSettings, saveTechnician, replaceData, resetDemo } = useStore();
  const [s, setS] = useState<Settings>(data.settings);
  const [rate, setRate] = useState(fromCents(data.settings.labourRateCents));
  const [errors, setErrors] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [techName, setTechName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // Keep the form in step when settings change elsewhere (restore, reset).
  useEffect(() => {
    setS(data.settings);
    setRate(fromCents(data.settings.labourRateCents));
  }, [data.settings]);

  function save(e: FormEvent) {
    e.preventDefault();
    const errs = validateSettings(s, rate);
    setErrors(errs);
    if (errs.length) return;
    saveSettings({ ...s, name: s.name.trim(), currency: s.currency.trim().toUpperCase(), labourRateCents: toCents(rate) });
    setMsg({ ok: true, text: "Settings saved. New labour lines use the new rate; existing jobs keep theirs." });
  }

  const field = (key: keyof Settings, label: string, type = "text") => (
    <label>
      {label}
      <input
        type={type}
        value={String(s[key])}
        onChange={(e) => setS({ ...s, [key]: type === "number" ? Number(e.target.value) : e.target.value })}
      />
    </label>
  );

  return (
    <>
      <div className="page-head">
        <h1>Settings</h1>
      </div>
      <div className="detail-grid">
        <form className="card stack" onSubmit={save} noValidate>
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
            Preview: {money(Number.isFinite(toCents(rate)) ? toCents(rate) : 0, s)} per hour
          </p>
          {errors.map((er) => (
            <div key={er} className="field-error">
              {er}
            </div>
          ))}
          <div>
            <button className="btn btn-primary" type="submit">
              Save settings
            </button>
          </div>
        </form>

        <div className="stack">
          <section className="card stack">
            <h2 style={{ margin: 0 }}>Technicians</h2>
            {data.technicians.map((t) => (
              <label key={t.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontWeight: 500 }}>
                <input type="checkbox" checked={t.active} onChange={(e) => saveTechnician({ ...t, active: e.target.checked })} />
                {t.name} {!t.active && <span className="muted">(inactive)</span>}
              </label>
            ))}
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                if (techName.trim().length < 2) return;
                saveTechnician({ id: newId("t"), name: techName.trim(), active: true });
                setTechName("");
              }}
            >
              <input aria-label="New technician name" placeholder="Name" value={techName} onChange={(e) => setTechName(e.target.value)} style={{ flex: 1, marginTop: 0 }} />
              <button className="btn btn-sm" type="submit" disabled={techName.trim().length < 2}>
                + Add
              </button>
            </form>
          </section>

          <section className="card stack">
            <h2 style={{ margin: 0 }}>Data</h2>
            <p className="muted small" style={{ margin: 0 }}>
              Everything is stored in this browser. Download a backup regularly.
            </p>
            <div className="row">
              <button className="btn" onClick={() => download(`workshop-backup-${todayLocal()}.json`, JSON.stringify(data))}>
                Download backup
              </button>
              <button className="btn" onClick={() => fileRef.current?.click()}>
                Restore…
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".json,application/json"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  try {
                    const parsed: unknown = JSON.parse(await f.text());
                    if (!isWorkshopData(parsed)) throw new Error("That file isn't a workshop backup.");
                    replaceData(parsed);
                    setS(parsed.settings);
                    setRate(fromCents(parsed.settings.labourRateCents));
                    setMsg({ ok: true, text: `Restored ${parsed.jobs.length} jobs and ${parsed.customers.length} customers.` });
                  } catch (err) {
                    setMsg({ ok: false, text: err instanceof Error ? err.message : "Couldn't read that file." });
                  }
                }}
              />
              <button
                className="btn btn-danger"
                onClick={() => {
                  if (window.confirm("Replace everything with fresh demo data?")) {
                    resetDemo();
                    setMsg({ ok: true, text: "Demo data regenerated." });
                  }
                }}
              >
                Reset demo
              </button>
            </div>
          </section>
          {msg && <div className={`notice ${msg.ok ? "notice-good" : ""}`}>{msg.text}</div>}
        </div>
      </div>
    </>
  );
}
