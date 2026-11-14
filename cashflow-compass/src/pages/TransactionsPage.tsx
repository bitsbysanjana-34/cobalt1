import { useEffect, useMemo, useState } from "react";
import type { Transaction } from "../types";
import { useApp } from "../store";
import { ALL_CATEGORIES, categoriesFor } from "../lib/categorize";
import { downloadText, transactionsToCsv } from "../lib/csv";
import { money, shortDate, todayISO } from "../lib/format";
import { recurringKey } from "../lib/recurring";
import { Badge, EmptyState } from "../components/ui";
import { Icon } from "../components/Icon";

type DirectionFilter = "all" | "income" | "expense";
type SortKey = "date-desc" | "date-asc" | "amount-desc";

const PAGE_SIZE = 12;

export function TransactionsPage({
  onImport,
  onAdd,
  onEdit,
}: {
  onImport: () => void;
  onAdd: () => void;
  onEdit: (tx: Transaction) => void;
}) {
  const {
    transactions,
    recurring,
    setCategory,
    deleteTransaction,
    notify,
    resetDemo,
    isDemoData,
  } = useApp();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [direction, setDirection] = useState<DirectionFilter>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState<SortKey>("date-desc");
  const [page, setPage] = useState(1);

  const recurringStatus = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of recurring) map.set(item.key, item.status);
    return map;
  }, [recurring]);

  useEffect(() => {
    setPage(1);
  }, [search, categoryFilter, direction, from, to, sort]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return transactions
      .filter((tx) => {
        if (query && !tx.description.toLowerCase().includes(query) && !tx.category.toLowerCase().includes(query)) {
          return false;
        }
        if (categoryFilter !== "all" && tx.category !== categoryFilter) return false;
        if (direction !== "all" && tx.direction !== direction) return false;
        if (from && tx.date < from) return false;
        if (to && tx.date > to) return false;
        return true;
      })
      .sort((a, b) => {
        if (sort === "date-asc") return a.date.localeCompare(b.date);
        if (sort === "amount-desc") return b.amount - a.amount;
        return b.date.localeCompare(a.date);
      });
  }, [transactions, search, categoryFilter, direction, from, to, sort]);

  const totals = filtered.reduce(
    (acc, tx) => {
      if (tx.direction === "income") acc.income += tx.amount;
      else acc.expense += tx.amount;
      return acc;
    },
    { income: 0, expense: 0 },
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visible = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const filtersActive = Boolean(
    search || categoryFilter !== "all" || direction !== "all" || from || to,
  );

  const handleDelete = (tx: Transaction) => {
    const confirmed = window.confirm(
      `Delete “${tx.description}” (${money(tx.amount)})? The forecast will be recalculated.`,
    );
    if (!confirmed) return;
    deleteTransaction(tx.id);
    notify("Transaction deleted. Forecast recalculated.");
  };

  const clearFilters = () => {
    setSearch("");
    setCategoryFilter("all");
    setDirection("all");
    setFrom("");
    setTo("");
    setSort("date-desc");
  };

  if (transactions.length === 0) {
    return (
      <div className="page">
        <header className="page-head">
          <div>
            <p className="eyebrow">Transactions</p>
            <h1>Your ledger is empty.</h1>
            <p className="page-sub">Import a CSV or add entries manually to start the analysis.</p>
          </div>
        </header>
        <div className="card">
          <EmptyState
            icon="list"
            title="No transactions to show"
            body="Every forecast, recurring payment and insight is derived from this ledger. Load the demo to explore, or import your bank export."
            action={
              <div className="button-row">
                <button className="btn btn-primary" onClick={onImport}>
                  <Icon name="upload" size={16} /> Import CSV
                </button>
                <button className="btn btn-secondary" onClick={resetDemo}>
                  Load demo data
                </button>
                <button className="btn btn-ghost" onClick={onAdd}>
                  Add a transaction
                </button>
              </div>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">Transactions</p>
          <h1>Every transaction, accounted for.</h1>
          <p className="page-sub">
            {transactions.length} entries stored locally. Edit a category and the app remembers the merchant.
          </p>
        </div>
        <div className="button-row">
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => downloadText("cashflow-compass-transactions.csv", transactionsToCsv(filtered))}
            disabled={filtered.length === 0}
          >
            <Icon name="download" size={15} /> Export CSV
          </button>
          <button className="btn btn-secondary" onClick={onImport}>
            <Icon name="upload" size={16} /> Import
          </button>
          <button className="btn btn-primary" onClick={onAdd}>
            <Icon name="plus" size={16} /> Add transaction
          </button>
        </div>
      </header>

      <div className="filter-bar">
        <div className="search-field">
          <Icon name="search" size={17} />
          <input
            type="search"
            placeholder="Search description or category…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Search transactions"
          />
        </div>
        <div className="filter-group">
          <label className="filter-label" htmlFor="filter-from">From</label>
          <input
            id="filter-from"
            type="date"
            value={from}
            max={to || todayISO()}
            onChange={(event) => setFrom(event.target.value)}
          />
        </div>
        <div className="filter-group">
          <label className="filter-label" htmlFor="filter-to">To</label>
          <input
            id="filter-to"
            type="date"
            value={to}
            min={from || undefined}
            max={todayISO()}
            onChange={(event) => setTo(event.target.value)}
          />
        </div>
        <select
          aria-label="Filter by category"
          value={categoryFilter}
          onChange={(event) => setCategoryFilter(event.target.value)}
        >
          <option value="all">All categories</option>
          {ALL_CATEGORIES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by type"
          value={direction}
          onChange={(event) => setDirection(event.target.value as DirectionFilter)}
        >
          <option value="all">Income &amp; expense</option>
          <option value="income">Income only</option>
          <option value="expense">Expenses only</option>
        </select>
        <select
          aria-label="Sort transactions"
          value={sort}
          onChange={(event) => setSort(event.target.value as SortKey)}
        >
          <option value="date-desc">Newest first</option>
          <option value="date-asc">Oldest first</option>
          <option value="amount-desc">Largest amount</option>
        </select>
        {filtersActive && (
          <button className="btn btn-ghost btn-sm" onClick={clearFilters}>
            <Icon name="x" size={14} /> Clear
          </button>
        )}
      </div>

      <div className="ledger-summary">
        <span>
          <strong className="num">{filtered.length}</strong> matching transactions
        </span>
        <span className="income num">+{money(totals.income)} income</span>
        <span className="expense num">−{money(totals.expense)} expenses</span>
        <span className="net num">
          Net {totals.income - totals.expense >= 0 ? "+" : "−"}
          {money(Math.abs(totals.income - totals.expense))}
        </span>
        {isDemoData && <Badge tone="violet">includes demo data</Badge>}
      </div>

      <div className="card table-card">
        {filtered.length === 0 ? (
          <EmptyState
            icon="search"
            title="No transactions match"
            body="Try a wider date range or clear a filter to see more of your ledger."
            action={
              <button className="btn btn-secondary" onClick={clearFilters}>
                Clear all filters
              </button>
            }
          />
        ) : (
          <>
            <div className="table-scroll">
              <table className="data-table ledger-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th>Category</th>
                    <th>Type</th>
                    <th className="right">Amount</th>
                    <th>Recurring</th>
                    <th className="right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((tx) => {
                    const status = recurringStatus.get(recurringKey(tx.description, tx.direction));
                    return (
                      <tr key={tx.id}>
                        <td className="nowrap num">{shortDate(tx.date)}</td>
                        <td>
                          <div className="description-cell">
                            <span>{tx.description}</span>
                            {tx.source === "demo" && <span className="source-tag">demo</span>}
                            {tx.source === "import" && <span className="source-tag import">csv</span>}
                          </div>
                        </td>
                        <td>
                          <select
                            className="category-select"
                            aria-label={`Category for ${tx.description}`}
                            value={tx.category}
                            onChange={(event) => setCategory(tx.id, event.target.value)}
                          >
                            {categoriesFor(tx.direction).map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <span className={`type-pill ${tx.direction}`}>
                            {tx.direction === "income" ? "Income" : "Expense"}
                          </span>
                        </td>
                        <td className={`right num amount ${tx.direction}`}>
                          {tx.direction === "income" ? "+" : "−"}
                          {money(tx.amount)}
                        </td>
                        <td>
                          {status === "confirmed" ? (
                            <Badge tone="info" dot>Recurring</Badge>
                          ) : status === "review" ? (
                            <Badge tone="warn">Review</Badge>
                          ) : (
                            <span className="subtle">—</span>
                          )}
                        </td>
                        <td>
                          <div className="row-actions">
                            <button
                              className="icon-btn sm"
                              aria-label={`Edit ${tx.description}`}
                              onClick={() => onEdit(tx)}
                            >
                              <Icon name="edit" size={15} />
                            </button>
                            <button
                              className="icon-btn sm danger"
                              aria-label={`Delete ${tx.description}`}
                              onClick={() => handleDelete(tx)}
                            >
                              <Icon name="trash" size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="table-foot">
              <span className="subtle small">
                Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of{" "}
                {filtered.length}
              </span>
              <div className="pager">
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={safePage === 1}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                >
                  Previous
                </button>
                <span className="subtle small">
                  Page {safePage} of {pageCount}
                </span>
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={safePage === pageCount}
                  onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      <p className="disclaimer">
        <Icon name="info" size={14} /> Category edits are saved in this browser and used to
        auto-categorize future imports from the same merchant. Demo rows are clearly tagged.
      </p>
    </div>
  );
}
