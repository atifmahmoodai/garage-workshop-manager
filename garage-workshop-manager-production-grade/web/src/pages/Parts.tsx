import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { isDesk, useMe } from "../api/auth";
import { api, ApiError, errorText } from "../api/client";
import { useMoney } from "../components/ui";
import { fmtDate } from "../lib/format";
import { fromCents, toCents } from "../lib/money";
import type { Part } from "../types";

interface Draft {
  id?: string;
  sku: string;
  name: string;
  category: string;
  stock: string;
  reorderLevel: string;
  cost: string;
  price: string;
}

export function validatePart(d: Draft, others: Part[]): string[] {
  const e: string[] = [];
  if (!d.sku.trim()) e.push("SKU is required.");
  else if (others.some((p) => p.id !== d.id && p.sku.toLowerCase() === d.sku.trim().toLowerCase())) e.push(`SKU ${d.sku.trim()} is already used.`);
  if (!d.name.trim()) e.push("Name is required.");
  if (!d.id && !/^\d+$/.test(d.stock.trim())) e.push("Stock must be a whole number.");
  if (!/^\d+$/.test(d.reorderLevel.trim())) e.push("Reorder level must be a whole number.");
  if (!(toCents(d.cost) >= 0)) e.push("Cost must be a valid amount.");
  if (!(toCents(d.price) >= 0)) e.push("Price must be a valid amount.");
  return e;
}

interface Movement {
  id: number;
  at: string;
  delta: number;
  reason: string;
  note: string;
  jobId: string | null;
  jobNumber: string | null;
  userName: string | null;
}

export function Parts() {
  const fmt = useMoney();
  const me = useMe();
  const desk = isDesk(me.data);
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const lowOnly = params.get("low") === "1";
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [receive, setReceive] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<Part | null>(null);
  const [actionError, setActionError] = useState("");
  const list = useQuery({ queryKey: ["parts"], queryFn: () => api<{ items: Part[] }>("/parts") });
  const parts = useMemo(() => list.data?.items ?? [], [list.data]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["parts"] });
    void qc.invalidateQueries({ queryKey: ["meta"] });
    void qc.invalidateQueries({ queryKey: ["movements"] });
  };
  const save = useMutation({
    mutationFn: (d: Draft) => {
      const body = { sku: d.sku.trim(), name: d.name.trim(), category: d.category.trim() || "Other", reorderLevel: Number(d.reorderLevel), costCents: toCents(d.cost), priceCents: toCents(d.price) };
      return d.id ? api(`/parts/${d.id}`, { method: "PUT", body }) : api("/parts", { method: "POST", body: { ...body, stock: Number(d.stock) } });
    },
    onSuccess: () => {
      refresh();
      setDraft(null);
    },
    onError: (e) => setErrors(e instanceof ApiError && Object.keys(e.details).length ? Object.values(e.details) : [errorText(e)]),
  });
  const move = useMutation({
    mutationFn: (m: { id: string; delta: number; reason: "receive" | "adjust"; note: string }) => api(`/parts/${m.id}/stock`, { method: "POST", body: { delta: m.delta, reason: m.reason, note: m.note } }),
    onMutate: () => setActionError(""),
    onSuccess: (_d, m) => {
      refresh();
      setReceive((r) => ({ ...r, [m.id]: "" }));
    },
    onError: (e) => setActionError(errorText(e)),
  });

  const rows = useMemo(() => {
    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    return parts
      .filter((p) => !lowOnly || p.stock <= p.reorderLevel)
      .filter((p) => tokens.every((t) => `${p.sku} ${p.name} ${p.category}`.toLowerCase().includes(t)))
      .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  }, [parts, lowOnly, q]);
  const stockValue = parts.reduce((s, p) => s + Math.max(0, p.stock) * p.costCents, 0);

  const edit = (p?: Part) => {
    setErrors([]);
    setDraft(
      p
        ? { id: p.id, sku: p.sku, name: p.name, category: p.category, stock: String(p.stock), reorderLevel: String(p.reorderLevel), cost: fromCents(p.costCents), price: fromCents(p.priceCents) }
        : { sku: "", name: "", category: "", stock: "0", reorderLevel: "2", cost: "", price: "" },
    );
  };

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    const errs = validatePart(draft, parts);
    setErrors(errs);
    if (!errs.length) save.mutate(draft);
  }

  function stocktake(p: Part) {
    const raw = window.prompt(`Stocktake for ${p.name}: how many are on the shelf now? (system says ${p.stock})`);
    if (raw === null) return;
    const counted = Number(raw.trim());
    if (!/^\d+$/.test(raw.trim())) return setActionError("Enter the counted quantity as a whole number.");
    if (counted !== p.stock) move.mutate({ id: p.id, delta: counted - p.stock, reason: "adjust", note: `Stocktake: counted ${counted}` });
  }

  if (list.isError) return <div className="notice">{errorText(list.error)}</div>;

  return (
    <>
      <div className="page-head">
        <h1>Parts &amp; stock</h1>
        {desk && <span className="muted">Stock value at cost: {fmt(stockValue)}</span>}
        <span className="spacer" />
        {desk && (
          <button className="btn btn-primary" onClick={() => edit()}>
            + Add part
          </button>
        )}
      </div>
      <div className="filter-bar">
        <label style={{ flex: 1, minWidth: 220 }}>
          Search
          <input type="search" placeholder="SKU, name, category…" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", paddingBottom: "0.6rem" }}>
          <input type="checkbox" checked={lowOnly} onChange={(e) => setParams(e.target.checked ? { low: "1" } : {}, { replace: true })} /> Only items to reorder
        </label>
      </div>
      {actionError && (
        <div className="notice" role="alert" style={{ marginBottom: "1rem" }}>
          {actionError}
        </div>
      )}

      {draft && (
        <form className="card stack" onSubmit={submit} noValidate style={{ marginBottom: "1rem" }}>
          <h2 style={{ margin: 0 }}>{draft.id ? "Edit part" : "New part"}</h2>
          <div className="form-grid">
            {(
              [
                ["sku", "SKU"],
                ["name", "Name"],
                ["category", "Category"],
                ...(draft.id ? [] : [["stock", "Opening stock"]]),
                ["reorderLevel", "Reorder at"],
                ["cost", "Cost"],
                ["price", "Sell price"],
              ] as [keyof Draft, string][]
            ).map(([k, label]) => (
              <label key={k}>
                {label}
                <input value={draft[k]} inputMode={["stock", "reorderLevel", "cost", "price"].includes(k) ? "decimal" : undefined} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
              </label>
            ))}
          </div>
          {draft.id && <p className="muted small" style={{ margin: 0 }}>Stock changes go through Receive or Stocktake so every movement is recorded.</p>}
          {errors.map((er) => (
            <div key={er} className="field-error">
              {er}
            </div>
          ))}
          <div className="row">
            <button type="submit" className="btn btn-primary btn-sm" disabled={save.isPending}>
              Save part
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>SKU</th>
              <th>Part</th>
              <th>Category</th>
              <th className="r">In stock</th>
              <th className="r">Reorder at</th>
              {desk && <th className="r">Cost</th>}
              <th className="r">Price</th>
              {desk && <th className="r">Margin</th>}
              {desk && <th>Receive</th>}
              <th />
            </tr>
          </thead>
          <tbody>
            {list.isPending && (
              <tr>
                <td colSpan={10} className="muted">
                  Loading…
                </td>
              </tr>
            )}
            {rows.map((p) => {
              const qty = receive[p.id] ?? "";
              const n = Number(qty);
              const valid = /^\d+$/.test(qty) && n > 0;
              return (
                <tr key={p.id}>
                  <td className="num">{p.sku}</td>
                  <td>{p.name}</td>
                  <td>{p.category}</td>
                  <td className="r">{p.stock <= p.reorderLevel ? <span className={`badge ${p.stock <= 0 ? "badge-bad" : "badge-warn"}`}>⚠ {p.stock}</span> : p.stock}</td>
                  <td className="r">{p.reorderLevel}</td>
                  {desk && <td className="r">{fmt(p.costCents)}</td>}
                  <td className="r">{fmt(p.priceCents)}</td>
                  {desk && <td className="r">{p.priceCents ? `${Math.round(((p.priceCents - p.costCents) / p.priceCents) * 100)}%` : "—"}</td>}
                  {desk && (
                    <td>
                      <div className="row" style={{ flexWrap: "nowrap", gap: "0.3rem" }}>
                        <input
                          aria-label={`Quantity received for ${p.name}`}
                          inputMode="numeric"
                          style={{ width: 64, marginTop: 0, padding: "0.3rem 0.4rem" }}
                          value={qty}
                          onChange={(e) => setReceive({ ...receive, [p.id]: e.target.value })}
                        />
                        <button className="btn btn-sm" disabled={!valid || move.isPending} onClick={() => move.mutate({ id: p.id, delta: n, reason: "receive", note: "Goods received" })}>
                          + Add
                        </button>
                      </div>
                    </td>
                  )}
                  <td>
                    <div className="row" style={{ flexWrap: "nowrap", gap: "0.3rem" }}>
                      {desk && (
                        <>
                          <button className="btn btn-sm" onClick={() => edit(p)}>
                            Edit
                          </button>
                          <button className="btn btn-sm" onClick={() => stocktake(p)}>
                            Stocktake
                          </button>
                        </>
                      )}
                      <button className="btn btn-sm" onClick={() => setHistory(p)}>
                        History
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!list.isPending && rows.length === 0 && (
              <tr>
                <td colSpan={10} className="muted" style={{ textAlign: "center", padding: "2rem" }}>
                  {lowOnly ? "Nothing needs reordering." : "No parts match."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {history && <MovementsDialog part={history} onClose={() => setHistory(null)} />}
    </>
  );
}

const REASONS: Record<string, string> = { opening: "Opening stock", receive: "Received", adjust: "Correction", job: "Job card" };

function MovementsDialog({ part, onClose }: { part: Part; onClose: () => void }) {
  const q = useQuery({ queryKey: ["movements", part.id], queryFn: () => api<{ items: Movement[] }>(`/parts/${part.id}/movements`) });
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={`Stock history for ${part.name}`} onClick={onClose}>
      <div className="card modal stack" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <div className="row">
          <h2 style={{ margin: 0 }}>{part.name}</h2>
          <span className="spacer" />
          <button className="btn btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          {part.sku} · {part.stock} in stock. Every change to the stock figure is listed here.
        </p>
        {q.isError && <div className="notice">{errorText(q.error)}</div>}
        <div className="table-wrap" style={{ maxHeight: 420, overflow: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th className="r">Change</th>
                <th>Reason</th>
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              {q.data?.items.map((m) => (
                <tr key={m.id}>
                  <td>{fmtDate(m.at, true)}</td>
                  <td className="r">{m.delta > 0 ? `+${m.delta}` : m.delta}</td>
                  <td>
                    {m.jobId ? <Link to={`/jobs/${m.jobId}`}>{m.jobNumber}</Link> : REASONS[m.reason] ?? m.reason}
                    {m.note && <span className="muted"> · {m.note}</span>}
                  </td>
                  <td className="muted">{m.userName ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
