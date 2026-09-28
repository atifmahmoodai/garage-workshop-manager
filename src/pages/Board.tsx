import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Kpi, Plate, StatusBadge, useMoney } from "../components/ui";
import { lowStock, lastEventAt } from "../lib/analytics";
import { addDays, todayLocal } from "../lib/dates";
import { fmtDate } from "../lib/format";
import { jobTotals } from "../lib/money";
import { useStore } from "../store/store";
import { BOARD_STATUSES, type Job, type JobStatus } from "../types";

const NEXT: Partial<Record<JobStatus, JobStatus>> = {
  Booked: "In progress",
  "In progress": "Ready",
  "Waiting parts": "In progress",
  Ready: "Completed",
};
const NEXT_LABEL: Partial<Record<JobStatus, string>> = {
  Booked: "Check in",
  "In progress": "Mark ready",
  "Waiting parts": "Parts arrived",
  Ready: "Collected",
};

export function Board() {
  const { data, setStatus } = useStore();
  const fmt = useMoney();
  const today = todayLocal();
  const vehicles = useMemo(() => new Map(data.vehicles.map((v) => [v.id, v])), [data.vehicles]);
  const customers = useMemo(() => new Map(data.customers.map((c) => [c.id, c])), [data.customers]);
  const techs = useMemo(() => new Map(data.technicians.map((t) => [t.id, t.name])), [data.technicians]);

  // Everything in the building, plus today's (and overdue) bookings.
  const onBoard = data.jobs.filter((j) => BOARD_STATUSES.includes(j.status) && (j.status !== "Booked" || j.bookedFor <= today));
  const upcoming = data.jobs
    .filter((j) => j.status === "Booked" && j.bookedFor > today && j.bookedFor <= addDays(today, 7))
    .sort((a, b) => a.bookedFor.localeCompare(b.bookedFor));
  const ready = onBoard.filter((j) => j.status === "Ready");
  const readyValue = ready.reduce((s, j) => s + jobTotals(j, data.settings.taxPercent).total, 0);
  const low = lowStock(data);
  const unpaid = data.jobs.filter((j) => j.invoice && !j.invoice.paidAt);

  const card = (j: Job) => {
    const v = vehicles.get(j.vehicleId);
    const c = customers.get(j.customerId);
    const overdue = j.status === "Booked" && j.bookedFor < today;
    const next = NEXT[j.status];
    return (
      <div key={j.id} className="job-card">
        <div className="row" style={{ gap: "0.4rem" }}>
          <Link to={`/jobs/${j.id}`}>
            <strong>{j.number}</strong>
          </Link>
          {v && <Plate plate={v.plate} />}
          <span className="spacer" />
          {overdue && <span className="badge badge-bad">⚠ booked {fmtDate(j.bookedFor)}</span>}
        </div>
        <div>
          {v ? `${v.year} ${v.make} ${v.model}` : "Unknown vehicle"} · <span className="muted">{c?.name}</span>
        </div>
        <div className="muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={j.complaint}>
          {j.complaint || "No description"}
        </div>
        <div className="row small" style={{ gap: "0.4rem" }}>
          <span className="muted">{j.technicianId ? techs.get(j.technicianId) : "No technician"}</span>
          <span className="spacer" />
          {j.status === "In progress" && (
            <button className="btn btn-sm" onClick={() => setStatus(j.id, "Waiting parts")}>
              Waiting parts
            </button>
          )}
          {next && (
            <button className="btn btn-sm btn-primary" onClick={() => setStatus(j.id, next)}>
              {NEXT_LABEL[j.status]}
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="page-head">
        <h1>Workshop board</h1>
        <span className="muted">{fmtDate(today)}</span>
        <span className="spacer" />
        <Link to="/jobs/new" className="btn btn-primary">
          + New job card
        </Link>
      </div>

      <div className="kpi-grid">
        <Kpi label="Cars in the workshop" value={String(onBoard.filter((j) => j.status !== "Booked").length)} sub={`${onBoard.filter((j) => j.status === "Booked").length} still to check in today`} />
        <Kpi label="Ready for collection" value={String(ready.length)} sub={`${fmt(readyValue)} to collect`} />
        <Kpi label="Waiting for parts" value={String(onBoard.filter((j) => j.status === "Waiting parts").length)} />
        <Kpi
          label="Unpaid invoices"
          value={String(unpaid.length)}
          sub={unpaid.length ? <Link to="/jobs?filter=unpaid">{fmt(unpaid.reduce((s, j) => s + jobTotals(j, data.settings.taxPercent).total, 0))} outstanding</Link> : "all paid"}
        />
        <Kpi
          label="Parts to reorder"
          value={String(low.length)}
          sub={low.length ? <Link to="/parts?low=1">{low.slice(0, 2).map((p) => p.name).join(", ")}{low.length > 2 ? "…" : ""}</Link> : "stock OK"}
        />
      </div>

      <div className="board" style={{ gridTemplateColumns: "repeat(4, minmax(240px, 1fr))" }}>
        {BOARD_STATUSES.map((s) => {
          const items = onBoard
            .filter((j) => j.status === s)
            .sort((a, b) => (lastEventAt(a, a.status) ?? a.createdAt).localeCompare(lastEventAt(b, b.status) ?? b.createdAt));
          return (
            <section key={s} className="board-col" aria-label={`${s} jobs`}>
              <h3>
                <StatusBadge status={s} /> <span className="badge">{items.length}</span>
              </h3>
              {items.map(card)}
              {items.length === 0 && <p className="muted small">Nothing here</p>}
            </section>
          );
        })}
      </div>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>Upcoming bookings (next 7 days)</h2>
        {upcoming.length === 0 ? (
          <p className="muted">No bookings.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Job</th>
                  <th>Vehicle</th>
                  <th>Customer</th>
                  <th>Work</th>
                  <th>Technician</th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((j) => {
                  const v = vehicles.get(j.vehicleId);
                  return (
                    <tr key={j.id}>
                      <td>{fmtDate(j.bookedFor)}</td>
                      <td>
                        <Link to={`/jobs/${j.id}`}>{j.number}</Link>
                      </td>
                      <td>
                        {v && <Plate plate={v.plate} />} {v?.make} {v?.model}
                      </td>
                      <td>{customers.get(j.customerId)?.name}</td>
                      <td style={{ whiteSpace: "normal" }}>{j.complaint}</td>
                      <td>{j.technicianId ? techs.get(j.technicianId) : <span className="muted">Unassigned</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
