import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMoney } from "../components/ui";
import { fmtDate } from "../lib/format";
import { jobTotals, labourLineCents, partLineCents } from "../lib/money";
import { useStore } from "../store/store";
import { PAYMENT_METHODS, type PaymentMethod } from "../types";

export function Invoice() {
  const { id } = useParams();
  const { data, markPaid } = useStore();
  const fmt = useMoney();
  const [method, setMethod] = useState<PaymentMethod>("Card");
  const job = data.jobs.find((j) => j.id === id);

  if (!job || !job.invoice) {
    return (
      <div className="card empty">
        <h1>No invoice yet</h1>
        <p className="muted">An invoice is issued when the job is marked Completed.</p>
        {job && (
          <Link to={`/jobs/${job.id}`} className="btn">
            Back to job
          </Link>
        )}
      </div>
    );
  }
  const s = data.settings;
  const customer = data.customers.find((c) => c.id === job.customerId);
  const vehicle = data.vehicles.find((v) => v.id === job.vehicleId);
  const t = jobTotals(job, s.taxPercent);
  const inv = job.invoice;

  return (
    <>
      <div className="page-head no-print">
        <Link to={`/jobs/${job.id}`} className="btn btn-sm">
          ← Job {job.number}
        </Link>
        <span className="spacer" />
        {!inv.paidAt && (
          <>
            <select aria-label="Payment method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} style={{ width: "auto", marginTop: 0 }}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
            <button className="btn btn-primary" onClick={() => markPaid(job.id, method)}>
              Mark as paid
            </button>
          </>
        )}
        <button className="btn" onClick={() => window.print()}>
          Print / save PDF
        </button>
      </div>

      <article className="invoice">
        <div className="row" style={{ alignItems: "start" }}>
          <div>
            <h1 style={{ margin: 0 }}>{s.name}</h1>
            <div style={{ color: "#475569" }}>
              {s.address}
              <br />
              {s.phone} · {s.email}
            </div>
          </div>
          <span className="spacer" />
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "1.4rem", fontWeight: 800 }}>INVOICE</div>
            <div>{inv.number}</div>
            <div style={{ color: "#475569" }}>{fmtDate(inv.issuedAt)}</div>
            {inv.paidAt ? (
              <span className="badge" style={{ background: "#e3f6e9", color: "#0a7d32" }}>
                ✓ PAID {fmtDate(inv.paidAt)} · {inv.method}
              </span>
            ) : (
              <span className="badge" style={{ background: "#fff3d6", color: "#9a5b00" }}>
                Payment due
              </span>
            )}
          </div>
        </div>

        <div className="row" style={{ margin: "1.5rem 0", alignItems: "start", gap: "2rem" }}>
          <div>
            <div style={{ fontSize: "0.75rem", color: "#64748b", fontWeight: 700 }}>BILL TO</div>
            <div>{customer?.name}</div>
            <div style={{ color: "#475569" }}>
              {customer?.phone}
              {customer?.email && <> · {customer.email}</>}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "0.75rem", color: "#64748b", fontWeight: 700 }}>VEHICLE</div>
            <div>
              {vehicle?.year} {vehicle?.make} {vehicle?.model} · {vehicle?.plate}
            </div>
            <div style={{ color: "#475569" }}>
              {job.mileageIn.toLocaleString("en-US")} mi · Job {job.number}
              {vehicle?.vin && <> · VIN {vehicle.vin}</>}
            </div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Description</th>
              <th className="r">Qty / hours</th>
              <th className="r">Unit</th>
              <th className="r">Amount</th>
            </tr>
          </thead>
          <tbody>
            {job.labour.map((l) => (
              <tr key={l.id}>
                <td>Labour: {l.description}</td>
                <td className="r">{l.hours.toFixed(1)} h</td>
                <td className="r">{fmt(l.rateCents)}</td>
                <td className="r">{fmt(labourLineCents(l))}</td>
              </tr>
            ))}
            {job.parts.map((p) => (
              <tr key={p.id}>
                <td>{p.description}</td>
                <td className="r">{p.qty}</td>
                <td className="r">{fmt(p.unitPriceCents)}</td>
                <td className="r">{fmt(partLineCents(p))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1rem" }}>
          <div className="totals" style={{ minWidth: 280 }}>
            <span>Subtotal</span>
            <span>{fmt(t.subtotal)}</span>
            {t.discount > 0 && (
              <>
                <span>Discount</span>
                <span>−{fmt(t.discount)}</span>
              </>
            )}
            <span>Tax ({s.taxPercent}%)</span>
            <span>{fmt(t.tax)}</span>
            <span className="grand">Total</span>
            <span className="grand">{fmt(t.total)}</span>
          </div>
        </div>
        <p style={{ color: "#64748b", fontSize: "0.85rem", marginTop: "2rem" }}>Thank you for your business. Parts carry a 12-month warranty.</p>
      </article>
    </>
  );
}
