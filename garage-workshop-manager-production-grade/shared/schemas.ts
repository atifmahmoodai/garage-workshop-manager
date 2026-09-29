// API contract: request schemas validated on the server.
import { z } from "zod";
import { JOB_STATUSES, PAYMENT_METHODS, type Customer, type Job, type JobStatus, type Vehicle } from "./types";
import type { JobTotals } from "./money";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const isoDay = z.string().regex(DAY, "Use YYYY-MM-DD").refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), "Not a real date");
const text = (max: number) => z.string().trim().max(max);
const cents = z.number().int().min(0).max(1_000_000_000);

export const ROLES = ["admin", "advisor", "technician"] as const;
export type Role = (typeof ROLES)[number];

export const loginSchema = z.object({ email: z.string().trim().toLowerCase().email().max(200), password: z.string().min(1).max(200) });
export const PASSWORD_MIN = 10;
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `At least ${PASSWORD_MIN} characters`)
  .max(200)
  .refine((p) => /[a-zA-Z]/.test(p) && /\d/.test(p), "Use letters and at least one number");
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: passwordSchema });

const email = z.union([z.literal(""), z.string().trim().toLowerCase().email("That email address doesn't look right.").max(200)]).default("");
const phone = text(40).refine((p) => p.replace(/\D/g, "").length >= 7, "Enter a phone number.");

export const customerSchema = z.object({ name: text(120).min(2, "Enter a name."), phone, email });
export type CustomerInput = z.infer<typeof customerSchema>;

/** Plates are compared without spaces and case, so "ab12 cde" and "AB12CDE" are the same car. */
export const normalisePlate = (p: string) => p.replace(/\s+/g, "").toUpperCase();

export const vehicleSchema = z.object({
  plate: text(20).min(1, "Enter the plate.").transform((p) => p.toUpperCase()),
  make: text(60).min(1, "Enter the make."),
  model: text(60).min(1, "Enter the model."),
  year: z.number().int().min(1950, "Check the year."),
  vin: text(17).regex(/^[A-HJ-NPR-Z0-9]{0,17}$/i, "VINs use 17 letters/digits (no I, O or Q)").transform((s) => s.toUpperCase()).default(""),
  mileage: z.number().int().min(0, "Mileage can't be negative.").max(2_000_000),
});
export type VehicleInput = z.infer<typeof vehicleSchema>;

const labourLine = z.object({
  description: text(200).min(1, "Labour lines need a description."),
  hours: z.number().gt(0, "Hours must be more than 0.").max(200).multipleOf(0.01),
  rateCents: cents,
});
const partLine = z.object({
  partId: z.string().max(64).nullish(),
  description: text(200).min(1, "Part lines need a description."),
  qty: z.number().int("Quantity must be a whole number.").min(1, "Quantity must be at least 1.").max(10_000),
  unitPriceCents: cents,
  // Cost of stock items is taken from the parts list on the server; this is for one-off items.
  unitCostCents: cents.default(0),
});

export const jobSchema = z.object({
  customerId: z.string().max(64).optional(),
  vehicleId: z.string().max(64).optional(),
  newCustomer: customerSchema.optional(),
  newVehicle: vehicleSchema.optional(),
  bookedFor: isoDay,
  complaint: text(2000).min(1, "Describe the customer's request or the fault."),
  notes: text(4000).default(""),
  mileageIn: z.number().int().min(0, "Mileage can't be negative.").max(2_000_000),
  status: z.enum(JOB_STATUSES),
  technicianId: z.string().max(64).nullish(),
  labour: z.array(labourLine).max(100),
  parts: z.array(partLine).max(200),
  discountCents: cents,
});
export type JobInput = z.infer<typeof jobSchema>;

export const statusSchema = z.object({ status: z.enum(JOB_STATUSES) });
export const paymentSchema = z.object({ method: z.enum(PAYMENT_METHODS) });
export const reopenSchema = z.object({ reason: text(300).min(3, "Say why the invoice is being voided.") });

export const partSchema = z.object({
  sku: text(40).min(1, "SKU is required.").transform((s) => s.toUpperCase()),
  name: text(120).min(1, "Name is required."),
  category: text(60).default("Other"),
  reorderLevel: z.number().int().min(0).max(100_000),
  costCents: cents,
  priceCents: cents,
});
export const newPartSchema = partSchema.extend({ stock: z.number().int().min(0).max(1_000_000) });
export const stockMoveSchema = z.object({
  delta: z.number().int().min(-1_000_000).max(1_000_000).refine((n) => n !== 0, "Enter a quantity."),
  reason: z.enum(["receive", "adjust"]),
  note: text(200).default(""),
});

export const technicianSchema = z.object({ name: text(120).min(2), active: z.boolean().default(true) });

export const settingsSchema = z.object({
  name: text(120).min(1),
  address: text(300).default(""),
  phone: text(40).default(""),
  email: z.union([z.literal(""), z.string().trim().email().max(200)]).default(""),
  currency: z.string().regex(/^[A-Z]{3}$/, "ISO code, e.g. USD"),
  locale: z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/, "e.g. en-US"),
  taxPercent: z.number().min(0).max(50),
  labourRateCents: cents,
  serviceIntervalMonths: z.number().int().min(1).max(60),
});

export const userCreateSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  name: text(120).min(2),
  role: z.enum(ROLES),
  password: passwordSchema,
});
export const userUpdateSchema = z.object({ name: text(120).min(2), role: z.enum(ROLES), active: z.boolean() });
export const resetPasswordSchema = z.object({ password: passwordSchema });

export const periodSchema = z.object({ from: isoDay, to: isoDay });

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

/** One row in job lists and on the board. */
export interface JobRow {
  id: string;
  number: string;
  bookedFor: string;
  createdAt: string;
  status: JobStatus;
  statusSince: string;
  complaint: string;
  technicianId: string | null;
  customer: { id: string; name: string; phone: string };
  vehicle: { id: string; plate: string; make: string; model: string; year: number };
  invoice: { number: string; paid: boolean; totalCents: number } | null;
  totalCents: number;
  workSummary: string;
}

export interface JobDetail {
  job: Job;
  customer: Customer;
  vehicle: Vehicle;
  customerVehicles: Vehicle[];
  totals: JobTotals;
  invoiceVoids: { number: string; voidedAt: string; reason: string }[];
}

/** An issued invoice exactly as it was when issued. */
export interface InvoiceDoc {
  number: string;
  jobId: string;
  jobNumber: string;
  issuedAt: string;
  paidAt: string | null;
  method: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  taxPercent: number;
  labourCents: number;
  partsCents: number;
  discountCents: number;
  netCents: number;
  taxCents: number;
  totalCents: number;
  lines: { kind: "labour" | "part"; description: string; qty: number; unitCents: number; amountCents: number }[];
  customer: { name: string; phone: string; email: string };
  vehicle: { plate: string; make: string; model: string; year: number; vin: string; mileageIn: number };
  workshop: { name: string; address: string; phone: string; email: string; currency: string; locale: string };
}
