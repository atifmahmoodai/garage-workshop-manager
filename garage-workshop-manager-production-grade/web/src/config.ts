import { DEFAULT_SETTINGS } from "../../shared/settings-defaults";
import type { Settings, Technician } from "./types";

/**
 * Workshop settings and technicians come from the server (GET /api/meta) and are
 * kept here so any component can read them synchronously.
 */
export const SETTINGS: Settings = structuredClone(DEFAULT_SETTINGS);
export const TECHNICIANS: Technician[] = [];

export function applyMeta(settings: Settings, technicians: Technician[]) {
  Object.assign(SETTINGS, settings);
  TECHNICIANS.splice(0, TECHNICIANS.length, ...technicians);
  document.title = `${settings.name} · Workshop`;
}

export const technicianName = (id: string | null | undefined) => TECHNICIANS.find((t) => t.id === id)?.name;
