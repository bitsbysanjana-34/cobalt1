import { useMemo, useState } from "react";
import type { ForecastPoint, Scenario } from "../types";
import { useApp } from "../store";
import { simulateScenario } from "../lib/forecast";
import {
  addDays,
  daysBetween,
  daysLabel,
  mediumDate,
  money,
  shortDate,
} from "../lib/format";
import { ForecastChart } from "../components/Charts";
import { Badge, EmptyState, Field, Segmented, Toggle } from "../components/ui";
import { Icon } from "../components/Icon";

type Kind = "expense" | "repayment";

interface FormState {
  name: string;
  amount: string;
  date: string;
  kind: Kind;
}

function pointAt(points: ForecastPoint[], date: string): ForecastPoint {
  return points.find((point) => point.date >= date) ?? points[points.length - 1];
}

export function PlannerPage() {
  const {
    today,
    scenarios,
    settings,
    baselineForecast,
    addScenario,
    updateScenario,
    deleteScenario,
    setScenarioActive,
    notify,
  } = useApp();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({
    name: "",
    amount: "",
    date: addDays(today, 14),
    kind: "expense",
  });
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => scenarios.find((scenario) => scenario.id === selectedId) ?? scenarios[0] ?? null,
    [scenarios, selectedId],
  );

  const impact = useMemo(() => {
    if (!selected) return null;
    return simulateScenario(baselineForecast, selected, settings.safetyThreshold);
  }, [selected, baselineForecast, settings.safetyThreshold]);

  const horizonEnd = addDays(today, settings.horizon);
  const outsideHorizon = selected ? selected.date > horizonEnd : false;

  const startEdit = (scenario: Scenario) => {
    setEditingId(scenario.id);
    setSelectedId(scenario.id);
    setForm({
      name: scenario.name,
      amount: String(scenario.amount),
      date: scenario.date,
      kind: scenario.kind,
    });
    setError(null);
  };

  const resetForm = () => {
    setEditingId(null);
    setForm({ name: "", amount: "", date: addDays(today, 14), kind: "expense" });
    setError(null);
  };

  const submit = () => {
    const amount = Number(form.amount);
    if (form.name.trim().length < 2) {
      return setError("Give the scenario a short name, e.g. “Laptop upgrade”.");
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return setError("Enter a planned amount greater than zero.");
    }
    if (!form.date) return setError("Choose a date for the scenario.");
    if (form.date < today) return setError("Choose today or a future date.");
    if (form.date > addDays(today, 90)) {
      return setError("Choose a date within the next 90 days.");
    }
    if (editingId) {
      updateScenario(editingId, {
        name: form.name.trim(),
        amount: Math.round(amount),
        date: form.date,
        kind: form.kind,
      });
      setSelectedId(editingId);
      notify("Scenario updated. Comparison recalculated.");
      resetForm();
      return;
    }
    const id = addScenario({
      name: form.name.trim(),
      amount: Math.round(amount),
      date: form.date,
      kind: form.kind,
    });
    setSelectedId(id);
    notify("Scenario added. Compare the forecast below.");
    resetForm();
  };

  const remove = (scenario: Scenario) => {
    if (!window.confirm(`Remove “${scenario.name}” from your scenarios?`)) return;
    deleteScenario(scenario.id);
    if (editingId === scenario.id) resetForm();
    if (selectedId === scenario.id) setSelectedId(null);
    notify("Scenario removed.");
  };

  const baselineOnDate = selected && impact ? pointAt(baselineForecast.points, selected.date) : null;
  const scenarioOnDate = selected && impact ? pointAt(impact.points, selected.date) : null;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">What-if planner</p>
          <h1>Try the decision before you make it.</h1>
          <p className="page-sub">
            Add a planned purchase or extra repayment. Nothing here changes your transactions — it
            only overlays the forecast so you can compare.
          </p>
        </div>
      </header>

      <section className="planner-grid">
        <div className="planner-side">
          <article className="card scenario-form-card">
            <div className="card-head">
              <div>
                <h2>{editingId ? "Edit scenario" : "New scenario"}</h2>
                <p className="card-sub">Cash impact only — no interest or return modelling</p>
              </div>
              {editingId && (
                <button className="btn btn-ghost btn-sm" onClick={resetForm}>
                  Cancel edit
                </button>
              )}
            </div>
            <div className="scenario-form">
              <Field label="What are you planning?" htmlFor="scenario-name">
                <input
                  id="scenario-name"
                  type="text"
                  placeholder="e.g. New laptop"
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
              </Field>
              <div className="form-grid">
                <Field label="Amount (₹)" htmlFor="scenario-amount">
                  <input
                    id="scenario-amount"
                    type="number"
                    min={1}
                    step={100}
                    placeholder="0"
                    value={form.amount}
                    onChange={(event) => setForm({ ...form, amount: event.target.value })}
                  />
                </Field>
                <Field label="Date" htmlFor="scenario-date">
                  <input
                    id="scenario-date"
                    type="date"
                    min={today}
                    max={addDays(today, 90)}
                    value={form.date}
                    onChange={(event) => setForm({ ...form, date: event.target.value })}
                  />
                </Field>
              </div>
              <Field label="Scenario type">
                <Segmented
                  label="Scenario type"
                  value={form.kind}
                  onChange={(value) => setForm({ ...form, kind: value as Kind })}
                  options={[
                    { value: "expense", label: "Planned purchase" },
                    { value: "repayment", label: "Extra repayment" },
                  ]}
                />
              </Field>
              {error && <div className="inline-error">{error}</div>}
              <button className="btn btn-primary btn-block" onClick={submit}>
                <Icon name={editingId ? "check" : "plus"} size={16} />
                {editingId ? "Update scenario" : "Add scenario"}
              </button>
              {scenarios.length === 0 && (
                <div className="suggestions">
                  <span className="subtle small">Or start with an example:</span>
                  <div className="button-row">
                    <button
                      className="chip-btn"
                      onClick={() =>
                        setForm({
                          name: "Laptop upgrade",
                          amount: "68000",
                          date: addDays(today, 20),
                          kind: "expense",
                        })
                      }
                    >
                      Laptop · ₹68,000
                    </button>
                    <button
                      className="chip-btn"
                      onClick={() =>
                        setForm({
                          name: "Extra loan repayment",
                          amount: "25000",
                          date: addDays(today, 9),
                          kind: "repayment",
                        })
                      }
                    >
                      Repayment · ₹25,000
                    </button>
                  </div>
                </div>
              )}
            </div>
          </article>

          <article className="card scenario-list-card">
            <div className="card-head">
              <div>
                <h2>Your scenarios</h2>
                <p className="card-sub">{scenarios.length} saved on this device</p>
              </div>
            </div>
            {scenarios.length === 0 ? (
              <p className="subtle small">
                No scenarios yet. Add one above to see the before-and-after forecast.
              </p>
            ) : (
              <ul className="scenario-list">
                {scenarios.map((scenario) => {
                  const isSelected = selected?.id === scenario.id;
                  return (
                    <li key={scenario.id} className={`scenario-item ${isSelected ? "selected" : ""}`}>
                      <button
                        className="scenario-select"
                        onClick={() => setSelectedId(scenario.id)}
                        aria-pressed={isSelected}
                      >
                        <span className="scenario-top">
                          <span className="scenario-name">{scenario.name}</span>
                          <Badge tone={scenario.kind === "repayment" ? "violet" : "neutral"}>
                            {scenario.kind === "repayment" ? "Repayment" : "Purchase"}
                          </Badge>
                        </span>
                        <span className="scenario-meta">
                          <span className="num">{money(scenario.amount)}</span>
                          <span>{shortDate(scenario.date)}</span>
                          <span className="subtle">{daysLabel(daysBetween(today, scenario.date))}</span>
                        </span>
                      </button>
                      <div className="scenario-controls">
                        <Toggle
                          id={`active-${scenario.id}`}
                          checked={scenario.active}
                          onChange={(active) => setScenarioActive(scenario.id, active)}
                          label="In dashboard"
                        />
                        <div className="row-actions">
                          <button
                            className="icon-btn sm"
                            aria-label={`Edit ${scenario.name}`}
                            onClick={() => startEdit(scenario)}
                          >
                            <Icon name="edit" size={14} />
                          </button>
                          <button
                            className="icon-btn sm danger"
                            aria-label={`Delete ${scenario.name}`}
                            onClick={() => remove(scenario)}
                          >
                            <Icon name="trash" size={14} />
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="subtle small scenario-note">
              “In dashboard” includes the scenario in the main forecast chart and safety check.
            </p>
          </article>
        </div>

        <article className="card comparison-card">
          <div className="card-head">
            <div>
              <div className="title-row">
                <h2>Before vs after</h2>
                {selected && <Badge tone="violet">{selected.name}</Badge>}
              </div>
              <p className="card-sub">
                Baseline forecast with your chosen safety buffer of {money(settings.safetyThreshold)}
              </p>
            </div>
            <Badge tone={settings.horizon === 30 ? "neutral" : "info"}>{settings.horizon}-day window</Badge>
          </div>

          {!selected || !impact ? (
            <EmptyState
              icon="flask"
              title="No scenario selected"
              body="Create a scenario to compare the projected balance with and without it. The comparison is deterministic and recalculates as soon as you edit an amount or date."
            />
          ) : (
            <>
              <ForecastChart
                points={baselineForecast.points}
                compare={impact.points}
                threshold={settings.safetyThreshold}
                compareLabel="With scenario"
                ariaLabel={`Baseline and scenario balance comparison for ${selected.name}`}
              />

              {outsideHorizon && (
                <div className="notice notice-warn">
                  <Icon name="alert" size={16} />
                  <div>
                    This scenario is outside the current {settings.horizon}-day window, so it does not
                    affect the comparison yet. Increase the forecast horizon from Settings.
                  </div>
                </div>
              )}

              <div className="compare-stats">
                <div>
                  <span className="kpi-label">On {shortDate(selected.date)}</span>
                  <p className="compare-values">
                    <span className="num muted">{money(baselineOnDate?.balance ?? 0)}</span>
                    <Icon name="arrow-right" size={14} />
                    <strong className="num">{money(scenarioOnDate?.balance ?? 0)}</strong>
                  </p>
                </div>
                <div>
                  <span className="kpi-label">Lowest point</span>
                  <p className="compare-values">
                    <span className="num muted">{money(baselineForecast.minBalance)}</span>
                    <Icon name="arrow-right" size={14} />
                    <strong className={`num ${impact.minBalance < settings.safetyThreshold ? "negative" : ""}`}>
                      {money(impact.minBalance)}
                    </strong>
                  </p>
                </div>
                <div>
                  <span className="kpi-label">At the end of the window</span>
                  <p className="compare-values">
                    <span className="num muted">{money(baselineForecast.endBalance)}</span>
                    <Icon name="arrow-right" size={14} />
                    <strong className="num">{money(impact.endBalance)}</strong>
                  </p>
                  <span className={`small num ${impact.endBalance - baselineForecast.endBalance < 0 ? "negative" : "positive"}`}>
                    {money(impact.endBalance - baselineForecast.endBalance)} vs baseline
                  </span>
                </div>
                <div>
                  <span className="kpi-label">Safety buffer</span>
                  {impact.breach ? (
                    <p className="compare-breach">
                      <Icon name="alert" size={15} /> Crosses {shortDate(impact.breach.date)}
                    </p>
                  ) : (
                    <p className="compare-ok">
                      <Icon name="check-circle" size={15} /> Holds
                    </p>
                  )}
                  <span className="small subtle">
                    Baseline: {baselineForecast.breach ? `crosses ${shortDate(baselineForecast.breach.date)}` : "holds"}
                  </span>
                </div>
              </div>

              <div className={`scenario-explainer ${impact.breach && !baselineForecast.breach ? "alert" : ""}`}>
                <h3>
                  <Icon name="info" size={16} /> What this means
                </h3>
                <ul>
                  <li>
                    On {mediumDate(selected.date)}, this {selected.kind === "repayment" ? "extra repayment" : "purchase"} of{" "}
                    <strong className="num">{money(selected.amount)}</strong> would take the projected balance from{" "}
                    <strong className="num">{money(baselineOnDate?.balance ?? 0)}</strong> to{" "}
                    <strong className="num">{money(scenarioOnDate?.balance ?? 0)}</strong>.
                  </li>
                  <li>
                    The lowest balance in the {settings.horizon}-day window becomes{" "}
                    <strong className="num">{money(impact.minBalance)}</strong> on {shortDate(impact.minDate)} —
                    {" "}
                    {impact.minBalance >= settings.safetyThreshold
                      ? `${money(impact.minBalance - settings.safetyThreshold)} above your buffer.`
                      : `${money(settings.safetyThreshold - impact.minBalance)} below your buffer.`}
                  </li>
                  <li>
                    {impact.breach
                      ? baselineForecast.breach
                        ? `The buffer is crossed on ${shortDate(impact.breach.date)} versus ${shortDate(baselineForecast.breach.date)} without this scenario.`
                        : `This scenario would create a new buffer crossing on ${shortDate(impact.breach.date)} that the baseline forecast does not have.`
                      : "The safety buffer is not crossed under this scenario in the current window."}
                  </li>
                  <li className="subtle">
                    Arithmetic uses the same detected bills and average variable spending as the
                    baseline. It does not model interest saved by repaying a loan, and it is not a
                    recommendation to borrow or spend.
                  </li>
                </ul>
              </div>
            </>
          )}
        </article>
      </section>

      <p className="disclaimer">
        <Icon name="info" size={14} /> Scenario comparisons assume everything else stays the same as
        the baseline forecast. Real life will differ; treat this as a planning estimate.
      </p>
    </div>
  );
}
