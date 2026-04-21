import * as XLSX from 'xlsx';

function parseNumber(v) {
  if (v == null) return NaN;
  if (typeof v === 'number') return v;
  return parseNumber(String(v).replace(',', '.'));
}

// ─── Canonical CEF plants ─────────────────────────────────────────────────────
// Order matches the benchmark CEF sheet's NVPG columns.
export const CANONICAL_CEF_PLANTS = [
  { slug: 'campia1',  pretty: 'CEF 1 CAMPIA TURZII' },
  { slug: 'campia2',  pretty: 'CEF 2 CAMPIA TURZII' },
  { slug: 'livezile', pretty: 'CEF LIVEZILE' },
  { slug: 'nervia',   pretty: 'CEF 3 NERVIA' },
  { slug: 'sotanga1', pretty: 'CEF 1 SOTANGA' },
  { slug: 'sotanga2', pretty: 'CEF 2 SOTANGA' },
];
export const CEF_SLUGS = CANONICAL_CEF_PLANTS.map(p => p.slug);
const CEF_SLUG_SET = new Set(CEF_SLUGS);


/**
 * Normalises a raw plant/column name to a canonical CEF slug, or null if it's
 * not one of the 6 CEF plants (e.g. DSO prosumer columns, Mic Prod plants like
 * "CEF Irum Reghin", or ENERCAST's "AGGREGATED" column).
 */
export function normalizePlantName(rawName) {
  if (rawName == null) return null;
  const s = String(rawName).toLowerCase().replace(/\s+/g, ' ').trim();
  if (!s) return null;

  // Exclusions: prosumer DSOs, Mic Prod plants, aggregate columns
  if (/^(deer|delgaz|deo|rel)\b/.test(s)) return null;
  if (/^dso\d|^ds0?4/.test(s)) return null;
  if (/^aggregat|^agregat/.test(s)) return null;
  if (/irum|campo verde|heckler|francomi/.test(s)) return null;

  if (s.includes('livezile')) return 'livezile';
  if (s.includes('nervia'))   return 'nervia';

  const hasCampia  = s.includes('campia');
  const hasSotanga = s.includes('sotanga');
  const m = s.match(/cef\s*(\d)/);
  const n = m ? m[1] : null;

  if (hasSotanga) return n === '2' ? 'sotanga2' : 'sotanga1';
  if (hasCampia)  return n === '2' ? 'campia2' : 'campia1';

  // Bare "CEF 1" / "CEF 2" (AMPERMETEO, ENLITIA, … convention → Campia Turzii)
  if (/^cef\s*1\b|^cef1\b/.test(s)) return 'campia1';
  if (/^cef\s*2\b|^cef2\b/.test(s)) return 'campia2';

  return null;
}
export function isSmallProdColumn(rawName) {
  if (rawName == null) return false;
  const s = String(rawName).toLowerCase().replace(/\s+/g, ' ').trim();
  return /irum|campo verde|heckler|francomi/.test(s);
}

export function isProsumerColumn(rawName) {
  if (rawName == null) return false;
  const s = String(rawName).toLowerCase().replace(/\s+/g, ' ').trim();
  return /^(deer|delgaz|deo|rel)\b/.test(s) || /^dso\d|^ds0?4/.test(s);
}
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

// ─── Per-plant helpers ────────────────────────────────────────────────────────

function emptyPerPlant() {
  const pp = {};
  for (const slug of CEF_SLUGS) pp[slug] = [];
  return pp;
}

/**
 * Given a header row + data rows (each row = [ts_or_first_col, ...values]),
 * and a colToSlug mapping (array aligned with row columns, values are CEF slugs
 * or null), accumulates per-plant points and a total points series (sum of CEF
 * slug columns only — DSO / Mic Prod / AGGREGATED columns are ignored).
 */
function buildFromRows(dataRows, colToSlug, getTimestamp) {
  const points = [];
  const perPlant = emptyPerPlant();

  for (const row of dataRows) {
    const ts = getTimestamp(row);
    if (!ts) continue;
    let total = 0;
    for (let c = 0; c < colToSlug.length; c++) {
      const slug = colToSlug[c];
      if (!slug) continue;
      const v = parseNumber(row[c]);
      if (isNaN(v)) continue;
      total += v;
      perPlant[slug].push({ timestamp: ts, value: v });
    }
    points.push({ timestamp: ts, value: total });
  }
  return { points, perPlant };
}

// ─── Generalised sheet parsers ────────────────────────────────────────────────

// Used by AMPERMETEO and SOLCAST: finds 'Data'/'Ora' header, then reads plant cols.
function parseDataOraSheet(wb, sheetName) {
  if (!wb.SheetNames.includes(sheetName)) return { points: [], perPlant: emptyPerPlant() };
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
  if (dateCol === -1) return { points: [], perPlant: emptyPerPlant() };

  const header = rows[headerIdx];
  const colToSlug = header.map((v, c) => c >= plantStartCol ? normalizePlantName(v) : null);

  const dataRows = rows.slice(headerIdx + 1).filter(r => r[dateCol] != null);
  return buildFromRows(
    dataRows,
    colToSlug,
    row => parseDdMmYyyy(row[dateCol], row[timeCol]),
  );
}

// Used by ENLITIA, EUROWIND, FORESIA, METEOMATICS: timestamp in col 0, header row 0.
function parseTimestampSheet(wb, sheetName) {
  if (!wb.SheetNames.includes(sheetName)) return { points: [], perPlant: emptyPerPlant() };
  const ws = wb.Sheets[sheetName];
  const rows = sheetToRows(ws);
  if (rows.length === 0) return { points: [], perPlant: emptyPerPlant() };

  const header = rows[0];
  const colToSlug = header.map((v, c) => c === 0 ? null : normalizePlantName(v));

  const dataRows = rows.slice(1).filter(r => r[0] != null);
  return buildFromRows(dataRows, colToSlug, row => parseTimestamp(row[0]));
}

// ─── Per-company parsers ──────────────────────────────────────────────────────

// ADEX: 'Worksheet' sheet, row 1 = names, row 2 = codes, row 3 = series label,
// data from row 4+. Col 0 = timestamp, cols 1-4 = DSO prosumers, cols 5-10 =
// the 6 canonical CEF plants, col 11 = 'CEF Irum Reghin' (Mic Prod).
function parseADEX(wb) {
  const ws = getSheet(wb, 'Worksheet');
  const rows = sheetToRows(ws);
  if (rows.length < 4) return { cef: { points: [], perPlant: emptyPerPlant() }, smallprod: [], prosumer: [] };

  const header = rows[0];
  const colToCef = header.map((v, c) => c === 0 ? null : normalizePlantName(v));
  const colToSp  = header.map(v => isSmallProdColumn(v));
  const colToPr  = header.map(v => isProsumerColumn(v));

  const dataRows = rows.slice(3).filter(r => r[0] != null);
  const cef = buildFromRows(dataRows, colToCef, row => parseTimestamp(row[0]));

  const spPts = [], prPts = [];
  for (const row of dataRows) {
    const ts = parseTimestamp(row[0]);
    if (!ts) continue;
    let spTotal = 0, prTotal = 0;
    for (let c = 0; c < header.length; c++) {
      const v = parseNumber(row[c]);
      if (isNaN(v)) continue;
      if (colToSp[c]) spTotal += v;
      if (colToPr[c]) prTotal += v;
    }
    spPts.push({ timestamp: ts, value: spTotal });
    prPts.push({ timestamp: ts, value: prTotal });
  }
  return { cef, smallprod: spPts, prosumer: prPts };
}

// ENERCAST CSV: semicolon-delimited. Header has many columns mixing CEF,
// Mic Prod, prosumer DSOs, and an 'AGGREGATED' column. We extract only CEF
// plant columns by name and recompute the CEF total from those.
export function parseENERCAST_CSV(text) {
  const lines = text.trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) return { points: [], perPlant: emptyPerPlant(), smallprod: [], prosumer: [] };

  const headers = lines[0].split(';').map(h => h.trim());
  const isPerPlant = headers[0].toLowerCase().startsWith('timestamp') && headers.length <= 4;

  const colToSlug = headers.map(h => normalizePlantName(h));
  const colToSp   = headers.map(h => isSmallProdColumn(h));
  const colToPr   = headers.map(h => isProsumerColumn(h));

  const points = [], spPoints = [], prPoints = [];
  const perPlant = emptyPerPlant();

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(';');
    if (isPerPlant) {
      const ts = parseTimestamp(cols[0]);
      if (!ts) continue;
      const v = parseNumber(cols[2]) || 0;
      points.push({ timestamp: ts, value: v });
    } else {
      const ts = parseDdMmYyyy(cols[0], cols[1]);
      if (!ts) continue;
      let cefTotal = 0, spTotal = 0, prTotal = 0;
      for (let c = 0; c < headers.length; c++) {
        const v = parseNumber(cols[c]);
        if (isNaN(v)) continue;
        const slug = colToSlug[c];
        if (slug) { cefTotal += v; perPlant[slug].push({ timestamp: ts, value: v }); }
        if (colToSp[c]) spTotal += v;
        if (colToPr[c]) prTotal += v;
      }
      points.push({ timestamp: ts, value: cefTotal });
      spPoints.push({ timestamp: ts, value: spTotal });
      prPoints.push({ timestamp: ts, value: prTotal });
    }
  }
  return { points, perPlant, smallprod: spPoints, prosumer: prPoints };
}

// METEOLOGICA PV files: sheet 'Forecast', 2 header rows, timestamp col 0,
// data cols 4+. Row 1 contains plant names.
function parseMETEOLOGICA(wb) {
  const ws = getSheet(wb, 'Forecast');
  const rows = sheetToRows(ws);
  if (rows.length < 3) return { points: [], perPlant: emptyPerPlant() };

  const header = rows[1] ?? rows[0];
  const colToSlug = header.map((v, c) => c < 4 ? null : normalizePlantName(v));

  const dataRows = rows.slice(2).filter(r => r[0] != null);
  return buildFromRows(dataRows, colToSlug, row => parseTimestamp(row[0]));
}

// METEOLOGICA Prosumers files: sheet 'Nova_Power_Prosumers'.
// Col 2 = "From yyyy-MM-dd HH:mm" (local start time), Col 6 = "Forecast(MWh)".
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
    const v = parseNumber(row[6]);
    if (isNaN(v)) continue;
    pts.push({ timestamp: ts, value: v });
  }
  return pts;
}

// OGRE: sheet 'Sheet1', single header, timestamp col 0, data cols 1+.
function parseOGRE(wb) {
  const ws = getSheet(wb, 'Sheet1');
  const rows = sheetToRows(ws);
  if (rows.length === 0) return { points: [], perPlant: emptyPerPlant() };

  const header = rows[0];
  const colToSlug = header.map((v, c) => c === 0 ? null : normalizePlantName(v));

  const dataRows = rows.slice(1).filter(r => r[0] != null);
  return buildFromRows(dataRows, colToSlug, row => parseTimestamp(row[0]));
}

// ─── Main forecast file parser ────────────────────────────────────────────────

/**
 * Parse a forecast file buffer.
 * Returns {
 *   cef:       { points, perPlant: { [slug]: points[] } },
 *   smallprod: { points },
 *   prosumer:  { points },
 * }
 */
export async function parseFile(company, buffer, filename) {
  const emptyCef = () => ({ points: [], perPlant: emptyPerPlant() });
  const emptyCat = () => ({ points: [] });
  const emptyResult = { cef: emptyCef(), smallprod: emptyCat(), prosumer: emptyCat() };

  try {
    const isCsv = filename.toLowerCase().endsWith('.csv');

    if (isCsv) {
      if (company === 'ENERCAST') {
        const result = parseENERCAST_CSV(new TextDecoder().decode(buffer));
        return { cef:       { points: result.points, perPlant: result.perPlant }, smallprod: { points: result.smallprod }, prosumer:  { points: result.prosumer }, };
      }
      // Generic CSV — unknown layout; aggregate only, no per-plant.
      const text = new TextDecoder().decode(buffer);
      const lines = text.trim().split('\n');
      const sep = lines[0].includes(';') ? ';' : ',';
      const pts = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(sep);
        if (!cols[0]) continue;
        const ts = parseTimestamp(cols[0]);
        if (!ts) continue;
        let total = 0;
        for (let c = 1; c < cols.length; c++) {
          const v = parseNumber(cols[c]);
          if (!isNaN(v)) total += v;
        }
        pts.push({ timestamp: ts, value: total });
      }
      return { cef: { points: pts, perPlant: emptyPerPlant() }, smallprod: emptyCat(), prosumer: emptyCat() };
    }

    const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
    const isProsumerFile = /prosumer/i.test(filename);
    let cef = emptyCef();
    let smallprodPts = [], prosumerPts = [];

    switch (company) {
      case 'ADEX':
        const r = parseADEX(wb);
        cef = r.cef;
        smallprodPts = r.smallprod;
        prosumerPts  = r.prosumer;
        break;

      case 'AMPERMETEO':
        cef          = parseDataOraSheet(wb, '01_NOVA_OWNED');
        smallprodPts = parseDataOraSheet(wb, '02_SMALL_PROD').points;
        prosumerPts  = parseDataOraSheet(wb, '03_PROSUMERS').points;
        break;

      case 'ENLITIA':
      case 'EUROWIND':
      case 'FORESIA':
      case 'METEOMATICS':
        cef          = parseTimestampSheet(wb, '01_NOVA_OWNED');
        smallprodPts = parseTimestampSheet(wb, '02_SMALL_PROD').points;
        prosumerPts  = parseTimestampSheet(wb, '03_PROSUMERS').points;
        break;

      case 'SOLCAST':
        cef          = parseDataOraSheet(wb, '01_NOVA_OWNED');
        smallprodPts = parseDataOraSheet(wb, '02_SMALL_PROD').points;
        // SOLCAST has no 03_PROSUMERS sheet
        break;

      case 'METEOLOGICA':
        if (isProsumerFile) {
          prosumerPts = parseMETEOLOGICA_PROSUMERS(wb);
        } else {
          cef = parseMETEOLOGICA(wb);
        }
        break;

      case 'OGRE':
        cef = parseOGRE(wb);
        break;

      default: {
        cef = parseTimestampSheet(wb, '01_NOVA_OWNED');
      }
    }

    return {
      cef,
      smallprod: { points: smallprodPts },
      prosumer:  { points: prosumerPts },
    };
  } catch (e) {
    console.warn(`[fileParser] ${filename} (${company}):`, e.message);
    return emptyResult;
  }
}

// ─── Benchmark parsers ────────────────────────────────────────────────────────

const BUCKET_MS = 15 * 60 * 1000;

// Parse the CEF sheet from the benchmark file.
// Returns {
//   points, limitedTimestamps,
//   perPlant:             { [slug]: points[] },
//   capacityBySlug:       { [slug]: MWp },        // derived from peak × 4
//   capacityMWhPerInterval  // Σ(MWp) × 0.25
// }
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

  // First contiguous NVPG run only (older files had duplicate NVPG sections).
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

  // Map each NVPG column to a canonical slug using its header name.
  const colSlugs = nvpgCols.map(c => normalizePlantName(colHeaders[c]));

  const maxNeededCol = Math.max(dateColIdx, timeColIdx, limitareColIdx !== -1 ? limitareColIdx : 0, ...nvpgCols);
  const dataRows = XLSX.utils.sheet_to_json(ws, {
    header: 1, defval: null,
    range: { s: { r: groupHeaderIdx + 2, c: 0 }, e: { r: fullRange.e.r, c: maxNeededCol } },
  });

  const points = [];
  const limitedTimestamps = new Set();
  const perPlant = emptyPerPlant();
  const peakBySlug = {};

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

    let total = 0;
    for (let k = 0; k < nvpgCols.length; k++) {
      const v = parseNumber(row[nvpgCols[k]]);
      if (isNaN(v)) continue;
      total += v;
      const slug = colSlugs[k];
      if (slug) {
        perPlant[slug].push({ timestamp: ts, value: v });
        if (!isLimited && v > (peakBySlug[slug] ?? 0)) peakBySlug[slug] = v;
      }
    }
    points.push({ timestamp: ts, value: total });
  }

  // Derive MWp per plant from peak observed production:
  //   peak_MWh_per_15min × 4 = MWp.  Excludes limited intervals so curtailed
  //   peaks don't deflate the capacity estimate.
  const capacityBySlug = {};
  let totalCapacityMWp = 0;
  for (const slug of CEF_SLUGS) {
    const peak = peakBySlug[slug];
    if (peak && peak > 0) {
      const mwp = peak * 4;
      capacityBySlug[slug] = mwp;
      totalCapacityMWp += mwp;
    }
  }
  const capacityMWhPerInterval = totalCapacityMWp > 0 ? totalCapacityMWp * 0.25 : null;

  return { points, limitedTimestamps, perPlant, capacityBySlug, capacityMWhPerInterval };
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
      const v = parseNumber(row[c]);
      if (!isNaN(v)) value += v;
    }
    pts.push({ timestamp: ts, value });
  }
  return pts;
}

// ─── Real-data file parser ────────────────────────────────────────────────────

/**
 * Parse the real-data benchmark file.
 * Returns {
 *   cef: {
 *     points, limitedTimestamps,
 *     perPlant, capacityBySlug, capacityMWhPerInterval
 *   },
 *   smallprod: { points },
 *   prosumer:  { points },
 * }
 */
export async function parseRealDataFile(buffer, filename) {
  const emptyResult = {
    cef: {
      points: [], limitedTimestamps: new Set(),
      perPlant: emptyPerPlant(),
      capacityBySlug: null, capacityMWhPerInterval: null,
    },
    smallprod: { points: [] },
    prosumer:  { points: [] },
  };

  try {
    const isCsv = filename.toLowerCase().endsWith('.csv');
    if (isCsv) {
      // Generic CSV: only CEF aggregate
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
        let total = 0;
        for (let c = dataStart; c < cols.length; c++) {
          const v = parseNumber(cols[c]);
          if (!isNaN(v)) total += v;
        }
        pts.push({ timestamp: ts, value: total });
      }
      return { ...emptyResult, cef: { ...emptyResult.cef, points: pts } };
    }

    const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
    const result = { ...emptyResult };

    if (wb.SheetNames.includes('CEF')) {
      const cefResult = parseBenchmarkCEF(wb);
      if (cefResult && cefResult.points.length > 0) {
        result.cef = cefResult;
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
