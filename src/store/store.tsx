import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { generateDemoData } from "../data/generate";
import { todayLocal } from "../lib/dates";
import { stockDelta } from "../lib/money";
import type { Customer, Job, JobStatus, Part, PaymentMethod, Settings, Technician, Vehicle, WorkshopData } from "../types";

const KEY = "garage-workshop:v1";

export function isWorkshopData(x: unknown): x is WorkshopData {
  const d = x as WorkshopData;
  return (
    !!d &&
    typeof d.settings?.name === "string" &&
    typeof d.settings?.taxPercent === "number" &&
    ["customers", "vehicles", "technicians", "parts", "jobs"].every((k) => Array.isArray((d as unknown as Record<string, unknown>)[k])) &&
    d.jobs.every((j) => typeof j?.id === "string" && Array.isArray(j.labour) && Array.isArray(j.parts) && Array.isArray(j.statusHistory)) &&
    d.parts.every((p) => typeof p?.id === "string" && typeof p.stock === "number")
  );
}

function load(): WorkshopData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (isWorkshopData(parsed)) return parsed;
    }
  } catch {
    // blocked or corrupt storage → fresh demo data
  }
  return generateDemoData(todayLocal());
}

export function newId(prefix: string): string {
  const rand = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}${rand}`;
}

const nextNumber = (values: (string | undefined)[], prefix: string, start: number) =>
  `${prefix}${values.reduce((m, v) => Math.max(m, Number((v ?? "").replace(/\D/g, "")) || 0), start - 1) + 1}`;

export const nextJobNumber = (d: WorkshopData) => nextNumber(d.jobs.map((j) => j.number), "J-", 1001);
export const nextInvoiceNumber = (d: WorkshopData) => nextNumber(d.jobs.map((j) => j.invoice?.number), "INV-", 5001);

/** Applies the stock movement implied by replacing `before` with `after` (cancelled jobs hold no stock). */
export function applyStock(parts: Part[], before: Job | undefined, after: Job | undefined): Part[] {
  const held = (j: Job | undefined) => (j && j.status !== "Cancelled" ? j.parts : []);
  const delta = stockDelta(held(before), held(after));
  if (!delta.size) return parts;
  return parts.map((p) => (delta.has(p.id) ? { ...p, stock: p.stock + delta.get(p.id)! } : p));
}

interface Store {
  data: WorkshopData;
  persisted: boolean;
  saveJob(job: Job): void;
  setStatus(jobId: string, status: JobStatus): void;
  markPaid(jobId: string, method: PaymentMethod): void;
  saveCustomer(c: Customer): void;
  saveVehicle(v: Vehicle): void;
  savePart(p: Part): void;
  adjustStock(partId: string, delta: number): void;
  saveTechnician(t: Technician): void;
  saveSettings(s: Settings): void;
  replaceData(d: WorkshopData): void;
  resetDemo(): void;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<WorkshopData>(load);
  const [persisted, setPersisted] = useState(true);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      try {
        if (localStorage.getItem(KEY)) return;
      } catch {
        setPersisted(false);
        return;
      }
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
      setPersisted(true);
    } catch {
      setPersisted(false);
    }
  }, [data]);

  const saveJob = useCallback((job: Job) => {
    setData((d) => {
      const before = d.jobs.find((j) => j.id === job.id);
      return {
        ...d,
        parts: applyStock(d.parts, before, job),
        jobs: before ? d.jobs.map((j) => (j.id === job.id ? job : j)) : [...d.jobs, job],
      };
    });
  }, []);

  const setStatus = useCallback((jobId: string, status: JobStatus) => {
    setData((d) => {
      const before = d.jobs.find((j) => j.id === jobId);
      if (!before || before.status === status) return d;
      const now = new Date().toISOString();
      const after: Job = {
        ...before,
        status,
        statusHistory: [...before.statusHistory, { status, at: now }],
        // Completing a job issues its invoice (once).
        invoice: status === "Completed" && !before.invoice ? { number: nextInvoiceNumber(d), issuedAt: now } : before.invoice,
      };
      return { ...d, parts: applyStock(d.parts, before, after), jobs: d.jobs.map((j) => (j.id === jobId ? after : j)) };
    });
  }, []);

  const markPaid = useCallback((jobId: string, method: PaymentMethod) => {
    setData((d) => ({
      ...d,
      jobs: d.jobs.map((j) => (j.id === jobId && j.invoice ? { ...j, invoice: { ...j.invoice, paidAt: new Date().toISOString(), method } } : j)),
    }));
  }, []);

  const upsert = <K extends "customers" | "vehicles" | "parts" | "technicians">(key: K) =>
    (item: WorkshopData[K][number]) =>
      setData((d) => {
        const list = d[key] as { id: string }[];
        const exists = list.some((x) => x.id === item.id);
        return { ...d, [key]: exists ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item] };
      });

  // Created once so consumers can depend on them.
  const saveCustomer = useCallback(upsert("customers"), []);
  const saveVehicle = useCallback(upsert("vehicles"), []);
  const savePart = useCallback(upsert("parts"), []);
  const saveTechnician = useCallback(upsert("technicians"), []);

  const adjustStock = useCallback((partId: string, delta: number) => {
    setData((d) => ({ ...d, parts: d.parts.map((p) => (p.id === partId ? { ...p, stock: p.stock + delta } : p)) }));
  }, []);
  const saveSettings = useCallback((s: Settings) => setData((d) => ({ ...d, settings: s })), []);
  const replaceData = useCallback((d: WorkshopData) => setData(d), []);
  const resetDemo = useCallback(() => setData(generateDemoData(todayLocal())), []);

  const value = useMemo<Store>(
    () => ({ data, persisted, saveJob, setStatus, markPaid, saveCustomer, saveVehicle, savePart, adjustStock, saveTechnician, saveSettings, replaceData, resetDemo }),
    [data, persisted, saveJob, setStatus, markPaid, saveCustomer, saveVehicle, savePart, adjustStock, saveTechnician, saveSettings, replaceData, resetDemo],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore must be used inside <StoreProvider>");
  return s;
}
