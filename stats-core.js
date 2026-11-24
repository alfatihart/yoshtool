// Pure helpers for YoshTool's cumulative protection stats (the Overview feature).
// No chrome.* here so it can be unit-tested under Node and imported by the service worker.
//
// Shape persisted in chrome.storage.local under STATS_KEY:
//   { day: "2026-11-19", today: {net,cos,pop,sensor}, total: {net,cos,pop,sensor} }
// - net    = network requests blocked by the ad/tracker rulesets (DNR, APPROXIMATE — getMatchedRules
//            is rate-limited and only polled for the active tab, so it undercounts).
// - cos    = elements hidden by the cosmetic filter / element blocker (exact).
// - pop    = popups blocked by the popup blocker (exact).
// - sensor = fields masked by the auto-sensor privacy blur (exact). Privacy, NOT a "blocked" count.
// "today" resets at local midnight; "total" is lifetime. Per-site stats are intentionally omitted.

export const STATS_KEY = "ytStats";
export const STAT_KEYS = ["net", "cos", "pop", "sensor"];

function zero() {
  return { net: 0, cos: 0, pop: 0, sensor: 0 };
}

export function emptyStats() {
  return { day: null, today: zero(), total: zero() };
}

// Local calendar day as YYYY-MM-DD (local time, so "today" rolls over at the user's midnight).
export function dayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

// Normalise a (possibly missing/partial/legacy) stored object and roll "today" over if the day changed.
// Mutates and returns `stats`. Lifetime totals are preserved across the roll-over.
export function rollDay(stats, day) {
  if (!stats || typeof stats !== "object") stats = emptyStats();
  if (!stats.today || typeof stats.today !== "object") stats.today = zero();
  if (!stats.total || typeof stats.total !== "object") stats.total = zero();
  for (const k of STAT_KEYS) {
    if (typeof stats.today[k] !== "number" || stats.today[k] < 0) stats.today[k] = 0;
    if (typeof stats.total[k] !== "number" || stats.total[k] < 0) stats.total[k] = 0;
  }
  if (stats.day !== day) {
    stats.day = day;
    stats.today = zero();
  }
  return stats;
}

// Add a non-negative delta of one metric to both today and total. Mutates and returns `stats`.
export function addDelta(stats, key, delta) {
  if (!STAT_KEYS.includes(key)) return stats;
  delta = Math.floor(Number(delta));
  if (!Number.isFinite(delta) || delta <= 0) return stats;
  stats.today[key] += delta;
  stats.total[key] += delta;
  return stats;
}

// The headline "blocked" number: ads/trackers + elements + popups. Sensor (privacy masking) is
// deliberately excluded — masking a field is not blocking a request.
export function blockedSum(c) {
  if (!c || typeof c !== "object") return 0;
  return (c.net || 0) + (c.cos || 0) + (c.pop || 0);
}

// Compact human count: 0, 42, 999, 1.2k, 12k, 1.3M.
export function fmtCount(n) {
  n = Number(n);
  if (!Number.isFinite(n) || n < 0) n = 0;
  n = Math.round(n);
  if (n < 1000) return String(n);
  if (n < 10000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  if (n < 1e6) return Math.round(n / 1000) + "k";
  if (n < 1e7) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  return Math.round(n / 1e6) + "M";
}
