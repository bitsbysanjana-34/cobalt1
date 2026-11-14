import { useState } from "react";
import { useApp } from "../store";
import { categoryColor } from "../lib/categorize";
import { downloadText, transactionsToCsv } from "../lib/csv";
import { monthlyEquivalent, FREQUENCY_LABEL } from "../lib/recurring";
import {
  mediumDate,
  money,
  percent,
  shortDate,
} from "../lib/format";
import { AccuracyChart } from "../components/Charts";
import { Badge, EmptyState } from "../components/ui";
import { Icon } from "../components/Icon";

export function InsightsPage() {
  const {
    recommendations,
    anomalies,
    backtest,
    recurring,
    transactions,
    settings,
    subscriptions,
    isDemoData,
    resetDemo,
    clearData,
    notify,
  } = useApp();
  const [armed, setArmed] = useState(false);

  const confirmedBills = recurring
    .filter((item) => item.status === "confirmed" && item.direction === "expense")
    .sort((a, b) => monthlyEquivalent(b) - monthlyEquivalent(a));
  const monthlyBills = confirmedBills.reduce((sum, item) => sum + monthlyEquivalent(item), 0);
  const accuracyTone = backtest
    ? backtest.errorPercent <= 5
      ? "good"
      : backtest.errorPercent <= 12
        ? "info"
        : "warn"
    : "neutral";

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">Insights</p>
          <h1>Why the forecast looks like this.</h1>
          <p className="page-sub">
            Every number below can be traced back to a transaction, a detected pattern, or a stated
            assumption.
          </p>
        </div>
        <Badge tone="info" dot>
          On-device analysis
        </Badge>
      </header>

      <section className="insights-section">
        <div className="section-head">
          <div>
            <h2>Recommendations</h2>
            <p className="card-sub">Each one lists the facts behind it</p>
          </div>
          <span className="subtle small">{recommendations.length} generated from your data</span>
        </div>
        <div className="rec-grid">
          {recommendations.map((rec) => (
            <article className={`card rec rec-${rec.tone}`} key={rec.id}>
              <div className="rec-icon">
                <Icon
                  name={rec.tone === "good" ? "check-circle" : rec.tone === "info" ? "info" : "alert"}
                  size={18}
                />
              </div>
              <div className="rec-body">
                <div className="rec-heading">
                  <h3>{rec.title}</h3>
                  <Badge tone={rec.tone === "alert" ? "expense" : rec.tone === "warn" ? "warn" : rec.tone === "good" ? "good" : "info"}>
                    {rec.tone === "alert" ? "Act soon" : rec.tone === "warn" ? "Watch" : rec.tone === "good" ? "On track" : "Insight"}
                  </Badge>
                </div>
                <p>{rec.body}</p>
                <div className="facts-block">
                  <span className="facts-title">Why this appears</span>
                  <ul className="facts">
                    {rec.facts.map((fact) => (
                      <li key={fact}>{fact}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="insights-split">
        <article className="card">
          <div className="card-head">
            <div>
              <h2>Unusual spending</h2>
              <p className="card-sub">Compared with your own history for the same category</p>
            </div>
            <Badge tone="warn">Not fraud detection</Badge>
          </div>
          {anomalies.length === 0 ? (
            <div className="calm-state">
              <Icon name="check-circle" size={20} />
              <div>
                <h3>Nothing unusual in the last 60 days</h3>
                <p>
                  Transactions are compared with the median for their category. Larger one-off
                  purchases and seasonal bills may still be perfectly normal.
                </p>
              </div>
            </div>
          ) : (
            <ul className="anomaly-list">
              {anomalies.map((anomaly) => (
                <li key={anomaly.transaction.id}>
                  <div className="anomaly-line">
                    <span className="anomaly-title">
                      {anomaly.transaction.description}
                      <span className="subtle small"> · {shortDate(anomaly.transaction.date)}</span>
                    </span>
                    <span className={`num amount ${anomaly.transaction.direction}`}>
                      {money(anomaly.transaction.amount)}
                    </span>
                  </div>
                  <div className="anomaly-meta">
                    <Badge tone={anomaly.severity === "strong" ? "expense" : "warn"}>
                      {anomaly.ratio.toFixed(1)}× typical
                    </Badge>
                    <span className="subtle small">
                      Typical {anomaly.transaction.category.toLowerCase()}: {money(anomaly.median)} ·{" "}
                      {anomaly.samples} transactions
                    </span>
                  </div>
                  <p className="anomaly-explanation">{anomaly.explanation}</p>
                </li>
              ))}
            </ul>
          )}
          <p className="footnote">
            The detector uses a median and median-absolute-deviation test. An unusual amount can be a
            planned purchase or a price change; it is not evidence of fraud.
          </p>
        </article>

        <article className="card accuracy-card">
          <div className="card-head">
            <div>
              <h2>Forecast accuracy</h2>
              <p className="card-sub">Backtest against the last 30 days you actually lived</p>
            </div>
            <Badge tone={accuracyTone}>
              {backtest ? `${percent(backtest.errorPercent, 1)} end-balance error` : "Not enough history"}
            </Badge>
          </div>
          {!backtest ? (
            <EmptyState
              icon="clock"
              title="Needs a little more history"
              body="The app holds out the last 30 days, forecasts them from the earlier data, then compares the result with what actually happened. That needs at least a few weeks of transactions."
            />
          ) : (
            <>
              <div className="accuracy-stats">
                <div>
                  <span className="kpi-label">Predicted on {shortDate(backtest.points[backtest.points.length - 1].date)}</span>
                  <span className="num accuracy-value">{money(backtest.predictedEnd)}</span>
                </div>
                <div>
                  <span className="kpi-label">Actual balance</span>
                  <span className="num accuracy-value">{money(backtest.actualEnd)}</span>
                </div>
                <div>
                  <span className="kpi-label">Mean daily error</span>
                  <span className="num accuracy-value">{money(backtest.meanAbsDailyError)}</span>
                </div>
              </div>
              <AccuracyChart result={backtest} />
              <p className="footnote">
                Forecast made on {mediumDate(backtest.cutoff)} using only transactions before that
                date. The end-balance error is measured against the actual balance on{" "}
                {mediumDate(backtest.points[backtest.points.length - 1].date)}. One backtest is a
                sanity check, not a statistical guarantee.
              </p>
            </>
          )}
        </article>
      </section>

      <section className="insights-split">
        <article className="card">
          <div className="card-head">
            <div>
              <h2>Confirmed fixed commitments</h2>
              <p className="card-sub">Normalised to a monthly figure for comparison</p>
            </div>
            <span className="num commitment-total">{money(monthlyBills)}<span className="subtle">/mo</span></span>
          </div>
          {confirmedBills.length === 0 ? (
            <p className="subtle small">No confirmed recurring bills yet.</p>
          ) : (
            <div className="table-scroll">
              <table className="data-table compact-table">
                <thead>
                  <tr>
                    <th>Commitment</th>
                    <th>Frequency</th>
                    <th>Next</th>
                    <th className="right">Typical</th>
                    <th className="right">Per month</th>
                  </tr>
                </thead>
                <tbody>
                  {confirmedBills.map((item) => (
                    <tr key={item.key}>
                      <td>
                        <span className="commitment-name">
                          <i className="legend-swatch" style={{ background: categoryColor(item.category) }} />
                          {item.label}
                        </span>
                      </td>
                      <td className="subtle">{FREQUENCY_LABEL[item.frequency]}</td>
                      <td className="subtle">{shortDate(item.nextDate)}</td>
                      <td className="right num">{money(item.typicalAmount)}</td>
                      <td className="right num">{money(monthlyEquivalent(item))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="footnote">
            {subscriptions.count} of these look like subscriptions, totalling about{" "}
            {money(subscriptions.monthlyTotal)} per month. Reviewing them is optional; the app does not
            cancel or recommend financial products.
          </p>
        </article>

        <article className="card privacy-card">
          <div className="card-head">
            <div>
              <h2>Data &amp; privacy</h2>
              <p className="card-sub">Everything stays in this browser</p>
            </div>
            <span className="kpi-icon"><Icon name="shield" size={18} /></span>
          </div>
          <ul className="privacy-list">
            <li>
              <Icon name="database" size={16} />
              <div>
                <strong>{transactions.length} transactions stored locally</strong>
                <p>Saved in browser localStorage. No account, server or bank connection.</p>
              </div>
            </li>
            <li>
              <Icon name="sparkles" size={16} />
              <div>
                <strong>Rule-based categorization</strong>
                <p>
                  Merchant keywords plus your own corrections. No transaction data is sent to an AI
                  provider, so the app works completely offline.
                </p>
              </div>
            </li>
            <li>
              <Icon name="clock" size={16} />
              <div>
                <strong>Baseline arithmetic</strong>
                <p>
                  {settings.horizon}-day window · buffer {money(settings.safetyThreshold)} ·{" "}
                  {isDemoData ? "demo data active" : "your imported data"}.
                </p>
              </div>
            </li>
          </ul>
          <div className="data-actions">
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => downloadText("cashflow-compass-transactions.csv", transactionsToCsv(transactions))}
              disabled={transactions.length === 0}
            >
              <Icon name="download" size={15} /> Export transactions
            </button>
            <button className="btn btn-ghost btn-sm" onClick={resetDemo}>
              Restore demo data
            </button>
            <button
              className={`btn btn-sm ${armed ? "btn-danger" : "btn-ghost"}`}
              onClick={() => {
                if (!armed) {
                  setArmed(true);
                  notify("Click again to permanently delete all local data.");
                  window.setTimeout(() => setArmed(false), 5000);
                  return;
                }
                clearData();
                setArmed(false);
              }}
            >
              <Icon name="trash" size={15} /> {armed ? "Confirm delete all" : "Delete all data"}
            </button>
          </div>
          <p className="footnote">
            This is a hackathon prototype. Forecasts and recommendations are estimates from the
            transactions provided, not professional financial advice. Demo figures are fictional.
          </p>
        </article>
      </section>

      <section className="insights-section">
        <div className="section-head">
          <div>
            <h2>How the forecast is built</h2>
            <p className="card-sub">A transparent baseline you can reason about</p>
          </div>
        </div>
        <div className="method-grid">
          <article className="card method">
            <span className="method-icon"><Icon name="repeat" size={18} /></span>
            <h3>1 · Detect repeating flows</h3>
            <p>
              Similar descriptions are grouped, then gaps between dates are checked against weekly,
              biweekly, monthly, quarterly, half-yearly and yearly rhythms. Amount stability sets a
              confidence score; uncertain patterns go to Review and stay out of the baseline.
            </p>
          </article>
          <article className="card method">
            <span className="method-icon"><Icon name="calendar" size={18} /></span>
            <h3>2 · Project bills &amp; income</h3>
            <p>
              Confirmed items are rolled forward to their next expected date and included at their
              median amount. If a bill is variable, the median is used only after you confirm it.
            </p>
          </article>
          <article className="card method">
            <span className="method-icon"><Icon name="trend-up" size={18} /></span>
            <h3>3 · Estimate everyday spending</h3>
            <p>
              Non-recurring income and expenses from the last 120 days are averaged per day. This keeps
              groceries, dining and transport in the forecast without treating every coffee as a bill.
            </p>
          </article>
          <article className="card method">
            <span className="method-icon"><Icon name="target" size={18} /></span>
            <h3>4 · Show uncertainty</h3>
            <p>
              The 80% band combines the day-to-day variation in your variable cash flow with a ±12%
              assumption on each detected bill. The band widens with the horizon, because the future is
              less certain.
            </p>
          </article>
        </div>
      </section>

      <p className="disclaimer">
        <Icon name="info" size={14} /> No external service is called to produce these insights. All
        arithmetic is deterministic and runs in your browser; the explanation text is assembled from
        the computed numbers, so it cannot invent facts. Forecasts remain estimates.
      </p>
    </div>
  );
}
