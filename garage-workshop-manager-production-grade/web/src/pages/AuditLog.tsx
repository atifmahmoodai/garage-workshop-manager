import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, errorText } from "../api/client";
import { fmtDate } from "../lib/format";

interface AuditEntry {
  id: number;
  at: string;
  action: string;
  entity: string;
  entityId: string | null;
  details: Record<string, unknown>;
  ip: string | null;
  userName: string | null;
}

const LABELS: Record<string, string> = {
  "auth.login": "Signed in",
  "auth.login_failed": "Failed sign-in",
  "auth.password_changed": "Changed password",
  "job.create": "Created job card",
  "job.update": "Edited job card",
  "job.status": "Moved job",
  "invoice.issue": "Issued invoice",
  "invoice.paid": "Recorded payment",
  "invoice.void": "Voided invoice",
  "customer.create": "Added customer",
  "customer.update": "Edited customer",
  "customer.delete": "Deleted customer",
  "vehicle.create": "Added vehicle",
  "vehicle.update": "Edited vehicle",
  "part.create": "Added part",
  "part.update": "Edited part",
  "stock.receive": "Received stock",
  "stock.adjust": "Stock correction",
  "technician.create": "Added technician",
  "technician.update": "Edited technician",
  "user.create": "Added user",
  "user.update": "Edited user",
  "user.password_reset": "Reset password",
  "settings.update": "Changed settings",
};

function summary(e: AuditEntry): string {
  const d = e.details;
  if (e.action === "job.status") return `${d.from} → ${d.to}`;
  if (e.action.startsWith("invoice.")) return [d.number, d.method, d.reason].filter(Boolean).join(" · ");
  if (e.action.startsWith("stock.")) return `${Number(d.delta) > 0 ? "+" : ""}${d.delta}${d.note ? ` · ${d.note}` : ""}`;
  if (e.action === "job.create") return String(d.number ?? "");
  return "";
}

const LINKS: Record<string, string> = { job: "/jobs/", customer: "/customers/" };

/** Who did what, and when: for accountability and for tracing mistakes. */
export function AuditLog() {
  const q = useQuery({ queryKey: ["audit"], queryFn: () => api<{ items: AuditEntry[] }>("/audit?limit=300") });
  return (
    <>
      <div className="page-head">
        <h1>Activity log</h1>
      </div>
      {q.isError && <div className="notice">{errorText(q.error)}</div>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>What</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {q.isPending && (
              <tr>
                <td colSpan={4} className="muted">
                  Loading…
                </td>
              </tr>
            )}
            {q.data?.items.map((e) => (
              <tr key={e.id}>
                <td className="num">{fmtDate(e.at, true)}</td>
                <td>{e.userName ?? <span className="muted">System</span>}</td>
                <td>
                  {LINKS[e.entity] && e.entityId && e.action !== "customer.delete" ? (
                    <Link to={`${LINKS[e.entity]}${e.entityId}`}>{LABELS[e.action] ?? e.action}</Link>
                  ) : (
                    (LABELS[e.action] ?? e.action)
                  )}
                </td>
                <td className="muted ellipsis" style={{ maxWidth: 360 }}>
                  {summary(e)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
