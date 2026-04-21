import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell, LabelList,
} from 'recharts';
import { Download } from 'lucide-react';
import { COMPANY_CODES, ANON_EXCLUDE, COMPANY_ORDER } from '../utils/constants.js';
import { usePngDownload } from '../hooks/usePngDownload.js';

const RANK_COLORS = [
  '#2ecc71', '#27ae60', '#1abc9c', '#16a085',
  '#3498db', '#2980b9', '#8e44ad', '#e67e22', '#e74c3c', '#c0392b',
];
const NO_DATA_COLOR = '#d1d5db';

const CustomTooltip = ({ active, payload, metric }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  if (d.noData) return (
    <div style={{
      background: '#fff', border: '1px solid #dde', borderRadius: 6,
      padding: '8px 12px', fontSize: 12, boxShadow: '0 2px 8px rgba(0,0,0,.1)',
    }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{d.label}</div>
      <div style={{ color: '#9ca3af', fontStyle: 'italic' }}>* No data submitted for this period yet</div>
    </div>
  );
  return (
    <div style={{
      background: '#fff', border: '1px solid #dde', borderRadius: 6,
      padding: '8px 12px', fontSize: 12, boxShadow: '0 2px 8px rgba(0,0,0,.1)',
    }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{d.label}</div>
      {metric === 'rmse' && <div>RMSE: <b>{d.rmse?.toFixed(4)} MWh</b></div>}
      {metric === 'nmae' && <div>NMAE: <b>{(d.nmae * 100)?.toFixed(2)}%</b></div>}
      {d.n != null && <div style={{ color: '#888', marginTop: 2 }}>{d.n.toLocaleString()} matched pts</div>}
    </div>
  );
};

// Pre-computed label stored in barLabel field — avoids valueAccessor+content ambiguity in recharts
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

/**
 * rows: [{ company, rmse, nmae, n }] sorted best→worst
 * metric: 'rmse' | 'nmae'
 * anonymous: if true, uses codes and excludes METEOLOGICA/OGRE
 *
 * Companies from COMPANY_ORDER that have no data appear at the bottom
 * with a grey bar and an italic "No data yet" label.
 */
export function Leaderboard({ title, rows, metric = 'rmse', anonymous = false }) {
  const [cardRef, downloadPng] = usePngDownload(`leaderboard_${title.replace(/\s+/g,'_')}.png`);
  const expected = anonymous
    ? COMPANY_ORDER.filter(c => !ANON_EXCLUDE.has(c))
    : COMPANY_ORDER;

  let withData = rows ?? [];
  if (anonymous) withData = withData.filter(r => !ANON_EXCLUDE.has(r.company));

  const hasData = new Set(withData.map(r => r.company));
  const noDataCompanies = expected.filter(c => !hasData.has(c));

  const makeLabel = c => anonymous ? (COMPANY_CODES[c] ?? c) : c;

  const formatValue = v =>
    metric === 'rmse'
      ? (v != null ? v.toFixed(4) : '—')
      : (v != null ? `${(v * 100).toFixed(2)}%` : '—');

  const getValue = d => metric === 'rmse' ? d.rmse : d.nmae;

  // Best at top: reverse the already-sorted (best→worst) input
  const ranked = [...withData].reverse().map(r => ({
    label:    makeLabel(r.company),
    rmse:     r.rmse,
    nmae:     r.nmae,
    n:        r.n,
    noData:   false,
    barLabel: formatValue(getValue(r)),
  }));

  const noDataItems = noDataCompanies.map(c => ({
    label:    makeLabel(c) + ' *',
    rmse:     0,
    nmae:     0,
    n:        0,
    noData:   true,
    barLabel: '',
  }));

  const chartData = [...ranked, ...noDataItems];
  if (chartData.length === 0) return null;

  const chartHeight = Math.max(180, chartData.length * 32 + 60);

  return (
    <div className="leaderboard-card">
      <div className="card-download-row">
        <button className="download-btn" onClick={downloadPng} title="Save as PNG">
          <Download size={13} /> Save PNG
        </button>
      </div>
      <div ref={cardRef}>
      <h3 className="leaderboard-title">{title}</h3>
      <p className="leaderboard-subtitle">
        {metric === 'rmse' ? 'RMSE (MWh) — lower is better' : 'NMAE (%) — lower is better'}
      </p>
      <ResponsiveContainer width="100%" height={chartHeight}>
        <BarChart
          layout="vertical"
          data={chartData}
          margin={{ top: 4, right: 90, left: 8, bottom: 4 }}
        >
          <XAxis
            type="number"
            tick={{ fontSize: 10 }}
            tickFormatter={v => v === 0 ? '' : formatValue(v)}
            domain={[0, 'dataMax']}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={anonymous ? 64 : 100}
            tick={{ fontSize: 11, fontFamily: anonymous ? 'monospace' : 'inherit' }}
          />
          <Tooltip content={<CustomTooltip metric={metric} />} />
          <Bar dataKey={d => d.noData ? 0 : getValue(d)} radius={[0, 3, 3, 0]}>
            {chartData.map((entry, i) => (
              <Cell
                key={entry.label}
                fill={
                  entry.noData
                    ? NO_DATA_COLOR
                    : (RANK_COLORS[Math.min(Math.max(ranked.length - 1 - i, 0), RANK_COLORS.length - 1)] ?? '#3498db')
                }
              />
            ))}
            <LabelList dataKey="barLabel" content={<BarLabel />} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="leaderboard-note">
        RMSE = √mean((f−a)²) · NMAE = Σ|f−a| / Σa
      </p>
      {noDataCompanies.length > 0 && (
        <p className="leaderboard-nodata-note">
          * No data submitted for this period yet
        </p>
      )}
      </div>
    </div>
  );
}
