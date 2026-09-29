import { addDays, parseDay } from "./dates";
import { createRng } from "./random";
import type { Customer, Job, JobStatus, LabourLine, Part, PartLine, StatusEvent, Technician, Vehicle, WorkshopData } from "./types";
import { DEFAULT_SETTINGS } from "./settings-defaults";
import { CAR_MODELS, COMPLAINTS, PART_SEEDS, SERVICE_PACKAGES } from "./catalog";

export { DEFAULT_SETTINGS };

const FIRST = ["Ava", "Noah", "Liam", "Emma", "Zara", "Ali", "Hana", "Ethan", "Mia", "Yusuf", "Sofia", "Daniel", "Aisha", "Leo", "Grace", "Ryan", "Fatima", "Oliver", "Chloe", "Adam", "Nora", "Samuel", "Layla", "Ben"];
const LAST = ["Smith", "Khan", "Garcia", "Patel", "Nguyen", "Brown", "Wilson", "Ali", "Martin", "Lee", "Hassan", "Clark", "Lopez", "Walker", "Young", "Hall", "Rahman", "King", "Scott", "Green"];
const LETTERS = "ABCDEFGHJKLMNPRSTUVWXYZ";
const VIN_CHARS = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789";

const iso = (day: string, hour: number) => new Date(parseDay(day) + Math.round(hour * 60) * 60_000).toISOString();

/** Six months of workshop history ending `today`, plus today's board and the next few days of bookings. */
export function generateDemoData(today: string, seed = 4242): WorkshopData {
  const r = createRng(seed);
  const settings = { ...DEFAULT_SETTINGS };

  const technicians: Technician[] = [
    { id: "t-marco", name: "Marco Silva", active: true },
    { id: "t-priya", name: "Priya Nair", active: true },
    { id: "t-kwame", name: "Kwame Mensah", active: true },
  ];

  const parts: Part[] = PART_SEEDS.map((p, i) => ({
    ...p,
    id: `p-${String(i + 1).padStart(3, "0")}`,
    // A few items deliberately at or below their reorder level.
    stock: i % 7 === 3 ? r.int(0, p.reorderLevel) : p.reorderLevel + r.int(2, 18),
  }));
  const bySku = new Map(parts.map((p) => [p.sku, p]));

  const customers: Customer[] = [];
  const vehicles: Vehicle[] = [];
  for (let i = 0; i < 160; i++) {
    const first = r.pick(FIRST);
    const last = r.pick(LAST);
    const c: Customer = {
      id: `c-${String(i + 1).padStart(4, "0")}`,
      name: `${first} ${last}`,
      phone: `+1 (555) ${r.int(200, 999)}-${String(r.int(0, 9999)).padStart(4, "0")}`,
      email: r.chance(0.8) ? `${first}.${last}${r.int(1, 99)}@example.com`.toLowerCase() : "",
    };
    customers.push(c);
    const cars = r.chance(0.18) ? 2 : 1;
    for (let k = 0; k < cars; k++) {
      const [make, model] = r.pick(CAR_MODELS);
      const year = Number(today.slice(0, 4)) - r.int(1, 14);
      let vin = "";
      for (let j = 0; j < 17; j++) vin += VIN_CHARS[r.int(0, VIN_CHARS.length - 1)];
      vehicles.push({
        id: `v-${String(vehicles.length + 1).padStart(4, "0")}`,
        customerId: c.id,
        plate: `${LETTERS[r.int(0, 22)]}${LETTERS[r.int(0, 22)]}${r.int(10, 99)} ${LETTERS[r.int(0, 22)]}${LETTERS[r.int(0, 22)]}${LETTERS[r.int(0, 22)]}`,
        make,
        model,
        year,
        vin,
        mileage: (Number(today.slice(0, 4)) - year) * r.int(9000, 16000),
      });
    }
  }

  // Mileage grows as we replay history, so start each car lower.
  for (const v of vehicles) v.mileage = Math.max(1000, v.mileage - r.int(4000, 9000));

  const jobs: Job[] = [];
  let jobNo = 1001;
  let invNo = 5001;
  const start = addDays(today, -182);
  let lineSeq = 1;
  const lid = () => `ln-${lineSeq++}`;

  function makeLines(): { labour: LabourLine[]; parts: PartLine[]; complaint: string } {
    const count = r.chance(0.8) ? 1 : 2;
    const labour: LabourLine[] = [];
    const lines: PartLine[] = [];
    const complaints: string[] = [];
    const used = new Set<string>();
    for (let i = 0; i < count; i++) {
      const pkg = r.weighted(SERVICE_PACKAGES, SERVICE_PACKAGES.map((p) => p.weight));
      if (used.has(pkg.name)) continue;
      used.add(pkg.name);
      complaints.push(r.pick(COMPLAINTS[pkg.name] ?? [pkg.name]));
      // Real jobs rarely take exactly book time.
      const hours = Math.max(0.3, Math.round(pkg.hours * r.float(0.9, 1.25) * 10) / 10);
      labour.push({ id: lid(), description: pkg.name, hours, rateCents: settings.labourRateCents });
      for (const [sku, qty] of pkg.parts) {
        const p = bySku.get(sku)!;
        lines.push({ id: lid(), partId: p.id, description: p.name, qty, unitPriceCents: p.priceCents, unitCostCents: p.costCents });
      }
    }
    return { labour, parts: lines, complaint: complaints.join("; ") };
  }

  for (let day = start; day <= addDays(today, 6); day = addDays(day, 1)) {
    const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
    if (dow === 0) continue; // closed Sundays
    const isPast = day < today;
    const isToday = day === today;
    const growth = 1 + 0.25 * ((parseDay(day) - parseDay(start)) / (parseDay(today) - parseDay(start)));
    const n = isToday ? Math.max(5, Math.round(r.int(3, 6) * growth)) : isPast ? Math.round(r.int(5, 9) * growth) : r.int(3, 6);

    for (let i = 0; i < n; i++) {
      const vehicle = r.pick(vehicles);
      vehicle.mileage += r.int(1500, 6000);
      const { labour, parts: lines, complaint } = makeLines();
      const tech = r.pick(technicians).id;
      const checkIn = r.float(8, 11);
      let createdDay = addDays(day, -r.int(0, 6));
      if (createdDay > today) createdDay = today;
      // Same-day bookings are made before the car is checked in.
      const createdAt = iso(createdDay, createdDay >= day ? r.float(7, checkIn - 0.25) : r.float(8, 17));
      const history: StatusEvent[] = [{ status: "Booked", at: createdAt }];
      let status: JobStatus = "Booked";
      let invoice: Job["invoice"];

      if (isPast) {
        if (r.chance(0.03)) {
          status = "Cancelled";
          history.push({ status, at: iso(day, checkIn) }); // after the booking was made
        } else {
          history.push({ status: "In progress", at: iso(day, checkIn) });
          let t = checkIn + labour.reduce((s, l) => s + l.hours, 0) + r.float(0.3, 2);
          let doneDay = day;
          if (r.chance(0.1)) {
            history.push({ status: "Waiting parts", at: iso(day, Math.min(17, t)) });
            doneDay = addDays(day, r.int(1, 3));
            t = r.float(10, 15);
          }
          if (doneDay > today) doneDay = today;
          history.push({ status: "Ready", at: iso(doneDay, Math.min(18, t)) });
          const daysAgo = parseDay(today) - parseDay(doneDay);
          // Most recent "Ready" cars may still be waiting for collection.
          if (daysAgo > 86_400_000 * 2 || r.chance(0.6)) {
            const collectedDay = r.chance(0.85) ? doneDay : addDays(doneDay, 1) > today ? today : addDays(doneDay, 1);
            status = "Completed";
            const at = iso(collectedDay, Math.min(19, t + r.float(0.5, 3)));
            history.push({ status, at });
            const unpaid = parseDay(today) - parseDay(collectedDay) < 86_400_000 * 20 && r.chance(0.12);
            invoice = {
              number: `INV-${invNo++}`,
              issuedAt: at,
              paidAt: unpaid ? undefined : at,
              method: unpaid ? undefined : r.weighted(["Card", "Cash", "Bank transfer"] as const, [6, 2, 2]),
            };
          } else status = "Ready";
        }
      } else if (isToday) {
        // The first four of today's jobs cover every board column so the demo always shows the full flow.
        const board: JobStatus[] = ["Booked", "In progress", "Waiting parts", "Ready"];
        status = i < board.length ? board[i] : r.weighted<JobStatus>(board, [3, 4, 1, 2]);
        if (status !== "Booked") history.push({ status: "In progress", at: iso(day, checkIn) });
        if (status === "Waiting parts") history.push({ status, at: iso(day, checkIn + 1) });
        if (status === "Ready") history.push({ status, at: iso(day, checkIn + 2) });
      }

      jobs.push({
        id: `j-${jobNo}`,
        number: `J-${jobNo++}`,
        customerId: vehicle.customerId,
        vehicleId: vehicle.id,
        bookedFor: day,
        createdAt,
        complaint,
        notes: "",
        mileageIn: vehicle.mileage,
        status,
        statusHistory: history,
        technicianId: status === "Booked" && !isPast ? (r.chance(0.5) ? tech : undefined) : tech,
        labour: status === "Booked" && !isPast ? labour.map((l) => ({ ...l })) : labour,
        parts: status === "Booked" && !isPast ? [] : lines,
        discountCents: r.chance(0.08) ? 1000 * r.int(1, 5) : 0,
        invoice,
      });
    }
  }

  return { settings, customers, vehicles, technicians, parts, jobs };
}
