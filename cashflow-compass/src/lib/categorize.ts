import type { Direction } from "../types";

export const EXPENSE_CATEGORIES = [
  "Rent",
  "Loan EMI",
  "Utilities",
  "Groceries",
  "Dining",
  "Transport",
  "Subscriptions",
  "Insurance",
  "Shopping",
  "Health",
  "Household",
  "Travel",
  "Education",
  "Entertainment",
  "Fees",
  "Other",
] as const;

export const INCOME_CATEGORIES = [
  "Salary",
  "Freelance",
  "Business",
  "Refund",
  "Other Income",
] as const;

export const ALL_CATEGORIES = [...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES];

export const CATEGORY_COLORS: Record<string, string> = {
  Salary: "#34d399",
  Freelance: "#2dd4bf",
  Business: "#22d3ee",
  Refund: "#a3e635",
  "Other Income": "#94a3b8",
  Rent: "#818cf8",
  "Loan EMI": "#f472b6",
  Utilities: "#38bdf8",
  Groceries: "#4ade80",
  Dining: "#fbbf24",
  Transport: "#60a5fa",
  Subscriptions: "#c084fc",
  Insurance: "#fb923c",
  Shopping: "#f87171",
  Health: "#2dd4bf",
  Household: "#facc15",
  Travel: "#a78bfa",
  Education: "#5eead4",
  Entertainment: "#fda4af",
  Fees: "#94a3b8",
  Other: "#64748b",
};

interface Rule {
  category: string;
  keywords: string[];
}

/** Ordered rules: more specific phrases come first. */
const RULES: Rule[] = [
  { category: "Refund", keywords: ["refund", "reversal", "cashback", "returned"] },
  { category: "Salary", keywords: ["salary", "payroll", "stipend", "wages", "acme technologies"] },
  {
    category: "Freelance",
    keywords: ["freelance", "consulting", "design studio", "client payment", "upwork", "fiverr", "invoice"],
  },
  { category: "Business", keywords: ["shop sales", "business receipt", "gst sales", "vendor payout"] },
  { category: "Loan EMI", keywords: ["emi", "equated monthly", "loan", "instalment", "installment"] },
  { category: "Rent", keywords: ["rent", "landlord", "lease", "society maintenance"] },
  {
    category: "Subscriptions",
    keywords: [
      "netflix",
      "spotify",
      "prime video",
      "hotstar",
      "disney",
      "youtube premium",
      "google one",
      "icloud",
      "adobe",
      "subscription",
      "canva",
      "notion",
      "apple music",
      "sonyliv",
      "zee5",
      "audible",
    ],
  },
  {
    category: "Insurance",
    keywords: ["insurance", "policy premium", "star health", "icici lombard", "acko", "hdfc life", "term plan"],
  },
  {
    category: "Utilities",
    keywords: [
      "electricity",
      "bescom",
      "water bill",
      "gas bill",
      "indane",
      "broadband",
      "airtel",
      "jio",
      "fiber",
      "internet",
      "postpaid",
      "recharge",
      "dth",
      "utility",
    ],
  },
  {
    category: "Groceries",
    keywords: ["bigbasket", "zepto", "blinkit", "dmart", "supermarket", "grocery", "groceries", "instamart", "reliance fresh", "more supermarket"],
  },
  {
    category: "Dining",
    keywords: ["swiggy", "zomato", "restaurant", "cafe", "coffee", "domino", "pizza", "burger", "truffles", "eatery", "bakery", "food court"],
  },
  {
    category: "Transport",
    keywords: ["uber", "ola", "metro", "fuel", "petrol", "diesel", "indian oil", "hp petrol", "shell", "rapido", "parking", "toll", "fastag"],
  },
  {
    category: "Health",
    keywords: ["pharmacy", "apollo", "medplus", "practo", "hospital", "clinic", "doctor", "diagnostic", "lab test", "cult.fit", "gym", "fitness", "dental", "health checkup"],
  },
  {
    category: "Household",
    keywords: ["urban company", "housekeeping", "maid", "plumber", "electrician", "pest control", "laundry", "dry clean", "home supplies"],
  },
  {
    category: "Travel",
    keywords: ["flight", "indigo", "air india", "vistara", "makemytrip", "goibibo", "hotel", "oyo", "airbnb", "train", "irctc", "bus ticket", "redbus"],
  },
  {
    category: "Education",
    keywords: ["udemy", "coursera", "course", "tuition", "school fee", "college", "books", "stationery", "exam fee"],
  },
  {
    category: "Entertainment",
    keywords: ["pvr", "inox", "bookmyshow", "cinema", "movie", "concert", "steam"],
  },
  {
    category: "Shopping",
    keywords: ["amazon", "flipkart", "myntra", "ajio", "croma", "reliance digital", "decathlon", "shopping", "mall", "lifestyle", "ikea", "nykaa"],
  },
  {
    category: "Fees",
    keywords: ["bank charge", "sms charge", "annual fee", "processing fee", "gst", "penalty", "late fee", "convenience fee"],
  },
];

export function normalizeMerchant(description: string): string {
  return description
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, 3)
    .join(" ");
}

/**
 * On-device categorizer: exact merchant memory first (from the user's own
 * corrections), then ordered keyword rules. No network calls.
 */
export function suggestCategory(
  description: string,
  direction: Direction,
  memory: Record<string, string> = {},
): string {
  const merchant = normalizeMerchant(description);
  const remembered = memory[merchant];
  const allowed = direction === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  if (remembered && (allowed as readonly string[]).includes(remembered)) {
    return remembered;
  }
  const haystack = description.toLowerCase();
  for (const rule of RULES) {
    if ((allowed as readonly string[]).includes(rule.category)) {
      for (const keyword of rule.keywords) {
        if (haystack.includes(keyword)) return rule.category;
      }
    }
  }
  return direction === "income" ? "Other Income" : "Other";
}

export function categoryColor(category: string): string {
  return CATEGORY_COLORS[category] ?? "#64748b";
}

export function categoriesFor(direction: Direction): readonly string[] {
  return direction === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
}

export function isIncomeCategory(category: string): boolean {
  return (INCOME_CATEGORIES as readonly string[]).includes(category);
}
