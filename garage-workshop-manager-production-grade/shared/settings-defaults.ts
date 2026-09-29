import type { Settings } from "./types";

// Kept free of zod so the app shell stays small.
export const DEFAULT_SETTINGS: Settings = {
  name: "Precision Auto Care",
  address: "88 Garage Lane, Springfield",
  phone: "+1 (555) 014-7788",
  email: "service@precisionauto.example",
  currency: "USD",
  locale: "en-US",
  taxPercent: 8,
  labourRateCents: 9500,
  serviceIntervalMonths: 12,
};
