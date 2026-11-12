import { test } from "node:test";
import assert from "node:assert/strict";
import {
  THRESHOLDS,
  rate,
  fmtDuration,
  fmtBytes,
  clsWindows,
  summarizeNavigation,
  topResources,
  NET_PROFILES,
  CPU_RATES,
  resolvePerfProfile,
  requestName,
  requestColor,
  summarizeRequests,
  pickFilmstrip,
  registrableDomain,
  requestPhases,
  buildWaterfall,
  lcpBreakdown,
  computeInsights,
} from "../perf-core.js";

test("rate: good / needs-improvement / poor per thresholds", () => {
  assert.equal(rate("lcp", 2000), "good");
  assert.equal(rate("lcp", 3000), "needs-improvement");
  assert.equal(rate("lcp", 5000), "poor");
  assert.equal(rate("cls", 0.05), "good");
  assert.equal(rate("cls", 0.2), "needs-improvement");
  assert.equal(rate("cls", 0.4), "poor");
  assert.equal(rate("ttfb", 500), "good");
  assert.equal(rate("inp", 600), "poor");
  assert.equal(rate("unknown", 10), "");
  assert.equal(rate("lcp", null), "");
  // boundary: exactly the good threshold is still good
  assert.equal(rate("fcp", 1800), "good");
  assert.equal(rate("fcp", 1801), "needs-improvement");
});

test("fmtDuration / fmtBytes", () => {
  assert.equal(fmtDuration(123), "123 ms");
  assert.equal(fmtDuration(1234), "1.23 s");
  assert.equal(fmtDuration(1000), "1.00 s");
  assert.equal(fmtDuration(null), "—");
  assert.equal(fmtBytes(512), "512 B");
  assert.equal(fmtBytes(2048), "2 KB");
  assert.equal(fmtBytes(1572864), "1.5 MB");
  assert.equal(fmtBytes(0), "—");
});

test("clsWindows: session-window algorithm", () => {
  // Two shifts < 1s apart → one session summing to 0.3.
  assert.equal(
    Math.round(clsWindows([
      { value: 0.1, startTime: 100, hadRecentInput: false },
      { value: 0.2, startTime: 500, hadRecentInput: false },
    ]) * 100) / 100,
    0.3,
  );
  // A >1s gap starts a new session → max is the larger single session, not the total.
  assert.equal(
    Math.round(clsWindows([
      { value: 0.1, startTime: 100, hadRecentInput: false },
      { value: 0.15, startTime: 2000, hadRecentInput: false }, // gap > 1s → new session
      { value: 0.05, startTime: 2200, hadRecentInput: false },
    ]) * 100) / 100,
    0.2, // second session 0.15 + 0.05
  );
  // hadRecentInput excluded.
  assert.equal(clsWindows([{ value: 0.5, startTime: 100, hadRecentInput: true }]), 0);
  // window > 5s long caps the session.
  assert.equal(
    Math.round(clsWindows([
      { value: 0.1, startTime: 0, hadRecentInput: false },
      { value: 0.1, startTime: 6000, hadRecentInput: false }, // > 5s from first → new session
    ]) * 100) / 100,
    0.1,
  );
  assert.equal(clsWindows([]), 0);
});

test("summarizeNavigation: phases from a navigation entry", () => {
  const nav = {
    domainLookupStart: 10, domainLookupEnd: 30,
    connectStart: 30, secureConnectionStart: 50, connectEnd: 90,
    requestStart: 90, responseStart: 200, responseEnd: 260,
    domContentLoadedEventEnd: 500, loadEventEnd: 900, transferSize: 12345,
  };
  const s = summarizeNavigation(nav);
  assert.equal(s.ttfb, 200);
  assert.equal(s.dns, 20);
  assert.equal(s.tcp, 60);
  assert.equal(s.tls, 40); // connectEnd - secureConnectionStart
  assert.equal(s.request, 110);
  assert.equal(s.response, 60);
  assert.equal(s.dcl, 500);
  assert.equal(s.load, 900);
  assert.equal(s.transferSize, 12345);
  assert.equal(summarizeNavigation(null), null);
});

test("topResources: slowest by duration, heaviest by size", () => {
  const res = [
    { name: "a.js", duration: 50, transferSize: 1000 },
    { name: "b.css", duration: 200, transferSize: 500 },
    { name: "c.png", duration: 10, transferSize: 90000 },
    { name: "d.js", duration: 0, transferSize: 0 }, // skipped (no duration)
  ];
  const { slowest, heaviest } = topResources(res, 2);
  assert.deepEqual(slowest.map((r) => r.name), ["b.css", "a.js"]);
  assert.deepEqual(heaviest.map((r) => r.name), ["c.png", "a.js"]);
});

// ---- Performance overlay helpers ----

test("resolvePerfProfile: string presets", () => {
  const p = resolvePerfProfile({ cpu: "4x", net: "slow4g", device: "mobile" });
  assert.equal(p.cpuRate, 4);
  assert.equal(p.net.latency, NET_PROFILES.slow4g.latency);
  assert.equal(p.mobile, true);
  assert.equal(p.cpuKey, "4x");
  assert.equal(p.netKey, "slow4g");
  assert.equal(p.deviceKey, "mobile");
});

test("resolvePerfProfile: defaults + custom values", () => {
  const d = resolvePerfProfile({});
  assert.equal(d.cpuRate, 1);
  assert.deepEqual(d.net, NET_PROFILES.none);
  assert.equal(d.mobile, false);
  assert.equal(d.deviceKey, "desktop");
  // numeric cpu rate is clamped to [1,20]; custom net object is normalized
  const c = resolvePerfProfile({ cpu: 50, net: { latency: 300, downloadThroughput: 1000 }, device: "desktop" });
  assert.equal(c.cpuRate, 20);
  assert.equal(c.cpuKey, "custom");
  assert.equal(c.net.latency, 300);
  assert.equal(c.net.downloadThroughput, 1000);
  assert.equal(c.net.uploadThroughput, -1);
  assert.equal(c.netKey, "custom");
  // CPU_RATES lookup table is exposed
  assert.equal(CPU_RATES["6x"], 6);
});

test("requestName / requestColor", () => {
  assert.equal(requestName("https://x.com/assets/app.js?v=2"), "app.js");
  assert.equal(requestName("https://x.com/"), "x.com");
  assert.equal(requestName("https://x.com"), "x.com");
  assert.equal(requestName("not a url"), "not a url");
  assert.equal(requestColor("Script"), requestColor("script")); // case-insensitive
  assert.equal(requestColor("script"), "#f59e0b");
  assert.equal(requestColor("nonsense"), requestColor("other"));
});

test("summarizeRequests: sort, cap, aggregates, data: URIs dropped", () => {
  const reqs = [
    { url: "https://x.com/doc", type: "document", start: 0, end: 100, size: 2000, status: 200 },
    { url: "https://x.com/a.js", type: "script", start: 50, end: 300, size: 5000, status: 200 },
    { url: "data:image/png;base64,AAAA", type: "image", start: 10, end: 20, size: 999 }, // dropped
    { url: "https://x.com/b.css", type: "stylesheet", start: 20, end: 60, size: 1000, status: 200 },
  ];
  const w = summarizeRequests(reqs, { limit: 2 });
  assert.equal(w.count, 3); // data: URI excluded from the count too
  assert.equal(w.totalBytes, 8000);
  assert.equal(w.total, 300); // latest end among non-data requests
  assert.equal(w.rows.length, 2); // capped
  assert.deepEqual(w.rows.map((r) => r.name), ["doc", "b.css"]); // sorted by start
  assert.equal(w.rows[0].dur, 100);
  assert.equal(w.rows[1].color, requestColor("stylesheet"));
});

test("summarizeRequests: empty input is safe", () => {
  const w = summarizeRequests([], {});
  assert.deepEqual(w.rows, []);
  assert.equal(w.total, 1);
  assert.equal(w.count, 0);
  assert.equal(w.totalBytes, 0);
});

test("pickFilmstrip: evenly spaced, LCP tagged, negatives dropped", () => {
  const frames = [
    { data: "f-neg", rel: -200 }, // before nav → dropped
    { data: "f0", rel: 0 },
    { data: "f1", rel: 500 },
    { data: "f2", rel: 1000 },
    { data: "f3", rel: 1500 },
    { data: "f4", rel: 2000 },
  ];
  const strip = pickFilmstrip(frames, 4, 1000);
  assert.ok(strip.length >= 1 && strip.length <= 4);
  assert.ok(!strip.some((f) => f.data === "f-neg"));
  // exactly one frame tagged as the LCP moment, and it's the one nearest rel=1000
  const lcp = strip.filter((f) => f.isLcp);
  assert.equal(lcp.length, 1);
  assert.equal(lcp[0].rel, 1000);
  assert.deepEqual(strip, [...strip].sort((a, b) => a.rel - b.rel)); // time-ordered
});

test("pickFilmstrip: no frames → empty, no LCP arg → no tag", () => {
  assert.deepEqual(pickFilmstrip([], 6, 1000), []);
  const strip = pickFilmstrip([{ data: "a", rel: 0 }, { data: "b", rel: 100 }], 2, null);
  assert.ok(!strip.some((f) => f.isLcp));
});

test("pickFilmstrip: samples denser near the start (FOUC window) but reaches the end", () => {
  const frames = [];
  for (let t = 0; t <= 2000; t += 50) frames.push({ data: "f" + t, rel: t });
  const strip = pickFilmstrip(frames, 8, null);
  assert.ok(strip.length >= 1 && strip.length <= 9);
  const early = strip.filter((f) => f.rel < 1000).length;
  const late = strip.filter((f) => f.rel >= 1000).length;
  assert.ok(early >= late, `expected more early frames, got early=${early} late=${late}`);
  assert.ok(strip[strip.length - 1].rel >= 1800); // still reaches the end of the load
  assert.deepEqual(strip, [...strip].sort((a, b) => a.rel - b.rel)); // time-ordered
});

// ---- Insights + rich waterfall ----

test("registrableDomain: multi-label TLDs grouped", () => {
  assert.equal(registrableDomain("a.foo.co.id"), "foo.co.id");
  assert.equal(registrableDomain("b.foo.co.id"), "foo.co.id");
  assert.equal(registrableDomain("www.example.com"), "example.com");
  assert.equal(registrableDomain("example.com"), "example.com");
  assert.equal(registrableDomain("cdn.fonts.googleapis.com"), "googleapis.com");
  assert.equal(registrableDomain("localhost"), "localhost");
});

test("requestPhases: splits CDP timing into segments", () => {
  const timing = { requestTime: 100, dnsStart: 0, dnsEnd: 10, connectStart: 10, connectEnd: 40, sslStart: 20, sslEnd: 40, sendStart: 40, sendEnd: 42, receiveHeadersEnd: 150 };
  const ph = requestPhases(timing, 300); // total 300ms from requestTime
  const by = Object.fromEntries(ph.map((p) => [p.name, Math.round(p.ms)]));
  assert.equal(by.dns, 10);
  assert.equal(by.connect, 10); // 40-10 minus ssl(20)
  assert.equal(by.ssl, 20);
  assert.equal(by.send, 2);
  assert.equal(by.wait, 108); // 150-42
  assert.equal(by.download, 150); // 300-150
  // no timing → single total segment
  assert.deepEqual(requestPhases(null, 50), [{ name: "total", ms: 50 }]);
});

test("buildWaterfall: rows carry phases + priority + totals", () => {
  const reqs = [
    { url: "https://x.com/doc", host: "x.com", type: "document", priority: "VeryHigh", protocol: "h2", status: 200, transfer: 14000, start: 0, end: 300, durFromRequestTime: 300, timing: { requestTime: 1, sendStart: 5, sendEnd: 6, receiveHeadersEnd: 120 } },
    { url: "https://x.com/a.js", host: "x.com", type: "script", priority: "High", protocol: "h2", status: 200, transfer: 50000, start: 120, end: 400, durFromRequestTime: 280, timing: null, renderBlocking: true },
  ];
  const w = buildWaterfall(reqs, { limit: 10 });
  assert.equal(w.count, 2);
  assert.equal(w.totalBytes, 64000);
  assert.equal(w.total, 400);
  assert.equal(w.rows[0].priority, "VeryHigh");
  assert.ok(w.rows[0].phases.some((p) => p.name === "wait"));
  assert.equal(w.rows[1].renderBlocking, true);
});

test("lcpBreakdown: image LCP splits into 4 phases summing to total", () => {
  const info = { url: "https://x.com/hero.webp", loadTime: 2800, renderTime: 2900 };
  const req = { url: "https://x.com/hero.webp", start: 500, end: 2800 };
  const lb = lcpBreakdown(420, 2900, info, req);
  assert.equal(lb.kind, "image");
  const by = Object.fromEntries(lb.phases.map((p) => [p.name, Math.round(p.ms)]));
  assert.equal(by.TTFB, 420);
  assert.equal(by["Load delay"], 80); // 500-420
  assert.equal(by["Load duration"], 2300); // 2800-500
  assert.equal(by["Render delay"], 100); // 2900-2800
  assert.ok(Math.abs(lb.phases.reduce((a, p) => a + p.pct, 0) - 100) < 0.01);
  // text LCP → only TTFB + render delay
  const t = lcpBreakdown(420, 1500, null, null);
  assert.equal(t.kind, "text");
  const tb = Object.fromEntries(t.phases.map((p) => [p.name, Math.round(p.ms)]));
  assert.equal(tb["Render delay"], 1080);
});

test("computeInsights: produces render-blocking, third-party, cache, DOM cards", () => {
  const reqs = [
    { url: "https://site.co.id/", host: "site.co.id", type: "document", protocol: "h2", status: 200, transfer: 14000, start: 0, end: 300, headers: { "content-encoding": "br" } },
    { url: "https://site.co.id/app.css", host: "site.co.id", type: "stylesheet", protocol: "h2", status: 200, transfer: 60000, start: 120, end: 900, headers: { "cache-control": "max-age=60" } },
    { url: "https://cdn.other.com/w.js", host: "cdn.other.com", type: "script", protocol: "http/1.1", status: 200, transfer: 120000, start: 130, end: 1200, headers: {}, initiatorUrl: "https://site.co.id/" },
  ];
  const cards = computeInsights({
    vitals: { lcp: 2900, nav: { ttfb: 300 } },
    reqs,
    renderBlockingUrls: ["https://site.co.id/app.css"],
    lcpInfo: null,
    domStats: { nodes: 2200, maxDepth: 40, maxChildren: 12 },
    pageHost: "www.site.co.id",
  });
  const ids = cards.map((c) => c.id);
  assert.ok(ids.includes("render-blocking"));
  assert.ok(ids.includes("third-parties")); // cdn.other.com != site.co.id
  assert.ok(ids.includes("cache")); // app.css max-age=60
  assert.ok(ids.includes("modern-http")); // w.js on http/1.1
  assert.ok(ids.includes("dom-size"));
  assert.ok(ids.includes("doc-latency"));
  // third-party grouping: cdn.other.com → other.com, NOT the page's site.co.id
  const tp = cards.find((c) => c.id === "third-parties");
  assert.ok(tp.items.some((i) => i.label === "other.com"));
  // severity-ordered: bad/warn before info/good
  const order = { bad: 0, warn: 1, info: 2, good: 3 };
  for (let i = 1; i < cards.length; i++) assert.ok(order[cards[i - 1].severity] <= order[cards[i].severity]);
});
