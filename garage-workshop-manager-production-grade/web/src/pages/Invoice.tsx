import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { isDesk, useMe } from "../api/auth";
import { api, ApiError, errorText } from "../api/client";
import { fmtDate } from "../lib/format";
import { money } from "../lib/format";
import type { InvoiceDoc } from "../../../shared/schemas";
import { PAYMENT_METHODS, type PaymentMethod } from "../types";

/** The invoice exactly as issued (a frozen copy), ready to print or save as PDF. */
export function Invoice() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const number = params.get("number");
  const me = useMe();
  const qc = useQueryClient();
  const [method, setMethod] = useState<PaymentMethod>("Card");
  const key = ["invoice", id, number];
  const q = useQuery({
    queryKey: key,
    queryFn: () => api<InvoiceDoc>(`/jobs/${encodeURIComponent(id!)}/invoice${number ? `?number=${encodeURIComponent(number)}` : ""}`),
  });
  const pay = useMutation({
    mutationFn: () => api(`/jobs/${id}/payment`, { method: "POST", body: { method } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["invoice", id] });
      void qc.invalidateQueries({ queryKey: ["job", id] });
      void qc.invalidateQueries({ queryKey: ["jobs"] });
      void qc.invalidateQueries({ queryKey: ["meta"] });
      void qc.invalidateQueries({ queryKey: ["board"] });
    },
  });

  if (q.isPending) return <p className="muted">Loading…</p>;
  if (q.isError) {
    const missing = q.error instanceof ApiError && q.error.status === 404;
    return (
      <div className="card empty">
        <h1>{missing ? "No invoice yet" : "Couldn't load the invoice"}</h1>
        <p className="muted">{missing ? "An invoice is issued when the job is marked Completed." : errorText(q.error)}</p>
        <Link to={`/jobs/${id}`} className="btn">
          Back to job
        </Link>
      </div>
    );
  }
  const inv = q.data;
  const w = inv.workshop;
  const fmt = (c: number) => money(c, w);

  return (
    <>
      <div className="page-head no-print">
        <Link to={`/jobs/${id}`} className="btn btn-sm">
          ← Job {inv.jobNumber}
        </Link>
        <span className="spacer" />
        {isDesk(me.data) && !inv.paidAt && !inv.voidedAt && (
          <>
            <select aria-label="Payment method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} style={{ width: "auto", marginTop: 0 }}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
            <button className="btn btn-primary" disabled={pay.isPending} onClick={() => pay.mutate()}>
              Mark as paid
            </button>
          </>
        )}
        <button className="btn" onClick={() => window.print()}>
          Print / save PDF
        </button>
      </div>
      {pay.isError && <div className="notice no-print">{errorText(pay.error)}</div>}

      <article className="invoice">
        {inv.voidedAt && (
          <div className="notice" style={{ marginBottom: "1rem" }}>
            VOID — cancelled {fmtDate(inv.voidedAt)}: {inv.voidReason}
          </div>
        )}
        <div className="row" style={{ alignItems: "start" }}>
          <div>
            <h1 style={{ margin: 0 }}>{w.name}</h1>
            <div style={{ color: "#475569" }}>
              {w.address}
              <br />
              {w.phone} · {w.email}
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
            ) : !inv.voidedAt ? (
              <span className="badge" style={{ background: "#fff3d6", color: "#9a5b00" }}>
                Payment due
              </span>
            ) : null}
          </div>
        </div>

        <div className="row" style={{ margin: "1.5rem 0", alignItems: "start", gap: "2rem" }}>
          <div>
            <div style={{ fontSize: "0.75rem", color: "#64748b", fontWeight: 700 }}>BILL TO</div>
            <div>{inv.customer.name}</div>
            <div style={{ color: "#475569" }}>
              {inv.customer.phone}
              {inv.customer.email && <> · {inv.customer.email}</>}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "0.75rem", color: "#64748b", fontWeight: 700 }}>VEHICLE</div>
            <div>
              {inv.vehicle.year} {inv.vehicle.make} {inv.vehicle.model} · {inv.vehicle.plate}
            </div>
            <div style={{ color: "#475569" }}>
              {inv.vehicle.mileageIn.toLocaleString(w.locale)} mi · Job {inv.jobNumber}
              {inv.vehicle.vin && <> · VIN {inv.vehicle.vin}</>}
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
            {inv.lines.map((l, i) => (
              <tr key={i}>
                <td>{l.kind === "labour" ? `Labour: ${l.description}` : l.description}</td>
                <td className="r">{l.kind === "labour" ? `${l.qty.toFixed(1)} h` : l.qty}</td>
                <td className="r">{fmt(l.unitCents)}</td>
                <td className="r">{fmt(l.amountCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1rem" }}>
          <div className="totals" style={{ minWidth: 280 }}>
            <span>Subtotal</span>
            <span>{fmt(inv.labourCents + inv.partsCents)}</span>
            {inv.discountCents > 0 && (
              <>
                <span>Discount</span>
                <span>−{fmt(inv.discountCents)}</span>
              </>
            )}
            <span>Tax ({inv.taxPercent}%)</span>
            <span>{fmt(inv.taxCents)}</span>
            <span className="grand">Total</span>
            <span className="grand">{fmt(inv.totalCents)}</span>
          </div>
        </div>
        <p style={{ color: "#64748b", fontSize: "0.85rem", marginTop: "2rem" }}>Thank you for your business. Parts carry a 12-month warranty.</p>
      </article>
    </>
  );
}
