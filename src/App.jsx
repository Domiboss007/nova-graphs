import { useState, useCallback } from 'react';
import { processZip } from './utils/zipProcessor.js';
import { parseRealDataFile } from './utils/fileParser.js';
import {
  computeDailyTotals,
  computeHourlyProfile,
  mergeDailyData,
  mergeHourlyData,
  computeMetrics,
  computeDailyMetrics,
} from './utils/dataProcessor.js';
import { CANONICAL_CEF_PLANTS, CEF_SLUGS } from './utils/fileParser.js';
import { DropZone } from './components/DropZone.jsx';
import { DailyTotalsChart, HourlyProfileChart } from './components/EnergyChart.jsx';
import { Leaderboard } from './components/Leaderboard.jsx';
import { AggregateCharts } from './components/AggregateCharts.jsx';
import { DailyRankingTable } from './components/DailyRankingTable.jsx';
import './App.css';
import { COMPANY_ORDER, COMPANY_CODES, ANON_EXCLUDE } from './utils/constants.js';

// Re-export so any code that already imports these from App.jsx keeps working
export { COMPANY_ORDER, COMPANY_CODES, ANON_EXCLUDE };

// Shown once in the anonymised section so readers can decode the codes
function CompanyCodeKey() {
  const entries = COMPANY_ORDER.filter(c => !ANON_EXCLUDE.has(c));
  return (
    <div className="code-key-wrap">
      <h3 className="subsection-heading">Anonymisation Key</h3>
      <p className="daily-ranking-sub">Mapping of company names to their assigned codes used in this section</p>
      <div className="code-key-grid">
        {entries.map(c => (
          <div key={c} className="code-key-row">
            <span className="code-key-code">{COMPANY_CODES[c]}</span>
            <span className="code-key-arrow">→</span>
            <span className="code-key-name">{c}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const CEF_LABEL     = { intraday: 'Intraday', dayahead: 'Day-Ahead' };
const CEF_TYPES     = ['intraday', 'dayahead'];
const BUCKET = 15 * 60 * 1000;

function filterLimited(pts, limitedTimestamps) {
  if (!limitedTimestamps || limitedTimestamps.size === 0) return pts;
  return pts.filter(pt => {
    const key = Math.round(pt.timestamp.getTime() / BUCKET) * BUCKET;
    return !limitedTimestamps.has(key);
  });
}

function filterPerPlantLimited(perPlant, limitedTimestamps) {
  if (!perPlant) return {};
  if (!limitedTimestamps || limitedTimestamps.size === 0) return perPlant;
  const out = {};
  for (const slug of CEF_SLUGS) {
    out[slug] = filterLimited(perPlant[slug] ?? [], limitedTimestamps);
  }
  return out;
}

function combinePoints(typeMap, cat) {
  const all = [];
  for (const typeData of Object.values(typeMap)) {
    if (typeData[cat]) all.push(...typeData[cat]);
  }
  return all;
}

function combinePerPlant(typeMap) {
  const out = {};
  for (const slug of CEF_SLUGS) out[slug] = [];
  for (const typeData of Object.values(typeMap)) {
    const pp = typeData.cefPerPlant;
    if (!pp) continue;
    for (const slug of CEF_SLUGS) {
      const pts = pp[slug];
      if (pts && pts.length > 0) out[slug].push(...pts);
    }
  }
  return out;
}

export default function App() {
  const [zipFile,         setZipFile]         = useState(null);
  const [realFile,        setRealFile]         = useState(null);
  const [processing,      setProcessing]       = useState(false);
  const [progress,        setProgress]         = useState({ done: 0, total: 0, file: '' });
  const [results,         setResults]          = useState(null);
  const [leaderboard,     setLeaderboard]      = useState(null);
  const [aggregateCharts, setAggregateCharts]  = useState(null);
  const [dailyRanking,    setDailyRanking]     = useState(null);
  const [error,           setError]            = useState(null);

  const handleProcess = useCallback(async () => {
    if (!zipFile) return;
    setProcessing(true);
    setError(null);
    setResults(null);
    setLeaderboard(null);
    setAggregateCharts(null);
    setDailyRanking(null);
    setProgress({ done: 0, total: 0, file: '' });

    try {
      // 1. Parse all forecasts from ZIP
      const forecastData = await processZip(zipFile, (done, total, file) => {
        setProgress({ done, total, file });
      });

      // 2. Parse real data
      let realData = {
        cef: {
          points: [], limitedTimestamps: new Set(),
          perPlant: null, capacityBySlug: null, capacityMWhPerInterval: null,
        },
        smallprod: { points: [] },
        prosumer:  { points: [] },
      };
      if (realFile) {
        const buf = await realFile.arrayBuffer();
        realData = await parseRealDataFile(buf, realFile.name);
      }

      const limitedTs        = realData.cef.limitedTimestamps;
      const cefActual        = realData.cef.points;
      const cefCapacity      = realData.cef.capacityMWhPerInterval ?? null;
      const cefActualPerPlant = realData.cef.perPlant ?? null;
      const capacityBySlug    = realData.cef.capacityBySlug ?? null;
      const spActual         = realData.smallprod.points;
      const prActual         = realData.prosumer.points;

      // Pre-compute actual aggregations
      const cefActualDaily   = computeDailyTotals(cefActual);
      const cefActualHourly  = computeHourlyProfile(cefActual);
      const spActualDaily    = computeDailyTotals(spActual);
      const spActualHourly   = computeHourlyProfile(spActual);
      const prActualDaily    = computeDailyTotals(prActual);
      const prActualHourly   = computeHourlyProfile(prActual);

      // 3. Build per-company results
      const out = {};

      for (const [company, types] of Object.entries(forecastData)) {
        const compOut = {};

        // CEF: one block per forecast type
        for (const fType of CEF_TYPES) {
          const typeData = types[fType];
          if (!typeData) continue;
          const raw = typeData.cef || [];
          const pts = filterLimited(raw, limitedTs);
          if (pts.length === 0) continue;
          const dailyMets  = computeDailyMetrics(pts, cefActual, cefCapacity);
          const dailyNmaes = Object.values(dailyMets).map(v => v.nmae).filter(v => v != null);
          const averageNmae = dailyNmaes.length > 0
            ? dailyNmaes.reduce((s, v) => s + v, 0) / dailyNmaes.length
            : null;
          compOut[`${fType}_cef`] = {
            daily:       mergeDailyData(cefActualDaily, computeDailyTotals(pts)),
            hourly:      mergeHourlyData(cefActualHourly, computeHourlyProfile(pts)),
            metrics:     computeMetrics(pts, cefActual, cefCapacity),
            averageNmae,
            dailyMetrics: dailyMets,
            pointCount:  pts.length,
          };
        }

        // Small producers: combine all forecast types into one set of charts
        const spRaw = filterLimited(combinePoints(types, 'smallprod'), limitedTs);
        if (spRaw.length > 0) {
          compOut.smallprod = {
            daily:      mergeDailyData(spActualDaily, computeDailyTotals(spRaw)),
            hourly:     mergeHourlyData(spActualHourly, computeHourlyProfile(spRaw)),
            metrics:    computeMetrics(spRaw, spActual),
            pointCount: spRaw.length,
          };
        }

        // Prosumers: combine all forecast types
        const prRaw = combinePoints(types, 'prosumer');
        if (prRaw.length > 0) {
          compOut.prosumer = {
            daily:      mergeDailyData(prActualDaily, computeDailyTotals(prRaw)),
            hourly:     mergeHourlyData(prActualHourly, computeHourlyProfile(prRaw)),
            metrics:    computeMetrics(prRaw, prActual),
            pointCount: prRaw.length,
          };
        }

        if (Object.keys(compOut).length > 0) out[company] = compOut;
      }

      // 4. Build leaderboards
      const lb = { intraday: [], dayahead: [], smallprod: [], prosumer: [] };
      for (const [company, data] of Object.entries(out)) {
        for (const fType of CEF_TYPES) {
          const d = data[`${fType}_cef`];
          if (d?.metrics?.rmse != null) {
            lb[fType].push({ company, ...d.metrics });
          }
        }
        if (out[company].smallprod?.metrics?.rmse != null)
          lb.smallprod.push({ company, ...out[company].smallprod.metrics });
        if (out[company].prosumer?.metrics?.rmse != null)
          lb.prosumer.push({ company, ...out[company].prosumer.metrics });
      }
      for (const key of Object.keys(lb)) lb[key].sort((a, b) => a.rmse - b.rmse);

      // 5. Build aggregate chart data
      const nmaeByCompany = [];
      const rmseByCompany = [];
      const perIntervalByCompany = {};
      for (const [company, data] of Object.entries(out)) {
        const metrics = CEF_TYPES
          .map(t => data[`${t}_cef`]?.metrics)
          .filter(m => m?.rmse != null);
        if (metrics.length === 0) continue;
        nmaeByCompany.push({
          company,
          nmae: metrics.reduce((s, m) => s + m.nmae, 0) / metrics.length,
        });
        rmseByCompany.push({
          company,
          rmse: metrics.reduce((s, m) => s + m.rmse, 0) / metrics.length,
        });
        // Per-interval breakdown for dynamic chart controls
        const comp = {};
        for (const fType of CEF_TYPES) {
          const d = data[`${fType}_cef`];
          if (!d) continue;
          comp[fType] = {
            aggregated:   d.metrics?.nmae ?? null,
            average:      d.averageNmae ?? null,
            rmse:         d.metrics?.rmse ?? null,
            dailyMetrics: d.dailyMetrics ?? {},
          };
        }
        if (Object.keys(comp).length > 0) perIntervalByCompany[company] = comp;
      }
      nmaeByCompany.sort((a, b) => a.nmae - b.nmae);
      rmseByCompany.sort((a, b) => a.rmse - b.rmse);

      // 6. Per-asset (per-plant) NMAE from forecast ZIP per-plant columns matched
      //    against the benchmark CEF per-plant actuals.
      let assetMetrics = null;
      if (cefActualPerPlant && capacityBySlug) {
        const byCompany = {};
        for (const [company, types] of Object.entries(forecastData)) {
          const combined = combinePerPlant(types);
          const filtered = filterPerPlantLimited(combined, limitedTs);
          const plantRow = CANONICAL_CEF_PLANTS.map(({ slug }) => {
            const fc = filtered[slug] ?? [];
            const ac = cefActualPerPlant[slug] ?? [];
            if (fc.length === 0 || ac.length === 0) return { nmae: null, n: 0 };
            const capPerInterval = capacityBySlug[slug] != null
              ? capacityBySlug[slug] * 0.25
              : null;
            const { nmae, n } = computeMetrics(fc, ac, capPerInterval);
            return { nmae, n };
          });
          // Only record companies that have at least one plant with data
          if (plantRow.some(r => r.nmae != null)) byCompany[company] = plantRow;
        }
        assetMetrics = {
          plants:    CANONICAL_CEF_PLANTS.map(p => p.pretty),
          byCompany,
        };
      }

      // 7. Build daily NMAE ranking (CEF, intraday + day-ahead combined, 8 companies only)
      const DAILY_RANK_COS = COMPANY_ORDER.filter(c => !ANON_EXCLUDE.has(c));
      const dailyRankingRaw = {};
      for (const company of DAILY_RANK_COS) {
        const compTypes = forecastData[company];
        if (!compTypes) continue;
        const allPts = [];
        for (const fType of CEF_TYPES) {
          const raw = compTypes[fType]?.cef ?? [];
          allPts.push(...filterLimited(raw, limitedTs));
        }
        if (allPts.length === 0) continue;
        dailyRankingRaw[company] = computeDailyMetrics(allPts, cefActual, cefCapacity);
      }

      setResults(out);
      setLeaderboard(lb);
      setAggregateCharts({
        nmaeByCompany,
        rmseByCompany,
        perIntervalByCompany,
        assetMetrics,
      });
      setDailyRanking(dailyRankingRaw);
    } catch (e) {
      console.error(e);
      setError(e.message || 'Unknown error during processing.');
    } finally {
      setProcessing(false);
    }
  }, [zipFile, realFile]);

  const sortedCompanies = results
    ? [
        ...COMPANY_ORDER.filter(c => results[c]),
        ...Object.keys(results).filter(c => !COMPANY_ORDER.includes(c)).sort(),
      ]
    : [];

  const progressPct = progress.total
    ? Math.round((progress.done / progress.total) * 100)
    : 0;

  const totalCompanies = sortedCompanies.length;

  return (
    <div className="app">
      {/* ── Header ── */}
      <header className="app-header">
        <h1 className="app-title">Energy Forecast Analyser</h1>
        <p className="app-subtitle">
          Compare solar energy forecasts from multiple providers against actual production data
        </p>
      </header>

      {/* ── Upload section ── */}
      <section className="upload-section">
        <div className="upload-grid">
          <div className="upload-col">
            <h2 className="upload-col-title">
              <span className="badge">1</span> Forecast Archive (ZIP)
            </h2>
            <p className="upload-col-desc">
              ZIP with 10 company sub-folders containing daily Excel/CSV forecasts
              (intraday + day-ahead split automatically; prosumer &amp; mici producatori sheets included)
            </p>
            <DropZone label="Forecasts ZIP" accept=".zip" onFile={setZipFile} currentFile={zipFile} />
          </div>

          <div className="upload-divider"><span>+</span></div>

          <div className="upload-col">
            <h2 className="upload-col-title">
              <span className="badge">2</span> Actual Production Data
            </h2>
            <p className="upload-col-desc">
              Benchmark Excel file (CEF + Mic Prod + Prosumatori sheets). Optional — charts still show
              forecasts without it, but metrics require it.
            </p>
            <DropZone label="Real Data File (optional)" accept=".xlsx,.xls,.csv" onFile={setRealFile} currentFile={realFile} />
          </div>
        </div>

        <div className="process-row">
          <button
            className="process-btn"
            onClick={handleProcess}
            disabled={!zipFile || processing}
          >
            {processing ? 'Processing…' : 'Generate Graphs'}
          </button>

          {results && !processing && (
            <span className="result-summary">
              ✔ {totalCompanies} companies processed
            </span>
          )}
        </div>

        {processing && (
          <div className="progress-wrap">
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progressPct}%` }} />
            </div>
            <div className="progress-label">
              {progress.done}/{progress.total} files — {progress.file}
            </div>
          </div>
        )}

        {error && <div className="error-banner">⚠ {error}</div>}
      </section>

      {results && sortedCompanies.length === 0 && (
        <div className="empty-state">
          No valid forecast files were found in the ZIP. Check the folder structure.
        </div>
      )}

      {/* ══ SECTION A: Non-anonymized aggregate charts ══ */}
      {aggregateCharts && (
        <section className="aggregate-section">
          <div className="aggregate-section-header">
            <h2 className="section-heading">Aggregate Comparison — All Companies</h2>
            <p className="section-sub">Real company names · All 10 companies included</p>
          </div>

          {/* Leaderboards */}
          {leaderboard && (
            <>
              <h3 className="subsection-heading">CEF Forecast Rankings</h3>
              <div className="leaderboards-grid">
                <Leaderboard title="Intraday CEF" metric="rmse" rows={leaderboard.intraday} anonymous={false} />
                <Leaderboard title="Day-Ahead CEF" metric="rmse" rows={leaderboard.dayahead} anonymous={false} />
              </div>

              {(leaderboard.smallprod.length > 0 || leaderboard.prosumer.length > 0) && (
                <>
                  <h3 className="subsection-heading">Category Rankings</h3>
                  <div className="leaderboards-grid">
                    <Leaderboard title="Mici Producatori" metric="rmse" rows={leaderboard.smallprod} anonymous={false} />
                    <Leaderboard title="Prosumatori" metric="rmse" rows={leaderboard.prosumer} anonymous={false} />
                  </div>
                </>
              )}
            </>
          )}

          {/* Aggregate bar charts */}
          <AggregateCharts data={aggregateCharts} anonymous={false} />

          {/* Daily NMAE ranking table */}
          {dailyRanking && <DailyRankingTable dailyRanking={dailyRanking} />}
        </section>
      )}

      {/* ══ SECTION B: Anonymized aggregate charts (no METEOLOGICA / OGRE) ══ */}
      {aggregateCharts && (
        <section className="aggregate-section aggregate-section--anon">
          <div className="aggregate-section-header">
            <h2 className="section-heading">Aggregate Comparison — Anonymized</h2>
            <p className="section-sub">Random codes · METEOLOGICA and OGRE excluded</p>
          </div>

          {leaderboard && (
            <>
              <h3 className="subsection-heading">CEF Forecast Rankings</h3>
              <div className="leaderboards-grid">
                <Leaderboard title="Intraday CEF" metric="rmse" rows={leaderboard.intraday} anonymous={true} />
                <Leaderboard title="Day-Ahead CEF" metric="rmse" rows={leaderboard.dayahead} anonymous={true} />
              </div>

              {(leaderboard.smallprod.length > 0 || leaderboard.prosumer.length > 0) && (
                <>
                  <h3 className="subsection-heading">Category Rankings</h3>
                  <div className="leaderboards-grid">
                    <Leaderboard title="Mici Producatori" metric="rmse" rows={leaderboard.smallprod} anonymous={true} />
                    <Leaderboard title="Prosumatori" metric="rmse" rows={leaderboard.prosumer} anonymous={true} />
                  </div>
                </>
              )}
            </>
          )}

          <AggregateCharts data={aggregateCharts} anonymous={true} />

          {/* Anonymisation key + anonymised daily ranking table */}
          <CompanyCodeKey />
          {dailyRanking && <DailyRankingTable dailyRanking={dailyRanking} anonymous={true} />}
        </section>
      )}

      {/* ── Per-company charts ── */}
      {sortedCompanies.map(company => (
        <section key={company} className="company-section">
          <h2 className="company-title">{company}</h2>

          {/* CEF: intraday + day-ahead */}
          {CEF_TYPES.filter(t => results[company][`${t}_cef`]).map(fType => {
            const d = results[company][`${fType}_cef`];
            return (
              <div key={fType} className="forecast-type-block">
                <div className={`type-badge type-badge--${fType}`}>
                  {CEF_LABEL[fType]} — CEF
                  <span className="type-badge-count">{d.pointCount.toLocaleString()} pts</span>
                  {d.metrics?.rmse != null && (
                    <span className="type-badge-metric">
                      RMSE {d.metrics.rmse.toFixed(4)} MWh · NMAE {(d.metrics.nmae * 100).toFixed(2)}%
                    </span>
                  )}
                </div>
                <div className="charts-grid">
                  <DailyTotalsChart company={company} forecastType={`${fType} CEF`} data={d.daily} />
                  <HourlyProfileChart company={company} forecastType={`${fType} CEF`} data={d.hourly} />
                </div>
              </div>
            );
          })}

          {/* Small Producers */}
          {results[company].smallprod && (() => {
            const d = results[company].smallprod;
            return (
              <div className="forecast-type-block forecast-type-block--smallprod">
                <div className="type-badge type-badge--smallprod">
                  Mici Producatori
                  <span className="type-badge-count">{d.pointCount.toLocaleString()} pts</span>
                  {d.metrics?.rmse != null && (
                    <span className="type-badge-metric">
                      RMSE {d.metrics.rmse.toFixed(4)} MWh · NMAE {(d.metrics.nmae * 100).toFixed(2)}%
                    </span>
                  )}
                </div>
                <div className="charts-grid">
                  <DailyTotalsChart company={company} forecastType="Mici Producatori" data={d.daily} />
                  <HourlyProfileChart company={company} forecastType="Mici Producatori" data={d.hourly} />
                </div>
              </div>
            );
          })()}

          {/* Prosumers */}
          {results[company].prosumer && (() => {
            const d = results[company].prosumer;
            return (
              <div className="forecast-type-block forecast-type-block--prosumer">
                <div className="type-badge type-badge--prosumer">
                  Prosumatori
                  <span className="type-badge-count">{d.pointCount.toLocaleString()} pts</span>
                  {d.metrics?.rmse != null && (
                    <span className="type-badge-metric">
                      RMSE {d.metrics.rmse.toFixed(4)} MWh · NMAE {(d.metrics.nmae * 100).toFixed(2)}%
                    </span>
                  )}
                </div>
                <div className="charts-grid">
                  <DailyTotalsChart company={company} forecastType="Prosumatori" data={d.daily} />
                  <HourlyProfileChart company={company} forecastType="Prosumatori" data={d.hourly} />
                </div>
              </div>
            );
          })()}
        </section>
      ))}

      {sortedCompanies.length > 0 && (
        <footer className="app-footer">
          {totalCompanies} companies · Hover charts for values · Click "Save PNG" to export
        </footer>
      )}
    </div>
  );
}
