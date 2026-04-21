import { useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell, LabelList,
} from 'recharts';
import { Download } from 'lucide-react';
import { COMPANY_CODES, ANON_EXCLUDE, COMPANY_ORDER } from '../utils/constants.js';
import { usePngDownload } from '../hooks/usePngDownload.js';

// Green → yellow → red gradient across ranks
const PALETTE = [
  '#2ecc71', '#27ae60', '#1abc9c', '#16a085',
  '#3498db', '#2980b9', '#8e44ad', '#e67e22', '#e74c3c', '#c0392b',
];
const NO_DATA_COLOR = '#d1d5db';

// All 10 companies have per-plant data in the benchmark file:
// 8 via the shared CEF sheet and METEOLOGICA/OGRE via their dedicated sheets.
const BENCHMARK_COMPANIES = [
  'ADEX', 'AMPERMETEO', 'ENERCAST', 'ENLITIA',
  'EUROWIND', 'FORESIA', 'METEOMATICS', 'SOLCAST',
  'METEOLOGICA', 'OGRE',
];

// ── Custom label renderer ─────────────────────────────────────────────────────
// Reads the pre-computed string from the barLabel field — avoids the
// valueAccessor+content conflict present in some recharts versions.

const BarLabel = ({ x, y, width, height, value }) => {
  if (!value) return null;
  return (
    <text
      x={(x ?? 0) + Math.max(width ?? 0, 0) + 4}
      y={(y ?? 0) + (height ?? 22) / 2}
      dominantBaseline="middle"
      fontSize={10}
      fill="#444"
    >
      {value}
    </text>
  );
};

// ── Shared horizontal bar chart ───────────────────────────────────────────────

/**
 * data items may include { noData: true } entries (pre-sorted ranked items first,
 * then noData at the end). Each item must have a `barLabel` string field.
 * `valueKey` is the numeric field used for bar length (0 for noData items).
 */
function HBar({ data, valueKey, labelWidth = 100, title, subtitle, height, monoLabels = false }) {
  const ranked  = data.filter(d => !d.noData);
  const noData  = data.filter(d =>  d.noData);
  const hasNoData = noData.length > 0;
  // best at top: reverse ranked, append noData at bottom
  const chartData = [...[...ranked].reverse(), ...noData];

  const h = height ?? Math.max(180, chartData.length * 34 + 60);
  const [cardRef, downloadPng] = usePngDownload(`${(title ?? 'chart').replace(/\s+/g,'_')}.png`);

  return (
    <div className="hbar-card">
      <div className="card-download-row">
        <button className="download-btn" onClick={downloadPng} title="Save as PNG">
          <Download size={13} /> Save PNG
        </button>
      </div>
      <div ref={cardRef}>
      {title    && <h4 className="hbar-title">{title}</h4>}
      {subtitle && <p className="hbar-subtitle">{subtitle}</p>}
      <ResponsiveContainer width="100%" height={h}>
        <BarChart
          layout="vertical"
          data={chartData}
          margin={{ top: 4, right: 90, left: 8, bottom: 4 }}
        >
          <XAxis
            type="number"
            tick={{ fontSize: 10 }}
            tickFormatter={v => v === 0 ? '' : String(v)}
            domain={[0, 'dataMax']}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={labelWidth}
            tick={{ fontSize: 11, ...(monoLabels ? { fontFamily: 'monospace' } : {}) }}
          />
          <Tooltip
            formatter={(v, _name, props) => {
              if (props.payload?.noData) return ['* No data submitted for this period yet', ''];
              return [String(v), valueKey.toUpperCase()];
            }}
            labelFormatter={l => `Company: ${l}`}
          />
          <Bar dataKey={d => d.noData ? 0 : d[valueKey]} radius={[0, 3, 3, 0]}>
            {chartData.map((entry, i) => (
              <Cell
                key={i}
                fill={
                  entry.noData
                    ? NO_DATA_COLOR
                    : PALETTE[Math.min(Math.max(ranked.length - 1 - i, 0), PALETTE.length - 1)]
                }
              />
            ))}
            <LabelList dataKey="barLabel" content={<BarLabel />} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {hasNoData && (
        <p className="leaderboard-nodata-note">* No data submitted for this period yet</p>
      )}
      </div>
    </div>
  );
}

// ── Per-asset NMAE charts ─────────────────────────────────────────────────────

function AssetCharts({ assetMetrics, anonymous }) {
  if (!assetMetrics) return null;
  const { plants, byCompany } = assetMetrics;

  // Only benchmark companies can have per-plant data. Respect anonymous filter.
  const expected = anonymous
    ? BENCHMARK_COMPANIES.filter(c => !ANON_EXCLUDE.has(c))
    : BENCHMARK_COMPANIES;

  const makeLabel   = c => anonymous ? (COMPANY_CODES[c] ?? c) : c;
  const formatNmae  = v => (v != null ? `${(v * 100).toFixed(2)}%` : '—');

  return (
    <div className="asset-charts-section">
      <h4 className="hbar-section-title">NMAE per Asset (from Benchmark CEF Sheet)</h4>
      <p className="hbar-section-sub">
        One chart per plant · NMAE averaged per company across all matched intervals
      </p>
      <div className="asset-charts-grid">
        {plants.map((plant, pi) => {
          // Companies with data for this plant
          const withData = Object.entries(byCompany)
            .map(([code, plantArr]) => ({ company: code, nmae: plantArr[pi]?.nmae, n: plantArr[pi]?.n }))
            .filter(r => r.nmae != null && (!anonymous || !ANON_EXCLUDE.has(r.company)));

          withData.sort((a, b) => a.nmae - b.nmae);

          const hasDataSet = new Set(withData.map(r => r.company));
          const noDataCompanies = expected.filter(c => !hasDataSet.has(c));

          const ranked = withData.map(r => ({
            label:    makeLabel(r.company),
            nmae:     r.nmae,
            n:        r.n,
            noData:   false,
            barLabel: formatNmae(r.nmae),
          }));

          const noDataItems = noDataCompanies.map(c => ({
            label:    makeLabel(c) + ' *',
            nmae:     0,
            n:        0,
            noData:   true,
            barLabel: '',
          }));

          const chartData = [...[...ranked].reverse(), ...noDataItems];
          if (chartData.length === 0) return null;

          const h   = Math.max(140, chartData.length * 30 + 50);
          const lw  = anonymous ? 60 : 100;

          return (
            <AssetPlantCard
              key={plant}
              plant={plant}
              chartData={chartData}
              ranked={ranked}
              noDataItems={noDataItems}
              formatNmae={formatNmae}
              lw={lw}
              h={h}
              anonymous={anonymous}
            />
          );
        })}
      </div>
    </div>
  );
}

function AssetPlantCard({ plant, chartData, ranked, noDataItems, formatNmae, lw, h, anonymous }) {
  const [cardRef, downloadPng] = usePngDownload(`nmae_${plant.replace(/\s+/g,'_')}.png`);
  return (
    <div className="hbar-card">
      <div className="card-download-row">
        <button className="download-btn" onClick={downloadPng} title="Save as PNG">
          <Download size={13} /> Save PNG
        </button>
      </div>
      <div ref={cardRef}>
      <h4 className="hbar-title" title={plant}>
                {plant.replace('CEF ', '')}
              </h4>
              <ResponsiveContainer width="100%" height={h}>
                <BarChart
                  layout="vertical"
                  data={chartData}
                  margin={{ top: 4, right: 80, left: 4, bottom: 4 }}
                >
                  <XAxis
                    type="number"
                    tick={{ fontSize: 9 }}
                    tickFormatter={v => v === 0 ? '' : formatNmae(v)}
                    domain={[0, 'dataMax']}
                  />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={lw}
                    tick={{ fontSize: 10, ...(anonymous ? { fontFamily: 'monospace' } : {}) }}
                  />
                  <Tooltip
                    formatter={(v, _name, props) => {
                      if (props.payload?.noData) return ['* No data submitted for this period yet', ''];
                      return [formatNmae(v), 'NMAE'];
                    }}
                    labelFormatter={l => `Company: ${l}`}
                  />
                  <Bar dataKey={d => d.noData ? 0 : d.nmae} radius={[0, 3, 3, 0]}>
                    {chartData.map((_, i) => (
                      <Cell
                        key={i}
                        fill={
                          chartData[i].noData
                            ? NO_DATA_COLOR
                            : PALETTE[Math.min(Math.max(ranked.length - 1 - i, 0), PALETTE.length - 1)]
                        }
                      />
                    ))}
                    <LabelList dataKey="barLabel" content={<BarLabel />} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              {noDataItems.length > 0 && (
                <p className="leaderboard-nodata-note">* No data submitted for this period yet</p>
              )}
      </div>
    </div>
  );
}

// ── Pill selector ─────────────────────────────────────────────────────────────

function PillGroup({ label, options, value, onChange }) {
  return (
    <div className="agg-ctrl-group">
      <span className="agg-ctrl-label">{label}</span>
      <div className="agg-pill-group">
        {options.map(o => (
          <button
            key={o.value}
            className={`agg-pill${value === o.value ? ' agg-pill--active' : ''}`}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Collect all YYYY-MM-DD keys across every company / interval type. */
function allDatesFrom(perIntervalByCompany) {
  const dates = new Set();
  if (!perIntervalByCompany) return dates;
  for (const comp of Object.values(perIntervalByCompany)) {
    for (const interval of Object.values(comp)) {
      for (const dk of Object.keys(interval.dailyMetrics ?? {})) dates.add(dk);
    }
  }
  return dates;
}

/**
 * Compute NMAE for one company+interval over the supplied date range.
 * method = 'average'    → mean of per-day NMAE values
 * method = 'aggregated' → Σ|err| / Σdenom (capacity or actual) across range
 *
 * dateFrom / dateTo are explicit user selections (empty string = no bound set).
 * When per-day data (dailyMetrics) is missing, falls back to the pre-computed
 * scalar only if NO explicit date filter is active.
 */
function nmaeForRange(compInterval, method, dateFrom, dateTo) {
  const dm = compInterval?.dailyMetrics;
  const hasDateFilter = !!(dateFrom || dateTo);

  // No per-day data at all → can only use scalar when no date filter is active
  if (!dm || Object.keys(dm).length === 0) {
    if (hasDateFilter) return null;   // can't filter without per-day data
    return compInterval?.[method] ?? null;
  }

  const entries = Object.entries(dm).filter(([dk]) => {
    if (dateFrom && dk < dateFrom) return false;
    if (dateTo   && dk > dateTo)   return false;
    return true;
  });

  if (entries.length === 0) return null;

  if (method === 'average') {
    const vals = entries.map(([, v]) => v.nmae).filter(v => v != null);
    return vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  }
  // aggregated: re-sum the raw accumulators
  let sumAbs = 0, sumDenom = 0;
  for (const [, v] of entries) {
    sumAbs   += v.sumAbsErr    ?? 0;
    sumDenom += v.sumNmaeDenom ?? 0;
  }
  return sumDenom > 0 ? sumAbs / sumDenom : null;
}

/**
 * Count how many unique calendar days fall within the date range across all
 * companies and interval types. Used for the "N days" subtitle indicator.
 */
function countDaysInRange(perIntervalByCompany, dateFrom, dateTo) {
  const days = new Set();
  if (!perIntervalByCompany) return 0;
  for (const comp of Object.values(perIntervalByCompany)) {
    for (const interval of Object.values(comp)) {
      for (const dk of Object.keys(interval.dailyMetrics ?? {})) {
        if (dateFrom && dk < dateFrom) continue;
        if (dateTo   && dk > dateTo)   continue;
        days.add(dk);
      }
    }
  }
  return days.size;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Renders CEF NMAE bar chart with interactive interval + method selectors,
 * plus the per-asset NMAE charts.
 *
 * Props:
 *   data = { perIntervalByCompany, nmaeByCompany (fallback), assetMetrics }
 *   anonymous: if true, use codes and exclude METEOLOGICA/OGRE
 */
export function AggregateCharts({ data, anonymous = false }) {
  const [intervalSel, setIntervalSel] = useState('both');
  const [methodSel,   setMethodSel]   = useState('average');
  const [dateFrom,    setDateFrom]    = useState('');
  const [dateTo,      setDateTo]      = useState('');

  if (!data) return null;
  const { perIntervalByCompany, nmaeByCompany, assetMetrics } = data;

  // Derive min/max available dates for clamping the pickers
  const availableDates = allDatesFrom(perIntervalByCompany);
  const minDate = availableDates.size > 0 ? [...availableDates].sort()[0]                    : '';
  const maxDate = availableDates.size > 0 ? [...availableDates].sort().at(-1) : '';

  const expected  = anonymous ? COMPANY_ORDER.filter(c => !ANON_EXCLUDE.has(c)) : COMPANY_ORDER;
  const makeLabel = c => anonymous ? (COMPANY_CODES[c] ?? c) : c;
  const fmtNmae   = v => v != null ? `${(v * 100).toFixed(2)}%` : '—';

  // Resolve NMAE for a single company given the current selectors + date range.
  // Pass the raw dateFrom/dateTo (empty string = no bound) so nmaeForRange can
  // distinguish "no filter active" from "filter set to min/max".
  const getNmae = (company) => {
    if (perIntervalByCompany) {
      const comp = perIntervalByCompany[company];
      if (!comp) return null;
      if (intervalSel === 'both') {
        const vals = ['intraday', 'dayahead']
          .map(t => nmaeForRange(comp[t], methodSel, dateFrom, dateTo))
          .filter(v => v != null);
        return vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
      }
      return nmaeForRange(comp[intervalSel], methodSel, dateFrom, dateTo);
    }
    // Fallback to pre-aggregated list (older data shape)
    return nmaeByCompany?.find(r => r.company === company)?.nmae ?? null;
  };

  const daysInRange = countDaysInRange(perIntervalByCompany, dateFrom, dateTo);

  // Build ranked + noData chart entries
  const withData    = expected.map(c => ({ company: c, nmae: getNmae(c) }));
  const hasDataSet  = new Set(withData.filter(r => r.nmae != null).map(r => r.company));
  const ranked      = withData
    .filter(r => r.nmae != null)
    .sort((a, b) => a.nmae - b.nmae)
    .map(r => ({ label: makeLabel(r.company), nmae: r.nmae, noData: false, barLabel: fmtNmae(r.nmae) }));
  const noDataItems = expected
    .filter(c => !hasDataSet.has(c))
    .map(c => ({ label: makeLabel(c) + ' *', nmae: 0, noData: true, barLabel: '' }));

  const nmaeData   = [...ranked, ...noDataItems];
  const labelWidth = anonymous ? 64 : 110;

  const intervalLabel = intervalSel === 'both' ? 'Intraday + Day-Ahead avg'
    : intervalSel === 'intraday' ? 'Intraday only'
    : 'Day-Ahead only';

  const chartTitle    = methodSel === 'average'
    ? 'Average NMAE per Competitor'
    : 'Aggregated NMAE per Competitor';
  const rangeLabel = (dateFrom || dateTo)
    ? ` · ${dateFrom || minDate || '…'} → ${dateTo || maxDate || '…'}`
    : '';
  const daysLabel  = daysInRange > 0 ? ` · ${daysInRange} day${daysInRange !== 1 ? 's' : ''}` : '';
  const chartSubtitle = methodSel === 'average'
    ? `Mean of daily NMAE values · ${intervalLabel}${rangeLabel}${daysLabel}`
    : `NMAE = Σ|forecast−actual| / Σcapacity · ${intervalLabel}${rangeLabel}${daysLabel}`;

  return (
    <div className="aggregate-charts-wrap">
      <h3 className="subsection-heading">CEF NMAE per Competitor</h3>

      <div className="aggregate-controls">
        <PillGroup
          label="Interval"
          options={[
            { value: 'both',      label: 'Both' },
            { value: 'intraday',  label: 'Intraday' },
            { value: 'dayahead',  label: 'Day-Ahead' },
          ]}
          value={intervalSel}
          onChange={setIntervalSel}
        />
        <PillGroup
          label="Method"
          options={[
            { value: 'average',    label: 'Avg NMAE' },
            { value: 'aggregated', label: 'Aggregated NMAE' },
          ]}
          value={methodSel}
          onChange={setMethodSel}
        />
        <div className="agg-ctrl-group">
          <span className="agg-ctrl-label">Date range</span>
          <div className="agg-date-range">
            <input
              type="date"
              className="agg-date-input"
              value={dateFrom}
              min={minDate}
              max={dateTo || maxDate}
              onChange={e => setDateFrom(e.target.value)}
            />
            <span className="agg-date-sep">→</span>
            <input
              type="date"
              className="agg-date-input"
              value={dateTo}
              min={dateFrom || minDate}
              max={maxDate}
              onChange={e => setDateTo(e.target.value)}
            />
            {(dateFrom || dateTo) && (
              <button
                className="agg-date-clear"
                onClick={() => { setDateFrom(''); setDateTo(''); }}
                title="Clear date filter"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="aggregate-charts-single">
        <HBar
          data={nmaeData}
          valueKey="nmae"
          labelWidth={labelWidth}
          monoLabels={anonymous}
          title={chartTitle}
          subtitle={chartSubtitle}
        />
      </div>

      {assetMetrics && (
        <AssetCharts assetMetrics={assetMetrics} anonymous={anonymous} />
      )}
    </div>
  );
}
