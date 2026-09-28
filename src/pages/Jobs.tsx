import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Plate, StatusBadge, useMoney } from "../components/ui";
import { fmtDate } from "../lib/format";
import { jobTotals } from "../lib/money";
import { useStore } from "../store/store";
import { JOB_STATUSES } from "../types";

export function Jobs() {
  const { data } = useStore();
  const fmt = useMoney();
  const [params, setParams] = useSearchParams();
  const filter = params.get("filter") ?? "";
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(100);
  const vehicles = useMemo(() => new Map(data.vehicles.map((v) => [v.id, v])), [data.vehicles]);
  const customers = useMemo(() => new Map(data.customers.map((c) => [c.id, c])), [data.customers]);

  const rows = useMemo(() => {
    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    return data.jobs
      .filter((j) => {
        if (filter === "unpaid") return !!j.invoice && !j.invoice.paidAt;
        if (filter && j.status !== filter) return false;
        return true;
      })
      .filter((j) => {
        if (!tokens.length) return true;
        const v = vehicles.get(j.vehicleId);
        const h = `${j.number} ${j.invoice?.number ?? ""} ${v?.plate ?? ""} ${v?.make ?? ""} ${v?.model ?? ""} ${customers.get(j.customerId)?.name ?? ""} ${j.complaint}`.toLowerCase();
        return tokens.every((t) => h.includes(t));
      })
      .sort((a, b) => b.bookedFor.localeCompare(a.bookedFor) || b.number.localeCompare(a.number));
  }, [data.jobs, filter, q, vehicles, customers]);

  return (
    <>
      <div className="page-head">
        <h1>Job cards</h1>
        <span className="spacer" />
        <Link to="/jobs/new" className="btn btn-primary">
          + New job card
        </Link>
      </div>
      <div className="filter-bar">
        <label>
          Show
          <select
            value={filter}
            onChange={(e) => {
              setLimit(100);
              setParams(e.target.value ? { filter: e.target.value } : {}, { replace: true });
            }}
          >
            <option value="">All jobs</option>
            <option value="unpaid">Unpaid invoices</option>
            {JOB_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label style={{ flex: 1, minWidth: 220 }}>
          Search
          <input type="search" placeholder="Job, invoice, plate, customer, car…" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      <p className="muted small">{rows.length} jobs</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Job</th>
              <th>Date</th>
              <th>Vehicle</th>
              <th>Customer</th>
              <th>Status</th>
              <th>Invoice</th>
              <th className="r">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((j) => {
              const v = vehicles.get(j.vehicleId);
              return (
                <tr key={j.id}>
                  <td>
                    <Link to={`/jobs/${j.id}`}>{j.number}</Link>
                  </td>
                  <td>{fmtDate(j.bookedFor)}</td>
                  <td>
                    {v && <Plate plate={v.plate} />} {v?.make} {v?.model}
                  </td>
                  <td>{customers.get(j.customerId)?.name}</td>
                  <td>
                    <StatusBadge status={j.status} />
                  </td>
                  <td>
                    {j.invoice ? (
                      <Link to={`/jobs/${j.id}/invoice`}>
                        {j.invoice.number} {j.invoice.paidAt ? <span className="badge badge-good">Paid</span> : <span className="badge badge-warn">Unpaid</span>}
                      </Link>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="r">{fmt(jobTotals(j, data.settings.taxPercent).total)}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="muted" style={{ textAlign: "center", padding: "2rem" }}>
                  No jobs match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.length > limit && (
        <div style={{ textAlign: "center", marginTop: "1rem" }}>
          <button className="btn" onClick={() => setLimit((l) => l + 100)}>
            Show more ({rows.length - limit} left)
          </button>
        </div>
      )}
    </>
  );
}
