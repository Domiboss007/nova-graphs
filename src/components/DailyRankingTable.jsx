import { Download } from 'lucide-react';
import { COMPANY_ORDER, ANON_EXCLUDE, COMPANY_CODES } from '../utils/constants.js';
import { usePngDownload } from '../hooks/usePngDownload.js';

// The 8 CEF companies (METEOLOGICA and OGRE excluded)
const TABLE_COMPANIES = COMPANY_ORDER.filter(c => !ANON_EXCLUDE.has(c));

// Rank colour: 1 (best) = soft green → N (worst) = soft red
function rankBg(rank, total) {
  if (!rank || total < 2) return 'transparent';
  const t = (rank - 1) / (total - 1); // 0 = best, 1 = worst
  let h;
  if (t <= 0.5) {
    h = 142 - (142 - 48) * (t / 0.5);
  } else {
    h = 48 - (48 - 4) * ((t - 0.5) / 0.5);
  }
  const s = t <= 0.5 ? 70 + (90 - 70) * (t / 0.5) : 90 - (90 - 80) * ((t - 0.5) / 0.5);
  return `hsl(${h.toFixed(0)}, ${s.toFixed(0)}%, 88%)`;
}

/**
 * Displays a scrollable table of daily NMAE per company.
 *
 * Props:
 *   dailyRanking: { [company]: { [YYYY-MM-DD]: { nmae, n } } }
 *   anonymous:    if true, show codes instead of names (same 8 companies, METEOLOGICA/OGRE already excluded)
 */
export function DailyRankingTable({ dailyRanking, anonymous = false }) {
  const suffix   = anonymous ? 'anon' : 'named';
  const [tableRef, downloadPng] = usePngDownload(`daily_ranking_cef_${suffix}.png`);

  if (!dailyRanking) return null;

  const companies = TABLE_COMPANIES.filter(
    c => dailyRanking[c] && Object.keys(dailyRanking[c]).length > 0
  );
  if (companies.length === 0) return null;

  const makeLabel = c => anonymous ? (COMPANY_CODES[c] ?? c) : c;

  // Collect all dates across all companies, sorted
  const dateSet = new Set();
  for (const c of companies) Object.keys(dailyRanking[c]).forEach(d => dateSet.add(d));
  const dates = [...dateSet].sort();
  if (dates.length === 0) return null;

  // Pre-compute per-date rankings
  const rankByDate = {};
  for (const date of dates) {
    const entries = companies
      .map(c => ({ c, nmae: dailyRanking[c]?.[date]?.nmae }))
      .filter(x => x.nmae != null)
      .sort((a, b) => a.nmae - b.nmae);
    rankByDate[date] = {};
    entries.forEach((x, i) => { rankByDate[date][x.c] = i + 1; });
  }

  const title = anonymous
    ? 'Daily NMAE Ranking — CEF (Anonymised)'
    : 'Daily NMAE Ranking — CEF';

  return (
    <div className="daily-ranking-wrap">
      <div className="card-download-row">
        <button className="download-btn" onClick={downloadPng} title="Save as PNG">
          <Download size={13} /> Save PNG
        </button>
      </div>

      <div ref={tableRef} style={{ background: '#fff', padding: '4px 0' }}>
        <h3 className="subsection-heading">{title}</h3>
        <p className="daily-ranking-sub">
          Combined intraday + day-ahead · NMAE per day per company · rank in parentheses (1 = best)
        </p>

        {/* Colour legend */}
        <div className="daily-ranking-legend">
          <span className="legend-label">Rank:</span>
          {Array.from({ length: companies.length }, (_, i) => (
            <span
              key={i}
              className="legend-cell"
              style={{ background: rankBg(i + 1, companies.length) }}
            >
              {i + 1}
            </span>
          ))}
        </div>

        <div className="daily-ranking-scroll">
          <table className="daily-ranking-table">
            <thead>
              <tr>
                <th className="dr-date-col">Date</th>
                {companies.map(c => (
                  <th key={c} className={`dr-company-col${anonymous ? ' dr-mono' : ''}`}>
                    {makeLabel(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dates.map(date => {
                const ranks = rankByDate[date];
                const nWithData = Object.keys(ranks).length;
                return (
                  <tr key={date}>
                    <td className="dr-date-cell">{date}</td>
                    {companies.map(c => {
                      const entry = dailyRanking[c]?.[date];
                      const nmae  = entry?.nmae;
                      const rank  = ranks[c];
                      return (
                        <td
                          key={c}
                          className="dr-value-cell"
                          style={{ background: nmae != null ? rankBg(rank, nWithData) : 'transparent' }}
                          title={entry?.n ? `${entry.n} matched intervals` : undefined}
                        >
                          {nmae != null ? (
                            <>
                              {(nmae * 100).toFixed(1)}%{' '}
                              <span className="dr-rank">({rank})</span>
                            </>
                          ) : (
                            <span className="dr-missing">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
