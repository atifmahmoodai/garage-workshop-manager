import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plate } from "../components/ui";
import { completedOn, servicesDue } from "../lib/analytics";
import { todayLocal } from "../lib/dates";
import { fmtDate } from "../lib/format";
import { useStore } from "../store/store";

export function Customers() {
  const { data } = useStore();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"all" | "due">("all");
  const today = todayLocal();
  const due = useMemo(() => servicesDue(data, today), [data, today]);

  const lastVisit = useMemo(() => {
    const m = new Map<string, string>();
    for (const j of data.jobs) {
      const d = completedOn(j);
      if (d && (!m.has(j.customerId) || d > m.get(j.customerId)!)) m.set(j.customerId, d);
    }
    return m;
  }, [data.jobs]);

  const rows = useMemo(() => {
    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    return data.customers
      .map((c) => ({ c, vehicles: data.vehicles.filter((v) => v.customerId === c.id) }))
      .filter(({ c, vehicles }) => {
        const h = `${c.name} ${c.phone} ${c.email} ${vehicles.map((v) => `${v.plate} ${v.make} ${v.model}`).join(" ")}`.toLowerCase();
        return tokens.every((t) => h.includes(t) || h.replace(/\s/g, "").includes(t));
      })
      .sort((a, b) => a.c.name.localeCompare(b.c.name));
  }, [data.customers, data.vehicles, q]);

  return (
    <>
      <div className="page-head">
        <h1>Customers</h1>
        <span className="spacer" />
        <Link to="/customers/new" className="btn btn-primary">
          + Add customer
        </Link>
      </div>
      <div className="tabs" role="tablist" style={{ maxWidth: 380, marginBottom: "1rem" }}>
        <button role="tab" aria-selected={tab === "all"} onClick={() => setTab("all")}>
          All customers ({data.customers.length})
        </button>
        <button role="tab" aria-selected={tab === "due"} onClick={() => setTab("due")}>
          Service due ({due.length})
        </button>
      </div>

      {tab === "all" ? (
        <>
          <div className="filter-bar">
            <label style={{ flex: 1, minWidth: 220 }}>
              Search
              <input type="search" placeholder="Name, phone, plate, car…" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Phone</th>
                  <th>Vehicles</th>
                  <th>Last visit</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 200).map(({ c, vehicles }) => (
                  <tr key={c.id}>
                    <td>
                      <Link to={`/customers/${c.id}`}>{c.name}</Link>
                    </td>
                    <td>{c.phone}</td>
                    <td>
                      {vehicles.map((v) => (
                        <span key={v.id} style={{ marginRight: "0.5rem" }}>
                          <Plate plate={v.plate} /> {v.make} {v.model}
                        </span>
                      ))}
                    </td>
                    <td>{lastVisit.has(c.id) ? fmtDate(lastVisit.get(c.id)!) : <span className="muted">—</span>}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted" style={{ textAlign: "center", padding: "2rem" }}>
                      No customers match.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          <p className="muted small">
            Vehicles whose last service was over {data.settings.serviceIntervalMonths} months ago, or will be within 30 days, and that aren't already booked in. Call or
            message them to book.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Vehicle</th>
                  <th>Customer</th>
                  <th>Phone</th>
                  <th>Last service</th>
                  <th>Due</th>
                </tr>
              </thead>
              <tbody>
                {due.map((d) => (
                  <tr key={d.vehicle.id}>
                    <td>
                      <Plate plate={d.vehicle.plate} /> {d.vehicle.year} {d.vehicle.make} {d.vehicle.model}
                    </td>
                    <td>{d.customer && <Link to={`/customers/${d.customer.id}`}>{d.customer.name}</Link>}</td>
                    <td>{d.customer?.phone && <a href={`tel:${d.customer.phone.replace(/[^\d+]/g, "")}`}>{d.customer.phone}</a>}</td>
                    <td>{fmtDate(d.lastService)}</td>
                    <td>
                      {d.overdueDays > 0 ? <span className="badge badge-warn">⚠ {d.overdueDays} days overdue</span> : <span className="badge">{fmtDate(d.due)}</span>}
                    </td>
                  </tr>
                ))}
                {due.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted" style={{ textAlign: "center", padding: "2rem" }}>
                      Nobody is due for a service in the next 30 days.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
