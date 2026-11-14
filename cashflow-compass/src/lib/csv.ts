import type { CsvParseResult, Direction, ParsedRow, Transaction } from "../types";
import { ALL_CATEGORIES, INCOME_CATEGORIES, suggestCategory } from "./categorize";
import { addDays, safeNumber, toISO, todayISO } from "./format";

type Field =
  | "date"
  | "description"
  | "amount"
  | "debit"
  | "credit"
  | "type"
  | "category";

const SYNONYMS: Record<Field, string[]> = {
  date: ["date", "transactiondate", "txndate", "valuedate", "posteddate", "dt", "bookingdate"],
  description: ["description", "narration", "details", "merchant", "payee", "particulars", "memo", "name", "remarks"],
  amount: ["amount", "value", "transactionamount", "amt", "amountinr"],
  debit: ["debit", "withdrawal", "withdrawals", "dr", "debitamount"],
  credit: ["credit", "deposit", "deposits", "cr", "creditamount"],
  type: ["type", "direction", "drcr", "transactiontype", "kind", "inout"],
  category: ["category", "tag", "expensecategory", "budgetcategory"],
};

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/)[0] ?? "";
  const candidates = [",", ";", "\t"];
  let best = ",";
  let bestCount = -1;
  for (const candidate of candidates) {
    const count = firstLine.split(candidate).length - 1;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

function splitRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

function isoFromParts(year: number, month: number, day: number): string | null {
  if (year < 1970 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return toISO(date);
}

/** Accepts ISO, DD/MM/YYYY, MM/DD/YYYY, "12 Nov 2026", "Nov 12, 2026" and Excel serials. */
export function parseFlexibleDate(raw: string): string | null {
  const value = raw.trim().replace(/\s+/g, " ");
  if (!value) return null;

  const iso = value.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) {
    return isoFromParts(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  const numeric = value.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (numeric) {
    let first = Number(numeric[1]);
    let second = Number(numeric[2]);
    let year = Number(numeric[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    if (first > 12 && second <= 12) {
      return isoFromParts(year, second, first);
    }
    if (second > 12 && first <= 12) {
      return isoFromParts(year, first, second);
    }
    // Ambiguous: Indian convention dd/mm/yyyy.
    return isoFromParts(year, second, first);
  }

  const dayMonthName = value.match(/^(\d{1,2})[\s-]([A-Za-z]{3,9})[\s,-]+(\d{2,4})$/);
  if (dayMonthName) {
    const month = MONTHS.indexOf(dayMonthName[2].slice(0, 3).toLowerCase());
    let year = Number(dayMonthName[3]);
    if (year < 100) year += 2000;
    if (month >= 0) return isoFromParts(year, month + 1, Number(dayMonthName[1]));
  }

  const monthNameDay = value.match(/^([A-Za-z]{3,9})[\s-](\d{1,2})[\s,-]+(\d{2,4})$/);
  if (monthNameDay) {
    const month = MONTHS.indexOf(monthNameDay[1].slice(0, 3).toLowerCase());
    let year = Number(monthNameDay[3]);
    if (year < 100) year += 2000;
    if (month >= 0) return isoFromParts(year, month + 1, Number(monthNameDay[2]));
  }

  const serial = Number(value);
  if (Number.isFinite(serial) && serial > 20000 && serial < 80000) {
    const date = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
    return toISO(new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }

  return null;
}

function directionFromType(raw: string): Direction | null {
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  if (/(^|\b)(income|credit|cr|deposit|inflow|received|in)(\b|$)/.test(value)) return "income";
  if (/(^|\b)(expense|debit|dr|withdrawal|outflow|paid|out|spend)(\b|$)/.test(value)) {
    return "expense";
  }
  return null;
}

function categoryValidFor(category: string, direction: Direction): boolean {
  const list = direction === "income" ? INCOME_CATEGORIES : ALL_CATEGORIES;
  return (list as readonly string[]).includes(category);
}

export function parseCsv(
  text: string,
  existing: Transaction[],
  positiveMeansExpense = true,
): CsvParseResult {
  const errors: { row: number; message: string }[] = [];
  const cleanText = text.replace(/^\uFEFF/, "");
  if (!cleanText.trim()) {
    return {
      headers: [],
      rows: [],
      errors: [{ row: 0, message: "The file is empty." }],
      mapping: {},
      positiveMeansExpense,
      hasTypeColumn: false,
      hasExplicitSigns: false,
      skipped: 0,
    };
  }
  const delimiter = detectDelimiter(cleanText);
  const table = splitRows(cleanText, delimiter);
  if (table.length < 2) {
    return {
      headers: table[0] ?? [],
      rows: [],
      errors: [{ row: 0, message: "No data rows were found under the header row." }],
      mapping: {},
      positiveMeansExpense,
      hasTypeColumn: false,
      hasExplicitSigns: false,
      skipped: 0,
    };
  }

  const headers = table[0].map((header) => header.trim());
  const mapping: Record<string, string | null> = {};
  headers.forEach((header, index) => {
    const normalized = normalizeHeader(header);
    for (const [field, synonyms] of Object.entries(SYNONYMS) as [Field, string[]][]) {
      if (mapping[field]) continue;
      if (synonyms.includes(normalized)) {
        mapping[field] = headers[index];
        return;
      }
    }
  });

  const indexOf = (field: Field): number => {
    const name = mapping[field];
    if (!name) return -1;
    return headers.findIndex((header) => header === name);
  };

  const dateIndex = indexOf("date");
  const descriptionIndex = indexOf("description");
  const amountIndex = indexOf("amount");
  const debitIndex = indexOf("debit");
  const creditIndex = indexOf("credit");
  const typeIndex = indexOf("type");
  const categoryIndex = indexOf("category");

  if (dateIndex < 0) errors.push({ row: 0, message: "Missing a date column (e.g. `date`)." });
  if (descriptionIndex < 0) {
    errors.push({ row: 0, message: "Missing a description column (e.g. `description`)." });
  }
  if (amountIndex < 0 && debitIndex < 0 && creditIndex < 0) {
    errors.push({
      row: 0,
      message: "Missing an amount column. Provide `amount`, or `debit`/`credit` columns.",
    });
  }
  if (errors.length > 0) {
    return {
      headers,
      rows: [],
      errors,
      mapping,
      positiveMeansExpense,
      hasTypeColumn: typeIndex >= 0,
      hasExplicitSigns: false,
      skipped: 0,
    };
  }

  const existingSignatures = new Set(
    existing.map(
      (tx) => `${tx.date}|${tx.description.toLowerCase().trim()}|${tx.amount}|${tx.direction}`,
    ),
  );
  const seen = new Set<string>();
  const today = todayISO();
  const hasExplicitSigns = table.slice(1).some((cells) => {
    const raw = (cells[amountIndex] ?? "").trim();
    return /^-/.test(raw) || /\(.*\)/.test(raw) || /\b(cr|dr)\b/i.test(raw);
  });

  const rows: ParsedRow[] = table.slice(1).map((cells, rowIndex) => {
    const rawDate = dateIndex >= 0 ? (cells[dateIndex] ?? "").trim() : "";
    const description = descriptionIndex >= 0 ? (cells[descriptionIndex] ?? "").trim() : "";
    const categoryRaw = categoryIndex >= 0 ? (cells[categoryIndex] ?? "").trim() : "";
    const typeRaw = typeIndex >= 0 ? (cells[typeIndex] ?? "").trim() : "";
    let amountRaw = amountIndex >= 0 ? (cells[amountIndex] ?? "").trim() : "";
    const debitRaw = debitIndex >= 0 ? (cells[debitIndex] ?? "").trim() : "";
    const creditRaw = creditIndex >= 0 ? (cells[creditIndex] ?? "").trim() : "";

    let amount: number | null = null;
    let error: string | null = null;
    let warning: string | null = null;
    let direction: Direction = positiveMeansExpense ? "expense" : "income";

    const typeDirection = directionFromType(typeRaw);
    const creditValue = creditRaw ? safeNumber(creditRaw) : NaN;
    const debitValue = debitRaw ? safeNumber(debitRaw) : NaN;

    if (creditRaw && Number.isFinite(creditValue) && creditValue !== 0) {
      amount = Math.abs(creditValue);
      direction = "income";
    } else if (debitRaw && Number.isFinite(debitValue) && debitValue !== 0) {
      amount = Math.abs(debitValue);
      direction = "expense";
    } else if (amountRaw) {
      const negative = /^-/.test(amountRaw) || /^\(.*\)$/.test(amountRaw);
      const crHint = /\bcr\b\.?$/i.test(amountRaw);
      const drHint = /\bdr\b\.?$/i.test(amountRaw);
      const parsed = safeNumber(amountRaw);
      amountRaw = amountRaw.replace(/\s*(dr|cr)\.?$/i, "");
      if (!Number.isFinite(parsed)) {
        error = `Amount "${(cells[amountIndex] ?? "").trim()}" is not a number.`;
      } else if (parsed === 0) {
        error = "Amount is zero.";
      } else {
        amount = Math.abs(parsed);
        if (typeDirection) direction = typeDirection;
        else if (negative || drHint) direction = "expense";
        else if (crHint) direction = "income";
        else direction = positiveMeansExpense ? "expense" : "income";
      }
    } else if (!debitRaw && !creditRaw) {
      error = "Amount is missing.";
    } else {
      error = "Debit/credit value is not numeric.";
    }

    const date = parseFlexibleDate(rawDate);
    if (!rawDate) error = error ?? "Date is missing.";
    else if (!date) error = error ?? `Could not read date "${rawDate}".`;

    if (!description) error = error ?? "Description is missing.";

    let category: string | null = null;
    if (categoryRaw) {
      const matched = ALL_CATEGORIES.find(
        (candidate) => candidate.toLowerCase() === categoryRaw.toLowerCase(),
      );
      if (matched) {
        if (!categoryValidFor(matched, direction)) {
          if (direction === "expense" && (INCOME_CATEGORIES as readonly string[]).includes(matched)) {
            direction = "income";
          } else {
            warning = `Category "${matched}" does not fit ${direction}; it will be auto-categorized.`;
          }
        } else {
          category = matched;
        }
      } else {
        warning = `Category "${categoryRaw}" is not recognised; it will be auto-categorized.`;
      }
    }

    if (date) {
      const signature = `${date}|${description.toLowerCase().trim()}|${amount}|${direction}`;
      if (existingSignatures.has(signature) || seen.has(signature)) {
        warning = "Possible duplicate of an existing transaction — skipped on import.";
      }
      seen.add(signature);
      if (date > today) warning = warning ?? "Date is in the future.";
    }

    return {
      index: rowIndex + 2,
      raw: cells,
      date,
      description,
      amount,
      direction,
      category,
      error,
      warning,
      duplicate: warning?.startsWith("Possible duplicate") ?? false,
    };
  });

  return {
    headers,
    rows,
    errors,
    mapping,
    positiveMeansExpense,
    hasTypeColumn: typeIndex >= 0,
    hasExplicitSigns,
    skipped: 0,
  };
}

export function previewRowsToTransactions(
  rows: ParsedRow[],
  memory: Record<string, string>,
): Omit<Transaction, "id" | "source">[] {
  return rows
    .filter((row) => !row.error && !row.duplicate && row.date && row.amount)
    .map((row) => ({
      date: row.date as string,
      description: row.description.trim(),
      amount: Math.round(row.amount as number),
      direction: row.direction,
      category:
        row.category ?? suggestCategory(row.description, row.direction, memory),
    }));
}

export function buildSampleCsv(today = todayISO()): string {
  const rows: string[][] = [
    ["date", "description", "amount", "type", "category"],
    [addDays(today, -32), "Acme Technologies Salary Credit", "80000", "income", "Salary"],
    [addDays(today, -31), "House Rent - Koramangala (UPI)", "28000", "expense", "Rent"],
    [addDays(today, -30), "HDFC Personal Loan EMI", "9850", "expense", "Loan EMI"],
    [addDays(today, -28), "BigBasket Order", "2140", "expense", ""],
    [addDays(today, -27), "Swiggy, Koramangala", "480", "expense", "Dining"],
    [addDays(today, -25), "BESCOM Electricity Bill", "2310", "expense", "Utilities"],
    [addDays(today, -22), "Netflix Subscription", "649", "expense", ""],
    [addDays(today, -20), "Uber Ride", "310", "expense", "Transport"],
    [addDays(today, -18), "Nova Design Studio Invoice", "14200", "income", "Freelance"],
    [addDays(today, -16), "Apollo Pharmacy", "620", "expense", "Health"],
    [addDays(today, -13), "BigBasket Order", "1880", "expense", ""],
    [addDays(today, -10), "Airtel Fiber Broadband", "999", "expense", "Utilities"],
    [addDays(today, -8), "Amazon.in Order", "2450", "expense", "Shopping"],
    [addDays(today, -6), "Spotify Premium", "119", "expense", ""],
    [addDays(today, -4), "Swiggy Order", "365", "expense", "Dining"],
    [addDays(today, -2), "BigBasket Order", "2560", "expense", ""],
  ];
  return rows
    .map((row) =>
      row
        .map((cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell))
        .join(","),
    )
    .join("\n");
}

export function transactionsToCsv(transactions: Transaction[]): string {
  const header = ["date", "description", "amount", "type", "category"];
  const rows = transactions
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((tx) => [
      tx.date,
      tx.description,
      String(tx.amount),
      tx.direction,
      tx.category,
    ]);
  return [header, ...rows]
    .map((row) =>
      row
        .map((cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell))
        .join(","),
    )
    .join("\n");
}

export function downloadText(filename: string, content: string, type = "text/csv") {
  const blob = new Blob([content], { type: `${type};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
