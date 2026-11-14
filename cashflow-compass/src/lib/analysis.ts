import type {
  Anomaly,
  BacktestResult,
  CategoryStat,
  Forecast,
  MonthTotals,
  RecurringItem,
  Recommendation,
  Settings,
  Transaction,
  UpcomingEvent,
} from "../types";
import {
  addDays,
  clamp,
  daysBetween,
  mean,
  median,
  money,
  monthKey,
  monthLabel,
  percent,
  shortDate,
} from "./format";
import { buildForecast } from "./forecast";
import {
  detectRecurring,
  monthlyEquivalent,
  recurringKey,
  FREQUENCY_LABEL,
} from "./recurring";
import { normalizeMerchant } from "./categorize";

/* ----------------------------- spending anomalies ----------------------------- */

/**
 * Compares each recent expense with the user's own prior spending in the same
 * category (median + MAD). Explains the comparison; never claims fraud.
 */
export function detectAnomalies(
  transactions: Transaction[],
  today: string,
  options: {
    lookbackDays?: number;
    recentDays?: number;
    limit?: number;
    excludeRecurringKeys?: Set<string>;
  } = {},
): Anomaly[] {
  const lookbackDays = options.lookbackDays ?? 210;
  const recentDays = options.recentDays ?? 60;
  const limit = options.limit ?? 3;
  const start = addDays(today, -lookbackDays);
  const recentStart = addDays(today, -recentDays);
  const expenses = transactions.filter(
    (tx) =>
      tx.direction === "expense" &&
      tx.date >= start &&
      tx.date <= today &&
      !options.excludeRecurringKeys?.has(recurringKey(tx.description, tx.direction)),
  );

  const byCategory = new Map<string, Transaction[]>();
  for (const tx of expenses) {
    const list = byCategory.get(tx.category) ?? [];
    list.push(tx);
    byCategory.set(tx.category, list);
  }

  const merchantKeyOf = (description: string) =>
    normalizeMerchant(description).split(" ").slice(0, 2).join(" ");
  const merchantLabel = (description: string) =>
    description.split(/[(-]/)[0].replace(/[.,\s]+$/, "").trim() || description;

  const statsFor = (list: Transaction[]) => {
    if (list.length === 0) return null;
    const amounts = list.map((tx) => tx.amount);
    const med = median(amounts);
    if (med <= 0) return null;
    const deviations = amounts.map((amount) => Math.abs(amount - med));
    const mad = median(deviations);
    return {
      median: med,
      scale: mad > 0 ? 1.4826 * mad : 0,
      samples: list.length,
    };
  };

  const anomalies: Anomaly[] = [];
  for (const [category, list] of byCategory) {
    if (list.length < 5) continue;
    const categoryStats = statsFor(list);
    if (!categoryStats) continue;

    const merchantGroups = new Map<string, Transaction[]>();
    for (const tx of list) {
      const key = merchantKeyOf(tx.description);
      const group = merchantGroups.get(key) ?? [];
      group.push(tx);
      merchantGroups.set(key, group);
    }

    for (const tx of list) {
      if (tx.date < recentStart) continue;
      const group = merchantGroups.get(merchantKeyOf(tx.description)) ?? [];
      const useMerchant = group.length >= 4;
      const cohort = (useMerchant ? statsFor(group) : categoryStats) ?? categoryStats;
      const med = cohort.median;
      const ratio = tx.amount / med;
      const robustZ =
        cohort.scale > 0
          ? (tx.amount - med) / cohort.scale
          : tx.amount > med * 1.7
            ? 6
            : 0;
      const unusual =
        tx.amount - med >= 400 &&
        (ratio >= 1.7 || robustZ >= 3.5) &&
        (ratio >= 2 || robustZ >= 4);
      if (!unusual) continue;
      const label = useMerchant ? merchantLabel(tx.description) : category.toLowerCase();
      anomalies.push({
        transaction: tx,
        median: med,
        ratio,
        samples: cohort.samples,
        severity: ratio >= 3 ? "strong" : "notable",
        explanation: `${money(tx.amount)} at ${tx.description} is ${ratio.toFixed(
          1,
        )}× your typical ${label} transaction of ${money(med)} (${cohort.samples} transactions in the last ${Math.round(
          lookbackDays / 30,
        )} months). Higher than usual for you — not necessarily a mistake or fraud.`,
      });
    }
  }

  return anomalies
    .sort((a, b) => b.ratio - a.ratio || b.transaction.date.localeCompare(a.transaction.date))
    .slice(0, limit);
}

/* -------------------------------- aggregation -------------------------------- */

export function categoryBreakdown(
  transactions: Transaction[],
  direction: "income" | "expense",
  from: string,
  to: string,
): CategoryStat[] {
  const totals = new Map<string, { total: number; count: number }>();
  for (const tx of transactions) {
    if (tx.direction !== direction || tx.date < from || tx.date > to) continue;
    const entry = totals.get(tx.category) ?? { total: 0, count: 0 };
    entry.total += tx.amount;
    entry.count += 1;
    totals.set(tx.category, entry);
  }
  const grand = [...totals.values()].reduce((sum, entry) => sum + entry.total, 0) || 1;
  return [...totals.entries()]
    .map(([category, entry]) => ({
      category,
      total: entry.total,
      count: entry.count,
      share: (entry.total / grand) * 100,
    }))
    .sort((a, b) => b.total - a.total);
}

export function periodTotals(
  transactions: Transaction[],
  from: string,
  to: string,
): { income: number; expense: number; net: number; count: number } {
  let income = 0;
  let expense = 0;
  let count = 0;
  for (const tx of transactions) {
    if (tx.date < from || tx.date > to) continue;
    count += 1;
    if (tx.direction === "income") income += tx.amount;
    else expense += tx.amount;
  }
  return { income, expense, net: income - expense, count };
}

export function monthlySeries(
  transactions: Transaction[],
  today: string,
  months = 6,
  openingBalance = 0,
): MonthTotals[] {
  const [year, month] = today.split("-").map(Number);
  const result: MonthTotals[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const anchor = new Date(year, month - 1 - i, 1);
    const key = `${anchor.getFullYear()}-${`${anchor.getMonth() + 1}`.padStart(2, "0")}`;
    const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    const endISO = `${key}-${`${end.getDate()}`.padStart(2, "0")}`;
    const totals = periodTotals(transactions, `${key}-01`, endISO);
    const balance =
      openingBalance +
      transactions
        .filter((tx) => tx.date <= endISO)
        .reduce((sum, tx) => sum + (tx.direction === "income" ? tx.amount : -tx.amount), 0);
    result.push({
      key,
      label: monthLabel(`${key}-01`),
      income: totals.income,
      expense: totals.expense,
      net: totals.net,
      balance,
    });
  }
  return result;
}

export interface SubscriptionSummary {
  count: number;
  monthlyTotal: number;
  annualTotal: number;
  items: { item: RecurringItem; monthly: number }[];
}

export function subscriptionSummary(recurring: RecurringItem[]): SubscriptionSummary {
  const items = recurring
    .filter(
      (item) =>
        item.status !== "dismissed" &&
        (item.category === "Subscriptions" ||
          /netflix|spotify|prime|hotstar|google one|adobe|subscription|youtube/i.test(item.label)),
    )
    .map((item) => ({ item, monthly: monthlyEquivalent(item) }));
  const monthlyTotal = items.reduce((sum, entry) => sum + entry.monthly, 0);
  return {
    count: items.length,
    monthlyTotal,
    annualTotal: monthlyTotal * 12,
    items: items.sort((a, b) => b.monthly - a.monthly),
  };
}

export interface SpendingHeadroom {
  untilDate: string;
  days: number;
  headroom: number;
  safeToSpend: number;
  perDay: number;
}

/**
 * Discretionary cash available above the safety buffer before the next detected
 * income, after all known bills. A limit, not a target: zero or negative means
 * committed outflows already eat the buffer.
 */
export function discretionaryHeadroom(
  forecast: Forecast,
  settings: Settings,
): SpendingHeadroom {
  const nextIncome = forecast.events.find(
    (event) => event.direction === "income" && event.date >= forecast.today,
  );
  const untilDate = nextIncome?.date ?? addDays(forecast.today, forecast.horizon);
  const days = Math.max(1, daysBetween(forecast.today, untilDate));
  const before = forecast.events.filter(
    (event) => event.date < untilDate && event.kind !== "variable",
  );
  const inflow = before
    .filter((event) => event.direction === "income")
    .reduce((sum, event) => sum + event.amount, 0);
  const outflow = before
    .filter((event) => event.direction === "expense")
    .reduce((sum, event) => sum + event.amount, 0);
  const headroom = forecast.startingBalance + inflow - outflow - settings.safetyThreshold;
  const safeToSpend = Math.max(0, headroom);
  return {
    untilDate,
    days,
    headroom,
    safeToSpend,
    perDay: safeToSpend / days,
  };
}

export function upcomingCommitments(
  forecast: Forecast,
  days: number,
): UpcomingEvent[] {
  const end = addDays(forecast.today, days);
  return forecast.events.filter(
    (event) => event.kind === "recurring" && event.date <= end && event.amount > 0,
  );
}

export function categorySpike(
  transactions: Transaction[],
  today: string,
): { category: string; current: number; previous: number; change: number; recentCount: number; priorCount: number } | null {
  const currentStart = addDays(today, -30);
  const previousStart = addDays(today, -60);
  const totals = new Map<string, { current: number; previous: number; recentCount: number; priorCount: number }>();
  for (const tx of transactions) {
    if (tx.direction !== "expense") continue;
    const entry = totals.get(tx.category) ?? { current: 0, previous: 0, recentCount: 0, priorCount: 0 };
    if (tx.date > currentStart && tx.date <= today) {
      entry.current += tx.amount;
      entry.recentCount += 1;
    } else if (tx.date > previousStart && tx.date <= currentStart) {
      entry.previous += tx.amount;
      entry.priorCount += 1;
    }
    totals.set(tx.category, entry);
  }
  let best: { category: string; current: number; previous: number; change: number; recentCount: number; priorCount: number } | null = null;
  for (const [category, entry] of totals) {
    if (entry.recentCount < 3 || entry.priorCount < 3) continue;
    if (entry.current - entry.previous < 700) continue;
    const change = ((entry.current - entry.previous) / Math.max(entry.previous, 1)) * 100;
    if (change < 20) continue;
    if (!best || change > best.change) {
      best = { category, ...entry, change };
    }
  }
  return best;
}

/* ------------------------------ recommendations ------------------------------ */

interface RecommendationInput {
  transactions: Transaction[];
  forecast: Forecast;
  recurring: RecurringItem[];
  anomalies: Anomaly[];
  settings: Settings;
  today: string;
}

export function buildRecommendations({
  transactions,
  forecast,
  recurring,
  anomalies,
  settings,
  today,
}: RecommendationInput): Recommendation[] {
  const recommendations: Recommendation[] = [];
  const activeSubscriptions = subscriptionSummary(recurring);
  const billsBefore = (date: string) =>
    forecast.events.filter(
      (event) => event.kind === "recurring" && event.direction === "expense" && event.date <= date,
    );

  if (forecast.breach) {
    const daysAway = daysBetween(today, forecast.breach.date);
    const bills = billsBefore(forecast.breach.date);
    const billTotal = bills.reduce((sum, event) => sum + event.amount, 0);
    const nextIncome = forecast.events.find(
      (event) => event.direction === "income" && event.date > today,
    );
    recommendations.push({
      id: "threshold-breach",
      tone: daysAway <= 10 ? "alert" : "warn",
      title: `Balance may dip below your ${money(settings.safetyThreshold)} buffer`,
      body: `Projecting your recent income and spending forward, the balance reaches about ${money(
        forecast.breach.balance,
      )} around ${shortDate(forecast.breach.date)} — below the safety threshold you set. This is an estimate from the transactions you provided, not a guarantee.`,
      facts: [
        `${bills.length} detected bills due before then: ${bills
          .slice(0, 3)
          .map((event) => `${event.label.split(" - ")[0]} ${money(event.amount)} on ${shortDate(event.date)}`)
          .join(", ")}${bills.length > 3 ? "…" : ""} — ${money(billTotal)} in total.`,
        `Everyday variable spending adds roughly ${money(
          forecast.variableExpensePerDay * Math.max(1, daysAway),
        )} over ${Math.max(1, daysAway)} days (${money(forecast.variableExpensePerDay)}/day average).`,
        nextIncome
          ? `The next recurring income of ${money(nextIncome.amount)} is expected on ${shortDate(nextIncome.date)}.`
          : "No recurring income was detected in this window.",
      ],
    });
  } else {
    const margin = forecast.minBalance - settings.safetyThreshold;
    recommendations.push({
      id: "buffer-holds",
      tone: margin < 15000 ? "warn" : "good",
      title:
        margin < 15000
          ? "Buffer holds, but with little room"
          : "Your buffer holds through the forecast window",
      body: `The lowest projected balance is ${money(forecast.minBalance)} on ${shortDate(
        forecast.minDate,
      )}, ${margin >= 0 ? "above" : "below"} your ${money(settings.safetyThreshold)} threshold by ${money(
        Math.abs(margin),
      )}. Add a what-if scenario to stress-test it.`,
      facts: [
        `${forecast.recurrenceCount} recurring payments/income streams are included in this forecast.`,
        `Recurring bills over the window total ${money(forecast.committedExpense)}.`,
        `The 80% estimate band ends at ±${money(forecast.bandWidthEnd)} around the projected balance.`,
      ],
    });
  }

  if (activeSubscriptions.count >= 2) {
    recommendations.push({
      id: "subscriptions",
      tone: "info",
      title: `You have ${activeSubscriptions.count} subscriptions totalling about ${money(
        activeSubscriptions.monthlyTotal,
      )}/month`,
      body: `Detected from repeat payments: roughly ${money(
        activeSubscriptions.monthlyTotal * 12,
      )} a year. Review the list to see whether each one is still needed — no action is assumed.`,
      facts: activeSubscriptions.items
        .slice(0, 4)
        .map(
          (entry) =>
            `${entry.item.label} — ${money(entry.monthly)}/month, ${FREQUENCY_LABEL[entry.item.frequency].toLowerCase()}.`,
        )
        .concat(
          activeSubscriptions.items.length > 4
            ? [`Plus ${activeSubscriptions.items.length - 4} more recurring subscriptions.`]
            : [],
        ),
    });
  }

  const spike = categorySpike(transactions, today);
  if (spike) {
    recommendations.push({
      id: "category-spike",
      tone: "warn",
      title: `${spike.category} spending is up ${percent(spike.change, 0)} in the last 30 days`,
      body: `You spent ${money(spike.current)} on ${spike.category.toLowerCase()} in the last 30 days versus ${money(
        spike.previous,
      )} in the 30 days before that. Compare the transactions if this was not planned.`,
      facts: [
        `${spike.recentCount} transactions in the last 30 days vs ${spike.priorCount} in the previous 30 days.`,
        `Difference: ${money(spike.current - spike.previous)}.`,
        "Cadence can shift simply because of bill timing, so check the underlying transactions.",
      ],
    });
  }

  if (anomalies.length > 0) {
    const top = anomalies[0];
    recommendations.push({
      id: "unusual-spend",
      tone: "info",
      title: "One transaction stands out from your normal pattern",
      body: top.explanation,
      facts: [
        `Typical ${top.transaction.category.toLowerCase()} transaction: ${money(top.median)} across ${top.samples} transactions.`,
        `This one: ${money(top.transaction.amount)} on ${shortDate(top.transaction.date)}.`,
        "Unusual does not mean fraudulent — it can be a planned one-off purchase.",
      ],
    });
  }

  const soon = forecast.events.filter(
    (event) =>
      event.direction === "expense" &&
      event.amount >= Math.max(5000, forecast.variableExpensePerDay * 20) &&
      daysBetween(today, event.date) >= 0 &&
      daysBetween(today, event.date) <= 10,
  );
  if (soon.length > 0 && !forecast.breach) {
    const event = soon[0];
    recommendations.push({
      id: "large-upcoming",
      tone: "info",
      title: `Large upcoming commitment: ${money(event.amount)} in ${Math.max(
        0,
        daysBetween(today, event.date),
      )} days`,
      body: `${event.label} is expected on ${shortDate(event.date)}. The forecast already includes it, so no action is required unless the amount changes.`,
      facts: [
        `Recurring bills in the next 10 days total ${money(
          soon.reduce((sum, item) => sum + item.amount, 0),
        )}.`,
        `Projected balance on that date: ${money(
          forecast.points.find((point) => point.date === event.date)?.balance ??
            forecast.minBalance,
        )}.`,
      ],
    });
  }

  if (forecast.historyDays < 45 && forecast.transactionCount > 0) {
    recommendations.push({
      id: "limited-history",
      tone: "info",
      title: "Forecast confidence is limited by short history",
      body: `Only ${forecast.historyDays} days of transactions are available. Import more history to improve recurring detection and the variable-spending estimate.`,
      facts: [
        `${forecast.transactionCount} transactions in the dataset.`,
        `Aim for at least 90 days, including 3+ cycles of each regular bill.`,
      ],
    });
  }

  const toneOrder: Record<Recommendation["tone"], number> = {
    alert: 0,
    warn: 1,
    info: 2,
    good: 3,
  };
  return recommendations.sort((a, b) => toneOrder[a.tone] - toneOrder[b.tone]).slice(0, 5);
}

/* ------------------------------ accuracy backtest ------------------------------ */

/**
 * Hold out the last 30 days, forecast them from earlier history, then compare
 * the predicted balance with what actually happened.
 */
export function runBacktest(
  transactions: Transaction[],
  settings: Settings,
  today: string,
  horizon = 30,
): BacktestResult | null {
  const cutoff = addDays(today, -horizon);
  const history = transactions.filter((tx) => tx.date <= cutoff);
  if (history.length < 15) return null;
  const sorted = [...transactions].sort((a, b) => (a.date < b.date ? -1 : 1));
  const openingBalance = settings.openingBalance;
  const recurring = detectRecurring(history, {}, cutoff);
  const forecast = buildForecast({
    transactions: history,
    recurring,
    settings: { ...settings, safetyThreshold: 0 },
    today: cutoff,
    horizon,
  });

  const actualAt = (date: string) =>
    openingBalance +
    sorted
      .filter((tx) => tx.date <= date)
      .reduce((sum, tx) => sum + (tx.direction === "income" ? tx.amount : -tx.amount), 0);

  const points = forecast.points.map((point) => ({
    date: point.date,
    predicted: point.balance,
    actual: actualAt(point.date),
  }));
  const predictedEnd = points[points.length - 1].predicted;
  const actualEnd = points[points.length - 1].actual;
  const meanAbsDailyError = mean(points.map((point) => Math.abs(point.predicted - point.actual)));
  const errorAmount = predictedEnd - actualEnd;
  const errorPercent =
    (Math.abs(errorAmount) / Math.max(Math.abs(actualEnd), 25000)) * 100;

  return {
    cutoff,
    horizon,
    predictedEnd,
    actualEnd,
    errorAmount,
    errorPercent: clamp(errorPercent, 0, 999),
    points,
    meanAbsDailyError,
  };
}

/* ------------------------------- small helpers ------------------------------- */

export function lastNMonthKeys(today: string, count: number): string[] {
  const [year, month] = today.split("-").map(Number);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(year, month - 1 - (count - 1 - index), 1);
    return monthKey(`${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-01`);
  });
}
