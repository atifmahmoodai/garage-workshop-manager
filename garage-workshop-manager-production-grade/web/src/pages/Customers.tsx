import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { isDesk, useMe } from "../api/auth";
import { api, errorText } from "../api/client";
import { Plate } from "../components/ui";
import { fmtDate } from "../lib/format";
import { useDebounced } from "../lib/useDebounced";
import type { Customer, Vehicle } from "../types";

interface CustomerRow extends Customer {
  vehicles: { id: string; plate: string; make: string; model: string }[];
  lastVisit: string | null;
}
interface DueRow {
  vehicle: Vehicle;
  customer?: Customer;
  lastService: string;
  due: string;
  overdueDays: number;
}

const PAGE = 100;

export function Customers() {
  const me = useMe();
  const [q, setQ] = useState("");
  const search = useDebounced(q.trim());
  const [tab, setTab] = useState<"all" | "due">("all");
  const list = useInfiniteQuery({
    queryKey: ["customers", search],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => api<{ items: CustomerRow[]; total: number }>(`/customers?q=${encodeURIComponent(search)}&offset=${pageParam}&limit=${PAGE}`, { signal }),
    getNextPageParam: (last, pages) => {
      const n = pages.reduce((s, p) => s + p.items.length, 0);
      return n < last.total ? n : undefined;
    },
    placeholderData: keepPreviousData,
  });
  const due = useQuery({ queryKey: ["due"], queryFn: () => api<{ items: DueRow[]; intervalMonths: number }>("/customers/due") });
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];
  const total = list.data?.pages[0]?.total ?? 0;
  const dueRows = due.data?.items ?? [];

  return (
    <>
      <div className="page-head">
        <h1>Customers</h1>
        <span className="spacer" />
        {isDesk(me.data) && (
          <Link to="/customers/new" className="btn btn-primary">
            + Add customer
          </Link>
        )}
      </div>
      <div className="tabs" role="tablist" style={{ maxWidth: 380, marginBottom: "1rem" }}>
        <button role="tab" aria-selected={tab === "all"} onClick={() => setTab("all")}>
          All customers {!search && list.data ? `(${total})` : ""}
        </button>
        <button role="tab" aria-selected={tab === "due"} onClick={() => setTab("due")}>
          Service due {due.data ? `(${dueRows.length})` : ""}
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
          {list.isError && <div className="notice">{errorText(list.error)}</div>}
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
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link to={`/customers/${c.id}`}>{c.name}</Link>
                    </td>
                    <td>{c.phone}</td>
                    <td>
                      {c.vehicles.map((v) => (
                        <span key={v.id} style={{ marginRight: "0.5rem" }}>
                          <Plate plate={v.plate} /> {v.make} {v.model}
                        </span>
                      ))}
                    </td>
                    <td>{c.lastVisit ? fmtDate(c.lastVisit) : <span className="muted">—</span>}</td>
                  </tr>
                ))}
                {!list.isPending && rows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted" style={{ textAlign: "center", padding: "2rem" }}>
                      No customers match.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {list.hasNextPage && (
            <div style={{ textAlign: "center", marginTop: "1rem" }}>
              <button className="btn" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
                Show more ({total - rows.length} left)
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="muted small">
            Vehicles whose last service was over {due.data?.intervalMonths ?? "…"} months ago, or will be within 30 days, and that aren't already booked in. Call or message them to book.
          </p>
          {due.isError && <div className="notice">{errorText(due.error)}</div>}
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
                {dueRows.map((d) => (
                  <tr key={d.vehicle.id}>
                    <td>
                      <Plate plate={d.vehicle.plate} /> {d.vehicle.year} {d.vehicle.make} {d.vehicle.model}
                    </td>
                    <td>{d.customer && <Link to={`/customers/${d.customer.id}`}>{d.customer.name}</Link>}</td>
                    <td>{d.customer?.phone && <a href={`tel:${d.customer.phone.replace(/[^\d+]/g, "")}`}>{d.customer.phone}</a>}</td>
                    <td>{fmtDate(d.lastService)}</td>
                    <td>{d.overdueDays > 0 ? <span className="badge badge-warn">⚠ {d.overdueDays} days overdue</span> : <span className="badge">{fmtDate(d.due)}</span>}</td>
                  </tr>
                ))}
                {due.data && dueRows.length === 0 && (
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
