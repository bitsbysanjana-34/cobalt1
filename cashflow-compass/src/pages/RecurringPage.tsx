import { useMemo, useState } from "react";
import type { RecurringItem, RecurringStatus } from "../types";
import { useApp } from "../store";
import { categoryColor } from "../lib/categorize";
import {
  addDays,
  daysBetween,
  daysLabel,
  mediumDate,
  money,
  shortDate,
} from "../lib/format";
import { monthlyEquivalent, FREQUENCY_LABEL } from "../lib/recurring";
import { AmountBars } from "../components/Charts";
import { Badge, ConfidenceMeter, EmptyState } from "../components/ui";
import { Icon } from "../components/Icon";

type Tab = "all" | "confirmed" | "review" | "dismissed";

export function RecurringPage({ onImport }: { onImport: () => void }) {
  const { recurring, today, forecast, setRecurringStatus, notify } = useApp();
  const [tab, setTab] = useState<Tab>("all");

  const counts = useMemo(
    () => ({
      all: recurring.length,
      confirmed: recurring.filter((item) => item.status === "confirmed").length,
      review: recurring.filter((item) => item.status === "review").length,
      dismissed: recurring.filter((item) => item.status === "dismissed").length,
    }),
    [recurring],
  );

  const visible = recurring.filter((item) => tab === "all" || item.status === tab);
  const monthlyBills = recurring
    .filter((item) => item.status === "confirmed" && item.direction === "expense")
    .reduce((sum, item) => sum + monthlyEquivalent(item), 0);
  const nextSeven = forecast.events
    .filter(
      (event) =>
        event.kind === "recurring" &&
        event.direction === "expense" &&
        event.date <= addDays(today, 7),
    )
    .reduce((sum, event) => sum + event.amount, 0);

  const update = (item: RecurringItem, status: RecurringStatus | null) => {
    setRecurringStatus(item.key, status);
    if (status === "confirmed") notify(`“${item.label}” marked as recurring. Forecast updated.`);
    else if (status === "dismissed") notify(`“${item.label}” removed from the forecast.`);
    else notify("Pattern reset to automatic detection.");
  };

  if (recurring.length === 0) {
    return (
      <div className="page">
        <header className="page-head">
          <div>
            <p className="eyebrow">Recurring</p>
            <h1>No repeating patterns found yet.</h1>
            <p className="page-sub">
              Regular bills and income are detected from description, timing and amount consistency.
            </p>
          </div>
        </header>
        <div className="card">
          <EmptyState
            icon="repeat"
            title="Not enough history to detect patterns"
            body="Import at least three cycles of a bill for it to be recognised — for example three months of rent or three weekly grocery orders. Import a CSV to get started."
            action={
              <button className="btn btn-primary" onClick={onImport}>
                <Icon name="upload" size={16} /> Import transactions
              </button>
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
          <p className="eyebrow">Recurring</p>
          <h1>The payments that repeat themselves.</h1>
          <p className="page-sub">
            Grouped by merchant, timing and amount. Uncertain matches stay in Review until you accept them.
          </p>
        </div>
      </header>

      <section className="recurring-summary">
        <div className="card mini-stat">
          <span className="kpi-label">Confirmed patterns</span>
          <span className="mini-stat-value num">{counts.confirmed}</span>
          <span className="subtle small">bills and income, out of {counts.all} detected</span>
        </div>
        <div className="card mini-stat">
          <span className="kpi-label">Monthly committed bills</span>
          <span className="mini-stat-value num">{money(monthlyBills)}</span>
          <span className="subtle small">normalised across weekly, monthly and yearly cycles</span>
        </div>
        <div className="card mini-stat">
          <span className="kpi-label">Due in the next 7 days</span>
          <span className="mini-stat-value num">{money(nextSeven)}</span>
          <span className="subtle small">
            {forecast.events.filter((event) => event.kind === "recurring" && event.date <= addDays(today, 7)).length} scheduled items
          </span>
        </div>
        <div className="card mini-stat review-stat">
          <span className="kpi-label">Needs review</span>
          <span className="mini-stat-value num">{counts.review}</span>
          <span className="subtle small">variable amounts or irregular timing</span>
        </div>
      </section>

      <div className="tabs" role="tablist" aria-label="Recurring detection status">
        {(["all", "confirmed", "review", "dismissed"] as Tab[]).map((option) => (
          <button
            key={option}
            role="tab"
            aria-selected={tab === option}
            className={tab === option ? "active" : ""}
            onClick={() => setTab(option)}
          >
            {option === "all" ? "All" : option === "review" ? "Review" : option.charAt(0).toUpperCase() + option.slice(1)}
            <span className="tab-count">{counts[option]}</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="check-circle"
            title={tab === "review" ? "Nothing waiting for review" : "No patterns in this view"}
            body={
              tab === "review"
                ? "Every detected pattern has been confirmed or dismissed. New patterns appear here after an import."
                : "Switch tabs to see other detected patterns."
            }
          />
        </div>
      ) : (
        <div className="recurring-grid">
          {visible.map((item) => (
            <article className={`recurring-card card ${item.direction}`} key={item.key}>
              <div className="recurring-head">
                <div className="recurring-title">
                  <span
                    className="recurring-mark"
                    style={{ background: categoryColor(item.category) }}
                  />
                  <div>
                    <h3>{item.label}</h3>
                    <div className="recurring-tags">
                      <Badge tone={item.direction === "income" ? "income" : "expense"}>
                        {item.direction === "income" ? "Income" : "Expense"}
                      </Badge>
                      <span className="subtle small">{item.category}</span>
                    </div>
                  </div>
                </div>
                <Badge
                  tone={item.status === "confirmed" ? "good" : item.status === "review" ? "warn" : "neutral"}
                  dot
                >
                  {item.status === "confirmed" ? "Confirmed" : item.status === "review" ? "Review" : "Dismissed"}
                </Badge>
              </div>

              <div className="recurring-amount-row">
                <div>
                  <span className="kpi-label">Typical amount</span>
                  <p className="recurring-amount num">{money(item.typicalAmount)}</p>
                </div>
                <div>
                  <span className="kpi-label">Frequency</span>
                  <p className="recurring-frequency">{FREQUENCY_LABEL[item.frequency]}</p>
                  <span className="subtle small">every ~{Math.round(item.intervalDays)} days</span>
                </div>
                <div>
                  <span className="kpi-label">Next expected</span>
                  <p className="recurring-next">{shortDate(item.nextDate)}</p>
                  <span className="subtle small">{daysLabel(daysBetween(today, item.nextDate))}</span>
                </div>
              </div>

              <div className="recurring-bars">
                <AmountBars
                  values={item.amounts}
                  color={item.direction === "income" ? "#34d399" : "#818cf8"}
                />
                <span className="subtle small">Last {item.amounts.length} amounts</span>
              </div>

              <ConfidenceMeter value={item.confidence} label={`${Math.round(item.confidence * 100)}% pattern match`} />

              <p className="detection-note">
                <Icon name={item.status === "review" ? "alert" : "info"} size={14} />
                {item.detectionNote} {item.occurrences} occurrences since {mediumDate(item.firstDate)}.
              </p>

              <div className="recurring-actions">
                {item.status === "review" ? (
                  <>
                    <button className="btn btn-primary btn-sm" onClick={() => update(item, "confirmed")}>
                      <Icon name="check" size={14} /> Confirm as recurring
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => update(item, "dismissed")}>
                      Not a bill
                    </button>
                  </>
                ) : item.status === "dismissed" ? (
                  <button className="btn btn-secondary btn-sm" onClick={() => update(item, null)}>
                    Restore suggestion
                  </button>
                ) : (
                  <button className="btn btn-ghost btn-sm" onClick={() => update(item, "dismissed")}>
                    Remove from forecast
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      <p className="disclaimer">
        <Icon name="info" size={14} /> Detection compares gaps between similar transactions and how
        much amounts vary. Items marked Review have variable amounts or irregular timing, so they are
        excluded from the baseline forecast unless you confirm them.
      </p>
    </div>
  );
}
