import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { BacktestResult, ForecastPoint, MonthTotals } from "../types";
import { clamp, compactMoney, longDate, money, shortDate } from "../lib/format";
import { categoryColor } from "../lib/categorize";

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      const next = element.getBoundingClientRect().width;
      if (next > 0) setWidth(next);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

interface ForecastChartProps {
  points: ForecastPoint[];
  compare?: ForecastPoint[] | null;
  threshold?: number | null;
  compareLabel?: string;
  ariaLabel?: string;
}

export function ForecastChart({
  points,
  compare = null,
  threshold = null,
  compareLabel = "With scenario",
  ariaLabel = "Projected cash balance with an 80% estimate range",
}: ForecastChartProps) {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const n = points.length;
  if (n === 0) return null;

  const W = Math.max(320, width || 760);
  const H = W < 560 ? 248 : 318;
  const M = { left: W < 560 ? 52 : 68, right: 14, top: 16, bottom: 32 };
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;

  const values: number[] = [];
  for (const point of points) values.push(point.lower, point.upper, point.balance);
  if (compare) for (const point of compare) values.push(point.balance);
  if (threshold !== null && threshold > 0) values.push(threshold);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const span = Math.max(rawMax - rawMin, 5000);
  const min = rawMin - span * 0.14;
  const max = rawMax + span * 0.12;

  const x = (index: number) => M.left + (index / Math.max(1, n - 1)) * plotW;
  const y = (value: number) => M.top + ((max - value) / (max - min)) * plotH;

  const linePath = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${x(index)} ${y(point.balance)}`)
    .join(" ");
  let bandPath = "";
  points.forEach((point, index) => {
    bandPath += `${index === 0 ? "M" : "L"} ${x(index)} ${y(point.upper)} `;
  });
  for (let index = n - 1; index >= 0; index--) {
    bandPath += `L ${x(index)} ${y(points[index].lower)} `;
  }
  bandPath += "Z";
  const comparePath = compare
    ? compare
        .map((point, index) => `${index === 0 ? "M" : "L"} ${x(index)} ${y(point.balance)}`)
        .join(" ")
    : null;

  const tickCount = W < 520 ? 4 : 6;
  const xTicks: number[] = [];
  for (let index = 0; index < tickCount; index++) {
    const idx = Math.round(((n - 1) * index) / (tickCount - 1));
    if (!xTicks.includes(idx)) xTicks.push(idx);
  }

  const gridValues = [0, 0.25, 0.5, 0.75, 1].map((fraction) => min + (max - min) * fraction);
  const zeroVisible = min < 0 && max > 0;

  const handleMove = (event: ReactPointerEvent<SVGRectElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const svgX = event.clientX - rect.left;
    const ratio = (svgX - M.left) / plotW;
    setHover(clamp(Math.round(ratio * (n - 1)), 0, n - 1));
  };

  const active = hover !== null ? points[hover] : null;
  const activeCompare = hover !== null && compare ? compare[hover] : null;

  return (
    <div className="chart-block">
      <div className="chart-wrap" ref={ref}>
        {width > 0 && (
          <svg
            width="100%"
            height={H}
            viewBox={`0 0 ${W} ${H}`}
            className="forecast-chart"
            role="img"
            aria-label={ariaLabel}
          >
            <title>{ariaLabel}</title>
            <defs>
              <linearGradient id="bandFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#818cf8" stopOpacity="0.3" />
                <stop offset="100%" stopColor="#6366f1" stopOpacity="0.05" />
              </linearGradient>
              <linearGradient id="lineStroke" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#a5b4fc" />
                <stop offset="100%" stopColor="#67e8f9" />
              </linearGradient>
            </defs>

            {gridValues.map((value, index) => (
              <g key={index}>
                <line x1={M.left} x2={W - M.right} y1={y(value)} y2={y(value)} className="grid-line" />
                <text
                  x={M.left - 10}
                  y={y(value)}
                  className="axis-text"
                  textAnchor="end"
                  dominantBaseline="middle"
                >
                  {compactMoney(value)}
                </text>
              </g>
            ))}

            {zeroVisible && (
              <line x1={M.left} x2={W - M.right} y1={y(0)} y2={y(0)} className="zero-line" />
            )}

            <path d={bandPath} fill="url(#bandFill)" />
            {threshold !== null && threshold > 0 && threshold >= min && threshold <= max && (
              <g>
                <line
                  x1={M.left}
                  x2={W - M.right}
                  y1={y(threshold)}
                  y2={y(threshold)}
                  className="threshold-line"
                />
                <text x={W - M.right} y={y(threshold) - 7} textAnchor="end" className="threshold-label">
                  Buffer {compactMoney(threshold)}
                </text>
              </g>
            )}

            {comparePath && <path d={comparePath} className="compare-line" />}
            <path d={linePath} className="balance-line" stroke="url(#lineStroke)" />
            <circle cx={x(0)} cy={y(points[0].balance)} r="4.5" className="start-dot" />

            {xTicks.map((index) => (
              <text
                key={index}
                x={x(index)}
                y={H - 10}
                textAnchor={index === 0 ? "start" : index === n - 1 ? "end" : "middle"}
                className="axis-text"
              >
                {shortDate(points[index].date)}
              </text>
            ))}

            {hover !== null && (
              <g>
                <line
                  x1={x(hover)}
                  x2={x(hover)}
                  y1={M.top}
                  y2={M.top + plotH}
                  className="crosshair"
                />
                <circle cx={x(hover)} cy={y(points[hover].balance)} r="5" className="hover-dot" />
                {activeCompare && (
                  <circle
                    cx={x(hover)}
                    cy={y(activeCompare.balance)}
                    r="4"
                    className="hover-dot compare"
                  />
                )}
              </g>
            )}

            <rect
              x={M.left}
              y={M.top}
              width={plotW}
              height={plotH}
              fill="transparent"
              onPointerMove={handleMove}
              onPointerLeave={() => setHover(null)}
            />
          </svg>
        )}

        {active && (
          <div
            className="chart-tip"
            style={{ left: `${clamp(x(hover as number), 96, W - 96)}px` }}
          >
            <div className="chart-tip-date">{longDate(active.date)}</div>
            <div className="chart-tip-row">
              <span>Projected</span>
              <strong>{money(active.balance)}</strong>
            </div>
            <div className="chart-tip-range">
              80% range {money(active.lower)} – {money(active.upper)}
            </div>
            {activeCompare && (
              <div className="chart-tip-row compare">
                <span>{compareLabel}</span>
                <strong>{money(activeCompare.balance)}</strong>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="chart-legend">
        <span>
          <i className="legend-line projected" /> Projected balance
        </span>
        <span>
          <i className="legend-band" /> 80% estimate range
        </span>
        {threshold !== null && threshold > 0 && (
          <span>
            <i className="legend-line buffer" /> Safety buffer
          </span>
        )}
        {compare && (
          <span>
            <i className="legend-line scenario" /> {compareLabel}
          </span>
        )}
      </div>
    </div>
  );
}

export function MonthlyBars({ months }: { months: MonthTotals[] }) {
  const max = Math.max(1, ...months.flatMap((month) => [month.income, month.expense]));
  return (
    <div className="month-bars" role="img" aria-label="Income and expenses over the last six months">
      {months.map((month) => (
        <div className="month-col" key={month.key}>
          <div className="month-bars-inner">
            <div
              className="month-bar income"
              style={{ height: `${Math.max(2, (month.income / max) * 100)}%` }}
              title={`${month.label} income: ${money(month.income)}`}
            />
            <div
              className="month-bar expense"
              style={{ height: `${Math.max(2, (month.expense / max) * 100)}%` }}
              title={`${month.label} expenses: ${money(month.expense)}`}
            />
          </div>
          <span className="month-label">{month.label}</span>
        </div>
      ))}
    </div>
  );
}

export function DonutChart({
  data,
  total,
  centerLabel,
}: {
  data: { label: string; value: number; color?: string }[];
  total: number;
  centerLabel: string;
}) {
  const size = 184;
  const radius = 70;
  const stroke = 20;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const visible = data.filter((entry) => entry.value > 0).slice(0, 6);
  return (
    <div className="donut">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`${centerLabel} breakdown by category`}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(148,163,184,0.12)"
          strokeWidth={stroke}
        />
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {visible.map((entry) => {
            const share = entry.value / Math.max(total, 1);
            const length = Math.max(0, share * circumference - 3);
            const dash = offset;
            offset += share * circumference;
            return (
              <circle
                key={entry.label}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={entry.color ?? categoryColor(entry.label)}
                strokeWidth={stroke}
                strokeDasharray={`${length} ${circumference - length}`}
                strokeDashoffset={-dash}
                strokeLinecap="butt"
                className="donut-seg"
              >
                <title>{`${entry.label}: ${money(entry.value)}`}</title>
              </circle>
            );
          })}
        </g>
        <text x={size / 2} y={size / 2 - 6} textAnchor="middle" className="donut-total">
          {compactMoney(total)}
        </text>
        <text x={size / 2} y={size / 2 + 16} textAnchor="middle" className="donut-caption">
          {centerLabel}
        </text>
      </svg>
    </div>
  );
}

export function AccuracyChart({ result }: { result: BacktestResult }) {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const W = Math.max(300, width || 560);
  const H = W < 520 ? 190 : 220;
  const M = { left: W < 520 ? 48 : 62, right: 12, top: 12, bottom: 28 };
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const values = result.points.flatMap((point) => [point.predicted, point.actual]);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const span = Math.max(rawMax - rawMin, 4000);
  const low = rawMin - span * 0.15;
  const high = rawMax + span * 0.15;
  const n = result.points.length;
  const x = (index: number) => M.left + (index / Math.max(1, n - 1)) * plotW;
  const y = (value: number) => M.top + ((high - value) / (high - low)) * plotH;
  const predicted = result.points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${x(index)} ${y(point.predicted)}`)
    .join(" ");
  const actual = result.points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${x(index)} ${y(point.actual)}`)
    .join(" ");
  const ticks = [result.points[0], result.points[Math.floor((n - 1) / 2)], result.points[n - 1]];

  return (
    <div className="chart-block">
      <div className="chart-wrap" ref={ref}>
        {width > 0 && (
          <svg
            width="100%"
            height={H}
            viewBox={`0 0 ${W} ${H}`}
            className="forecast-chart"
            role="img"
            aria-label="Forecast backtest: predicted versus actual balance over the last 30 days"
          >
            {[0, 0.33, 0.66, 1].map((fraction, index) => {
              const value = low + (high - low) * fraction;
              return (
                <g key={index}>
                  <line
                    x1={M.left}
                    x2={W - M.right}
                    y1={y(value)}
                    y2={y(value)}
                    className="grid-line"
                  />
                  <text
                    x={M.left - 8}
                    y={y(value)}
                    textAnchor="end"
                    dominantBaseline="middle"
                    className="axis-text"
                  >
                    {compactMoney(value)}
                  </text>
                </g>
              );
            })}
            {ticks.map((point, index) => (
              <text
                key={`${point.date}-${index}`}
                x={x(index === 1 ? Math.floor((n - 1) / 2) : index === 2 ? n - 1 : 0)}
                y={H - 8}
                textAnchor={index === 0 ? "start" : index === 2 ? "end" : "middle"}
                className="axis-text"
              >
                {shortDate(point.date)}
              </text>
            ))}
            <path d={predicted} className="balance-line" />
            <path d={actual} className="actual-line" />
          </svg>
        )}
      </div>
      <div className="chart-legend">
        <span>
          <i className="legend-line projected" /> Predicted 30 days earlier
        </span>
        <span>
          <i className="legend-line actual" /> Actual balance
        </span>
      </div>
    </div>
  );
}

export function AmountBars({ values, color = "#818cf8" }: { values: number[]; color?: string }) {
  const max = Math.max(1, ...values);
  return (
    <div className="amount-bars" aria-hidden="true">
      {values.map((value, index) => (
        <span
          key={index}
          style={{
            height: `${Math.max(18, (value / max) * 100)}%`,
            background: color,
          }}
        />
      ))}
    </div>
  );
}
