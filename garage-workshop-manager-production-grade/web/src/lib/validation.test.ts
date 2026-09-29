import { describe, expect, it } from "vitest";
import { validateCustomer } from "../pages/CustomerDetail";
import { validateJob } from "../pages/JobEditor";
import { validatePart } from "../pages/Parts";
import { validateSettings } from "../pages/Settings";
import { DEFAULT_SETTINGS } from "../../../shared/settings-defaults";
import type { Job } from "../types";

const job: Job = {
  id: "", number: "", customerId: "c", vehicleId: "v", bookedFor: "2026-09-28", createdAt: "", complaint: "Noise", notes: "", mileageIn: 10,
  status: "Booked", statusHistory: [], labour: [{ id: "1", description: "Check", hours: 1, rateCents: 9500 }], parts: [], discountCents: 0,
};

describe("form validation", () => {
  it("job cards", () => {
    expect(validateJob(job, {})).toEqual([]);
    expect(validateJob({ ...job, customerId: "", complaint: " " }, {}).join(" ")).toMatch(/customer.*request/i);
    expect(validateJob({ ...job, parts: [{ id: "p", description: "x", qty: 1.5, unitPriceCents: 1, unitCostCents: 0 }] }, {}).join(" ")).toMatch(/whole number/);
    expect(validateJob({ ...job, status: "Completed", labour: [] }, {}).join(" ")).toMatch(/work done/);
    expect(validateJob({ ...job, customerId: "" }, { newCustomer: { name: "A", phone: "1", email: "" } })).toHaveLength(2);
  });
  it("customers", () => {
    expect(validateCustomer({ name: "Ann Lee", phone: "555 1234", email: "" })).toEqual([]);
    expect(validateCustomer({ name: "A", phone: "12", email: "bad" })).toHaveLength(3);
  });
  it("parts", () => {
    const others = [{ id: "a", sku: "OIL-1", name: "", category: "", stock: 0, reorderLevel: 0, costCents: 0, priceCents: 0 }];
    expect(validatePart({ sku: "oil-1", name: "Oil", category: "", stock: "1", reorderLevel: "1", cost: "1", price: "2" }, others).join(" ")).toMatch(/already used/);
    expect(validatePart({ id: "a", sku: "OIL-1", name: "Oil", category: "", stock: "x", reorderLevel: "1", cost: "1", price: "2" }, others)).toEqual([]);
  });
  it("settings", () => {
    expect(validateSettings(DEFAULT_SETTINGS, "95.00")).toEqual([]);
    expect(validateSettings({ ...DEFAULT_SETTINGS, currency: "XX1" }, "95").join(" ")).toMatch(/valid currency/);
  });
});
