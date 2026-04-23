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
    },
    dayahead: {
      cef: new Map(),
      cefPerPlant: makePerPlantMaps(),
    },
    // smallprod and prosumer are shared across forecast types
    // because companies submit the same data in both intraday and day-ahead
    smallprod: new Map(),
    prosumer: new Map(),
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

async function processEnercastGroup(files) {
  const cefMap       = new Map();
  const perPlant     = makePerPlantMaps();
  const smallprodMap = new Map();
  const prosumerMap  = new Map();

  for (const { buffer, filename } of files) {
    const cats = await parseFile('ENERCAST', buffer, filename);
    addPointsToMap(cefMap, cats.cef.points);
    addPerPlantToMaps(perPlant, cats.cef.perPlant);
    addPointsToMap(smallprodMap, cats.smallprod.points);
    addPointsToMap(prosumerMap,  cats.prosumer.points);
  }

  return {
    cef:         cefMap,
    cefPerPlant: perPlant,
    smallprod:   smallprodMap,
    prosumer:    prosumerMap,
  };
}

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

    // CEF goes into per-type maps (intraday and dayahead tracked separately)
    addPointsToMap(companyMaps[company][fType].cef, cats.cef.points);
    addPerPlantToMaps(companyMaps[company][fType].cefPerPlant, cats.cef.perPlant);

    // smallprod and prosumer go into shared company-level maps
    // Map keyed by timestamp so duplicates from intraday+dayahead are deduplicated
    addPointsToMap(companyMaps[company].smallprod, cats.smallprod.points);
    addPointsToMap(companyMaps[company].prosumer,  cats.prosumer.points);
  }

  // Process ENERCAST per type
  for (const type of ['intraday', 'dayahead']) {
    if (enercastByType[type].length === 0) continue;
    const cats = await processEnercastGroup(enercastByType[type]);
    if (cats.cef.size > 0) {
      if (!companyMaps['ENERCAST']) companyMaps['ENERCAST'] = makeTypeMaps();
      companyMaps['ENERCAST'][type].cef         = cats.cef;
      companyMaps['ENERCAST'][type].cefPerPlant = cats.cefPerPlant;
      addPointsToMap(companyMaps['ENERCAST'].smallprod, Array.from(cats.smallprod.values()));
      addPointsToMap(companyMaps['ENERCAST'].prosumer,  Array.from(cats.prosumer.values()));
    }
  }

  // Convert Maps → sorted arrays; only keep types with any data.
  const result = {};
  for (const [company, data] of Object.entries(companyMaps)) {
    const companyResult = {};
    let hasAny = false;

    // Convert shared smallprod and prosumer once
    const smallprodArr = Array.from(data.smallprod.values())
      .filter(pt => pt.timestamp)
      .sort((a, b) => a.timestamp - b.timestamp);
    const prosumerArr = Array.from(data.prosumer.values())
      .filter(pt => pt.timestamp)
      .sort((a, b) => a.timestamp - b.timestamp);

    for (const type of ['intraday', 'dayahead']) {
      const cats = data[type];
      if (!cats) continue;

      const cefArr = Array.from(cats.cef.values())
        .filter(pt => pt.timestamp)
        .sort((a, b) => a.timestamp - b.timestamp);

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
        // Only attach smallprod/prosumer to intraday to avoid double-counting
        // in dataProcessor which processes both forecast types
        smallprod:   type === 'intraday' ? smallprodArr : [],
        prosumer:    type === 'intraday' ? prosumerArr  : [],
      };
      hasAny = true;
    }

    // If company only has dayahead (no intraday), attach smallprod/prosumer there
    if (hasAny && !companyResult['intraday'] && companyResult['dayahead']) {
      companyResult['dayahead'].smallprod = smallprodArr;
      companyResult['dayahead'].prosumer  = prosumerArr;
    }

    if (hasAny) result[company] = companyResult;
  }

  return result;
}