import * as XLSX from 'xlsx';

// ─── Forecast-type detection ──────────────────────────────────────────────────

export function detectForecastType(filename) {
  if (/day[-_\s]?ahead/i.test(filename)) return 'dayahead';
  return 'intraday';
}

// OGRE 1-hour aggregated duplicates are skipped; prosumer files are now parsed.
export function shouldSkipFile(filename) {
  if (/ - 1h/i.test(filename)) return true;
  return false;
}

// ─── Company detection ────────────────────────────────────────────────────────

export function detectCompanyFromPath(zipPath) {
  const match = zipPath.match(/\d{2}_([A-Z]+)/i);
  if (!match) return null;
  const name = match[1].toUpperCase();
  const known = ['ADEX','AMPERMETEO','ENERCAST','ENLITIA','EUROWIND',
                 'FORESIA','METEOMATICS','SOLCAST','METEOLOGICA','OGRE'];
  return known.includes(name) ? name : name;
}

// ─── Timestamp helpers ────────────────────────────────────────────────────────

function parseTimestamp(value) {
  if (value == null) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!s) return null;

  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s)) {
    const d = new Date(s.slice(0, 16).replace(' ', 'T') + ':00');
    return isNaN(d.getTime()) ? null : d;
  }
  const foresia = s.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/);
  if (foresia) {
    const d = new Date(`${foresia[1]}T${foresia[2]}:00`);
    return isNaN(d.getTime()) ? null : d;
  }
  const ogre = s.match(/^(\d{4})\/(\d{2})\/(\d{2}) - (\d{2}):(\d{2})/);
  if (ogre) {
    const d = new Date(`${ogre[1]}-${ogre[2]}-${ogre[3]}T${ogre[4]}:${ogre[5]}:00`);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function parseDdMmYyyy(dateStr, timeVal) {
  if (!dateStr) return null;
  const parts = String(dateStr).trim().split('.');
  if (parts.length !== 3) return null;
  const [dd, mm, yyyy] = parts;

  let h = 0, m = 0;
  if (timeVal instanceof Date) {
    h = timeVal.getHours();
    m = timeVal.getMinutes();
  } else if (typeof timeVal === 'string') {
    const t = timeVal.trim().split(':');
    h = parseInt(t[0]) || 0;
    m = parseInt(t[1]) || 0;
  } else if (typeof timeVal === 'number') {
    const totalMins = Math.round(timeVal * 24 * 60);
    h = Math.floor(totalMins / 60) % 24;
    m = totalMins % 60;
  }

  const iso = `${yyyy.trim()}-${mm.trim().padStart(2,'0')}-${dd.trim().padStart(2,'0')}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00`;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

// ─── Sheet helpers ────────────────────────────────────────────────────────────

function getSheet(wb, preferredName) {
  if (preferredName && wb.SheetNames.includes(preferredName)) return wb.Sheets[preferredName];
  return wb.Sheets[wb.SheetNames[0]];
}

function sheetToRows(ws) {
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
}

function sumNumericFrom(row, startIdx) {
  let total = 0;
  for (let i = startIdx; i < row.length; i++) {
    const v = parseFloat(row[i]);
    if (!isNaN(v)) total += v;
  }
  return total;
}

// ─── Generalized sheet parsers ────────────────────────────────────────────────

// Used by AMPERMETEO and SOLCAST: finds 'Data'/'Ora' header, then reads plant cols.
function parseDataOraSheet(wb, sheetName) {
  if (!wb.SheetNames.includes(sheetName)) return [];
  const ws = wb.Sheets[sheetName];
  const rows = sheetToRows(ws);

  let headerIdx = -1, dateCol = -1, timeCol = -1, plantStartCol = 5;
  for (let i = 0; i < Math.min(rows.length, 6); i++) {
    const dIdx = rows[i].findIndex(v => v === 'Data');
    if (dIdx !== -1) {
      headerIdx = i;
      dateCol = dIdx;
      timeCol = rows[i].findIndex((v, j) => j > dIdx && v === 'Ora');
      // Layout: Data, Ora, Ziua, IBD 15min, IBD 1h, [plants…]
      plantStartCol = timeCol + 4;
      break;
    }
  }
  if (dateCol === -1) return [];

  const pts = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row[dateCol]) continue;
    const ts = parseDdMmYyyy(row[dateCol], row[timeCol]);
    if (!ts) continue;
    pts.push({ timestamp: ts, value: sumNumericFrom(row, plantStartCol) });
  }
  return pts;
}

// Used by ENLITIA, EUROWIND, FORESIA, METEOMATICS: timestamp in col 0, values col 1+
function parseTimestampSheet(wb, sheetName) {
  if (!wb.SheetNames.includes(sheetName)) return [];
  const ws = wb.Sheets[sheetName];
  const rows = sheetToRows(ws);
  const pts = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row[0]) continue;
    const ts = parseTimestamp(row[0]);
    if (!ts) continue;
    pts.push({ timestamp: ts, value: sumNumericFrom(row, 1) });
  }
  return pts;
}

// ─── Per-company parsers ──────────────────────────────────────────────────────

function parseADEX(wb) {
  const ws = getSheet(wb, 'Worksheet');
  const rows = sheetToRows(ws);
  const pts = [];
  for (let i = 3; i < rows.length; i++) {
    const row = rows[i];
    if (!row[0]) continue;
    const ts = parseTimestamp(row[0]);
    if (!ts) continue;
    pts.push({ timestamp: ts, value: sumNumericFrom(row, 1) });
  }
  return pts;
}

// ENERCAST CSV: semicolon-delimited
export function parseENERCAST_CSV(text) {
  const lines = text.trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) return { points: [], isAggregated: false };

  const headers = lines[0].split(';').map(h => h.trim());
  const aggIdx = headers.indexOf('AGGREGATED');
  const isPerPlant = headers[0].toLowerCase().startsWith('timestamp') && headers.length <= 4;
  const isAggregated = aggIdx !== -1;

  const pts = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(';');
    let ts, value;

    if (isPerPlant) {
      ts = parseTimestamp(cols[0]);
      value = parseFloat(cols[2]) || 0;
    } else {
      ts = parseDdMmYyyy(cols[0], cols[1]);
      if (isAggregated) {
        value = parseFloat(cols[aggIdx]) || 0;
      } else {
        value = 0;
        for (let j = 2; j < cols.length; j++) {
          const v = parseFloat(cols[j]);
          if (!isNaN(v)) value += v;
        }
      }
    }
    if (!ts) continue;
    pts.push({ timestamp: ts, value: value || 0 });
  }
  return { points: pts, isAggregated };
}

// METEOLOGICA PV files: sheet 'Forecast', 2 header rows, timestamp col 0, data cols 4+
function parseMETEOLOGICA(wb) {
  const ws = getSheet(wb, 'Forecast');
  const rows = sheetToRows(ws);
  const pts = [];
  for (let i = 2; i < rows.length; i++) {
    const row = rows[i];
    if (!row[0]) continue;
    const ts = parseTimestamp(row[0]);
    if (!ts) continue;
    pts.push({ timestamp: ts, value: sumNumericFrom(row, 4) });
  }
  return pts;
}

// METEOLOGICA Prosumers files: sheet 'Nova_Power_Prosumers'
// Col 2 = "From yyyy-MM-dd HH:mm" (local start time), Col 6 = "Forecast(MWh)"
function parseMETEOLOGICA_PROSUMERS(wb) {
  const ws = wb.Sheets['Nova_Power_Prosumers'];
  if (!ws) return [];
  const rows = sheetToRows(ws);
  const pts = [];
  // Row 0: title, Row 1: headers, Row 2+: data
  for (let i = 2; i < rows.length; i++) {
    const row = rows[i];
    if (!row[2]) continue;
    const ts = parseTimestamp(row[2]);
    if (!ts) continue;
    const v = parseFloat(row[6]);
    if (isNaN(v)) continue;
    pts.push({ timestamp: ts, value: v });
  }
  return pts;
}

// OGRE: sheet 'Sheet1', single header, timestamp col 0, data cols 1+
function parseOGRE(wb) {
  const ws = getSheet(wb, 'Sheet1');
  const rows = sheetToRows(ws);
  const pts = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row[0]) continue;
    const ts = parseTimestamp(row[0]);
    if (!ts) continue;
    pts.push({ timestamp: ts, value: sumNumericFrom(row, 1) });
  }
  return pts;
}

// ─── Main forecast file parser ────────────────────────────────────────────────

/**
 * Parse a forecast file buffer.
 * Returns { cef: {points, isAggregated}, smallprod: {points, isAggregated}, prosumer: {points, isAggregated} }
 */
export async function parseFile(company, buffer, filename) {
  const empty = (pts = [], agg = false) => ({ points: pts, isAggregated: agg });
  const emptyResult = { cef: empty(), smallprod: empty(), prosumer: empty() };

  try {
    const isCsv = filename.toLowerCase().endsWith('.csv');

    if (isCsv) {
      const text = new TextDecoder().decode(buffer);
      if (company === 'ENERCAST') {
        const result = parseENERCAST_CSV(text);
        return { cef: result, smallprod: empty(), prosumer: empty() };
      }
      // Generic CSV
      const lines = text.trim().split('\n');
      const sep = lines[0].includes(';') ? ';' : ',';
      const pts = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(sep);
        if (!cols[0]) continue;
        const ts = parseTimestamp(cols[0]);
        if (!ts) continue;
        pts.push({ timestamp: ts, value: sumNumericFrom(cols, 1) });
      }
      return { cef: empty(pts, false), smallprod: empty(), prosumer: empty() };
    }

    const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
    const isProsumerFile = /prosumer/i.test(filename);
    let cefPts = [], smallprodPts = [], prosumerPts = [];

    switch (company) {
      case 'ADEX':
        cefPts = parseADEX(wb);
        break;

      case 'AMPERMETEO':
        cefPts      = parseDataOraSheet(wb, '01_NOVA_OWNED');
        smallprodPts = parseDataOraSheet(wb, '02_SMALL_PROD');
        prosumerPts  = parseDataOraSheet(wb, '03_PROSUMERS');
        break;

      case 'ENLITIA':
      case 'EUROWIND':
      case 'FORESIA':
      case 'METEOMATICS':
        cefPts      = parseTimestampSheet(wb, '01_NOVA_OWNED');
        smallprodPts = parseTimestampSheet(wb, '02_SMALL_PROD');
        prosumerPts  = parseTimestampSheet(wb, '03_PROSUMERS');
        break;

      case 'SOLCAST':
        cefPts      = parseDataOraSheet(wb, '01_NOVA_OWNED');
        smallprodPts = parseDataOraSheet(wb, '02_SMALL_PROD');
        // SOLCAST has no 03_PROSUMERS sheet
        break;

      case 'METEOLOGICA':
        if (isProsumerFile) {
          prosumerPts = parseMETEOLOGICA_PROSUMERS(wb);
        } else {
          cefPts = parseMETEOLOGICA(wb);
        }
        break;

      case 'OGRE':
        cefPts = parseOGRE(wb);
        break;

      default: {
        const ws = getSheet(wb, '01_NOVA_OWNED');
        const rows = sheetToRows(ws);
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row[0]) continue;
          const ts = parseTimestamp(row[0]);
          if (!ts) continue;
          cefPts.push({ timestamp: ts, value: sumNumericFrom(row, 1) });
        }
      }
    }

    return {
      cef:      { points: cefPts,      isAggregated: true },
      smallprod: { points: smallprodPts, isAggregated: true },
      prosumer:  { points: prosumerPts,  isAggregated: true },
    };
  } catch (e) {
    console.warn(`[fileParser] ${filename} (${company}):`, e.message);
    return emptyResult;
  }
}

// ─── Benchmark parsers ────────────────────────────────────────────────────────

const BUCKET_MS = 15 * 60 * 1000;

// Parse the CEF sheet from the benchmark file.
// Returns { points, limitedTimestamps } where limitedTimestamps is Set<epoch_ms>
// for intervals with Limitare = TRUE (must be excluded from forecast data too).
function parseBenchmarkCEF(wb) {
  const ws = wb.Sheets['CEF'];
  if (!ws) return null;

  const fullRange = XLSX.utils.decode_range(ws['!ref'] || 'A1');

  const headerRows = XLSX.utils.sheet_to_json(ws, {
    header: 1, defval: null,
    range: { s: { r: 0, c: 0 }, e: { r: 5, c: fullRange.e.c } },
  });

  let groupHeaderIdx = -1;
  for (let i = 0; i < headerRows.length; i++) {
    if (headerRows[i].some(v => v === 'NVPG')) { groupHeaderIdx = i; break; }
  }
  if (groupHeaderIdx === -1) return null;

  const groupHeaders = headerRows[groupHeaderIdx];
  const colHeaders   = headerRows[groupHeaderIdx + 1];

  const dateColIdx    = colHeaders.findIndex(v => v != null && String(v).trim() === 'Data');
  const timeColIdx    = colHeaders.findIndex((v, i) => i > dateColIdx && v === 'Ora');
  const limitareColIdx = colHeaders.findIndex(v =>
    v != null && String(v).toLowerCase().includes('limitare'),
  );
  if (dateColIdx === -1) return null;

  const nvpgCols = [];
  let collecting = false;
  for (let j = 0; j < groupHeaders.length; j++) {
    if (groupHeaders[j] === 'NVPG') {
      collecting = true;
      nvpgCols.push(j);
    } else if (collecting && groupHeaders[j] != null) {
      break;
    }
  }
  if (nvpgCols.length === 0) return null;

  // ── Extract installed capacity (MWp per plant) from the header rows ──────
  // Row at groupHeaderIdx-1 contains section labels (e.g. "NMAE - NVPG").
  // Row at groupHeaderIdx-2 contains the corresponding numeric capacity values.
  let plantCapacities = null;
  if (groupHeaderIdx >= 2) {
    const labelRow = headerRows[groupHeaderIdx - 1];
    const valRow   = headerRows[groupHeaderIdx - 2];
    if (labelRow && valRow) {
      const nmaeStartCol = labelRow.findIndex(
        v => v != null && String(v).toUpperCase().startsWith('NMAE'),
      );
      if (nmaeStartCol !== -1) {
        const caps = [];
        for (let k = 0; k < nvpgCols.length; k++) {
          const mw = parseFloat(valRow[nmaeStartCol + k]);
          caps.push(isNaN(mw) ? 0 : mw);
        }
        if (caps.some(v => v > 0)) plantCapacities = caps;
      }
    }
  }
  const totalCapacityMWp        = plantCapacities ? plantCapacities.reduce((s, v) => s + v, 0) : 0;
  const capacityMWhPerInterval  = totalCapacityMWp > 0 ? totalCapacityMWp * 0.25 : null;

  const maxNeededCol = Math.max(dateColIdx, timeColIdx, limitareColIdx !== -1 ? limitareColIdx : 0, ...nvpgCols);
  const dataRows = XLSX.utils.sheet_to_json(ws, {
    header: 1, defval: null,
    range: { s: { r: groupHeaderIdx + 2, c: 0 }, e: { r: fullRange.e.r, c: maxNeededCol } },
  });

  const pts = [];
  const limitedTimestamps = new Set();

  for (const row of dataRows) {
    const dateCell = row[dateColIdx];
    if (!dateCell) continue;

    let ts;
    if (dateCell instanceof Date) {
      const timeCell = timeColIdx !== -1 ? row[timeColIdx] : null;
      if (timeCell instanceof Date) {
        ts = new Date(
          dateCell.getFullYear(), dateCell.getMonth(), dateCell.getDate(),
          timeCell.getHours(), timeCell.getMinutes(), 0,
        );
      } else {
        ts = dateCell;
      }
    } else {
      ts = parseTimestamp(dateCell);
    }
    if (!ts || isNaN(ts.getTime())) continue;

    const tsKey = Math.round(ts.getTime() / BUCKET_MS) * BUCKET_MS;

    const limitare = limitareColIdx !== -1 ? row[limitareColIdx] : null;
    const isLimited = limitare === true ||
                      String(limitare).toUpperCase() === 'TRUE' ||
                      limitare === 1;
    if (isLimited) {
      // Track limited timestamps so forecast data can be filtered to exclude them
      // from metrics. Still include the actual production value so daily chart
      // totals match "Rezulate CEF" (which includes all production).
      limitedTimestamps.add(tsKey);
    }

    let value = 0;
    for (const col of nvpgCols) {
      const v = parseFloat(row[col]);
      if (!isNaN(v)) value += v;
    }
    pts.push({ timestamp: ts, value });
  }
  return { points: pts, limitedTimestamps, plantCapacities, capacityMWhPerInterval };
}

// Parse a simple benchmark category sheet (Mic Prod or Prosumatori).
// Structure: row 0 = aggregate totals, row 1 = group headers, row 2 = col names,
// row 3+ = data. Actual NOVA POWER values are at cols 6-10.
function parseBenchmarkCategorySheet(wb, sheetName) {
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  const fullRange = XLSX.utils.decode_range(ws['!ref'] || 'A1');

  // Data rows start at row 3 (0-indexed); date at col 1, time at col 2, values at 6-10
  const dataRows = XLSX.utils.sheet_to_json(ws, {
    header: 1, defval: null,
    range: { s: { r: 3, c: 0 }, e: { r: fullRange.e.r, c: 10 } },
  });

  const pts = [];
  for (const row of dataRows) {
    const dateCell = row[1];
    if (!dateCell) continue;

    let ts;
    if (dateCell instanceof Date) {
      const timeCell = row[2];
      if (timeCell instanceof Date) {
        ts = new Date(
          dateCell.getFullYear(), dateCell.getMonth(), dateCell.getDate(),
          timeCell.getHours(), timeCell.getMinutes(), 0,
        );
      } else {
        ts = dateCell;
      }
    } else {
      ts = parseTimestamp(dateCell);
    }
    if (!ts || isNaN(ts.getTime())) continue;

    let value = 0;
    for (let c = 6; c <= 10; c++) {
      const v = parseFloat(row[c]);
      if (!isNaN(v)) value += v;
    }
    pts.push({ timestamp: ts, value });
  }
  return pts;
}

// ─── Per-asset metrics from benchmark CEF sheet ───────────────────────────────

const BENCH_TO_CODE = {
  'ADEX': 'ADEX', 'AMPER-METEO': 'AMPERMETEO', 'ENERCAST': 'ENERCAST',
  'ENLITIA': 'ENLITIA', 'EUROWIND': 'EUROWIND', 'FORESIA': 'FORESIA',
  'METEOMATICS': 'METEOMATICS', 'SOLCAST': 'SOLCAST',
};

/**
 * Reads the benchmark CEF sheet and computes NMAE per company per plant.
 * Returns { plants: string[], byCompany: { [code]: { nmae, n }[] } }
 * where each array has one entry per plant (same order as `plants`).
 */
function parseAssetMetricsFromBenchmark(wb, plantCapacities = null) {
  const ws = wb.Sheets['CEF'];
  if (!ws) return null;

  const fullRange = XLSX.utils.decode_range(ws['!ref'] || 'A1');

  const headerRows = XLSX.utils.sheet_to_json(ws, {
    header: 1, defval: null,
    range: { s: { r: 0, c: 0 }, e: { r: 5, c: fullRange.e.c } },
  });

  let groupHeaderIdx = -1;
  for (let i = 0; i < headerRows.length; i++) {
    if (headerRows[i].some(v => v === 'NVPG')) { groupHeaderIdx = i; break; }
  }
  if (groupHeaderIdx === -1) return null;

  const groupHeaders = headerRows[groupHeaderIdx];
  const colHeaders   = headerRows[groupHeaderIdx + 1];

  const dateColIdx    = colHeaders.findIndex(v => v != null && String(v).trim() === 'Data');
  const timeColIdx    = colHeaders.findIndex((v, i) => i > dateColIdx && v === 'Ora');
  const limitareColIdx = colHeaders.findIndex(v =>
    v != null && String(v).toLowerCase().includes('limitare'),
  );
  if (dateColIdx === -1) return null;

  // Build map of group name → [col indices] using the FIRST contiguous run only.
  // Some groups (e.g. ADEX) appear twice in the sheet (forecast + NMAE sections);
  // we only want the first occurrence.
  const groupCols = {};
  let j2 = 0;
  while (j2 < groupHeaders.length) {
    if (groupHeaders[j2] == null) { j2++; continue; }
    const gname = groupHeaders[j2];
    if (groupCols[gname]) { j2++; continue; }   // already recorded first run
    const cols = [];
    while (j2 < groupHeaders.length && groupHeaders[j2] === gname) {
      cols.push(j2++);
    }
    groupCols[gname] = cols;
  }

  const nvpgCols = groupCols['NVPG'];
  if (!nvpgCols || nvpgCols.length === 0) return null;

  const plantNames = nvpgCols.map(c => {
    const h = colHeaders[c];
    return h ? String(h).trim() : `Plant ${c}`;
  });

  // Determine which benchmark companies are present
  const activeCompanies = Object.keys(BENCH_TO_CODE).filter(
    bName => groupCols[bName] && groupCols[bName].length === nvpgCols.length
  );

  // Max column needed
  const allUsedCols = [dateColIdx, timeColIdx];
  if (limitareColIdx !== -1) allUsedCols.push(limitareColIdx);
  allUsedCols.push(...nvpgCols);
  for (const bn of activeCompanies) allUsedCols.push(...groupCols[bn]);
  const maxCol = Math.max(...allUsedCols);

  const dataRows = XLSX.utils.sheet_to_json(ws, {
    header: 1, defval: null,
    range: { s: { r: groupHeaderIdx + 2, c: 0 }, e: { r: fullRange.e.r, c: maxCol } },
  });

  // Accumulators: byCompany[code][plantIdx] = { sumAbsErr, sumNmaeDenom, n }
  const byCompany = {};
  for (const bn of activeCompanies) {
    const code = BENCH_TO_CODE[bn];
    byCompany[code] = plantNames.map(() => ({ sumAbsErr: 0, sumNmaeDenom: 0, n: 0 }));
  }

  for (const row of dataRows) {
    const dateCell = row[dateColIdx];
    if (!dateCell) continue;

    let ts;
    if (dateCell instanceof Date) {
      const timeCell = timeColIdx !== -1 ? row[timeColIdx] : null;
      if (timeCell instanceof Date) {
        ts = new Date(
          dateCell.getFullYear(), dateCell.getMonth(), dateCell.getDate(),
          timeCell.getHours(), timeCell.getMinutes(), 0,
        );
      } else {
        ts = dateCell;
      }
    } else {
      ts = parseTimestamp(dateCell);
    }
    if (!ts || isNaN(ts.getTime())) continue;

    const limitare = limitareColIdx !== -1 ? row[limitareColIdx] : null;
    if (limitare === true || String(limitare).toUpperCase() === 'TRUE' || limitare === 1) continue;

    const actualVals = nvpgCols.map(c => { const v = parseFloat(row[c]); return isNaN(v) ? 0 : v; });

    for (const bn of activeCompanies) {
      const code = BENCH_TO_CODE[bn];
      const compCols = groupCols[bn];
      for (let pi = 0; pi < nvpgCols.length; pi++) {
        const forecast = parseFloat(row[compCols[pi]]);
        const actual = actualVals[pi];
        if (isNaN(forecast)) continue;
        if (forecast === 0 && actual === 0) continue;
        if (plantCapacities) {
          // Capacity-normalised: denominator = plant capacity (MWp) × 0.25 h
          byCompany[code][pi].sumAbsErr    += Math.abs(forecast - actual);
          byCompany[code][pi].sumNmaeDenom += (plantCapacities[pi] ?? 0) * 0.25;
          byCompany[code][pi].n++;
        } else if (actual > 0) {
          // Production-normalised fallback (only production intervals)
          byCompany[code][pi].sumAbsErr    += Math.abs(forecast - actual);
          byCompany[code][pi].sumNmaeDenom += actual;
          byCompany[code][pi].n++;
        }
      }
    }
  }

  // Compute NMAE per company per plant
  const result = { plants: plantNames, byCompany: {} };
  for (const [code, plantAccs] of Object.entries(byCompany)) {
    result.byCompany[code] = plantAccs.map(acc => ({
      nmae: acc.sumNmaeDenom > 0 ? acc.sumAbsErr / acc.sumNmaeDenom : null,
      n:    acc.n,
    }));
  }

  // Also parse METEOLOGICA and OGRE from their dedicated sheets (same structure:
  // row 1 = group headers, row 2 = plant headers, data from row 3,
  // cols 18-23 = NVPG actuals, cols 24-29 = company forecasts).
  const COMPANY_SHEETS = [
    { sheet: 'Meteologica ', code: 'METEOLOGICA' },
    { sheet: 'OGRE',         code: 'OGRE' },
  ];
  const NVPG_START = 18;
  const COMP_START = 24;
  const N_PLANTS   = plantNames.length; // should be 6

  for (const { sheet, code } of COMPANY_SHEETS) {
    const csws = wb.Sheets[sheet];
    if (!csws) continue;
    const csRange = XLSX.utils.decode_range(csws['!ref']);
    const csRows = XLSX.utils.sheet_to_json(csws, {
      header: 1, defval: null,
      range: { s: { r: 3, c: 0 }, e: { r: csRange.e.r, c: COMP_START + N_PLANTS - 1 } },
    });
    const accs = Array.from({ length: N_PLANTS }, () => ({ sumAbsErr: 0, sumNmaeDenom: 0, n: 0 }));
    for (const row of csRows) {
      for (let pi = 0; pi < N_PLANTS; pi++) {
        const actual   = parseFloat(row[NVPG_START + pi]);
        const forecast = parseFloat(row[COMP_START + pi]);
        if (isNaN(actual) || isNaN(forecast)) continue;
        if (actual === 0 && forecast === 0) continue;
        if (plantCapacities) {
          accs[pi].sumAbsErr    += Math.abs(forecast - actual);
          accs[pi].sumNmaeDenom += (plantCapacities[pi] ?? 0) * 0.25;
          accs[pi].n++;
        } else if (actual > 0) {
          accs[pi].sumAbsErr    += Math.abs(forecast - actual);
          accs[pi].sumNmaeDenom += actual;
          accs[pi].n++;
        }
      }
    }
    result.byCompany[code] = accs.map(acc => ({
      nmae: acc.sumNmaeDenom > 0 ? acc.sumAbsErr / acc.sumNmaeDenom : null,
      n:    acc.n,
    }));
  }

  return result;
}

// ─── Real-data file parser ────────────────────────────────────────────────────

/**
 * Parse the real-data benchmark file.
 * Returns {
 *   cef:      { points, limitedTimestamps },
 *   smallprod: { points },
 *   prosumer:  { points },
 *   assetMetrics: { plants, byCompany } | null
 * }
 */
export async function parseRealDataFile(buffer, filename) {
  const emptyResult = {
    cef:      { points: [], limitedTimestamps: new Set(), plantCapacities: null, capacityMWhPerInterval: null },
    smallprod: { points: [] },
    prosumer:  { points: [] },
    assetMetrics: null,
  };

  try {
    const isCsv = filename.toLowerCase().endsWith('.csv');
    if (isCsv) {
      // Generic CSV: only CEF
      const text = new TextDecoder().decode(buffer);
      const lines = text.trim().split('\n').filter(l => l.trim());
      const sep = lines[0].includes(';') ? ';' : ',';
      const pts = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(sep);
        let ts = parseTimestamp(cols[0]);
        let dataStart = 1;
        if (!ts) { ts = parseDdMmYyyy(cols[0], cols[1]); dataStart = 2; }
        if (!ts) continue;
        pts.push({ timestamp: ts, value: sumNumericFrom(cols, dataStart) });
      }
      return { ...emptyResult, cef: { points: pts, limitedTimestamps: new Set() } };
    }

    const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
    const result = { ...emptyResult };

    if (wb.SheetNames.includes('CEF')) {
      const cefResult = parseBenchmarkCEF(wb);
      if (cefResult && cefResult.points.length > 0) {
        result.cef = {
          points:                cefResult.points,
          limitedTimestamps:     cefResult.limitedTimestamps,
          plantCapacities:       cefResult.plantCapacities ?? null,
          capacityMWhPerInterval: cefResult.capacityMWhPerInterval ?? null,
        };
        result.assetMetrics = parseAssetMetricsFromBenchmark(wb, cefResult.plantCapacities);
      }
    }

    if (wb.SheetNames.includes('Mic Prod')) {
      result.smallprod = { points: parseBenchmarkCategorySheet(wb, 'Mic Prod') };
    }

    if (wb.SheetNames.includes('Prosumatori')) {
      result.prosumer = { points: parseBenchmarkCategorySheet(wb, 'Prosumatori') };
    }

    return result;
  } catch (e) {
    console.warn(`[fileParser] real data ${filename}:`, e.message);
    return emptyResult;
  }
}
