import type { Direction, Scenario, Transaction } from "../types";
import { suggestCategory } from "./categorize";
import { addDays, parseISO, toISO, todayISO } from "./format";

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20261114);
const between = (min: number, max: number) => min + rand() * (max - min);
const pick = <T,>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];
const chance = (p: number) => rand() < p;
const round = (n: number) => Math.round(n / 10) * 10;

type Draft = Omit<Transaction, "id" | "source">;

function demoDrafts(today = todayISO()): Draft[] {
  const todayDate = new Date(today);
  const drafts: Draft[] = [];
  const push = (
    date: Date,
    description: string,
    amount: number,
    direction: Direction,
    category?: string,
  ) => {
    const iso = toISO(date);
    if (iso > today) return;
    drafts.push({
      date: iso,
      description,
      amount: Math.max(1, Math.round(amount)),
      direction,
      category: category ?? suggestCategory(description, direction),
    });
  };

  for (let offset = 25; offset >= 0; offset--) {
    const anchor = new Date(todayDate.getFullYear(), todayDate.getMonth() - offset, 1);
    const year = anchor.getFullYear();
    const month = anchor.getMonth();
    const day = (d: number) =>
      new Date(year, month, Math.min(d, new Date(year, month + 1, 0).getDate()));

    /* ---- recurring income & bills ---- */
    push(day(1), "Acme Technologies Salary Credit", 80000, "income", "Salary");
    push(day(5), "House Rent - Koramangala (UPI)", 30000, "expense", "Rent");
    push(day(7), "HDFC Personal Loan EMI", 9850, "expense", "Loan EMI");
    push(day(3), "Cult.fit Gym Membership", 1499, "expense", "Health");
    push(day(9), "Adobe Creative Cloud", 1675, "expense", "Subscriptions");
    push(day(12), "BESCOM Electricity Bill", between(1780, 2640), "expense", "Utilities");
    push(day(14), "Airtel Fiber Broadband", 999, "expense", "Utilities");
    push(day(16), "Netflix Subscription", 649, "expense", "Subscriptions");
    push(day(18), "Spotify Premium", 119, "expense", "Subscriptions");
    push(day(21), "Google One Storage", 210, "expense", "Subscriptions");

    // Quarterly bike insurance – four payments a year, next one lands inside the 30-day view.
    if ((12 - offset + 24) % 3 === 0) {
      push(day(24), "ICICI Lombard Two-Wheeler Insurance", 2180, "expense", "Insurance");
    }

    // Annual health cover paid every November: the big upcoming commitment.
    if (month === 10) {
      push(day(20), "Star Health Family Floater Annual Premium", 46800, "expense", "Insurance");
    }

    /* ---- variable everyday spending ---- */
    const diningCount = Math.round(between(5, 8));
    for (let i = 0; i < diningCount; i++) {
      const merchant = pick(["Swiggy Order", "Zomato Order", "Third Wave Coffee", "Truffles Restaurant"]);
      const amount =
        merchant === "Third Wave Coffee"
          ? between(220, 520)
          : merchant === "Truffles Restaurant"
            ? between(480, 1250)
            : between(260, 980);
      push(day(Math.ceil(between(1, 28))), merchant, round(amount), "expense", "Dining");
    }

    const transportCount = Math.round(between(4, 7));
    for (let i = 0; i < transportCount; i++) {
      const merchant = pick(["Uber Ride", "Ola Cabs", "Indian Oil Fuel", "Namma Metro Recharge"]);
      const amount =
        merchant === "Indian Oil Fuel"
          ? between(500, 1700)
          : merchant === "Namma Metro Recharge"
            ? between(100, 400)
            : between(140, 780);
      push(day(Math.ceil(between(1, 28))), merchant, round(amount), "expense", "Transport");
    }

    if (chance(0.8)) {
      push(day(Math.ceil(between(2, 27))), chance(0.55) ? "Blinkit Order" : "Urban Company Service", round(between(380, 2400)), "expense", "Household");
    }

    if (chance(0.85)) {
      const merchant = chance(0.7) ? "Amazon.in Order" : "Myntra Order";
      push(day(Math.ceil(between(2, 27))), merchant, round(between(750, 4600)), "expense", "Shopping");
    }

    if (chance(0.65)) {
      push(day(Math.ceil(between(3, 26))), "Apollo Pharmacy", round(between(180, 940)), "expense", "Health");
    }
    if (chance(0.3)) {
      push(day(Math.ceil(between(4, 25))), "Practo Video Consultation", 499, "expense", "Health");
    }
    if (chance(0.35)) {
      push(day(Math.ceil(between(6, 26))), chance(0.5) ? "PVR Cinemas" : "BookMyShow Tickets", round(between(480, 1300)), "expense", "Entertainment");
    }
  }

  /* ---- weekly groceries: fixed rhythm, variable amounts -> Review candidate ---- */
  const groceryStart = addDays(today, -7 * 112);
  for (let cursor = groceryStart; cursor <= today; cursor = addDays(cursor, 7)) {
    push(parseISO(cursor), "BigBasket Order", round(between(950, 3350)), "expense", "Groceries");
  }

  /* ---- one-off events that make the demo feel lived-in ---- */
  const current = new Date(today);
  push(new Date(current.getFullYear(), current.getMonth() - 3, 18), "Croma Electronics - Laptop Purchase", 67999, "expense", "Shopping");
  push(new Date(current.getFullYear(), current.getMonth() - 7, 12), "IndiGo Flight Booking", 12400, "expense", "Travel");
  push(new Date(current.getFullYear(), current.getMonth() - 11, 4), "IRCTC Train Tickets", 1760, "expense", "Travel");
  push(new Date(current.getFullYear(), current.getMonth() - 1, 11), "Apollo Pharmacy - Full Body Health Checkup", 6850, "expense", "Health");
  push(new Date(current.getFullYear(), current.getMonth() - 9, 22), "Udemy Course Purchase", 449, "expense", "Education");
  push(new Date(current.getFullYear(), current.getMonth() - 6, 15), "Amazon Refund", 1299, "income", "Refund");
  push(new Date(current.getFullYear(), current.getMonth() - 1, 26), "Nova Design Studio Invoice", 18500, "income", "Freelance");
  push(new Date(current.getFullYear(), current.getMonth() - 8, 8), "Nova Design Studio Invoice", 14200, "income", "Freelance");
  push(new Date(current.getFullYear(), current.getMonth() - 4, 19), "Nova Design Studio Invoice", 9600, "income", "Freelance");
  push(new Date(current.getFullYear(), current.getMonth() - 13, 21), "Nova Design Studio Invoice", 21500, "income", "Freelance");

  return drafts;
}

export function buildDemoTransactions(today = todayISO()): Transaction[] {
  return demoDrafts(today)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((draft, index) => ({
      ...draft,
      id: `demo-${String(index + 1).padStart(4, "0")}`,
      source: "demo" as const,
    }));
}

export function buildDemoScenarios(today = todayISO()): Scenario[] {
  return [
    {
      id: "scenario-demo-laptop",
      name: "Laptop upgrade",
      amount: 68000,
      date: addDays(today, 20),
      kind: "expense",
      active: false,
    },
    {
      id: "scenario-demo-prepay",
      name: "Extra loan repayment",
      amount: 25000,
      date: addDays(today, 9),
      kind: "repayment",
      active: false,
    },
  ];
}

export const DEMO_FACTS = {
  months: 26,
  monthlyIncome: 80000,
  household: "Koramangala, Bengaluru",
};
