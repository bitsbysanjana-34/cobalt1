import { useMemo, useState } from "react";
import type { Page } from "../types";
import {
  addDays,
  daysBetween,
  daysLabel,
  mediumDate,
  money,
  percent,
  shortDate,
} from "../lib/format";
import { useApp } from "../store";
import { categoryColor } from "../lib/categorize";
import { DonutChart, ForecastChart, MonthlyBars } from "../components/Charts";
import { discretionaryHeadroom } from "../lib/analysis";
import { Badge, EmptyState, Segmented } from "../components/ui";
import { Icon } from "../components/Icon";

type Period = "month" | "30" | "90";

const PERIOD_LABEL: Record<Period, string> = {
  month: "this month",
  "30": "last 30 days",
  "90": "last 90 days",
};

export function DashboardPage({
  onImport,
  onAddTransaction,
  onNavigate,
  onOpenSettings,
  onAddScenario,
}: {
  onImport: () => void;
  onAddTransaction: () => void;
  onNavigate: (page: Page) => void;
  onOpenSettings: () => void;
  onAddScenario: () => void;
}) {
  const {
    today,
    transactions,
    forecast,
    baselineForecast,
    scenarios,
    settings,
    balance30DaysAgo,
    subscriptions,
    anomalies,
    recommendations,
    monthly,
    isDemoData,
    resetDemo,
    updateSettings,
    periodTotals,
    categoryBreakdown,
  } = useApp();
  const headroom = discretionaryHeadroom(forecast, settings);
  const [period, setPeriod] = useState<Period>("30");

  const range = useMemo(() => {
    if (period === "month") return { from: `${today.slice(0, 7)}-01`, to: today, label: "This month" };
    if (period === "90") return { from: addDays(today, -89), to: today, label: "Last 90 days" };
    return { from: addDays(today, -29), to: today, label: "Last 30 days" };
  }, [period, today]);

  const totals = periodTotals(transactions, range.from, range.to);
  const categories = categoryBreakdown(transactions, "expense", range.from, range.to);
  const delta = forecast.startingBalance - balance30DaysAgo;
  const savingsRate = totals.income > 0 ? (totals.net / totals.income) * 100 : 0;
  const upcoming = forecast.events.slice(0, 6);
  const recent = [...transactions]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 6);
  const latestMonth = monthly.length > 0 ? monthly[monthly.length - 1] : null;
  const activeScenarios = scenarios.filter((scenario) => scenario.active);
  const activeScenarioTotal = activeScenarios.reduce((sum, scenario) => sum + scenario.amount, 0);
  const demoCount = transactions.filter((tx) => tx.source === "demo").length;
  const ownCount = transactions.length - demoCount;
  const periodOptions: { value: Period; label: string }[] = [
    { value: "month", label: "This month" },
    { value: "30", label: "30 days" },
    { value: "90", label: "90 days" },
  ];

  if (transactions.length === 0) {
    return (
      <div className="page">
        <header className="page-head">
          <div>
            <p className="eyebrow">Dashboard · {mediumDate(today)}</p>
            <h1>Cash flow, clearly.</h1>
            <p className="page-sub">
              Add transactions or import a CSV to see a forecast built from your own history.
            </p>
          </div>
        </header>
        <div className="card empty-hero">
          <EmptyState
            icon="compass"
            title="No transactions yet"
            body="CashFlow Compass needs some transaction history before it can detect recurring payments and forecast your balance. Start with the demo, or bring your own CSV."
            action={
              <div className="button-row">
                <button className="btn btn-primary" onClick={resetDemo}>
                  <Icon name="sparkles" size={16} /> Load demo data
                </button>
                <button className="btn btn-secondary" onClick={onImport}>
                  <Icon name="upload" size={16} /> Import CSV
                </button>
                <button className="btn btn-ghost" onClick={onAddTransaction}>
                  Add a transaction
                </button>
              </div>
            }
          />
          <div className="empty-features">
            <div>
              <Icon name="repeat" size={18} />
              <h4>Find recurring bills</h4>
              <p>Timing and amount patterns surface subscriptions, rent, EMIs and salary.</p>
            </div>
            <div>
              <Icon name="trend-down" size={18} />
              <h4>See shortfalls early</h4>
              <p>A 30-day balance forecast with a visible uncertainty range and safety buffer.</p>
            </div>
            <div>
              <Icon name="flask" size={18} />
              <h4>Test decisions</h4>
              <p>Try a purchase or extra repayment before you commit, then compare the paths.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const bufferPct = Math.max(
    0,
    Math.min(140, (forecast.startingBalance / Math.max(settings.safetyThreshold, 1)) * 100),
  );

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">Dashboard · {mediumDate(today)}</p>
          <h1>{greeting()}, here’s your cash flow.</h1>
          <p className="page-sub">
            Forecast for the next {forecast.horizon} days, built from {forecast.transactionCount} transactions.
          </p>
        </div>
        <Segmented
          label="Summary period"
          options={periodOptions}
          value={period}
          onChange={setPeriod}
        />
      </header>

      {isDemoData && (
        <div className="demo-banner">
          <div className="demo-banner-text">
            <Badge tone="violet" dot>
              Demo data
            </Badge>
            <span>
              You’re exploring a fictional Bengaluru household with {demoCount} sample transactions
              {ownCount > 0 ? ` and ${ownCount} of your own` : ""}. Import a CSV to add more, or reset
              the demo — nothing is sent anywhere.
            </span>
          </div>
          <div className="button-row">
            <button className="btn btn-secondary btn-sm" onClick={onImport}>
              <Icon name="upload" size={15} /> Import my CSV
            </button>
            <button className="btn btn-ghost btn-sm" onClick={resetDemo}>
              Reset demo
            </button>
          </div>
        </div>
      )}

      <section className="kpi-grid" aria-label="Balance and period summary">
        <article className="card kpi">
          <div className="kpi-top">
            <span className="kpi-label">Current balance</span>
            <span className="kpi-icon"><Icon name="wallet" size={17} /></span>
          </div>
          <p className="kpi-value num">{money(forecast.startingBalance)}</p>
          <p className={`kpi-foot ${delta >= 0 ? "positive" : "negative"}`}>
            <Icon name={delta >= 0 ? "arrow-up" : "arrow-down"} size={13} />
            {money(Math.abs(delta))} {delta >= 0 ? "up" : "down"} vs 30 days ago
          </p>
        </article>
        <article className="card kpi">
          <div className="kpi-top">
            <span className="kpi-label">Income · {PERIOD_LABEL[period]}</span>
            <span className="kpi-icon income"><Icon name="arrow-down" size={17} /></span>
          </div>
          <p className="kpi-value num income">{money(totals.income)}</p>
          <p className="kpi-foot">
            {transactions.filter((tx) => tx.direction === "income" && tx.date >= range.from && tx.date <= range.to).length} incoming transactions
          </p>
        </article>
        <article className="card kpi">
          <div className="kpi-top">
            <span className="kpi-label">Expenses · {PERIOD_LABEL[period]}</span>
            <span className="kpi-icon expense"><Icon name="arrow-up" size={17} /></span>
          </div>
          <p className="kpi-value num expense">{money(totals.expense)}</p>
          <p className="kpi-foot">
            {transactions.filter((tx) => tx.direction === "expense" && tx.date >= range.from && tx.date <= range.to).length} outgoing transactions
          </p>
        </article>
        <article className="card kpi">
          <div className="kpi-top">
            <span className="kpi-label">Net cash flow</span>
            <span className={`kpi-icon ${totals.net >= 0 ? "income" : "expense"}`}>
              <Icon name={totals.net >= 0 ? "trend-up" : "trend-down"} size={17} />
            </span>
          </div>
          <p className={`kpi-value num ${totals.net >= 0 ? "income" : "expense"}`}>
            {totals.net >= 0 ? "+" : "−"}
            {money(Math.abs(totals.net))}
          </p>
          <p className="kpi-foot">
            {totals.income > 0
              ? `${percent(Math.abs(savingsRate), 0)} of income ${savingsRate >= 0 ? "kept" : "overspent"}`
              : "No income recorded in this period"}
          </p>
        </article>
      </section>

      <section className="dashboard-main">
        <article className="card forecast-card">
          <div className="card-head">
            <div>
              <div className="title-row">
                <h2>Cash-flow forecast</h2>
                <Badge tone={forecast.confidence === "high" ? "good" : forecast.confidence === "medium" ? "info" : "warn"} dot>
                  {forecast.confidence === "high" ? "High confidence" : forecast.confidence === "medium" ? "Moderate confidence" : "Limited history"}
                </Badge>
                {activeScenarios.length > 0 && (
                  <Badge tone="violet" dot>
                    {activeScenarios.length} scenario{activeScenarios.length === 1 ? "" : "s"} applied
                  </Badge>
                )}
              </div>
              <p className="card-sub">
                Starting at {money(forecast.startingBalance)} · {forecast.recurrenceCount} recurring streams ·{" "}
                {forecast.historyDays} days of history
              </p>
            </div>
            <div className="card-head-actions">
              <Segmented
                size="sm"
                label="Forecast horizon"
                options={[
                  { value: 30, label: "30d" },
                  { value: 60, label: "60d" },
                  { value: 90, label: "90d" },
                ]}
                value={settings.horizon}
                onChange={(value) => updateSettings({ horizon: value as 30 | 60 | 90 })}
              />
              <button className="icon-btn" aria-label="Adjust safety buffer" onClick={onOpenSettings}>
                <Icon name="settings" size={17} />
              </button>
            </div>
          </div>

          {activeScenarios.length > 0 && (
            <div className="scenario-active-row">
              <Icon name="flask" size={14} />
              <span>
                <strong>{activeScenarios.map((scenario) => scenario.name).join(", ")}</strong>{" "}
                ({money(activeScenarioTotal)} planned) is included in the solid line. The dashed line is
                the same forecast without it.
              </span>
              <button className="link-btn" onClick={() => onNavigate("planner")}>
                Adjust <Icon name="arrow-right" size={13} />
              </button>
            </div>
          )}
          <ForecastChart
            points={forecast.points}
            threshold={settings.safetyThreshold}
            compare={activeScenarios.length > 0 ? baselineForecast.points : null}
            compareLabel="Baseline (no scenario)"
            ariaLabel={`Projected balance for the next ${forecast.horizon} days with an 80% uncertainty range`}
          />
          <p className="chart-note">
            The shaded band is an 80% estimate range based on your historical daily variation and
            ±12% variation on detected bills. It widens with time; the line is not a guarantee.
          </p>

          <div className="drivers">
            <div className="drivers-head">
              <h3>What moves this forecast</h3>
              <span className="subtle">Detected from your transactions</span>
            </div>
            <div className="driver-grid">
              {forecast.factors.map((factor) => (
                <div className="driver" key={factor.label}>
                  <div className="driver-icon">
                    <Icon
                      name={
                        factor.direction === "income"
                          ? "arrow-down"
                          : factor.direction === "expense"
                            ? "arrow-up"
                            : "info"
                      }
                      size={15}
                    />
                  </div>
                  <div className="driver-body">
                    <span className="driver-label">{factor.label}</span>
                    <span className={`driver-amount ${factor.direction === "neutral" ? "muted" : factor.direction}`}>
                      {factor.direction === "neutral" ? "—" : money(factor.amount)}
                    </span>
                    <p>{factor.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </article>

        <div className="side-stack">
          <article className={`card safety-card ${forecast.breach ? "at-risk" : "safe"}`}>
                        <div className="card-head">
              <div>
                <h2>Safety check</h2>
                <p className="card-sub">
                  Your chosen buffer · {money(settings.safetyThreshold)}
                  {activeScenarios.length > 0 ? " · scenarios included" : ""}
                </p>
              </div>
              <span className="kpi-icon"><Icon name="shield" size={18} /></span>
            </div>
            <div className="safety-gauge" aria-hidden="true">
              <span
                className={forecast.startingBalance < settings.safetyThreshold ? "low" : ""}
                style={{ width: `${bufferPct}%` }}
              />
            </div>
            <div className="safety-gauge-label">
              <span>{money(forecast.startingBalance)} today</span>
              <span>{money(settings.safetyThreshold)} buffer</span>
            </div>

            {forecast.breach ? (
              <div className="breach-block">
                <div className="breach-icon"><Icon name="alert" size={18} /></div>
                <div>
                  <h3>May drop below buffer {daysLabel(daysBetween(today, forecast.breach.date))}</h3>
                  <p>
                    Projected <strong className="num">{money(forecast.breach.balance)}</strong> on{" "}
                    {mediumDate(forecast.breach.date)} — {money(settings.safetyThreshold - forecast.breach.balance)} under your buffer.
                  </p>
                </div>
              </div>
            ) : (
              <div className="breach-block ok">
                <div className="breach-icon"><Icon name="check-circle" size={18} /></div>
                <div>
                  <h3>Buffer holds through {shortDate(addDays(today, forecast.horizon))}</h3>
                  <p>
                    Lowest point is <strong className="num">{money(forecast.minBalance)}</strong> on{" "}
                    {shortDate(forecast.minDate)}, {money(forecast.minBalance - settings.safetyThreshold)} above the buffer.
                  </p>
                </div>
              </div>
            )}

            <div className="headroom-block">
              <div className="headroom-top">
                <span className="kpi-label">Safe to spend before {shortDate(headroom.untilDate)}</span>
                <strong className="num">{money(headroom.safeToSpend)}</strong>
              </div>
              <p>
                {headroom.headroom > 0
                  ? `About ${money(headroom.perDay)}/day while staying above your buffer, after detected bills. This is a limit based on your own forecast, not a target.`
                  : `No discretionary headroom: detected bills before your next income already put you ${money(
                      Math.abs(headroom.headroom),
                    )} below your buffer.`}
              </p>
            </div>

            <dl className="mini-stats">
              <div>
                <dt>Lowest projected</dt>
                <dd className={`num ${forecast.minBalance < settings.safetyThreshold ? "negative" : ""}`}>
                  {money(forecast.minBalance)}
                </dd>
              </div>
              <div>
                <dt>In {forecast.horizon} days</dt>
                <dd className="num">{money(forecast.endBalance)}</dd>
              </div>
              <div>
                <dt>Band at end</dt>
                <dd className="num">±{money(forecast.bandWidthEnd)}</dd>
              </div>
            </dl>

            <button className="btn btn-secondary btn-block" onClick={onAddScenario}>
              <Icon name="flask" size={16} /> Stress-test a decision
            </button>
          </article>

          <article className="card upcoming-card">
            <div className="card-head">
              <div>
                <h2>Upcoming</h2>
                <p className="card-sub">Recurring payments and income</p>
              </div>
              <button className="link-btn" onClick={() => onNavigate("recurring")}>
                View all <Icon name="arrow-right" size={14} />
              </button>
            </div>
            {upcoming.length === 0 ? (
              <p className="subtle small">No recurring payments detected in this window.</p>
            ) : (
              <ul className="upcoming-list">
                {upcoming.map((event) => (
                  <li key={event.id}>
                    <span className={`event-dot ${event.direction}`}>
                      <Icon name={event.direction === "income" ? "arrow-down" : "arrow-up"} size={12} />
                    </span>
                    <div className="event-main">
                      <span className="event-label">{event.label}</span>
                      <span className="event-meta">
                        {shortDate(event.date)} · {daysLabel(daysBetween(today, event.date))}
                        {event.kind === "scenario" ? " · scenario" : ""}
                      </span>
                    </div>
                    <span className={`event-amount num ${event.direction}`}>
                      {event.direction === "income" ? "+" : "−"}
                      {money(event.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </article>
        </div>
      </section>

      <section className="dashboard-row">
        <article className="card recommendations-card">
          <div className="card-head">
            <div>
              <div className="title-row">
                <h2>Recommendations</h2>
                <Badge tone="info">Explainable</Badge>
              </div>
              <p className="card-sub">Grounded in your transactions and this forecast</p>
            </div>
            <button className="link-btn" onClick={() => onNavigate("insights")}>
              All insights <Icon name="arrow-right" size={14} />
            </button>
          </div>
          <div className="rec-list">
            {recommendations.slice(0, 2).map((rec) => (
              <div className={`rec rec-${rec.tone}`} key={rec.id}>
                <div className="rec-icon">
                  <Icon
                    name={rec.tone === "good" ? "check-circle" : rec.tone === "info" ? "info" : "alert"}
                    size={17}
                  />
                </div>
                <div className="rec-body">
                  <h3>{rec.title}</h3>
                  <p>{rec.body}</p>
                  <ul className="facts">
                    {rec.facts.map((fact) => (
                      <li key={fact}>{fact}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="card money-map">
          <div className="card-head">
            <div>
              <h2>Where the money goes</h2>
              <p className="card-sub">{range.label} · {money(totals.expense)} spent</p>
            </div>
          </div>
          {categories.length === 0 ? (
            <p className="subtle small">No expenses recorded in this period.</p>
          ) : (
            <div className="money-map-body">
              <DonutChart
                data={categories.map((entry) => ({
                  label: entry.category,
                  value: entry.total,
                  color: categoryColor(entry.category),
                }))}
                total={totals.expense}
                centerLabel="spent"
              />
              <ul className="category-legend">
                {categories.slice(0, 5).map((entry) => (
                  <li key={entry.category}>
                    <span className="legend-swatch" style={{ background: categoryColor(entry.category) }} />
                    <span className="legend-name">{entry.category}</span>
                    <span className="legend-value num">{money(entry.total)}</span>
                    <span className="legend-share num">{percent(entry.share, 0)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </article>
      </section>

      <section className="dashboard-triptych">
        <article className="card">
          <div className="card-head">
            <div>
              <h2>Cash flow, last 6 months</h2>
              <p className="card-sub">Income against expenses</p>
            </div>
            <Badge tone={(latestMonth?.net ?? 0) >= 0 ? "good" : "expense"}>
              {(latestMonth?.net ?? 0) >= 0 ? "Net positive" : "Net negative"}
              {latestMonth ? ` in ${latestMonth.label}` : ""}
            </Badge>
          </div>
          <MonthlyBars months={monthly} />
          <div className="bar-legend">
            <span><i className="legend-swatch income" /> Income</span>
            <span><i className="legend-swatch expense" /> Expenses</span>
          </div>
        </article>

        <article className="card">
          <div className="card-head">
            <div>
              <h2>Unusual spending</h2>
              <p className="card-sub">Compared with your own category history</p>
            </div>
            <span className="kpi-icon"><Icon name="target" size={17} /></span>
          </div>
          {anomalies.length === 0 ? (
            <div className="calm-state">
              <Icon name="check-circle" size={20} />
              <div>
                <h3>Nothing stands out</h3>
                <p>No recent transaction is far outside your usual range for its category.</p>
              </div>
            </div>
          ) : (
            <div className="anomaly">
              <div className="anomaly-top">
                <span className="anomaly-amount num">{money(anomalies[0].transaction.amount)}</span>
                <Badge tone="warn">{anomalies[0].ratio.toFixed(1)}× typical</Badge>
              </div>
              <h3>{anomalies[0].transaction.description}</h3>
              <p className="subtle small">
                {shortDate(anomalies[0].transaction.date)} · {anomalies[0].transaction.category}
              </p>
              <p>{anomalies[0].explanation}</p>
              <button className="link-btn" onClick={() => onNavigate("insights")}>
                More signals <Icon name="arrow-right" size={14} />
              </button>
            </div>
          )}
        </article>

        <article className="card">
          <div className="card-head">
            <div>
              <h2>Subscriptions</h2>
              <p className="card-sub">Detected repeat payments</p>
            </div>
            <span className="kpi-icon"><Icon name="repeat" size={17} /></span>
          </div>
          <p className="subscription-total num">
            {money(subscriptions.monthlyTotal)}
            <span className="subtle">/month</span>
          </p>
          <p className="subtle small">
            {subscriptions.count} recurring subscription{subscriptions.count === 1 ? "" : "s"} ·{" "}
            {money(subscriptions.annualTotal)} a year
          </p>
          <ul className="mini-sub-list">
            {subscriptions.items.slice(0, 3).map((entry) => (
              <li key={entry.item.key}>
                <span>{entry.item.label}</span>
                <span className="num">{money(entry.monthly)}/mo</span>
              </li>
            ))}
          </ul>
          <button className="link-btn" onClick={() => onNavigate("recurring")}>
            Review recurring <Icon name="arrow-right" size={14} />
          </button>
        </article>
      </section>

      <section className="card recent-card">
        <div className="card-head">
          <div>
            <h2>Recent transactions</h2>
            <p className="card-sub">Latest activity across imported and manual entries</p>
          </div>
          <button className="link-btn" onClick={() => onNavigate("transactions")}>
            Open transactions <Icon name="arrow-right" size={14} />
          </button>
        </div>
        <ul className="recent-list">
          {recent.map((tx) => (
            <li key={tx.id}>
              <span className={`event-dot ${tx.direction}`}>
                <Icon name={tx.direction === "income" ? "arrow-down" : "arrow-up"} size={12} />
              </span>
              <span className="recent-main">
                <span className="recent-desc">{tx.description}</span>
                <span className="recent-meta">
                  {shortDate(tx.date)} · {tx.category}
                  {tx.source === "demo" && <span className="source-tag">demo</span>}
                </span>
              </span>
              <span className={`recent-amount num ${tx.direction}`}>
                {tx.direction === "income" ? "+" : "−"}
                {money(tx.amount)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <p className="disclaimer">
        <Icon name="info" size={14} /> Forecasts and recommendations are estimates based only on the
        transactions you provided. They are not professional financial advice. All calculations run
        locally in your browser.
      </p>
    </div>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
