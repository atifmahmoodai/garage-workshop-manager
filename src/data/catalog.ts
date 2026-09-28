import type { Part } from "../types";

type PartSeed = Omit<Part, "id" | "stock">;

// [sku, name, category, cost $, price $, reorder level]
const P: [string, string, string, number, number, number][] = [
  ["OIL-5W30-5L", "Engine oil 5W-30 (5 L)", "Oils & fluids", 22, 45, 10],
  ["OIL-0W20-4L", "Engine oil 0W-20 (4 L)", "Oils & fluids", 24, 48, 8],
  ["FLT-OIL-STD", "Oil filter", "Filters", 4, 12, 15],
  ["FLT-AIR-STD", "Air filter", "Filters", 7, 22, 10],
  ["FLT-CAB-STD", "Cabin filter", "Filters", 6, 20, 8],
  ["FLT-FUEL-STD", "Fuel filter", "Filters", 9, 28, 5],
  ["BRK-PAD-F", "Brake pads (front set)", "Brakes", 28, 75, 6],
  ["BRK-PAD-R", "Brake pads (rear set)", "Brakes", 24, 65, 6],
  ["BRK-DSC-F", "Brake discs (front pair)", "Brakes", 60, 140, 4],
  ["BRK-FLD-1L", "Brake fluid DOT4 (1 L)", "Oils & fluids", 6, 18, 6],
  ["BAT-60AH", "Battery 60 Ah", "Electrical", 70, 145, 3],
  ["BAT-75AH", "Battery 75 Ah", "Electrical", 85, 175, 3],
  ["SPK-PLUG", "Spark plug", "Ignition", 5, 14, 16],
  ["WPR-BLD-PR", "Wiper blades (pair)", "Accessories", 8, 25, 8],
  ["BLB-H7", "Headlight bulb H7", "Electrical", 3, 12, 10],
  ["CLT-KIT", "Coolant 50/50 (5 L)", "Oils & fluids", 10, 28, 6],
  ["AC-GAS", "A/C refrigerant R1234yf (500 g)", "A/C", 35, 90, 4],
  ["TMB-KIT", "Timing belt kit with water pump", "Engine", 120, 280, 2],
  ["CLU-KIT", "Clutch kit", "Transmission", 180, 390, 2],
  ["TYR-205-55-16", "Tyre 205/55 R16", "Tyres", 55, 110, 8],
  ["TYR-225-65-17", "Tyre 225/65 R17", "Tyres", 75, 145, 8],
  ["SUS-SHK-F", "Front shock absorber", "Suspension", 45, 110, 4],
  ["SUS-LINK", "Stabiliser link", "Suspension", 12, 35, 6],
  ["BLT-SERP", "Serpentine belt", "Engine", 18, 48, 4],
];

export const PART_SEEDS: PartSeed[] = P.map(([sku, name, category, cost, price, reorderLevel]) => ({
  sku,
  name,
  category,
  costCents: cost * 100,
  priceCents: price * 100,
  reorderLevel,
}));

/** Standard jobs a service advisor adds with one click: labour hours + parts (by SKU). */
export interface ServicePackage {
  name: string;
  hours: number;
  parts: [sku: string, qty: number][];
  /** Relative frequency in the demo data. */
  weight: number;
}

export const SERVICE_PACKAGES: ServicePackage[] = [
  { name: "Oil & filter change", hours: 0.5, parts: [["OIL-5W30-5L", 1], ["FLT-OIL-STD", 1]], weight: 30 },
  { name: "Full service", hours: 2, parts: [["OIL-5W30-5L", 1], ["FLT-OIL-STD", 1], ["FLT-AIR-STD", 1], ["FLT-CAB-STD", 1], ["SPK-PLUG", 4]], weight: 18 },
  { name: "Front brake pads", hours: 1.2, parts: [["BRK-PAD-F", 1]], weight: 12 },
  { name: "Front pads & discs", hours: 1.8, parts: [["BRK-PAD-F", 1], ["BRK-DSC-F", 1]], weight: 6 },
  { name: "Rear brake pads", hours: 1.2, parts: [["BRK-PAD-R", 1]], weight: 6 },
  { name: "Brake fluid change", hours: 0.8, parts: [["BRK-FLD-1L", 1]], weight: 5 },
  { name: "Battery replacement", hours: 0.4, parts: [["BAT-60AH", 1]], weight: 8 },
  { name: "Diagnostics", hours: 1, parts: [], weight: 12 },
  { name: "A/C regas", hours: 0.8, parts: [["AC-GAS", 1]], weight: 6 },
  { name: "Timing belt replacement", hours: 4, parts: [["TMB-KIT", 1], ["CLT-KIT", 1]], weight: 3 },
  { name: "Clutch replacement", hours: 5.5, parts: [["CLU-KIT", 1]], weight: 2 },
  { name: "Two tyres fitted & balanced", hours: 0.8, parts: [["TYR-205-55-16", 2]], weight: 8 },
  { name: "Wheel alignment", hours: 0.8, parts: [], weight: 7 },
  { name: "Front shocks replacement", hours: 2.5, parts: [["SUS-SHK-F", 2], ["SUS-LINK", 2]], weight: 3 },
  { name: "Wiper blades & bulbs", hours: 0.3, parts: [["WPR-BLD-PR", 1], ["BLB-H7", 1]], weight: 5 },
];

export const CAR_MODELS: [string, string][] = [
  ["Toyota", "Corolla"], ["Toyota", "Camry"], ["Toyota", "RAV4"], ["Toyota", "Hilux"], ["Honda", "Civic"], ["Honda", "CR-V"],
  ["Honda", "City"], ["Hyundai", "Tucson"], ["Hyundai", "Elantra"], ["Kia", "Sportage"], ["Kia", "Picanto"], ["Ford", "Ranger"],
  ["Ford", "Focus"], ["Nissan", "Qashqai"], ["Suzuki", "Swift"], ["Volkswagen", "Golf"], ["BMW", "3 Series"], ["Mercedes-Benz", "C-Class"],
  ["Mazda", "CX-5"], ["Mitsubishi", "Outlander"],
];

export const COMPLAINTS: Record<string, string[]> = {
  "Oil & filter change": ["Oil change due", "Service light on"],
  "Full service": ["Annual service", "Service due by mileage"],
  "Front brake pads": ["Squealing when braking", "Brake warning light"],
  "Front pads & discs": ["Vibration under braking", "Grinding noise from front"],
  "Rear brake pads": ["Rear brakes noisy"],
  "Brake fluid change": ["Soft brake pedal"],
  "Battery replacement": ["Car won't start in the morning", "Battery warning light"],
  Diagnostics: ["Engine warning light on", "Rough idle", "Loss of power"],
  "A/C regas": ["A/C not cold"],
  "Timing belt replacement": ["Timing belt due at 100k"],
  "Clutch replacement": ["Clutch slipping", "Hard to change gear"],
  "Two tyres fitted & balanced": ["Front tyres worn", "Puncture, sidewall damage"],
  "Wheel alignment": ["Car pulls to the left", "Uneven tyre wear"],
  "Front shocks replacement": ["Knocking over bumps", "Bouncy ride"],
  "Wiper blades & bulbs": ["Wipers smearing, headlight out"],
};
