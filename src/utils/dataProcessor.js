// ─── Helpers ──────────────────────────────────────────────────────────────────

function dateKey(date) {
  // Returns 'YYYY-MM-DD' in local time
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ─── Aggregations ─────────────────────────────────────────────────────────────

/**
 * Returns [{ date: 'YYYY-MM-DD', value: number }] sorted by date.
 * Each point's value represents MWh for that 15-min interval; summing gives MWh/day.
 */
export function computeDailyTotals(points) {
  const byDate = {};
  for (const { timestamp, value } of points) {
    if (!timestamp || isNaN(timestamp.getTime())) continue;
    const key = dateKey(timestamp);
    byDate[key] = (byDate[key] || 0) + (value || 0);
  }
  return Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ date, value }));
}

/**
 * Returns [{ hour: 0..23, value: number }] for hours 7–20 only.
 * First sums 15-min slots within each hour per day, then averages across days.
 */
export function computeHourlyProfile(points) {
  // byDateHour['2026-03-05-10'] = total MWh for that hour on that date
  const byDateHour = {};

  for (const { timestamp, value } of points) {
    if (!timestamp || isNaN(timestamp.getTime())) continue;
    const hour = timestamp.getHours();
    if (hour < 7 || hour > 20) continue;
    const key = `${dateKey(timestamp)}-${hour}`;
    byDateHour[key] = (byDateHour[key] || 0) + (value || 0);
  }

  // Group by hour and average across dates
  const sumByHour = {};
  const countByHour = {};
  for (const [key, val] of Object.entries(byDateHour)) {
    const parts = key.split('-');
    const hour = parseInt(parts[3]);
    sumByHour[hour] = (sumByHour[hour] || 0) + val;
    countByHour[hour] = (countByHour[hour] || 0) + 1;
  }

  const result = [];
  for (let h = 7; h <= 20; h++) {
    const sum = sumByHour[h] || 0;
    const count = countByHour[h] || 1;
    result.push({ hour: h, value: sum / count });
  }
  return result;
}

// ─── Accuracy metrics ─────────────────────────────────────────────────────────

/**
 * Computes RMSE and NMAE between forecast and actual point arrays.
 *
 * Timestamps are rounded to the nearest 15-min bucket for matching.
 *
 * RMSE = sqrt( mean( (forecast − actual)² ) )  [MWh]
 *
 * NMAE (two modes):
 *  - capacity-normalised (preferred): pass capacityMWhPerInterval = Σ(MW_installed) × 0.25
 *    → NMAE = Σ|err| / (n × capacity_per_interval)   — robust, includes all non-zero-zero intervals
 *  - production-normalised (fallback): no capacity provided
 *    → NMAE = Σ|err| / Σactual  — only on production intervals (actual > 0)
 */
export function computeMetrics(forecastPoints, actualPoints, capacityMWhPerInterval = null) {
  if (!forecastPoints?.length || !actualPoints?.length) {
    return { rmse: null, nmae: null, n: 0 };
  }

  const BUCKET = 15 * 60 * 1000;
  const actualMap = new Map();
  for (const { timestamp, value } of actualPoints) {
    if (!timestamp) continue;
    const key = Math.round(timestamp.getTime() / BUCKET) * BUCKET;
    actualMap.set(key, value);
  }

  let sumSqErr = 0, sumAbsErr = 0, sumNmaeDenom = 0, n = 0;
  for (const { timestamp, value: forecast } of forecastPoints) {
    if (!timestamp) continue;
    const key = Math.round(timestamp.getTime() / BUCKET) * BUCKET;
    const actual = actualMap.get(key);
    if (actual == null) continue;
    if (forecast === 0 && actual === 0) continue;

    const err = forecast - actual;
    sumSqErr += err * err;
    n++;

    if (capacityMWhPerInterval != null) {
      // Capacity-normalised: fixed denominator per interval — includes all non-zero-zero
      sumAbsErr    += Math.abs(err);
      sumNmaeDenom += capacityMWhPerInterval;
    } else if (actual > 0) {
      // Production-normalised: only on production intervals (avoids huge values at night)
      sumAbsErr    += Math.abs(err);
      sumNmaeDenom += actual;
    }
  }

  if (n === 0) return { rmse: null, nmae: null, n };

  return {
    rmse: Math.sqrt(sumSqErr / n),
    nmae: sumNmaeDenom > 0 ? sumAbsErr / sumNmaeDenom : null,
    n,
  };
}

/**
 * Computes per-day NMAE between forecast and actual point arrays.
 * Returns { [YYYY-MM-DD]: { nmae, n } } for every date that has matched intervals.
 * Zero–zero intervals excluded. Uses the same capacity / production normalisation
 * as computeMetrics (pass capacityMWhPerInterval for capacity-normalised NMAE).
 */
export function computeDailyMetrics(forecastPoints, actualPoints, capacityMWhPerInterval = null) {
  if (!forecastPoints?.length || !actualPoints?.length) return {};

  const BUCKET = 15 * 60 * 1000;
  const actualMap = new Map();
  for (const { timestamp, value } of actualPoints) {
    if (!timestamp) continue;
    const key = Math.round(timestamp.getTime() / BUCKET) * BUCKET;
    actualMap.set(key, value);
  }

  // date → { sumAbsErr, sumNmaeDenom, n }
  const byDate = {};
  for (const { timestamp, value: forecast } of forecastPoints) {
    if (!timestamp) continue;
    const key = Math.round(timestamp.getTime() / BUCKET) * BUCKET;
    const actual = actualMap.get(key);
    if (actual == null) continue;
    if (forecast === 0 && actual === 0) continue;
    if (capacityMWhPerInterval == null && actual === 0) continue;
    const dk = dateKey(timestamp);
    if (!byDate[dk]) byDate[dk] = { sumAbsErr: 0, sumNmaeDenom: 0, n: 0 };
    byDate[dk].sumAbsErr    += Math.abs(forecast - actual);
    byDate[dk].sumNmaeDenom += capacityMWhPerInterval != null ? capacityMWhPerInterval : actual;
    byDate[dk].n++;
  }

  const result = {};
  for (const [dk, acc] of Object.entries(byDate)) {
    result[dk] = {
      nmae:         acc.sumNmaeDenom > 0 ? acc.sumAbsErr / acc.sumNmaeDenom : null,
      n:            acc.n,
      sumAbsErr:    acc.sumAbsErr,
      sumNmaeDenom: acc.sumNmaeDenom,
    };
  }
  return result;
}

// ─── Merge helpers ────────────────────────────────────────────────────────────

/**
 * Merges actual + forecast daily arrays into [{ date, actual, forecast }]
 * covering all dates that appear in either array.
 */
export function mergeDailyData(actual, forecast) {
  const actualMap = Object.fromEntries((actual || []).map(d => [d.date, d.value]));
  const forecastMap = Object.fromEntries((forecast || []).map(d => [d.date, d.value]));
  const allDates = [...new Set([...Object.keys(actualMap), ...Object.keys(forecastMap)])].sort();
  return allDates.map(date => ({
    date,
    actual: actualMap[date] ?? null,
    forecast: forecastMap[date] ?? null,
  }));
}

/**
 * Merges actual + forecast hourly arrays into [{ hour, actual, forecast }] for hours 7–20.
 */
export function mergeHourlyData(actual, forecast) {
  const actualMap = Object.fromEntries((actual || []).map(d => [d.hour, d.value]));
  const forecastMap = Object.fromEntries((forecast || []).map(d => [d.hour, d.value]));
  return Array.from({ length: 14 }, (_, i) => {
    const h = i + 7;
    return { hour: h, actual: actualMap[h] ?? null, forecast: forecastMap[h] ?? null };
  });
}
