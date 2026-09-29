import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { isDesk, useMe } from "../api/auth";
import { api, errorText } from "../api/client";
import { Plate, StatusBadge, useMoney } from "../components/ui";
import { fmtDate } from "../lib/format";
import { useDebounced } from "../lib/useDebounced";
import type { JobRow } from "../../../shared/schemas";
import { JOB_STATUSES } from "../types";

const PAGE = 100;

export function Jobs() {
  const fmt = useMoney();
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const filter = params.get("filter") ?? "";
  const [q, setQ] = useState("");
  const search = useDebounced(q.trim());
  const list = useInfiniteQuery({
    queryKey: ["jobs", filter, search],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => api<{ items: JobRow[]; total: number }>(`/jobs?filter=${encodeURIComponent(filter)}&q=${encodeURIComponent(search)}&offset=${pageParam}&limit=${PAGE}`, { signal }),
    getNextPageParam: (last, pages) => {
      const n = pages.reduce((s, p) => s + p.items.length, 0);
      return n < last.total ? n : undefined;
    },
    placeholderData: keepPreviousData,
  });
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];
  const total = list.data?.pages[0]?.total ?? 0;

  return (
    <>
      <div className="page-head">
        <h1>Job cards</h1>
        <span className="spacer" />
        {isDesk(me.data) && (
          <Link to="/jobs/new" className="btn btn-primary">
            + New job card
          </Link>
        )}
      </div>
      <div className="filter-bar">
        <label>
          Show
          <select value={filter} onChange={(e) => setParams(e.target.value ? { filter: e.target.value } : {}, { replace: true })}>
            <option value="">All jobs</option>
            <option value="open">Open jobs</option>
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
      {list.isError && <div className="notice">{errorText(list.error)}</div>}
      <p className="muted small">{list.isPending ? "Loading…" : `${total} jobs`}</p>
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
            {rows.map((j) => (
              <tr key={j.id}>
                <td>
                  <Link to={`/jobs/${j.id}`}>{j.number}</Link>
                </td>
                <td>{fmtDate(j.bookedFor)}</td>
                <td>
                  <Plate plate={j.vehicle.plate} /> {j.vehicle.make} {j.vehicle.model}
                </td>
                <td>{j.customer.name}</td>
                <td>
                  <StatusBadge status={j.status} />
                </td>
                <td>
                  {j.invoice ? (
                    <Link to={`/jobs/${j.id}/invoice`}>
                      {j.invoice.number} {j.invoice.paid ? <span className="badge badge-good">Paid</span> : <span className="badge badge-warn">Unpaid</span>}
                    </Link>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td className="r">{fmt(j.totalCents)}</td>
              </tr>
            ))}
            {!list.isPending && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="muted" style={{ textAlign: "center", padding: "2rem" }}>
                  No jobs match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {list.hasNextPage && (
        <div style={{ textAlign: "center", marginTop: "1rem" }}>
          <button className="btn" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
            {list.isFetchingNextPage ? "Loading…" : `Show more (${total - rows.length} left)`}
          </button>
        </div>
      )}
    </>
  );
}
