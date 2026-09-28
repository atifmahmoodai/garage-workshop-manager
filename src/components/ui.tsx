import type { ReactNode } from "react";
import { useStore } from "../store/store";
import { money } from "../lib/format";
import type { JobStatus } from "../types";

export function useMoney() {
  const { data } = useStore();
  return (cents: number) => money(cents, data.settings);
}

const STATUS_CLASS: Record<JobStatus, string> = {
  Booked: "",
  "In progress": "badge-brand",
  "Waiting parts": "badge-warn",
  Ready: "badge-good",
  Completed: "",
  Cancelled: "badge-bad",
};

const STATUS_ICON: Record<JobStatus, string> = {
  Booked: "◷",
  "In progress": "⚙",
  "Waiting parts": "⏸",
  Ready: "✓",
  Completed: "✔",
  Cancelled: "✕",
};

export function StatusBadge({ status }: { status: JobStatus }) {
  return (
    <span className={`badge ${STATUS_CLASS[status]}`}>
      {STATUS_ICON[status]} {status}
    </span>
  );
}

export function Kpi({ label, value, sub }: { label: string; value: string; sub?: ReactNode }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

export function Plate({ plate }: { plate: string }) {
  return <span className="plate">{plate}</span>;
}
