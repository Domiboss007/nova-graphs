import JSZip from 'jszip';
import {
  detectCompanyFromPath,
  detectForecastType,
  shouldSkipFile,
  parseFile,
  CEF_SLUGS,
} from './fileParser.js';

const VALID_EXTENSIONS = new Set(['xlsx', 'xls', 'csv']);

function getExtension(filename) {
  return filename.split('.').pop().toLowerCase();
}

function makePerPlantMaps() {
  const pp = {};
  for (const slug of CEF_SLUGS) pp[slug] = new Map();
  return pp;
}

function makeTypeMaps() {
  return {
    intraday: {
      cef: new Map(),
      cefPerPlant: makePerPlantMaps(),
      smallprod: new Map(),
      prosumer: new Map(),
    },
    dayahead: {
      cef: new Map(),
      cefPerPlant: makePerPlantMaps(),
      smallprod: new Map(),
      prosumer: new Map(),
    },
  };
}

function addPointsToMap(map, points) {
  for (const pt of points) {
    if (!pt.timestamp) continue;
    map.set(pt.timestamp.getTime(), pt);
  }
}

function addPerPlantToMaps(perPlantMaps, perPlant) {
  if (!perPlant) return;
  for (const slug of CEF_SLUGS) {
    const pts = perPlant[slug];
    if (!pts || pts.length === 0) continue;
    addPointsToMap(perPlantMaps[slug], pts);
  }
}

/**
 * Process all ENERCAST files of a single forecast type.
 * ENERCAST only provides CEF data (aggregate + per-plant parsed from a single
 * multi-column CSV per day).
 */
async function processEnercastGroup(files) {
  const cefMap = new Map();
  const perPlant = makePerPlantMaps();

  for (const { buffer, filename } of files) {
    const cats = await parseFile('ENERCAST', buffer, filename);
    addPointsToMap(cefMap, cats.cef.points);
    addPerPlantToMaps(perPlant, cats.cef.perPlant);
  }

  return {
    cef: cefMap,
    cefPerPlant: perPlant,
    smallprod: new Map(),
    prosumer: new Map(),
  };
}

/**
 * Processes a ZIP file and returns:
 *   { [company]: {
 *       intraday?: { cef, cefPerPlant, smallprod, prosumer },
 *       dayahead?: { ... }
 *   } }
 * where `cef`, `smallprod`, `prosumer` are TimeSeriesPoint[] and
 * `cefPerPlant` is { [slug]: TimeSeriesPoint[] }.
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

    addPointsToMap(companyMaps[company][fType].cef,       cats.cef.points);
    addPerPlantToMaps(companyMaps[company][fType].cefPerPlant, cats.cef.perPlant);
    addPointsToMap(companyMaps[company][fType].smallprod, cats.smallprod.points);
    addPointsToMap(companyMaps[company][fType].prosumer,  cats.prosumer.points);
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

  // Convert Maps → sorted arrays; only keep types with any data.
  const result = {};
  for (const [company, types] of Object.entries(companyMaps)) {
    const companyResult = {};
    let hasAny = false;
    for (const [type, cats] of Object.entries(types)) {
      const cefArr       = Array.from(cats.cef.values()).filter(pt => pt.timestamp).sort((a, b) => a.timestamp - b.timestamp);
      const smallprodArr = Array.from(cats.smallprod.values()).filter(pt => pt.timestamp).sort((a, b) => a.timestamp - b.timestamp);
      const prosumerArr  = Array.from(cats.prosumer.values()).filter(pt => pt.timestamp).sort((a, b) => a.timestamp - b.timestamp);

      const perPlant = {};
      for (const slug of CEF_SLUGS) {
        const m = cats.cefPerPlant[slug];
        if (!m || m.size === 0) continue;
        perPlant[slug] = Array.from(m.values())
          .filter(pt => pt.timestamp)
          .sort((a, b) => a.timestamp - b.timestamp);
      }

      if (cefArr.length === 0 && smallprodArr.length === 0 && prosumerArr.length === 0) continue;

      companyResult[type] = {
        cef:         cefArr,
        cefPerPlant: perPlant,
        smallprod:   smallprodArr,
        prosumer:    prosumerArr,
      };
      hasAny = true;
    }
    if (hasAny) result[company] = companyResult;
  }

  return result;
}
