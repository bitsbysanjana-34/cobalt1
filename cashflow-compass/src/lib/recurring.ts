import type {
  Direction,
  Frequency,
  RecurringItem,
  RecurringStatus,
  Transaction,
} from "../types";
import { addDays, addMonths, clamp, daysBetween, median, stdDev } from "./format";

const NOISE =
  /\b(upi|neft|imps|rtgs|pos|ref|txn|transaction|payment|paid|to|from|via|order|online|pvt|ltd|limited|the|and|of|for|ac|no|id|autopay|auto|debit|credit|bill|charges?)\b/g;

export const FREQUENCY_LABEL: Record<Frequency, string> = {
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
  quarterly: "Quarterly",
  "half-yearly": "Every 6 months",
  yearly: "Yearly",
};

const FREQUENCY_DAYS: Record<Frequency, number> = {
  weekly: 7,
  biweekly: 14,
  monthly: 30.44,
  quarterly: 91.31,
  "half-yearly": 182.62,
  yearly: 365.25,
};

/** Stable grouping key: merchant-ish words without noise or digits. */
export function recurringKey(description: string, direction: Direction): string {
  const cleaned = description
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(NOISE, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = cleaned.split(" ").filter(Boolean).slice(0, 3).join(" ");
  return `${direction}:${words || description.toLowerCase().slice(0, 12)}`;
}

function frequencyFor(intervalDays: number): Frequency | null {
  if (intervalDays >= 5 && intervalDays <= 9) return "weekly";
  if (intervalDays >= 12 && intervalDays <= 17) return "biweekly";
  if (intervalDays >= 25 && intervalDays <= 36) return "monthly";
  if (intervalDays >= 80 && intervalDays <= 103) return "quarterly";
  if (intervalDays >= 165 && intervalDays <= 202) return "half-yearly";
  if (intervalDays >= 340 && intervalDays <= 392) return "yearly";
  return null;
}

function toleranceFor(intervalDays: number): number {
  if (intervalDays <= 9) return 2;
  if (intervalDays <= 17) return 3;
  if (intervalDays <= 36) return 6;
  if (intervalDays <= 103) return 14;
  if (intervalDays <= 202) return 24;
  return 40;
}

function advanceFrom(date: string, frequency: Frequency): string {
  switch (frequency) {
    case "weekly":
      return addDays(date, 7);
    case "biweekly":
      return addDays(date, 14);
    case "monthly":
      return addMonths(date, 1);
    case "quarterly":
      return addMonths(date, 3);
    case "half-yearly":
      return addMonths(date, 6);
    case "yearly":
      return addMonths(date, 12);
  }
}

export function monthlyEquivalent(item: RecurringItem): number {
  const multiplier =
    item.frequency === "weekly"
      ? 52 / 12
      : item.frequency === "biweekly"
        ? 26 / 12
        : item.frequency === "monthly"
          ? 1
          : item.frequency === "quarterly"
            ? 1 / 3
            : item.frequency === "half-yearly"
              ? 1 / 6
              : 1 / 12;
  return item.typicalAmount * multiplier;
}

function nextOccurrence(lastDate: string, frequency: Frequency, today: string): string {
  let cursor = lastDate;
  for (let i = 0; i < 40; i++) {
    cursor = advanceFrom(cursor, frequency);
    if (cursor >= today) return cursor;
  }
  return cursor;
}

function mode(values: string[], fallback: string): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best = fallback;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

export function projectOccurrences(
  item: RecurringItem,
  horizonEnd: string,
): string[] {
  const dates: string[] = [];
  let cursor = item.nextDate;
  for (let i = 0; i < 24 && cursor <= horizonEnd; i++) {
    dates.push(cursor);
    cursor = advanceFrom(cursor, item.frequency);
  }
  return dates;
}

/** Detect likely recurring payments from description grouping + timing regularity. */
export function detectRecurring(
  transactions: Transaction[],
  overrides: Record<string, RecurringStatus> = {},
  today: string,
): RecurringItem[] {
  const groups = new Map<string, Transaction[]>();
  for (const transaction of transactions) {
    const key = recurringKey(transaction.description, transaction.direction);
    const bucket = groups.get(key);
    if (bucket) bucket.push(transaction);
    else groups.set(key, [transaction]);
  }

  const items: RecurringItem[] = [];

  for (const [key, raw] of groups) {
    if (raw.length < 2) continue;
    const sorted = [...raw].sort((a, b) => (a.date < b.date ? -1 : 1));
    const dates = sorted.map((t) => t.date);
    const amounts = sorted.map((t) => t.amount);
    const intervals = dates
      .slice(1)
      .map((date, index) => daysBetween(dates[index], date))
      .filter((value) => value > 0);
    if (intervals.length === 0) continue;

    const interval = median(intervals);
    const frequency = frequencyFor(interval);
    if (!frequency) continue;
    const tolerance = toleranceFor(interval);
    const regularShare =
      intervals.filter((value) => Math.abs(value - interval) <= tolerance).length /
      intervals.length;
    const averageAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const cv = averageAmount > 0 ? stdDev(amounts) / averageAmount : 0;
    const requiredOccurrences = frequency === "yearly" ? 2 : 3;
    if (sorted.length < requiredOccurrences) continue;
    if (regularShare < 0.6) continue;

    const stability = clamp(1 - cv, 0, 1);
    const countScore = clamp((sorted.length - 2) / 4, 0, 1);
    const confidence = clamp(
      0.3 + 0.3 * regularShare + 0.25 * stability + 0.15 * countScore,
      0,
      0.99,
    );
    const autoConfirmed = regularShare >= 0.75 && cv <= 0.25;
    const override = overrides[key];
    const status: RecurringStatus =
      override === "dismissed"
        ? "dismissed"
        : override === "confirmed"
          ? "confirmed"
          : autoConfirmed
            ? "confirmed"
            : "review";

    const lastDate = dates[dates.length - 1];
    const direction = sorted[0].direction;
    const typical = Math.round(median(amounts));
    const detectionNote = autoConfirmed
      ? `${sorted.length} payments at a steady ${FREQUENCY_LABEL[frequency].toLowerCase()} rhythm, amounts within ±${Math.round(cv * 100)}%.`
      : cv > 0.25
        ? `Timing looks ${FREQUENCY_LABEL[frequency].toLowerCase()}, but amounts vary ±${Math.round(cv * 100)}% — possibly variable spending rather than a fixed bill.`
        : `The ${FREQUENCY_LABEL[frequency].toLowerCase()} rhythm is only partly regular (${Math.round(regularShare * 100)}% of gaps match). Please review.`;

    items.push({
      key,
      label: sorted[sorted.length - 1].description,
      direction,
      category: mode(sorted.map((t) => t.category), sorted[0].category),
      frequency,
      intervalDays: interval,
      typicalAmount: typical,
      firstDate: dates[0],
      lastDate,
      nextDate: nextOccurrence(lastDate, frequency, today),
      occurrences: sorted.length,
      confidence,
      amountStability: stability,
      status,
      dates: dates.slice(-6),
      amounts: amounts.slice(-6),
      detectionNote,
    });
  }

  return items.sort((a, b) => a.nextDate.localeCompare(b.nextDate));
}

export function frequencyDays(frequency: Frequency): number {
  return FREQUENCY_DAYS[frequency];
}
