import JSZip from 'jszip';
import {
  detectCompanyFromPath,
  detectForecastType,
  shouldSkipFile,
  parseFile,
} from './fileParser.js';

const VALID_EXTENSIONS = new Set(['xlsx', 'xls', 'csv']);

function getExtension(filename) {
  return filename.split('.').pop().toLowerCase();
}

function makeTypeMaps() {
  return {
    intraday: { cef: new Map(), smallprod: new Map(), prosumer: new Map() },
    dayahead: { cef: new Map(), smallprod: new Map(), prosumer: new Map() },
  };
}

/**
 * Process all ENERCAST files of a single forecast type.
 * ENERCAST only provides CEF data.
 * Returns { cef: Map, smallprod: Map, prosumer: Map }
 */
async function processEnercastGroup(files) {
  const aggFiles = [];
  const plantFiles = [];
  let hasAggregated = false;

  for (const { buffer, filename } of files) {
    const cats = await parseFile('ENERCAST', buffer, filename);
    const { points, isAggregated } = cats.cef;
    if (isAggregated) { aggFiles.push(points); hasAggregated = true; }
    else { plantFiles.push(points); }
  }

  const cefMap = new Map();
  if (hasAggregated) {
    for (const points of aggFiles) {
      for (const pt of points) {
        if (!pt.timestamp) continue;
        cefMap.set(pt.timestamp.getTime(), pt);
      }
    }
  } else {
    for (const points of plantFiles) {
      for (const pt of points) {
        if (!pt.timestamp) continue;
        const key = pt.timestamp.getTime();
        const existing = cefMap.get(key);
        if (existing) {
          cefMap.set(key, { timestamp: pt.timestamp, value: existing.value + pt.value });
        } else {
          cefMap.set(key, pt);
        }
      }
    }
  }

  return { cef: cefMap, smallprod: new Map(), prosumer: new Map() };
}

/**
 * Processes a ZIP file and returns:
 *   { [company]: { intraday?: { cef, smallprod, prosumer }, dayahead?: { ... } } }
 * where each category value is a TimeSeriesPoint[].
 */
export async function processZip(zipFile, onProgress) {
  const zip = await JSZip.loadAsync(zipFile);

  const entries = Object.entries(zip.files).filter(([path, entry]) => {
    if (entry.dir) return false;
    const filename = path.split('/').pop();
    if (!filename || filename.startsWith('.') || path.includes('__MACOSX')) return false;
    if (shouldSkipFile(filename)) return false;
    return VALID_EXTENSIONS.has(getExtension(filename));
  });

  entries.sort(([a], [b]) => a.localeCompare(b));

  const total = entries.length;
  let processed = 0;

  // companyMaps[company] = { intraday: {cef:Map, smallprod:Map, prosumer:Map}, dayahead:{...} }
  const companyMaps = {};
  const enercastByType = { intraday: [], dayahead: [] };

  for (const [path, entry] of entries) {
    const filename = path.split('/').pop();
    const company = detectCompanyFromPath(path);

    processed++;
    onProgress?.(processed, total, filename);

    if (!company) continue;

    let buffer;
    try {
      buffer = await entry.async('arraybuffer');
    } catch {
      continue;
    }

    const fType = detectForecastType(filename);

    if (company === 'ENERCAST') {
      enercastByType[fType].push({ path, buffer, filename });
      continue;
    }

    const cats = await parseFile(company, buffer, filename);

    if (!companyMaps[company]) {
      companyMaps[company] = makeTypeMaps();
    }

    for (const cat of ['cef', 'smallprod', 'prosumer']) {
      const { points } = cats[cat];
      if (!points || points.length === 0) continue;
      for (const pt of points) {
        if (!pt.timestamp) continue;
        companyMaps[company][fType][cat].set(pt.timestamp.getTime(), pt);
      }
    }
  }

  // Process ENERCAST per type
  for (const type of ['intraday', 'dayahead']) {
    if (enercastByType[type].length === 0) continue;
    const cats = await processEnercastGroup(enercastByType[type]);
    if (cats.cef.size > 0) {
      if (!companyMaps['ENERCAST']) companyMaps['ENERCAST'] = makeTypeMaps();
      companyMaps['ENERCAST'][type] = cats;
    }
  }

  // Convert Maps → sorted arrays; only keep types/categories that have data
  const result = {};
  for (const [company, types] of Object.entries(companyMaps)) {
    const companyResult = {};
    let hasAny = false;
    for (const [type, cats] of Object.entries(types)) {
      const typeCats = {};
      let hasAnyCat = false;
      for (const [cat, map] of Object.entries(cats)) {
        if (map.size === 0) continue;
        typeCats[cat] = Array.from(map.values())
          .filter(pt => pt.timestamp)
          .sort((a, b) => a.timestamp - b.timestamp);
        hasAnyCat = true;
      }
      if (hasAnyCat) { companyResult[type] = typeCats; hasAny = true; }
    }
    if (hasAny) result[company] = companyResult;
  }

  return result;
}
