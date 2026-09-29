import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Kpi, useMoney } from "../components/ui";
import { api, errorText } from "../api/client";
import type { workshopStats } from "../lib/analytics";
import { addDays, startOfMonthsAgo, todayLocal } from "../lib/dates";
import { fmtDate, fmtHours, fmtPct } from "../lib/format";

const PERIODS = [
  { id: "month", label: "This month" },
  { id: "30", label: "Last 30 days" },
  { id: "90", label: "Last 90 days" },
  { id: "180", label: "Last 6 months" },
];

const axis = { stroke: "var(--chart-grid)", tick: { fill: "var(--chart-axis)", fontSize: 12 }, tickLine: false };
const tip = {
  contentStyle: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, color: "var(--text)", fontSize: 13 },
  labelStyle: { color: "var(--text)", fontWeight: 700 },
  cursor: { fill: "var(--surface-2)", opacity: 0.6 },
};

export function Reports() {
  const fmt = useMoney();
  const today = todayLocal();
  const [period, setPeriod] = useState("90");
  const [asTable, setAsTable] = useState(false);
  const from = period === "month" ? startOfMonthsAgo(today, 0) : addDays(today, -(Number(period) - 1));
  const q = useQuery({
    queryKey: ["reports", from, today],
    queryFn: () => api<ReturnType<typeof workshopStats>>(`/reports?from=${from}&to=${today}`),
    placeholderData: keepPreviousData,
  });
  if (q.isError) return <div className="notice">{errorText(q.error)}</div>;
  if (!q.data) return <p className="muted">Loading reports…</p>;
  const s = q.data;
  const weekly = s.weekly.map((w) => ({ ...w, label: fmtDate(w.week).replace(/, \d{4}$/, ""), labourD: w.labour / 100, partsD: w.parts / 100 }));

  return (
    <>
      <div className="page-head">
        <h1>Reports</h1>
        <span className="spacer" />
        <label>
          Period
          <select value={period} onChange={(e) => setPeriod(e.target.value)}>
            {PERIODS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        {/* Invoice register for the accountant (issued, paid and voided invoices in the period). */}
        <a className="btn btn-sm" style={{ alignSelf: "flex-end" }} href={`/api/reports/invoices.csv?from=${from}&to=${today}`} download>
          Invoices CSV
        </a>
      </div>

      <div className="kpi-grid">
        <Kpi label="Revenue (ex. tax)" value={fmt(s.revenue)} sub={`${s.jobsCompleted} jobs completed`} />
        <Kpi label="Average job" value={fmt(s.avgJobValue)} sub={`${fmtHours(s.hoursBilled)} labour billed`} />
        <Kpi label="Gross profit" value={fmt(s.grossProfit)} sub={`labour ${fmt(s.labourRevenue)} · parts ${fmt(s.partsRevenue)}`} />
        <Kpi label="Parts margin" value={fmtPct(s.partsMargin)} sub="after discounts" />
        <Kpi label="Avg turnaround" value={fmtHours(s.avgTurnaroundHours)} sub="check-in → ready" />
        <Kpi
          label="Unpaid invoices"
          value={fmt(s.unpaidTotal)}
          sub={s.unpaidCount ? <Link to="/jobs?filter=unpaid">{s.unpaidCount} invoices →</Link> : "none"}
        />
      </div>

      <div className="chart-grid">
        <section className="chart-card wide" aria-label="Weekly revenue">
          <header>
            <div>
              <h3>Weekly revenue</h3>
              <p className="muted small">Completed jobs, net of discounts, excluding tax. The last bar is the current week so far.</p>
            </div>
            <span className="spacer" />
            <button className="btn btn-sm" onClick={() => setAsTable((t) => !t)} aria-pressed={asTable}>
              {asTable ? "Chart" : "Table"}
            </button>
          </header>
          {asTable ? (
            <div className="table-wrap" style={{ maxHeight: 300 }}>
              <table>
                <thead>
                  <tr>
                    <th>Week of</th>
                    <th className="r">Jobs</th>
                    <th className="r">Labour</th>
                    <th className="r">Parts</th>
                    <th className="r">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {s.weekly.map((w) => (
                    <tr key={w.week}>
                      <td>{fmtDate(w.week)}</td>
                      <td className="r">{w.jobs}</td>
                      <td className="r">{fmt(w.labour)}</td>
                      <td className="r">{fmt(w.parts)}</td>
                      <td className="r">{fmt(w.labour + w.parts)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <>
              <div className="legend">
                <span>
                  <i className="swatch" style={{ background: "var(--series-1)" }} /> Labour
                </span>
                <span>
                  <i className="swatch" style={{ background: "var(--series-2)" }} /> Parts
                </span>
              </div>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={weekly} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                  <XAxis dataKey="label" {...axis} minTickGap={16} />
                  <YAxis {...axis} axisLine={false} width={60} tickFormatter={(v: number) => fmt(v * 100).replace(/\.00$/, "")} />
                  <Tooltip {...tip} formatter={(v) => fmt(Number(v) * 100)} />
                  <Bar dataKey="labourD" name="Labour" stackId="r" fill="var(--series-1)" stroke="var(--chart-surface)" strokeWidth={1} maxBarSize={40} isAnimationActive={false} />
                  <Bar dataKey="partsD" name="Parts" stackId="r" fill="var(--series-2)" stroke="var(--chart-surface)" strokeWidth={1} radius={[4, 4, 0, 0]} maxBarSize={40} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </>
          )}
        </section>

        <section className="chart-card" aria-label="Technicians">
          <header>
            <div>
              <h3>Technicians</h3>
              <p className="muted small">Utilisation = billed hours ÷ available hours (8 h × working days)</p>
            </div>
          </header>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Technician</th>
                  <th className="r">Jobs</th>
                  <th className="r">Billed</th>
                  <th>Utilisation</th>
                  <th className="r">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {s.technicians.map((t) => (
                  <tr key={t.id}>
                    <td>{t.name}</td>
                    <td className="r">{t.jobs}</td>
                    <td className="r">{fmtHours(t.hours)}</td>
                    <td>
                      <div className="row" style={{ flexWrap: "nowrap" }}>
                        <div className="meter" style={{ flex: 1, minWidth: 50 }}>
                          <span style={{ width: `${Math.min(100, t.utilisation * 100)}%` }} />
                        </div>
                        <span className="num small">{fmtPct(t.utilisation)}</span>
                      </div>
                    </td>
                    <td className="r">{fmt(t.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="chart-card" aria-label="Top services">
          <header>
            <h3>Top services</h3>
          </header>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Service</th>
                  <th className="r">Times</th>
                  <th className="r">Labour revenue</th>
                </tr>
              </thead>
              <tbody>
                {s.topServices.map((x) => (
                  <tr key={x.name}>
                    <td>{x.name}</td>
                    <td className="r">{x.count}</td>
                    <td className="r">{fmt(x.revenue)}</td>
                  </tr>
                ))}
                {s.topServices.length === 0 && (
                  <tr>
                    <td colSpan={3} className="muted">
                      No completed jobs in this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
