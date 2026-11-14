import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type {
  RecurringStatus,
  Scenario,
  Settings,
  Transaction,
} from "./types";
import { buildDemoScenarios, buildDemoTransactions } from "./lib/demo";
import { detectRecurring } from "./lib/recurring";
import {
  applyScenariosToForecast,
  buildForecast,
} from "./lib/forecast";
import {
  buildRecommendations,
  categoryBreakdown,
  detectAnomalies,
  monthlySeries,
  periodTotals,
  runBacktest,
  subscriptionSummary,
} from "./lib/analysis";
import { addDays, todayISO } from "./lib/format";
import { normalizeMerchant } from "./lib/categorize";
import { DEFAULT_SETTINGS } from "./lib/defaults";

const STORAGE_KEY = "cashflow-compass:v1";

interface PersistedShape {
  version: number;
  transactions: Transaction[];
  scenarios: Scenario[];
  settings: Settings;
  overrides: Record<string, RecurringStatus>;
  merchantMemory: Record<string, string>;
  seededAt: string | null;
}

function demoState(): PersistedShape {
  return {
    version: 1,
    transactions: buildDemoTransactions(),
    scenarios: buildDemoScenarios(),
    settings: { ...DEFAULT_SETTINGS },
    overrides: {},
    merchantMemory: {},
    seededAt: new Date().toISOString(),
  };
}

function loadState(): PersistedShape {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedShape;
      if (Array.isArray(parsed.transactions)) {
        return {
          version: 1,
          transactions: parsed.transactions,
          scenarios: Array.isArray(parsed.scenarios)
            ? parsed.scenarios.map((scenario) => ({ ...scenario, active: scenario.active ?? false }))
            : [],
          settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
          overrides: parsed.overrides ?? {},
          merchantMemory: parsed.merchantMemory ?? {},
          seededAt: parsed.seededAt ?? null,
        };
      }
    }
  } catch (error) {
    console.warn("Could not read saved data; starting with demo data.", error);
  }
  return demoState();
}

interface AppContextValue {
  today: string;
  transactions: Transaction[];
  scenarios: Scenario[];
  settings: Settings;
  overrides: Record<string, RecurringStatus>;
  merchantMemory: Record<string, string>;
  recurring: ReturnType<typeof detectRecurring>;
  forecast: ReturnType<typeof buildForecast>;
  baselineForecast: ReturnType<typeof buildForecast>;
  anomalies: ReturnType<typeof detectAnomalies>;
  recommendations: ReturnType<typeof buildRecommendations>;
  backtest: ReturnType<typeof runBacktest>;
  subscriptions: ReturnType<typeof subscriptionSummary>;
  monthly: ReturnType<typeof monthlySeries>;
  balance30DaysAgo: number;
  isDemoData: boolean;
  toast: string | null;
  notify: (message: string) => void;
  addTransaction: (transaction: Omit<Transaction, "id" | "source">) => void;
  importTransactions: (rows: Omit<Transaction, "id" | "source">[]) => number;
  updateTransaction: (id: string, patch: Partial<Transaction>) => void;
  setCategory: (id: string, category: string) => void;
  deleteTransaction: (id: string) => void;
  addScenario: (scenario: Omit<Scenario, "id" | "active">) => string;
  updateScenario: (id: string, patch: Partial<Scenario>) => void;
  deleteScenario: (id: string) => void;
  setScenarioActive: (id: string, active: boolean) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  setRecurringStatus: (key: string, status: RecurringStatus | null) => void;
  resetDemo: () => void;
  clearData: () => void;
  periodTotals: typeof periodTotals;
  categoryBreakdown: typeof categoryBreakdown;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<PersistedShape>(loadState);
  const [toast, setToast] = useState<string | null>(null);

  const today = todayISO();

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.warn("Could not save to localStorage.", error);
    }
  }, [state]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const notify = useCallback((message: string) => setToast(message), []);

  const recurring = useMemo(
    () => detectRecurring(state.transactions, state.overrides, today),
    [state.transactions, state.overrides, today],
  );

  const baselineForecast = useMemo(
    () =>
      buildForecast({
        transactions: state.transactions,
        recurring,
        settings: state.settings,
        today,
      }),
    [state.transactions, recurring, state.settings, today],
  );

  const forecast = useMemo(
    () =>
      applyScenariosToForecast(
        baselineForecast,
        state.scenarios,
        state.settings.safetyThreshold,
      ),
    [baselineForecast, state.scenarios, state.settings.safetyThreshold],
  );

  const confirmedRecurringKeys = useMemo(
    () => new Set(recurring.filter((item) => item.status === "confirmed").map((item) => item.key)),
    [recurring],
  );

  const anomalies = useMemo(
    () =>
      detectAnomalies(state.transactions, today, {
        excludeRecurringKeys: confirmedRecurringKeys,
      }),
    [state.transactions, today, confirmedRecurringKeys],
  );

  const recommendations = useMemo(
    () =>
      buildRecommendations({
        transactions: state.transactions,
        forecast,
        recurring,
        anomalies,
        settings: state.settings,
        today,
      }),
    [state.transactions, forecast, recurring, anomalies, state.settings, today],
  );

  const backtest = useMemo(
    () => runBacktest(state.transactions, state.settings, today),
    [state.transactions, state.settings, today],
  );

  const subscriptions = useMemo(() => subscriptionSummary(recurring), [recurring]);

  const monthly = useMemo(
    () => monthlySeries(state.transactions, today, 6, state.settings.openingBalance),
    [state.transactions, today, state.settings.openingBalance],
  );

  const balance30DaysAgo = useMemo(() => {
    const cutoff = addDays(today, -30);
    return (
      state.settings.openingBalance +
      state.transactions
        .filter((tx) => tx.date <= cutoff)
        .reduce(
          (sum, tx) => sum + (tx.direction === "income" ? tx.amount : -tx.amount),
          0,
        )
    );
  }, [state.transactions, state.settings.openingBalance, today]);

  const addTransaction = useCallback(
    (transaction: Omit<Transaction, "id" | "source">) => {
      setState((prev) => ({
        ...prev,
        transactions: [
          ...prev.transactions,
          {
            ...transaction,
            id: `tx_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
            source: "manual",
          },
        ],
      }));
      notify("Transaction added.");
    },
    [notify],
  );

  const importTransactions = useCallback(
    (rows: Omit<Transaction, "id" | "source">[]) => {
      setState((prev) => ({
        ...prev,
        transactions: [
          ...prev.transactions,
          ...rows.map((row, index) => ({
            ...row,
            id: `imp_${Date.now().toString(36)}_${index}`,
            source: "import" as const,
          })),
        ],
      }));
      return rows.length;
    },
    [],
  );

  const updateTransaction = useCallback((id: string, patch: Partial<Transaction>) => {
    setState((prev) => ({
      ...prev,
      transactions: prev.transactions.map((tx) =>
        tx.id === id ? { ...tx, ...patch } : tx,
      ),
    }));
  }, []);

  const setCategory = useCallback(
    (id: string, category: string) => {
      setState((prev) => {
        const target = prev.transactions.find((tx) => tx.id === id);
        if (!target) return prev;
        return {
          ...prev,
          transactions: prev.transactions.map((tx) =>
            tx.id === id ? { ...tx, category } : tx,
          ),
          merchantMemory: {
            ...prev.merchantMemory,
            [normalizeMerchant(target.description)]: category,
          },
        };
      });
      notify("Category saved — similar imports will use it.");
    },
    [notify],
  );

  const deleteTransaction = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      transactions: prev.transactions.filter((tx) => tx.id !== id),
    }));
  }, []);

  const addScenario = useCallback(
    (scenario: Omit<Scenario, "id" | "active">) => {
      const id = `sc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
      setState((prev) => ({
        ...prev,
        scenarios: [...prev.scenarios, { ...scenario, id, active: false }],
      }));
      return id;
    },
    [],
  );

  const updateScenario = useCallback((id: string, patch: Partial<Scenario>) => {
    setState((prev) => ({
      ...prev,
      scenarios: prev.scenarios.map((scenario) =>
        scenario.id === id ? { ...scenario, ...patch } : scenario,
      ),
    }));
  }, []);

  const deleteScenario = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      scenarios: prev.scenarios.filter((scenario) => scenario.id !== id),
    }));
  }, []);

  const setScenarioActive = useCallback((id: string, active: boolean) => {
    setState((prev) => ({
      ...prev,
      scenarios: prev.scenarios.map((scenario) =>
        scenario.id === id ? { ...scenario, active } : scenario,
      ),
    }));
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setState((prev) => ({ ...prev, settings: { ...prev.settings, ...patch } }));
  }, []);

  const setRecurringStatus = useCallback(
    (key: string, status: RecurringStatus | null) => {
      setState((prev) => {
        const next = { ...prev.overrides };
        if (status === null) delete next[key];
        else next[key] = status;
        return { ...prev, overrides: next };
      });
    },
    [],
  );

  const resetDemo = useCallback(() => {
    const hasOwnEntries = state.transactions.some((tx) => tx.source !== "demo");
    if (
      hasOwnEntries &&
      !window.confirm(
        "Restore demo data? Your imported and manual transactions will be replaced. Export a CSV first if you need a copy.",
      )
    ) {
      return;
    }
    setState(demoState());
    notify("Demo data restored.");
  }, [notify, state.transactions]);

  const clearData = useCallback(() => {
    setState({
      version: 1,
      transactions: [],
      scenarios: [],
      settings: { ...DEFAULT_SETTINGS },
      overrides: {},
      merchantMemory: {},
      seededAt: null,
    });
    notify("All local data deleted.");
  }, [notify]);

  const isDemoData = state.transactions.some((tx) => tx.source === "demo");

  const value: AppContextValue = {
    today,
    transactions: state.transactions,
    scenarios: state.scenarios,
    settings: state.settings,
    overrides: state.overrides,
    merchantMemory: state.merchantMemory,
    recurring,
    forecast,
    baselineForecast,
    anomalies,
    recommendations,
    backtest,
    subscriptions,
    monthly,
    balance30DaysAgo,
    isDemoData,
    toast,
    notify,
    addTransaction,
    importTransactions,
    updateTransaction,
    setCategory,
    deleteTransaction,
    addScenario,
    updateScenario,
    deleteScenario,
    setScenarioActive,
    updateSettings,
    setRecurringStatus,
    resetDemo,
    clearData,
    periodTotals,
    categoryBreakdown,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp must be used inside AppProvider");
  return context;
}
