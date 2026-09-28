export const JOB_STATUSES = ["Booked", "In progress", "Waiting parts", "Ready", "Completed", "Cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
/** Statuses shown as columns on the workshop board. */
export const BOARD_STATUSES: JobStatus[] = ["Booked", "In progress", "Waiting parts", "Ready"];

export const PAYMENT_METHODS = ["Cash", "Card", "Bank transfer"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export interface Settings {
  name: string;
  address: string;
  phone: string;
  email: string;
  currency: string;
  locale: string;
  taxPercent: number;
  /** Default labour rate per hour, in cents. */
  labourRateCents: number;
  /** Months between services before a vehicle shows as due. */
  serviceIntervalMonths: number;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string;
}

export interface Vehicle {
  id: string;
  customerId: string;
  plate: string;
  make: string;
  model: string;
  year: number;
  vin: string;
  mileage: number;
}

export interface Technician {
  id: string;
  name: string;
  active: boolean;
}

export interface Part {
  id: string;
  sku: string;
  name: string;
  category: string;
  stock: number;
  reorderLevel: number;
  costCents: number;
  priceCents: number;
}

export interface LabourLine {
  id: string;
  description: string;
  hours: number;
  rateCents: number;
}

export interface PartLine {
  id: string;
  /** Linked stock item; stock is adjusted when the line is saved. Empty for one-off/sublet items. */
  partId?: string;
  description: string;
  qty: number;
  unitPriceCents: number;
  unitCostCents: number;
}

export interface StatusEvent {
  status: JobStatus;
  at: string;
}

export interface Invoice {
  number: string;
  issuedAt: string;
  paidAt?: string;
  method?: PaymentMethod;
}

export interface Job {
  id: string;
  number: string;
  customerId: string;
  vehicleId: string;
  /** YYYY-MM-DD the car is booked in. */
  bookedFor: string;
  createdAt: string;
  complaint: string;
  notes: string;
  mileageIn: number;
  status: JobStatus;
  statusHistory: StatusEvent[];
  technicianId?: string;
  labour: LabourLine[];
  parts: PartLine[];
  discountCents: number;
  invoice?: Invoice;
}

export interface WorkshopData {
  settings: Settings;
  customers: Customer[];
  vehicles: Vehicle[];
  technicians: Technician[];
  parts: Part[];
  jobs: Job[];
}
