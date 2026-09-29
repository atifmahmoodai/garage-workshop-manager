import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { isDesk, useMe } from "../api/auth";
import { api, errorText } from "../api/client";
import { Kpi, Plate, StatusBadge, useMoney } from "../components/ui";
import { technicianName } from "../config";
import { fmtDate } from "../lib/format";
import type { JobRow } from "../../../shared/schemas";
import { BOARD_STATUSES, type JobStatus } from "../types";

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

interface BoardData {
  today: string;
  onBoard: JobRow[];
  upcoming: JobRow[];
  unpaid: { count: number; totalCents: number };
  lowStock: string[];
}

export function Board() {
  const fmt = useMoney();
  const me = useMe();
  const desk = isDesk(me.data);
  const qc = useQueryClient();
  const [error, setError] = useState("");
  const q = useQuery({ queryKey: ["board"], queryFn: () => api<BoardData>("/board"), refetchInterval: 30_000 });
  const move = useMutation({
    mutationFn: ({ id, status }: { id: string; status: JobStatus }) => api(`/jobs/${id}/status`, { method: "POST", body: { status } }),
    onMutate: () => setError(""),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["board"] });
      void qc.invalidateQueries({ queryKey: ["meta"] });
      void qc.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (e) => setError(errorText(e)),
  });

  if (q.isError) return <div className="notice">{errorText(q.error)}</div>;
  if (!q.data) return <p className="muted">Loading…</p>;
  const { today, onBoard, upcoming, unpaid, lowStock } = q.data;
  const ready = onBoard.filter((j) => j.status === "Ready");
  const readyValue = ready.reduce((s, j) => s + j.totalCents, 0);

  const card = (j: JobRow) => {
    const overdue = j.status === "Booked" && j.bookedFor < today;
    const next = NEXT[j.status];
    // Technicians can't mark cars as collected (that completes the job and issues the invoice).
    const canNext = next && (desk || next !== "Completed");
    return (
      <div key={j.id} className="job-card">
        <div className="row" style={{ gap: "0.4rem" }}>
          <Link to={`/jobs/${j.id}`}>
            <strong>{j.number}</strong>
          </Link>
          <Plate plate={j.vehicle.plate} />
          <span className="spacer" />
          {overdue && <span className="badge badge-bad">⚠ booked {fmtDate(j.bookedFor)}</span>}
        </div>
        <div>
          {j.vehicle.year} {j.vehicle.make} {j.vehicle.model} · <span className="muted">{j.customer.name}</span>
        </div>
        <div className="muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={j.complaint}>
          {j.complaint || "No description"}
        </div>
        <div className="row small" style={{ gap: "0.4rem" }}>
          <span className="muted">{technicianName(j.technicianId) ?? "No technician"}</span>
          <span className="spacer" />
          {j.status === "In progress" && (
            <button className="btn btn-sm" disabled={move.isPending} onClick={() => move.mutate({ id: j.id, status: "Waiting parts" })}>
              Waiting parts
            </button>
          )}
          {canNext && (
            <button className="btn btn-sm btn-primary" disabled={move.isPending} onClick={() => move.mutate({ id: j.id, status: next })}>
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
        {desk && (
          <Link to="/jobs/new" className="btn btn-primary">
            + New job card
          </Link>
        )}
      </div>
      {error && (
        <div className="notice" role="alert" style={{ marginBottom: "1rem" }}>
          {error}
        </div>
      )}

      <div className="kpi-grid">
        <Kpi label="Cars in the workshop" value={String(onBoard.filter((j) => j.status !== "Booked").length)} sub={`${onBoard.filter((j) => j.status === "Booked").length} still to check in today`} />
        <Kpi label="Ready for collection" value={String(ready.length)} sub={`${fmt(readyValue)} to collect`} />
        <Kpi label="Waiting for parts" value={String(onBoard.filter((j) => j.status === "Waiting parts").length)} />
        <Kpi label="Unpaid invoices" value={String(unpaid.count)} sub={unpaid.count ? <Link to="/jobs?filter=unpaid">{fmt(unpaid.totalCents)} outstanding</Link> : "all paid"} />
        <Kpi
          label="Parts to reorder"
          value={String(lowStock.length)}
          sub={lowStock.length ? <Link to="/parts?low=1">{lowStock.slice(0, 2).join(", ")}{lowStock.length > 2 ? "…" : ""}</Link> : "stock OK"}
        />
      </div>

      <div className="board" style={{ gridTemplateColumns: "repeat(4, minmax(240px, 1fr))" }}>
        {BOARD_STATUSES.map((s) => {
          const items = onBoard.filter((j) => j.status === s).sort((a, b) => a.statusSince.localeCompare(b.statusSince));
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
                {upcoming.map((j) => (
                  <tr key={j.id}>
                    <td>{fmtDate(j.bookedFor)}</td>
                    <td>
                      <Link to={`/jobs/${j.id}`}>{j.number}</Link>
                    </td>
                    <td>
                      <Plate plate={j.vehicle.plate} /> {j.vehicle.make} {j.vehicle.model}
                    </td>
                    <td>{j.customer.name}</td>
                    <td style={{ whiteSpace: "normal" }}>{j.complaint}</td>
                    <td>{technicianName(j.technicianId) ?? <span className="muted">Unassigned</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
