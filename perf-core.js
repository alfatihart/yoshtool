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
