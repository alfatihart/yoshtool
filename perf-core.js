// perf-core.js
// Pure helpers for the Page-performance tool (Core Web Vitals + load timing). No chrome.*/DOM →
// Node-tested, and imported by popup.js. The content script perf.js keeps a BYTE-IDENTICAL inline
// copy of these functions (it's a classic script that can't import) — keep them in sync.
//
// We read the raw Performance APIs ourselves (no third-party lib, in keeping with YoshTool's
// no-build/no-dep ethos): Paint Timing (FCP), PerformanceObserver 'largest-contentful-paint' (LCP),
// 'layout-shift' with the session-window algorithm (CLS), Navigation Timing (TTFB + phases), and
// Resource Timing (slowest/heaviest). INP is approximated as the worst interaction seen during the
// measurement window (true INP is a lifetime high-percentile — labelled honestly in the UI).

// Core Web Vitals thresholds (good ≤ t[0]; needs-improvement ≤ t[1]; else poor). Verified Nov 2026.
// ms except CLS (unitless). `load` is not an official CWV but useful for colouring the load event.
export const THRESHOLDS = {
  lcp: [2500, 4000],
  cls: [0.1, 0.25],
  inp: [200, 500],
  fcp: [1800, 3000],
  ttfb: [800, 1800],
  load: [2500, 5000],
};

// Classify a metric value → "good" | "needs-improvement" | "poor" | "" (unknown metric/value).
export function rate(name, value) {
  const t = THRESHOLDS[name];
  if (!t || value == null || Number.isNaN(value)) return "";
  return value <= t[0] ? "good" : value <= t[1] ? "needs-improvement" : "poor";
}

// Human-readable duration: ms under 1s, otherwise seconds with 2 decimals.
export function fmtDuration(ms) {
  if (ms == null || Number.isNaN(ms)) return "—";
  return ms >= 1000 ? (ms / 1000).toFixed(2) + " s" : Math.round(ms) + " ms";
}

// Human-readable byte size.
export function fmtBytes(n) {
  if (!n || Number.isNaN(n)) return "—";
  if (n >= 1048576) return (n / 1048576).toFixed(1) + " MB";
  if (n >= 1024) return Math.round(n / 1024) + " KB";
  return n + " B";
}

// CLS via the session-window algorithm (same as Google's web-vitals): sum shifts into a session while
// consecutive shifts are < 1s apart and the window is < 5s long; CLS is the largest session sum.
// `shifts` = [{ value, startTime, hadRecentInput }]. Shifts with recent input are excluded.
export function clsWindows(shifts) {
  let max = 0, cur = 0, first = 0, last = 0;
  for (const s of shifts || []) {
    if (!s || s.hadRecentInput) continue;
    if (cur > 0 && s.startTime - last < 1000 && s.startTime - first < 5000) {
      cur += s.value;
      last = s.startTime;
    } else {
      cur = s.value;
      first = s.startTime;
      last = s.startTime;
    }
    if (cur > max) max = cur;
  }
  return max;
}

// Reduce a PerformanceNavigationTiming (or plain object) to the phases we show.
export function summarizeNavigation(n) {
  if (!n) return null;
  const diff = (a, b) => Math.max(0, (n[a] || 0) - (n[b] || 0));
  return {
    ttfb: n.responseStart || 0,
    dns: diff("domainLookupEnd", "domainLookupStart"),
    tcp: diff("connectEnd", "connectStart"),
    tls: n.secureConnectionStart ? diff("connectEnd", "secureConnectionStart") : 0,
    request: diff("responseStart", "requestStart"),
    response: diff("responseEnd", "responseStart"),
    dcl: n.domContentLoadedEventEnd || 0,
    load: n.loadEventEnd || 0,
    transferSize: n.transferSize || 0,
  };
}

// Pick the slowest (by duration) and heaviest (by transferSize) resources.
export function topResources(resources, n = 5) {
  const list = (resources || []).filter((r) => r && r.duration > 0);
  const slowest = [...list].sort((a, b) => b.duration - a.duration).slice(0, n);
  const heaviest = [...list].filter((r) => r.transferSize > 0).sort((a, b) => b.transferSize - a.transferSize).slice(0, n);
  return { slowest, heaviest };
}

// ============================================================================
// Performance OVERLAY (on-page lab) — throttle presets + helpers that shape the
// CDP screencast frames and Network events into a filmstrip + request waterfall.
// Pure (no chrome.*/DOM) → Node-tested, imported by background.js. The overlay
// content script (perf-overlay.js) only RENDERS what background computes here, so
// these helpers aren't inlined there (unlike perf.js's collectors).
// ============================================================================

// CDP Network.emulateNetworkConditions presets. Throughput is bytes/sec; -1 = unthrottled.
// slow4g matches Lighthouse "Slow 4G" (150ms, 1.6 Mbit down / 750 Kbit up).
export const NET_PROFILES = {
  none: { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
  slow4g: { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 },
  fast4g: { offline: false, latency: 40, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (3 * 1024 * 1024) / 8 },
  slow3g: { offline: false, latency: 400, downloadThroughput: (400 * 1024) / 8, uploadThroughput: (400 * 1024) / 8 },
};

// CPU throttle rates for Emulation.setCPUThrottlingRate (1 = no throttle).
export const CPU_RATES = { none: 1, "4x": 4, "6x": 6 };

function clampNum(n, lo, hi) {
  n = Number(n);
  if (Number.isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

// Normalize a picker choice {cpu, net, device} into the concrete CDP params background applies.
// cpu: "none"|"4x"|"6x"|<number rate>; net: key of NET_PROFILES or a {latency,downloadThroughput,
// uploadThroughput} object; device: "desktop"|"mobile". Returns the resolved rate/conditions plus the
// keys echoed back to the overlay so it can re-show the chosen profile after the reload.
export function resolvePerfProfile(opts) {
  opts = opts || {};
  let cpuRate = 1;
  if (typeof opts.cpu === "number") cpuRate = clampNum(opts.cpu, 1, 20);
  else if (opts.cpu && CPU_RATES[opts.cpu] != null) cpuRate = CPU_RATES[opts.cpu];
  let net;
  if (opts.net && typeof opts.net === "object") {
    net = {
      offline: false,
      latency: clampNum(opts.net.latency, 0, 10000),
      downloadThroughput: opts.net.downloadThroughput != null ? opts.net.downloadThroughput : -1,
      uploadThroughput: opts.net.uploadThroughput != null ? opts.net.uploadThroughput : -1,
    };
  } else {
    net = NET_PROFILES[opts.net] || NET_PROFILES.none;
  }
  return {
    cpuRate,
    net,
    mobile: opts.device === "mobile",
    cpuKey: typeof opts.cpu === "string" ? opts.cpu : typeof opts.cpu === "number" ? "custom" : "none",
    netKey: typeof opts.net === "string" ? opts.net : opts.net ? "custom" : "none",
    deviceKey: opts.device === "mobile" ? "mobile" : "desktop",
  };
}

// Waterfall colours per CDP ResourceType (lower-cased). Used by requestColor + the overlay legend.
const REQ_TYPE_COLORS = {
  document: "#2f74c0",
  stylesheet: "#8b5cf6",
  script: "#f59e0b",
  image: "#10b981",
  media: "#10b981",
  font: "#ec4899",
  xhr: "#38bdf8",
  fetch: "#38bdf8",
  websocket: "#38bdf8",
  other: "#8b93a0",
};
export function requestColor(type) {
  return REQ_TYPE_COLORS[String(type || "").toLowerCase()] || REQ_TYPE_COLORS.other;
}

// Short, human label for a request URL: the last path segment, else the host.
export function requestName(url) {
  try {
    const u = new URL(url);
    const seg = (u.pathname || "").split("/").filter(Boolean).pop();
    const name = seg || u.hostname || url;
    return name.length > 42 ? name.slice(0, 41) + "…" : name;
  } catch (e) {
    const s = String(url || "") || "—";
    return s.length > 42 ? s.slice(0, 41) + "…" : s;
  }
}

// Shape raw (time-relative) request records into the waterfall the overlay draws.
// `reqs` items: { url, type, start, end, size, status } with start/end in ms from navigation start.
// Returns { rows (top N by start), total (ms, for bar scaling), count, totalBytes } over ALL requests.
export function summarizeRequests(reqs, opts) {
  const limit = (opts && opts.limit) || 24;
  const list = (reqs || []).filter((r) => r && r.url && !/^data:/i.test(r.url));
  let total = 0,
    totalBytes = 0;
  for (const r of list) {
    const end = r.end != null ? r.end : r.start || 0;
    if (end > total) total = end;
    totalBytes += r.size || 0;
  }
  if (!(total > 0)) total = 1;
  const rows = [...list]
    .sort((a, b) => (a.start || 0) - (b.start || 0))
    .slice(0, limit)
    .map((r) => {
      const start = Math.max(0, r.start || 0);
      const end = r.end != null ? Math.max(start, r.end) : start;
      return {
        name: requestName(r.url),
        type: r.type || "other",
        color: requestColor(r.type),
        start,
        dur: end - start,
        size: r.size || 0,
        status: r.status || 0,
      };
    });
  return { rows, total, count: list.length, totalBytes };
}

// Downsample screencast frames to ~`count` thumbnails across the load timeline, sampled DENSER near
// the start (a power curve) — that's where first paint and any FOUC flash happen, so an even time
// spacing on a long load would miss them. `frames` items: { data, rel } (rel ms from nav start). The
// frame nearest lcpMs is always included and tagged isLcp so the overlay can outline the LCP moment.
export function pickFilmstrip(frames, count, lcpMs) {
  const list = (frames || []).filter((f) => f && f.rel >= 0).sort((a, b) => a.rel - b.rel);
  if (!list.length) return [];
  count = Math.max(1, count || 6);
  const maxRel = list[list.length - 1].rel || 1;
  const nearest = (t) => {
    let best = list[0],
      bd = Infinity;
    for (const f of list) {
      const d = Math.abs(f.rel - t);
      if (d < bd) {
        bd = d;
        best = f;
      }
    }
    return best;
  };
  const picked = [];
  const seen = new Set();
  const add = (f) => {
    if (f && !seen.has(f.rel)) {
      picked.push({ data: f.data, rel: f.rel });
      seen.add(f.rel);
    }
  };
  // Power curve (>1) packs the sampled times toward 0 while still reaching maxRel.
  const P = 1.7;
  for (let i = 0; i < count; i++) {
    const frac = count === 1 ? 0 : i / (count - 1);
    add(nearest(maxRel * Math.pow(frac, P)));
  }
  // Always include (and tag) the frame nearest the LCP moment.
  let lcpFrame = null;
  if (lcpMs != null && !Number.isNaN(lcpMs)) {
    lcpFrame = nearest(lcpMs);
    add(lcpFrame);
  }
  picked.sort((a, b) => a.rel - b.rel);
  if (lcpFrame) {
    const m = picked.find((f) => f.rel === lcpFrame.rel);
    if (m) m.isLcp = true;
  }
  return picked;
}
