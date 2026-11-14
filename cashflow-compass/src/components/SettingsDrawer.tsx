import { useState } from "react";
import { useApp } from "../store";
import { money } from "../lib/format";
import { downloadText, transactionsToCsv } from "../lib/csv";
import { Drawer, Field, Segmented } from "./ui";
import { Icon } from "./Icon";

const THRESHOLD_PRESETS = [50000, 100000, 150000, 250000];

export function SettingsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const {
    settings,
    updateSettings,
    transactions,
    scenarios,
    isDemoData,
    resetDemo,
    clearData,
    notify,
  } = useApp();
  const [armed, setArmed] = useState(false);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Settings & data"
      subtitle="Tune the forecast and manage what stays on this device."
    >
      <div className="drawer-section">
        <h3>Safety buffer</h3>
        <p className="subtle small">
          The forecast flags the first day the projected balance falls below this amount. It is your
          own comfort level, not a product recommendation.
        </p>
        <Field label="Buffer amount (₹)" htmlFor="setting-threshold">
          <input
            id="setting-threshold"
            type="number"
            min={0}
            step={1000}
            value={settings.safetyThreshold}
            onChange={(event) =>
              updateSettings({ safetyThreshold: Math.max(0, Number(event.target.value) || 0) })
            }
          />
        </Field>
        <div className="preset-row">
          {THRESHOLD_PRESETS.map((preset) => (
            <button
              key={preset}
              className={`chip-btn ${settings.safetyThreshold === preset ? "active" : ""}`}
              onClick={() => updateSettings({ safetyThreshold: preset })}
            >
              {money(preset)}
            </button>
          ))}
        </div>
      </div>

      <div className="drawer-section">
        <h3>Starting point</h3>
        <Field
          label="Opening balance (₹)"
          hint="Cash you held before the first imported transaction. Leave at zero if your CSV already reflects the full balance history."
          htmlFor="setting-opening"
        >
          <input
            id="setting-opening"
            type="number"
            step={1000}
            value={settings.openingBalance}
            onChange={(event) => updateSettings({ openingBalance: Number(event.target.value) || 0 })}
          />
        </Field>
        <Field label="Default forecast window" hint="Applies to the dashboard chart and safety check.">
          <Segmented
            label="Default forecast window"
            options={[
              { value: 30, label: "30 days" },
              { value: 60, label: "60 days" },
              { value: 90, label: "90 days" },
            ]}
            value={settings.horizon}
            onChange={(value) => updateSettings({ horizon: value as 30 | 60 | 90 })}
          />
        </Field>
      </div>

      <div className="drawer-section">
        <h3>Your data</h3>
        <div className="data-summary">
          <div>
            <span className="num">{transactions.length}</span>
            <span className="subtle small">transactions</span>
          </div>
          <div>
            <span className="num">{scenarios.length}</span>
            <span className="subtle small">scenarios</span>
          </div>
          <div>
            <span className="num">{isDemoData ? "Demo" : "Mine"}</span>
            <span className="subtle small">data source</span>
          </div>
        </div>
        <button
          className="btn btn-secondary btn-block"
          onClick={() => downloadText("cashflow-compass-transactions.csv", transactionsToCsv(transactions))}
          disabled={transactions.length === 0}
        >
          <Icon name="download" size={15} /> Export transactions as CSV
        </button>
        <button className="btn btn-secondary btn-block" onClick={resetDemo}>
          <Icon name="sparkles" size={15} /> Restore demo data
        </button>
        <button
          className={`btn btn-block ${armed ? "btn-danger" : "btn-ghost"}`}
          onClick={() => {
            if (!armed) {
              setArmed(true);
              notify("Click again to delete all local data.");
              window.setTimeout(() => setArmed(false), 5000);
              return;
            }
            clearData();
            setArmed(false);
            onClose();
          }}
        >
          <Icon name="trash" size={15} /> {armed ? "Click again to confirm delete" : "Delete all local data"}
        </button>
        <p className="footnote">
          Data lives in this browser’s localStorage. Export a CSV if you want a backup; clearing site
          data will remove it permanently.
        </p>
      </div>

      <div className="drawer-section about-block">
        <h3>About CashFlow Compass</h3>
        <p className="subtle small">
          A local-first prototype for PS 2.2 — predictive cash-flow management for individuals and
          small businesses. It never connects to a bank, processes payments or gives investment
          advice.
        </p>
        <p className="footnote">Forecasts are estimates based on the transactions provided.</p>
      </div>
    </Drawer>
  );
}
