import { useEffect, useState } from "react";
import type { Page, Transaction } from "./types";
import { useApp } from "./store";
import { DashboardPage } from "./pages/DashboardPage";
import { TransactionsPage } from "./pages/TransactionsPage";
import { RecurringPage } from "./pages/RecurringPage";
import { PlannerPage } from "./pages/PlannerPage";
import { InsightsPage } from "./pages/InsightsPage";
import { CsvImportModal } from "./components/CsvImportModal";
import { TransactionModal } from "./components/TransactionModal";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { Icon } from "./components/Icon";

const NAV: { page: Page; label: string; icon: string }[] = [
  { page: "dashboard", label: "Dashboard", icon: "grid" },
  { page: "transactions", label: "Transactions", icon: "list" },
  { page: "recurring", label: "Recurring", icon: "repeat" },
  { page: "planner", label: "What-if", icon: "flask" },
  { page: "insights", label: "Insights", icon: "sparkles" },
];

export default function App() {
  const { toast } = useApp();
  const [page, setPage] = useState<Page>("dashboard");
  const [importOpen, setImportOpen] = useState(false);
  const [transactionOpen, setTransactionOpen] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [page]);

  const openAdd = () => {
    setEditing(null);
    setTransactionOpen(true);
  };

  const openEdit = (tx: Transaction) => {
    setEditing(tx);
    setTransactionOpen(true);
  };

  const goToPlanner = () => setPage("planner");

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <button className="brand" onClick={() => setPage("dashboard")} aria-label="CashFlow Compass home">
            <span className="brand-mark">
              <Icon name="compass" size={21} />
            </span>
            <span className="brand-text">
              <strong>CashFlow Compass</strong>
              <small>Predictive cash-flow OS</small>
            </span>
          </button>

          <nav className="main-nav" aria-label="Main navigation">
            {NAV.map((item) => (
              <button
                key={item.page}
                className={`nav-btn ${page === item.page ? "active" : ""}`}
                onClick={() => setPage(item.page)}
                aria-current={page === item.page ? "page" : undefined}
              >
                <Icon name={item.icon} size={16} />
                {item.label}
              </button>
            ))}
          </nav>

          <div className="topbar-actions">
            <span className="local-pill">
              <Icon name="shield" size={13} /> On-device
            </span>
            <button className="btn btn-ghost btn-sm" onClick={() => setImportOpen(true)}>
              <Icon name="upload" size={15} /> Import CSV
            </button>
            <button className="btn btn-primary btn-sm" onClick={openAdd}>
              <Icon name="plus" size={15} /> Add
            </button>
            <button
              className="icon-btn"
              aria-label="Open settings"
              onClick={() => setSettingsOpen(true)}
            >
              <Icon name="settings" size={18} />
            </button>
          </div>
        </div>

        <nav className="mobile-nav" aria-label="Mobile navigation">
          {NAV.map((item) => (
            <button
              key={item.page}
              className={`nav-btn ${page === item.page ? "active" : ""}`}
              onClick={() => setPage(item.page)}
              aria-current={page === item.page ? "page" : undefined}
            >
              <Icon name={item.icon} size={15} />
              {item.label}
            </button>
          ))}
        </nav>
      </header>

      <main>
        {page === "dashboard" && (
          <DashboardPage
            onImport={() => setImportOpen(true)}
            onAddTransaction={openAdd}
            onNavigate={setPage}
            onOpenSettings={() => setSettingsOpen(true)}
            onAddScenario={goToPlanner}
          />
        )}
        {page === "transactions" && (
          <TransactionsPage
            onImport={() => setImportOpen(true)}
            onAdd={openAdd}
            onEdit={openEdit}
          />
        )}
        {page === "recurring" && <RecurringPage onImport={() => setImportOpen(true)} />}
        {page === "planner" && <PlannerPage />}
        {page === "insights" && <InsightsPage />}
      </main>

      <footer className="app-footer">
        <span>
          <strong>CashFlow Compass</strong> · PS 2.2 hackathon prototype · local-first, no bank
          connections
        </span>
        <span>Forecasts are estimates based on the transactions you provide. Not financial advice.</span>
      </footer>

      <CsvImportModal open={importOpen} onClose={() => setImportOpen(false)} />
      <TransactionModal
        open={transactionOpen}
        onClose={() => {
          setTransactionOpen(false);
          setEditing(null);
        }}
        editing={editing}
      />
      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {toast && (
        <div className="toast" role="status">
          <Icon name="check-circle" size={17} />
          {toast}
        </div>
      )}
    </div>
  );
}
