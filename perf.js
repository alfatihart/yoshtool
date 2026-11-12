// perf.js — on-demand (classic) content script. Collects Core Web Vitals + load timing from the raw
// Performance APIs over a short window, then sends the snapshot to the popup (and caches it in
// storage). Injected via chrome.scripting.executeScript({files:["perf.js"]}) on the active tab.
//
// clsWindows / summarizeNavigation / topResources below are a BYTE-IDENTICAL inline copy of
// perf-core.js (a classic content script can't import) — keep in sync. Rating/formatting is done in
// the popup, so only these three collectors are inlined here.
//
// Honest limit: injected on demand = AFTER load, so navigation timing and FCP are final (buffered),
// but LCP may not be final (it stops updating at first interaction) and INP needs real interaction —
// the UI labels this.
(() => {
  if (window.__yoshtoolPerfRunning) return;
  window.__yoshtoolPerfRunning = true;

  // ---- inline copy of perf-core.js helpers (keep IDENTICAL) ----
  function clsWindows(shifts) {
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
  function summarizeNavigation(n) {
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
  function topResources(resources, n = 5) {
    const list = (resources || []).filter((r) => r && r.duration > 0);
    const slowest = [...list].sort((a, b) => b.duration - a.duration).slice(0, n);
    const heaviest = [...list].filter((r) => r.transferSize > 0).sort((a, b) => b.transferSize - a.transferSize).slice(0, n);
    return { slowest, heaviest };
  }
  // ---- end inline copy ----

  const shifts = [];
  let lcp = null;
  let lastLcpAt = 0;
  let lcpEntry = null;
  let fcpVal = null;
  const interactions = [];
  const observers = [];
  function observe(type, cb, extra) {
    try {
      const o = new PerformanceObserver((list) => { for (const e of list.getEntries()) cb(e); });
      o.observe(Object.assign({ type, buffered: true }, extra || {}));
      observers.push(o);
    } catch (e) {}
  }
  observe("paint", (e) => { if (e.name === "first-contentful-paint" && fcpVal == null) fcpVal = e.startTime; });
  observe("largest-contentful-paint", (e) => { lcp = e.startTime; lastLcpAt = performance.now(); lcpEntry = e; });
  observe("layout-shift", (e) => { shifts.push({ value: e.value, startTime: e.startTime, hadRecentInput: e.hadRecentInput }); });
  observe("event", (e) => { if (e.interactionId) interactions.push(e.duration); }, { durationThreshold: 16 });

  function fcp() {
    if (fcpVal != null) return fcpVal;
    try { const p = performance.getEntriesByName("first-contentful-paint")[0]; return p ? p.startTime : null; }
    catch (e) { return null; }
  }

  let sent = false;
  function finish() {
    if (sent) return;
    sent = true;
    for (const o of observers) { try { o.disconnect(); } catch (e) {} }
    let navEntry = null;
    try { navEntry = performance.getEntriesByType("navigation")[0] || null; } catch (e) {}
    let resources = [];
    try {
      resources = performance.getEntriesByType("resource").map((r) => ({
        name: r.name, initiatorType: r.initiatorType, duration: r.duration, transferSize: r.transferSize || 0,
      }));
    } catch (e) {}
    // LCP element details (for the LCP-phase breakdown): resource url for image LCP, timings, element.
    let lcpInfo = null;
    if (lcpEntry) {
      const el = lcpEntry.element || null;
      let cls = null;
      try { cls = el && typeof el.className === "string" ? el.className.slice(0, 80) : null; } catch (e) {}
      lcpInfo = {
        url: lcpEntry.url || null,
        size: lcpEntry.size || 0,
        loadTime: lcpEntry.loadTime || 0,
        renderTime: lcpEntry.renderTime || 0,
        tag: el ? (el.tagName || "").toLowerCase() : null,
        id: el && el.id ? String(el.id).slice(0, 60) : null,
        cls,
        text: el && !lcpEntry.url ? (el.textContent || "").trim().slice(0, 80) : null,
      };
    }

    // Render-blocking resources, read from the live DOM (CSS + sync head scripts).
    let renderBlocking = [];
    try {
      const sel = 'head link[rel~="stylesheet"][href]:not([media="print"]), head script[src]:not([async]):not([defer]):not([type="module"])';
      renderBlocking = Array.from(document.querySelectorAll(sel)).map((n) => n.href || n.src).filter(Boolean);
    } catch (e) {}

    // DOM size stats (for the "Optimize DOM size" insight).
    let domStats = null;
    try {
      const all = document.querySelectorAll("*");
      let maxChildren = 0, maxDepth = 0;
      for (const el of all) { if (el.children && el.children.length > maxChildren) maxChildren = el.children.length; }
      for (const el of all) {
        if (el.children && el.children.length === 0) {
          let d = 0, p = el;
          while (p && p.parentElement) { d++; p = p.parentElement; }
          if (d > maxDepth) maxDepth = d;
        }
      }
      domStats = { nodes: all.length, maxDepth, maxChildren };
    } catch (e) {}

    const data = {
      url: location.href,
      fcp: fcp(),
      lcp,
      cls: clsWindows(shifts),
      inp: interactions.length ? Math.max.apply(null, interactions) : null, // approx: worst interaction seen
      interactionCount: interactions.length,
      nav: summarizeNavigation(navEntry),
      res: topResources(resources, 5),
      lcpInfo,
      renderBlocking,
      domStats,
      measuredAt: Date.now(),
    };
    try { chrome.runtime.sendMessage({ cmd: "perf-result", data }); } catch (e) {}
    try { chrome.storage.local.set({ perfResult: data }); } catch (e) {}
    window.__yoshtoolPerfRunning = false;
  }

  // Adaptive window: finish once FCP is present AND LCP has settled (no new LCP for ~1s, or none after
  // 3s), else a hard cap of 8s. A throttled SPA paints late — a fixed short window would miss FCP/LCP.
  const startedAt = performance.now();
  function tick() {
    if (sent) return;
    const now = performance.now();
    const haveFcp = fcp() != null;
    const lcpOk = lcp != null ? now - lastLcpAt > 1000 : now - startedAt > 3000;
    if ((haveFcp && lcpOk) || now - startedAt > 8000) finish();
    else setTimeout(tick, 300);
  }
  setTimeout(tick, 400);
})();
