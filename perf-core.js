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

// ============================================================================
// Hand-rolled "Insights" + rich request waterfall (DevTools-Performance parity, route A).
// All pure (no chrome.*/DOM) → Node-tested, imported by background.js. Background collects the raw
// Network/CDP + perf.js signals and feeds them here; the overlay only renders the result.
// See docs/performance-devtools-parity-research.md.
// ============================================================================

// A short public-suffix table so third-party grouping treats e.g. a.foo.co.id and b.foo.co.id as one
// site (foo.co.id). Not exhaustive — covers the common multi-label TLDs.
const TWO_LEVEL_TLDS = new Set([
  "co.id", "or.id", "ac.id", "go.id", "sch.id", "net.id", "web.id", "my.id", "biz.id", "desa.id",
  "co.uk", "org.uk", "gov.uk", "ac.uk", "me.uk", "com.au", "net.au", "org.au", "gov.au", "edu.au",
  "co.jp", "or.jp", "ne.jp", "co.kr", "com.br", "com.cn", "com.sg", "com.my", "co.th", "in.th",
  "co.nz", "co.za", "com.tr", "com.mx", "com.ar", "com.hk", "com.tw", "com.ph", "com.vn", "co.in",
]);

// Registrable domain (eTLD+1) for grouping. Heuristic — falls back to the last two labels.
export function registrableDomain(host) {
  host = String(host || "").toLowerCase().replace(/\.$/, "");
  if (!host || host.indexOf(".") < 0) return host;
  const p = host.split(".");
  if (p.length <= 2) return host;
  const last2 = p.slice(-2).join(".");
  return TWO_LEVEL_TLDS.has(last2) ? p.slice(-3).join(".") : last2;
}

export function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch (e) { return ""; }
}

// Break one request's CDP `timing` object + total duration into DevTools-style phase segments (ms).
// `timing` offsets are ms from timing.requestTime; totalMs = (finish - requestTime) in ms.
export function requestPhases(timing, totalMs) {
  totalMs = Math.max(0, totalMs || 0);
  if (!timing || timing.requestTime == null) return [{ name: "total", ms: totalMs }];
  const v = (k) => (typeof timing[k] === "number" && timing[k] >= 0 ? timing[k] : null);
  const dnsS = v("dnsStart"), dnsE = v("dnsEnd"), cS = v("connectStart"), cE = v("connectEnd");
  const sS = v("sslStart"), sE = v("sslEnd"), snS = v("sendStart"), snE = v("sendEnd"), rh = v("receiveHeadersEnd");
  const out = [];
  const firstNet = [dnsS, cS, snS].filter((x) => x != null).sort((a, b) => a - b)[0];
  if (firstNet != null && firstNet > 0.5) out.push({ name: "stalled", ms: firstNet });
  if (dnsS != null && dnsE != null && dnsE > dnsS) out.push({ name: "dns", ms: dnsE - dnsS });
  if (cS != null && cE != null && cE > cS) {
    const ssl = sS != null && sE != null && sE > sS ? sE - sS : 0;
    out.push({ name: "connect", ms: cE - cS - ssl });
    if (ssl > 0) out.push({ name: "ssl", ms: ssl });
  }
  if (snS != null && snE != null && snE > snS) out.push({ name: "send", ms: snE - snS });
  if (snE != null && rh != null && rh > snE) out.push({ name: "wait", ms: rh - snE });
  if (rh != null && totalMs > rh) out.push({ name: "download", ms: totalMs - rh });
  return out.length ? out : [{ name: "total", ms: totalMs }];
}

// Colours per phase (waterfall segments) and the "waiting"/TTFB phase name map.
const PHASE_COLORS = {
  stalled: "#8b93a0", dns: "#14b8a6", connect: "#f59e0b", ssl: "#a855f7",
  send: "#38bdf8", wait: "#22c55e", download: "#2f74c0", total: "#2f74c0",
};
export function phaseColor(name) { return PHASE_COLORS[name] || PHASE_COLORS.total; }

// Build the rich waterfall the overlay draws. `reqs` items (already relativized to nav start):
// { url, host, type, priority, protocol, status, mime, transfer, start(ms), end(ms),
//   durFromRequestTime(ms), timing, renderBlocking }. Returns rows (top N by start) + totals.
export function buildWaterfall(reqs, opts) {
  const limit = (opts && opts.limit) || 30;
  const list = (reqs || []).filter((r) => r && r.url && !/^data:/i.test(r.url));
  let total = 0, totalBytes = 0;
  for (const r of list) {
    const end = r.end != null ? r.end : r.start || 0;
    if (end > total) total = end;
    totalBytes += r.transfer || 0;
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
        url: r.url,
        type: r.type || "other",
        color: requestColor(r.type),
        priority: r.priority || "",
        protocol: r.protocol || "",
        status: r.status || 0,
        transfer: r.transfer || 0,
        start,
        dur: end - start,
        phases: requestPhases(r.timing, r.durFromRequestTime != null ? r.durFromRequestTime : end - start),
        renderBlocking: !!r.renderBlocking,
      };
    });
  return { rows, total, count: list.length, totalBytes };
}

// LCP split into the four Google phases. ttfbMs = document TTFB; lcpMs = LCP time (ms from nav);
// lcpInfo = { url, renderTime, loadTime, tag, ... } from the LCP PerformanceEntry; lcpReq = the
// matched network request (or null for a text LCP). Returns { total, phases:[{name,ms,pct}], kind }.
export function lcpBreakdown(ttfbMs, lcpMs, lcpInfo, lcpReq) {
  if (lcpMs == null || Number.isNaN(lcpMs)) return null;
  const ttfb = Math.max(0, ttfbMs || 0);
  const total = Math.max(lcpMs, ttfb);
  let loadDelay = 0, loadDuration = 0, renderDelay = 0;
  const isImage = !!(lcpInfo && lcpInfo.url);
  if (isImage && lcpReq && lcpReq.start != null) {
    const rStart = Math.max(ttfb, lcpReq.start);
    const rEnd = Math.max(rStart, lcpReq.end != null ? lcpReq.end : rStart);
    loadDelay = Math.max(0, rStart - ttfb);
    loadDuration = Math.max(0, rEnd - rStart);
    renderDelay = Math.max(0, lcpMs - rEnd);
  } else if (isImage && lcpInfo && lcpInfo.loadTime) {
    // Fall back to the entry's own loadTime/renderTime when the request wasn't matched.
    const rEnd = Math.max(ttfb, lcpInfo.loadTime);
    loadDelay = Math.max(0, rEnd - loadDuration - ttfb); // unknown split → fold into delay
    loadDuration = 0;
    renderDelay = Math.max(0, lcpMs - rEnd);
  } else {
    renderDelay = Math.max(0, lcpMs - ttfb); // text LCP: no resource phases
  }
  const phases = [
    { name: "TTFB", ms: ttfb },
    { name: "Load delay", ms: loadDelay },
    { name: "Load duration", ms: loadDuration },
    { name: "Render delay", ms: renderDelay },
  ];
  const sum = phases.reduce((a, p) => a + p.ms, 0) || 1;
  for (const p of phases) p.pct = (p.ms / sum) * 100;
  return { total, phases, kind: isImage ? "image" : "text" };
}

const STATIC_TYPES = new Set(["script", "stylesheet", "image", "font", "media"]);

// Parse Cache-Control max-age (seconds) from a headers object (lowercased keys). null = unknown.
function maxAgeOf(headers) {
  const cc = headers && (headers["cache-control"] || headers["Cache-Control"]);
  if (!cc) return headers && headers["expires"] ? 0 : null;
  if (/no-store|no-cache/i.test(cc)) return 0;
  const m = /max-age\s*=\s*(\d+)/i.exec(cc);
  return m ? parseInt(m[1], 10) : null;
}

// The main entry point: turn a collected run into an ordered list of insight cards.
// ctx = { vitals, reqs(enriched), renderBlockingUrls[], lcpInfo, domStats, pageHost }.
// Each card: { id, title, severity:"bad"|"warn"|"good"|"info", summary, items:[{label,value}], savingsBytes? }.
export function computeInsights(ctx) {
  ctx = ctx || {};
  const reqs = (ctx.reqs || []).filter((r) => r && r.url && !/^data:/i.test(r.url));
  const vitals = ctx.vitals || {};
  const nav = vitals.nav || {};
  const pageReg = registrableDomain(ctx.pageHost || "");
  const cards = [];

  // --- LCP breakdown ---
  const lcpInfo = ctx.lcpInfo || null;
  const lcpReq = lcpInfo && lcpInfo.url ? reqs.find((r) => r.url === lcpInfo.url) || null : null;
  const lb = lcpBreakdown(nav.ttfb, vitals.lcp, lcpInfo, lcpReq);
  if (lb) {
    const worst = [...lb.phases].sort((a, b) => b.ms - a.ms)[0];
    cards.push({
      id: "lcp",
      title: "LCP breakdown",
      severity: rate("lcp", vitals.lcp) === "good" ? "good" : rate("lcp", vitals.lcp) === "poor" ? "bad" : "warn",
      summary: `${fmtDuration(lb.total)} LCP — mostly ${worst.name} (${fmtDuration(worst.ms)})`,
      items: lb.phases.map((p) => ({ label: p.name, value: `${fmtDuration(p.ms)} · ${Math.round(p.pct)}%` })),
      lcp: lb,
      element: lcpInfo ? (lcpInfo.url ? requestName(lcpInfo.url) : lcpInfo.tag || "text") : null,
    });
  }

  // --- Render-blocking requests ---
  const rbUrls = new Set(ctx.renderBlockingUrls || []);
  const rb = reqs.filter((r) => rbUrls.has(r.url));
  if (rb.length) {
    const bytes = rb.reduce((a, r) => a + (r.transfer || 0), 0);
    const lastEnd = Math.max(...rb.map((r) => r.end || 0));
    cards.push({
      id: "render-blocking",
      title: "Render-blocking requests",
      severity: rb.length >= 3 ? "bad" : "warn",
      summary: `${rb.length} resource${rb.length > 1 ? "s" : ""} (${fmtBytes(bytes)}) block first paint — last finishes at ${fmtDuration(lastEnd)}`,
      items: rb
        .sort((a, b) => (b.end || 0) - (a.end || 0))
        .slice(0, 8)
        .map((r) => ({ label: requestName(r.url), value: `${fmtBytes(r.transfer)} · ${fmtDuration((r.end || 0) - (r.start || 0))}` })),
      savingsBytes: bytes,
    });
  }

  // --- Document request latency ---
  const doc = reqs.find((r) => r.type === "document") || reqs[0];
  if (doc) {
    const ttfb = nav.ttfb || 0;
    const enc = doc.headers && (doc.headers["content-encoding"] || "");
    const sev = ttfb > 1800 ? "bad" : ttfb > 800 ? "warn" : "good";
    const items = [{ label: "TTFB", value: fmtDuration(ttfb) }, { label: "Protocol", value: doc.protocol || "?" }];
    items.push({ label: "Compression", value: enc ? String(enc) : "none" });
    cards.push({
      id: "doc-latency",
      title: "Document request latency",
      severity: sev,
      summary: `Server responded in ${fmtDuration(ttfb)}${enc ? "" : " · not compressed"}`,
      items,
    });
  }

  // --- Third parties ---
  const groups = new Map();
  for (const r of reqs) {
    const reg = registrableDomain(r.host || hostOf(r.url));
    if (!reg || reg === pageReg) continue;
    const g = groups.get(reg) || { reg, bytes: 0, count: 0 };
    g.bytes += r.transfer || 0;
    g.count += 1;
    groups.set(reg, g);
  }
  if (groups.size) {
    const top = [...groups.values()].sort((a, b) => b.bytes - a.bytes);
    const tpBytes = top.reduce((a, g) => a + g.bytes, 0);
    const totalBytes = reqs.reduce((a, r) => a + (r.transfer || 0), 0) || 1;
    cards.push({
      id: "third-parties",
      title: "Third parties",
      severity: tpBytes / totalBytes > 0.5 ? "warn" : "info",
      summary: `${groups.size} third-party origin${groups.size > 1 ? "s" : ""} · ${fmtBytes(tpBytes)} (${Math.round((tpBytes / totalBytes) * 100)}% of bytes)`,
      items: top.slice(0, 6).map((g) => ({ label: g.reg, value: `${g.count} req · ${fmtBytes(g.bytes)}` })),
      savingsBytes: tpBytes,
    });
  }

  // --- Efficient cache lifetimes ---
  const shortCache = reqs.filter((r) => {
    if (!STATIC_TYPES.has(r.type)) return false;
    const ma = maxAgeOf(r.headers);
    return ma != null && ma < 86400; // < 1 day (includes 0 / no-store / no-cache)
  });
  if (shortCache.length) {
    const bytes = shortCache.reduce((a, r) => a + (r.transfer || 0), 0);
    cards.push({
      id: "cache",
      title: "Use efficient cache lifetimes",
      severity: bytes > 1048576 ? "warn" : "info",
      summary: `${shortCache.length} static asset${shortCache.length > 1 ? "s" : ""} (${fmtBytes(bytes)}) have a short/absent cache lifetime`,
      items: shortCache
        .sort((a, b) => (b.transfer || 0) - (a.transfer || 0))
        .slice(0, 8)
        .map((r) => ({ label: requestName(r.url), value: fmtBytes(r.transfer) })),
      savingsBytes: bytes,
    });
  }

  // --- Modern HTTP ---
  const legacy = reqs.filter((r) => /^http\/1/i.test(r.protocol || ""));
  if (legacy.length) {
    const byHost = new Map();
    for (const r of legacy) byHost.set(r.host || hostOf(r.url), (byHost.get(r.host || hostOf(r.url)) || 0) + 1);
    cards.push({
      id: "modern-http",
      title: "Modern HTTP",
      severity: "info",
      summary: `${legacy.length} request${legacy.length > 1 ? "s" : ""} still on HTTP/1.x (not h2/h3)`,
      items: [...byHost.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([h, c]) => ({ label: h, value: `${c} req` })),
    });
  }

  // --- DOM size ---
  const d = ctx.domStats;
  if (d && d.nodes) {
    const sev = d.nodes > 1500 || d.maxDepth > 32 || d.maxChildren > 60 ? "warn" : "good";
    cards.push({
      id: "dom-size",
      title: "Optimize DOM size",
      severity: sev,
      summary: `${d.nodes.toLocaleString()} DOM nodes · depth ${d.maxDepth} · max ${d.maxChildren} children`,
      items: [
        { label: "Total nodes", value: String(d.nodes) },
        { label: "Max depth", value: String(d.maxDepth) },
        { label: "Max children", value: String(d.maxChildren) },
      ],
    });
  }

  // --- Network dependency chain (critical path approximation) ---
  const byUrl = new Map(reqs.map((r) => [r.url, r]));
  let bestChain = [];
  for (const r of reqs) {
    const chain = [];
    const seen = new Set();
    let cur = r;
    while (cur && !seen.has(cur.url) && chain.length < 40) {
      seen.add(cur.url);
      chain.unshift(cur);
      cur = cur.initiatorUrl ? byUrl.get(cur.initiatorUrl) : null;
    }
    if (chain.length > bestChain.length) bestChain = chain;
  }
  if (bestChain.length >= 3) {
    const chainDur = (bestChain[bestChain.length - 1].end || 0) - (bestChain[0].start || 0);
    cards.push({
      id: "dependency-chain",
      title: "Network dependency tree",
      severity: bestChain.length >= 5 ? "warn" : "info",
      summary: `Longest dependent chain: ${bestChain.length} requests over ${fmtDuration(chainDur)}`,
      items: bestChain.slice(-8).map((r) => ({ label: requestName(r.url), value: fmtDuration((r.end || 0) - (r.start || 0)) })),
    });
  }

  const order = { bad: 0, warn: 1, info: 2, good: 3 };
  cards.sort((a, b) => (order[a.severity] - order[b.severity]) || 0);
  return cards;
}

// ============================================================================
// Live Performance Monitor (DevTools "Performance monitor" parity). Pure helpers over the flat
// Performance.getMetrics samples background polls; the overlay renders sparklines. See the research doc.
// ============================================================================

// Derive human metrics from two consecutive Performance.getMetrics samples (name→value maps).
// prev may be null for the first tick. dtMs = ms between samples. CPU% ≈ Δ(task time)/Δt; layouts and
// style recalcs become per-second rates; heap/nodes/listeners are instantaneous.
export function monitorDerive(prev, cur, dtMs) {
  cur = cur || {};
  const dt = Math.max(1, dtMs || 1000) / 1000;
  const d = (k) => Math.max(0, (cur[k] || 0) - ((prev && prev[k]) || 0));
  return {
    cpu: prev ? Math.max(0, Math.min(100, (d("TaskDuration") / dt) * 100)) : 0,
    heapMB: (cur.JSHeapUsedSize || 0) / 1048576,
    nodes: cur.Nodes || 0,
    listeners: cur.JSEventListeners || 0,
    documents: cur.Documents || 0,
    layoutsPerSec: prev ? d("LayoutCount") / dt : 0,
    recalcsPerSec: prev ? d("RecalcStyleCount") / dt : 0,
  };
}

// Points string for an inline-SVG sparkline polyline over `values` in a w×h box (newest last).
// maxOverride pins the y-scale (else it auto-scales to the series max, min 1).
export function sparkPoints(values, w, h, maxOverride) {
  const v = (values || []).filter((x) => typeof x === "number" && !Number.isNaN(x));
  if (!v.length) return "";
  const max = maxOverride != null && maxOverride > 0 ? maxOverride : Math.max(1, ...v);
  const n = v.length;
  return v
    .map((val, i) => {
      const x = n === 1 ? w : (i / (n - 1)) * w;
      const y = h - Math.max(0, Math.min(1, val / max)) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}
