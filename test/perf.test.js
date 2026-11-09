import { test } from "node:test";
import assert from "node:assert/strict";
import { THRESHOLDS, rate, fmtDuration, fmtBytes, clsWindows, summarizeNavigation, topResources } from "../perf-core.js";

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
