import { useRef, useCallback } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, Dot
} from 'recharts';
import { toPng } from 'html-to-image';
import { Download } from 'lucide-react';

const ACTUAL_COLOR = '#1f77b4';
const FORECAST_COLOR = '#ff7f0e';

function fmt2(n) {
  return n != null ? Number(n.toFixed(2)) : null;
}

// ─── Custom dot that only renders when value is non-null ─────────────────────
function SmartDot(props) {
  const { cx, cy, value } = props;
  if (value == null) return null;
  return <Dot {...props} r={3} />;
}

const TYPE_LABEL = { intraday: 'Intraday', dayahead: 'Day-Ahead' };

// ─── Daily Totals Chart ──────────────────────────────────────────────────────
export function DailyTotalsChart({ company, forecastType, data }) {
  const containerRef = useRef(null);
  const typeLabel = TYPE_LABEL[forecastType] ?? forecastType ?? '';

  const formatted = data.map(d => ({
    ...d,
    actual: d.actual != null ? fmt2(d.actual) : null,
    forecast: d.forecast != null ? fmt2(d.forecast) : null,
    label: d.date,
  }));

  const handleDownload = useCallback(() => {
    if (!containerRef.current) return;
    toPng(containerRef.current, { backgroundColor: '#ffffff', pixelRatio: 2 })
      .then(dataUrl => {
        const a = document.createElement('a');
        a.download = `daily_totals_${company}_${forecastType ?? 'all'}.png`;
        a.href = dataUrl;
        a.click();
      })
      .catch(console.error);
  }, [company, forecastType]);

  return (
    <div className="chart-card">
      <div className="chart-header">
        <span className="chart-title">
          Daily Total Energy Production vs Forecast (MWh) — {company}{typeLabel ? ` · ${typeLabel}` : ''}
        </span>
        <button className="download-btn" onClick={handleDownload} title="Save as PNG">
          <Download size={15} /> Save PNG
        </button>
      </div>
      <div ref={containerRef} className="chart-wrapper">
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={formatted} margin={{ top: 12, right: 30, left: 10, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11 }}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              label={{ value: 'MWh / day', angle: -90, position: 'insideLeft', offset: 10, style: { fontSize: 11 } }}
            />
            <Tooltip
              formatter={(v, name) => [v != null ? `${v.toFixed(2)} MWh` : '—', name]}
              contentStyle={{ fontSize: 12 }}
            />
            <Legend wrapperStyle={{ fontSize: 12, paddingTop: 4 }} />
            <Line
              type="linear"
              dataKey="actual"
              name="Actual (MWh/day)"
              stroke={ACTUAL_COLOR}
              strokeWidth={1.8}
              dot={<SmartDot stroke={ACTUAL_COLOR} fill={ACTUAL_COLOR} />}
              activeDot={{ r: 5 }}
              connectNulls={false}
            />
            <Line
              type="linear"
              dataKey="forecast"
              name={`Forecast ${company} (MWh/day)`}
              stroke={FORECAST_COLOR}
              strokeWidth={1.8}
              dot={<SmartDot stroke={FORECAST_COLOR} fill={FORECAST_COLOR} />}
              activeDot={{ r: 5 }}
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── Hourly Profile Chart ────────────────────────────────────────────────────
export function HourlyProfileChart({ company, forecastType, data }) {
  const containerRef = useRef(null);
  const typeLabel = TYPE_LABEL[forecastType] ?? forecastType ?? '';

  const formatted = data.map(d => ({
    ...d,
    actual: d.actual != null ? fmt2(d.actual) : null,
    forecast: d.forecast != null ? fmt2(d.forecast) : null,
  }));

  const handleDownload = useCallback(() => {
    if (!containerRef.current) return;
    toPng(containerRef.current, { backgroundColor: '#ffffff', pixelRatio: 2 })
      .then(dataUrl => {
        const a = document.createElement('a');
        a.download = `hourly_profile_${company}_${forecastType ?? 'all'}.png`;
        a.href = dataUrl;
        a.click();
      })
      .catch(console.error);
  }, [company, forecastType]);

  return (
    <div className="chart-card">
      <div className="chart-header">
        <span className="chart-title">
          Avg Hourly Profile 7:00–20:00 (MWh) — {company}{typeLabel ? ` · ${typeLabel}` : ''}
        </span>
        <button className="download-btn" onClick={handleDownload} title="Save as PNG">
          <Download size={15} /> Save PNG
        </button>
      </div>
      <div ref={containerRef} className="chart-wrapper">
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={formatted} margin={{ top: 12, right: 30, left: 10, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
            <XAxis
              dataKey="hour"
              tick={{ fontSize: 11 }}
              tickLine={false}
              label={{ value: 'Hour of Day', position: 'insideBottom', offset: -4, style: { fontSize: 11 } }}
            />
            <YAxis
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              label={{ value: 'Avg MWh / hour', angle: -90, position: 'insideLeft', offset: 10, style: { fontSize: 11 } }}
            />
            <Tooltip
              formatter={(v, name) => [v != null ? `${v.toFixed(3)} MWh` : '—', name]}
              contentStyle={{ fontSize: 12 }}
            />
            <Legend wrapperStyle={{ fontSize: 12, paddingTop: 4 }} />
            <Line
              type="linear"
              dataKey="actual"
              name="Realised Energy (MWh/hour)"
              stroke={ACTUAL_COLOR}
              strokeWidth={1.8}
              dot={<SmartDot stroke={ACTUAL_COLOR} fill={ACTUAL_COLOR} />}
              activeDot={{ r: 5 }}
              connectNulls={false}
            />
            <Line
              type="linear"
              dataKey="forecast"
              name={`Forecast offered by ${company} (MWh/hour)`}
              stroke={FORECAST_COLOR}
              strokeWidth={1.8}
              dot={<SmartDot stroke={FORECAST_COLOR} fill={FORECAST_COLOR} />}
              activeDot={{ r: 5 }}
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
