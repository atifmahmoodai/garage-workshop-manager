import { useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useMoney } from "../components/ui";
import { toCents, fromCents } from "../lib/money";
import { newId, useStore } from "../store/store";
import type { Part } from "../types";

interface Draft {
  id: string;
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
  if (!/^\d+$/.test(d.stock.trim())) e.push("Stock must be a whole number.");
  if (!/^\d+$/.test(d.reorderLevel.trim())) e.push("Reorder level must be a whole number.");
  if (!(toCents(d.cost) >= 0)) e.push("Cost must be a valid amount.");
  if (!(toCents(d.price) >= 0)) e.push("Price must be a valid amount.");
  return e;
}

export function Parts() {
  const { data, savePart, adjustStock } = useStore();
  const fmt = useMoney();
  const [params, setParams] = useSearchParams();
  const lowOnly = params.get("low") === "1";
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [receive, setReceive] = useState<Record<string, string>>({});

  const rows = useMemo(() => {
    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    return data.parts
      .filter((p) => !lowOnly || p.stock <= p.reorderLevel)
      .filter((p) => tokens.every((t) => `${p.sku} ${p.name} ${p.category}`.toLowerCase().includes(t)))
      .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  }, [data.parts, lowOnly, q]);
  const stockValue = data.parts.reduce((s, p) => s + Math.max(0, p.stock) * p.costCents, 0);

  const edit = (p?: Part) => {
    setErrors([]);
    setDraft(
      p
        ? { id: p.id, sku: p.sku, name: p.name, category: p.category, stock: String(p.stock), reorderLevel: String(p.reorderLevel), cost: fromCents(p.costCents), price: fromCents(p.priceCents) }
        : { id: newId("p"), sku: "", name: "", category: "", stock: "0", reorderLevel: "2", cost: "", price: "" },
    );
  };

  function save(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    const errs = validatePart(draft, data.parts);
    setErrors(errs);
    if (errs.length) return;
    savePart({
      id: draft.id,
      sku: draft.sku.trim().toUpperCase(),
      name: draft.name.trim(),
      category: draft.category.trim() || "Other",
      stock: Number(draft.stock),
      reorderLevel: Number(draft.reorderLevel),
      costCents: toCents(draft.cost),
      priceCents: toCents(draft.price),
    });
    setDraft(null);
  }

  return (
    <>
      <div className="page-head">
        <h1>Parts &amp; stock</h1>
        <span className="muted">Stock value at cost: {fmt(stockValue)}</span>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={() => edit()}>
          + Add part
        </button>
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

      {draft && (
        <form className="card stack" onSubmit={save} noValidate style={{ marginBottom: "1rem" }}>
          <h2 style={{ margin: 0 }}>{data.parts.some((p) => p.id === draft.id) ? "Edit part" : "New part"}</h2>
          <div className="form-grid">
            {(
              [
                ["sku", "SKU"],
                ["name", "Name"],
                ["category", "Category"],
                ["stock", "In stock"],
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
          {errors.map((er) => (
            <div key={er} className="field-error">
              {er}
            </div>
          ))}
          <div className="row">
            <button type="submit" className="btn btn-primary btn-sm">
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
              <th className="r">Cost</th>
              <th className="r">Price</th>
              <th className="r">Margin</th>
              <th>Receive</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const qty = receive[p.id] ?? "";
              const n = Number(qty);
              const valid = /^\d+$/.test(qty) && n > 0;
              return (
                <tr key={p.id}>
                  <td className="num">{p.sku}</td>
                  <td>{p.name}</td>
                  <td>{p.category}</td>
                  <td className="r">
                    {p.stock <= p.reorderLevel ? <span className={`badge ${p.stock <= 0 ? "badge-bad" : "badge-warn"}`}>⚠ {p.stock}</span> : p.stock}
                  </td>
                  <td className="r">{p.reorderLevel}</td>
                  <td className="r">{fmt(p.costCents)}</td>
                  <td className="r">{fmt(p.priceCents)}</td>
                  <td className="r">{p.priceCents ? `${Math.round(((p.priceCents - p.costCents) / p.priceCents) * 100)}%` : "—"}</td>
                  <td>
                    <div className="row" style={{ flexWrap: "nowrap", gap: "0.3rem" }}>
                      <input
                        aria-label={`Quantity received for ${p.name}`}
                        inputMode="numeric"
                        style={{ width: 64, marginTop: 0, padding: "0.3rem 0.4rem" }}
                        value={qty}
                        onChange={(e) => setReceive({ ...receive, [p.id]: e.target.value })}
                      />
                      <button
                        className="btn btn-sm"
                        disabled={!valid}
                        onClick={() => {
                          adjustStock(p.id, n);
                          setReceive({ ...receive, [p.id]: "" });
                        }}
                      >
                        + Add
                      </button>
                    </div>
                  </td>
                  <td>
                    <button className="btn btn-sm" onClick={() => edit(p)}>
                      Edit
                    </button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="muted" style={{ textAlign: "center", padding: "2rem" }}>
                  {lowOnly ? "Nothing needs reordering." : "No parts match."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
