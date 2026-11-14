import type {
  Forecast,
  ForecastFactor,
  ForecastPoint,
  Frequency,
  RecurringItem,
  Scenario,
  Settings,
  Transaction,
  UpcomingEvent,
} from "../types";
import {
  addDays,
  clamp,
  daysBetween,
  money,
  stdDev,
} from "./format";
import { recurringKey } from "./recurring";

const Z_80 = 1.2816; // one-sided-ish 80% interval for a normal error band
const RECURRING_UNCERTAINTY = 0.12;
const VARIABLE_UNCERTAINTY_DAYS = 120;

interface ForecastInput {
  transactions: Transaction[];
  recurring: RecurringItem[];
  settings: Settings;
  today: string;
  horizon?: number;
  scenarios?: Scenario[];
  includeScenarios?: boolean;
}

export function signedAmount(event: { amount: number; direction: "income" | "expense" }): number {
  return event.direction === "income" ? event.amount : -event.amount;
}

function eventsOn(events: UpcomingEvent[], date: string): UpcomingEvent[] {
  return events.filter((event) => event.date === date);
}

export function balanceFromTransactions(
  transactions: Transaction[],
  openingBalance: number,
): number {
  return transactions.reduce(
    (balance, tx) => balance + (tx.direction === "income" ? tx.amount : -tx.amount),
    openingBalance,
  );
}

export function buildForecast({
  transactions,
  recurring,
  settings,
  today,
  horizon = settings.horizon,
  scenarios = [],
  includeScenarios = false,
}: ForecastInput): Forecast {
  const sorted = [...transactions].sort((a, b) => (a.date < b.date ? -1 : 1));
  const historyDays = sorted.length ? daysBetween(sorted[0].date, today) + 1 : 0;
  const startingBalance = balanceFromTransactions(sorted, settings.openingBalance);
  const confirmed = recurring.filter((item) => item.status === "confirmed");
  const recurringKeys = new Set(confirmed.map((item) => item.key));
  const variableTransactions = sorted.filter(
    (tx) => !recurringKeys.has(recurringKey(tx.description, tx.direction)),
  );

  const lookback = clamp(historyDays, 14, VARIABLE_UNCERTAINTY_DAYS);
  let windowStart = addDays(today, -lookback);
  if (sorted.length && sorted[0].date > windowStart) windowStart = sorted[0].date;
  const windowDays = Math.max(1, daysBetween(windowStart, today) + 1);
  const windowTx = variableTransactions.filter(
    (tx) => tx.date >= windowStart && tx.date <= today,
  );

  const variableExpenseWindow = windowTx
    .filter((tx) => tx.direction === "expense")
    .reduce((sum, tx) => sum + tx.amount, 0);
  const variableIncomeWindow = windowTx
    .filter((tx) => tx.direction === "income")
    .reduce((sum, tx) => sum + tx.amount, 0);

  const variableExpensePerDay = variableExpenseWindow / windowDays;
  const variableIncomePerDay = variableIncomeWindow / windowDays;

  const dailyNet = new Map<string, number>();
  for (const tx of windowTx) {
    dailyNet.set(
      tx.date,
      (dailyNet.get(tx.date) ?? 0) + (tx.direction === "income" ? tx.amount : -tx.amount),
    );
  }
  const dailySeries: number[] = [];
  for (let d = 0; d < windowDays; d++) {
    dailySeries.push(dailyNet.get(addDays(windowStart, d)) ?? 0);
  }
  const dailyStd = stdDev(dailySeries);

  const horizonEnd = addDays(today, horizon);
  const events: UpcomingEvent[] = [];
  for (const item of confirmed) {
    let cursor = item.nextDate;
    for (let i = 0; i < 24 && cursor <= horizonEnd; i++) {
      events.push({
        id: `rec-${item.key}-${cursor}`,
        date: cursor,
        label: item.label,
        amount: item.typicalAmount,
        direction: item.direction,
        category: item.category,
        kind: "recurring",
        recurringKey: item.key,
        isEstimate: true,
      });
      // advance by frequency without importing helper internals
      const next = nextEventDate(cursor, item.frequency);
      cursor = next;
    }
  }

  const activeScenarios = includeScenarios
    ? scenarios.filter(
        (scenario) => scenario.active && scenario.date >= today && scenario.date <= horizonEnd,
      )
    : [];
  for (const scenario of activeScenarios) {
    events.push({
      id: `scenario-${scenario.id}`,
      date: scenario.date,
      label: scenario.kind === "repayment" ? `${scenario.name} (extra repayment)` : scenario.name,
      amount: scenario.amount,
      direction: "expense",
      category: scenario.kind === "repayment" ? "Loan EMI" : "Other",
      kind: "scenario",
      isEstimate: false,
    });
  }
  events.sort((a, b) => a.date.localeCompare(b.date));

  const points: ForecastPoint[] = [
    { date: today, balance: startingBalance, lower: startingBalance, upper: startingBalance },
  ];
  let balance = startingBalance;
  let variance = 0;
  let committedIncome = 0;
  let committedExpense = 0;

  for (let day = 1; day <= horizon; day++) {
    const date = addDays(today, day);
    const dayEvents = eventsOn(events, date);
    let eventNet = 0;
    for (const event of dayEvents) {
      eventNet += signedAmount(event);
      variance += Math.pow(event.amount * RECURRING_UNCERTAINTY, 2);
      if (event.kind === "recurring") {
        if (event.direction === "income") committedIncome += event.amount;
        else committedExpense += event.amount;
      }
    }
    balance += variableIncomePerDay - variableExpensePerDay + eventNet;
    variance += Math.pow(dailyStd, 2);
    const band = Z_80 * Math.sqrt(variance);
    points.push({ date, balance, lower: balance - band, upper: balance + band });
  }

  let minBalance = points[0].balance;
  let minDate = points[0].date;
  let breach: Forecast["breach"] = null;
  for (const point of points) {
    if (point.balance < minBalance) {
      minBalance = point.balance;
      minDate = point.date;
    }
    if (!breach && point.balance < settings.safetyThreshold) {
      breach = { date: point.date, balance: point.balance };
    }
  }

  const committedEvents = events.filter((event) => event.kind === "recurring");
  const biggest = [...committedEvents]
    .filter((event) => event.direction === "expense")
    .sort((a, b) => b.amount - a.amount)[0];

  const factors: ForecastFactor[] = [];
  if (committedExpense > 0) {
    factors.push({
      label: "Recurring bills",
      detail: `${committedEvents.filter((e) => e.direction === "expense").length} detected payments over the next ${horizon} days, including ${biggest ? biggest.label : "rent"}.`,
      amount: committedExpense,
      direction: "expense",
    });
  }
  if (committedIncome > 0) {
    factors.push({
      label: "Recurring income",
      detail: `${committedEvents.filter((e) => e.direction === "income").length} expected ${committedEvents.filter((e) => e.direction === "income").length === 1 ? "deposit" : "deposits"} from detected income streams.`,
      amount: committedIncome,
      direction: "income",
    });
  }
  if (variableExpensePerDay > 0) {
    factors.push({
      label: "Everyday spending",
      detail: `About ${money(variableExpensePerDay)} per day, averaged over ${windowDays} days of non-recurring expenses.`,
      amount: variableExpensePerDay * horizon,
      direction: "expense",
    });
  }
  if (variableIncomePerDay > 0.5) {
    factors.push({
      label: "Other income",
      detail: `Freelance and one-off income averaged from the last ${windowDays} days.`,
      amount: variableIncomePerDay * horizon,
      direction: "income",
    });
  }
  if (historyDays < 45) {
    factors.push({
      label: "Limited history",
      detail: `Only ${historyDays} days of transactions are available, so this forecast is less reliable.`,
      amount: 0,
      direction: "neutral",
    });
  }

  const confidence: Forecast["confidence"] =
    historyDays >= 90 && confirmed.length >= 2
      ? "high"
      : historyDays >= 45
        ? "medium"
        : "low";

  return {
    today,
    horizon,
    startingBalance,
    points,
    events,
    minBalance,
    minDate,
    endBalance: points[points.length - 1].balance,
    breach,
    bandWidthEnd: points[points.length - 1].upper - points[points.length - 1].balance,
    confidence,
    historyDays,
    transactionCount: sorted.length,
    variableIncomePerDay,
    variableExpensePerDay,
    variableIncomeTotal: variableIncomePerDay * horizon,
    variableExpenseTotal: variableExpensePerDay * horizon,
    committedIncome,
    committedExpense,
    recurrenceCount: confirmed.length,
    factors,
    scenarioImpact: null,
  };
}

function nextEventDate(date: string, frequency: Frequency): string {
  const months =
    frequency === "monthly"
      ? 1
      : frequency === "quarterly"
        ? 3
        : frequency === "half-yearly"
          ? 6
          : frequency === "yearly"
            ? 12
            : 0;
  if (months === 0) {
    return addDays(date, frequency === "weekly" ? 7 : 14);
  }
  const [y, m, d] = date.split("-").map(Number);
  const target = new Date(y, m - 1 + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d, lastDay));
  const yy = target.getFullYear();
  const mm = `${target.getMonth() + 1}`.padStart(2, "0");
  const dd = `${target.getDate()}`.padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export interface ScenarioSummary {
  points: ForecastPoint[];
  minBalance: number;
  minDate: string;
  endBalance: number;
  breach: Forecast["breach"];
}

/** Deterministically shift the already-computed forecast path by a planned amount. */
export function overlayScenarios(
  points: ForecastPoint[],
  scenarios: Scenario[],
  threshold: number,
  today: string,
): ScenarioSummary {
  const active = scenarios.filter((scenario) => scenario.active);
  const shifted = points.map((point) => {
    const deduction = active
      .filter((scenario) => (scenario.date < today ? true : point.date >= scenario.date))
      .reduce((sum, scenario) => sum + scenario.amount, 0);
    return {
      ...point,
      balance: point.balance - deduction,
      lower: point.lower - deduction,
      upper: point.upper - deduction,
    };
  });
  return summarize(shifted, threshold);
}

/** Compare one scenario against the baseline path (used by the planner). */
export function simulateScenario(
  base: Forecast,
  scenario: Scenario,
  threshold: number,
): ScenarioSummary {
  return overlayScenarios(
    base.points,
    [{ ...scenario, active: true }],
    threshold,
    base.today,
  );
}

export function summarize(points: ForecastPoint[], threshold: number): ScenarioSummary {
  let minBalance = points[0].balance;
  let minDate = points[0].date;
  let breach: Forecast["breach"] = null;
  for (const point of points) {
    if (point.balance < minBalance) {
      minBalance = point.balance;
      minDate = point.date;
    }
    if (!breach && point.balance < threshold) {
      breach = { date: point.date, balance: point.balance };
    }
  }
  return {
    points,
    minBalance,
    minDate,
    endBalance: points[points.length - 1].balance,
    breach,
  };
}

/** Add active scenario events into the baseline forecast for the dashboard. */
export function applyScenariosToForecast(
  base: Forecast,
  scenarios: Scenario[],
  threshold: number,
): Forecast {
  const active = scenarios.filter(
    (scenario) => scenario.active && scenario.date <= addDays(base.today, base.horizon),
  );
  if (active.length === 0) return base;
  const summary = overlayScenarios(base.points, active, threshold, base.today);
  const scenarioEvents: UpcomingEvent[] = active.map((scenario) => ({
    id: `scenario-${scenario.id}`,
    date: scenario.date < base.today ? base.today : scenario.date,
    label: scenario.kind === "repayment" ? `${scenario.name} (extra repayment)` : scenario.name,
    amount: scenario.amount,
    direction: "expense",
    category: scenario.kind === "repayment" ? "Loan EMI" : "Other",
    kind: "scenario",
  }));
  return {
    ...base,
    points: summary.points,
    minBalance: summary.minBalance,
    minDate: summary.minDate,
    endBalance: summary.endBalance,
    breach: summary.breach,
    events: [...base.events, ...scenarioEvents].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

/** Typical monthly surplus from the trailing window, for context copy. */
export function trailingMonthlySurplus(transactions: Transaction[], today: string): number {
  const start = addDays(today, -90);
  const windowTx = transactions.filter((tx) => tx.date >= start && tx.date <= today);
  if (windowTx.length === 0) return 0;
  const income = windowTx
    .filter((tx) => tx.direction === "income")
    .reduce((s, tx) => s + tx.amount, 0);
  const expense = windowTx
    .filter((tx) => tx.direction === "expense")
    .reduce((s, tx) => s + tx.amount, 0);
  return ((income - expense) / 90) * 30.44;
}

export function medianDailySpend(transactions: Transaction[], today: string): number {
  const start = addDays(today, -90);
  const expenses = transactions.filter(
    (tx) => tx.direction === "expense" && tx.date >= start && tx.date <= today,
  );
  if (expenses.length === 0) return 0;
  return expenses.reduce((sum, tx) => sum + tx.amount, 0) / 90;
}
