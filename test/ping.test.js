import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeTarget, pingStats, pingBadgeText, pingBadgeColor } from "../ping-core.js";

test("normalizeTarget", () => {
  assert.equal(normalizeTarget("8.8.8.8"), "https://8.8.8.8/");
  assert.equal(normalizeTarget("google.com"), "https://google.com/");
  assert.equal(normalizeTarget("https://x.com/a/b?q=1"), "https://x.com/");
  assert.equal(normalizeTarget("http://local.test"), "http://local.test/");
  assert.equal(normalizeTarget("", "https://fallback.com/page"), "https://fallback.com/");
  assert.equal(normalizeTarget("  "), null);
  assert.equal(normalizeTarget("", ""), null);
});

test("pingStats: min/avg/max/jitter/loss", () => {
  const s = pingStats([10, 20, 30]);
  assert.equal(s.count, 3);
  assert.equal(s.ok, 3);
  assert.equal(s.loss, 0);
  assert.equal(s.min, 10);
  assert.equal(s.max, 30);
  assert.equal(s.avg, 20);
  assert.equal(s.jitter, 10); // |20-10|=10, |30-20|=10 → mean 10
});

test("pingStats: loss from nulls, ignores failed in min/avg", () => {
  const s = pingStats([10, null, 30, null]);
  assert.equal(s.count, 4);
  assert.equal(s.ok, 2);
  assert.equal(s.loss, 50);
  assert.equal(s.min, 10);
  assert.equal(s.max, 30);
  assert.equal(s.avg, 20);
});

test("pingStats: all failed / empty", () => {
  const a = pingStats([null, null]);
  assert.equal(a.loss, 100);
  assert.equal(a.min, null);
  assert.equal(a.avg, null);
  const e = pingStats([]);
  assert.equal(e.count, 0);
  assert.equal(e.loss, 0);
  assert.equal(e.min, null);
});

test("pingBadgeText: rounds, caps at 4 chars, '!' on failure", () => {
  assert.equal(pingBadgeText(88.4), "88");
  assert.equal(pingBadgeText(706), "706");
  assert.equal(pingBadgeText(0), "0");
  assert.equal(pingBadgeText(12345), "9k+");
  assert.equal(pingBadgeText(null), "!");
  assert.equal(pingBadgeText(NaN), "!");
});

test("pingBadgeColor: bright text green/amber/red thresholds + red on failure", () => {
  assert.equal(pingBadgeColor(50), "#4ade80");
  assert.equal(pingBadgeColor(99), "#4ade80");
  assert.equal(pingBadgeColor(100), "#fbbf24");
  assert.equal(pingBadgeColor(299), "#fbbf24");
  assert.equal(pingBadgeColor(300), "#f87171");
  assert.equal(pingBadgeColor(null), "#f87171");
});
