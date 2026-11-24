import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyStats,
  dayKey,
  rollDay,
  addDelta,
  blockedSum,
  fmtCount,
} from "../stats-core.js";

test("emptyStats: zeroed shape", () => {
  const s = emptyStats();
  assert.equal(s.day, null);
  assert.deepEqual(s.today, { net: 0, cos: 0, pop: 0, sensor: 0 });
  assert.deepEqual(s.total, { net: 0, cos: 0, pop: 0, sensor: 0 });
});

test("dayKey: local YYYY-MM-DD", () => {
  assert.equal(dayKey(new Date(2026, 10, 19, 13, 5)), "2026-11-19"); // month is 0-based → Nov
  assert.equal(dayKey(new Date(2026, 0, 2)), "2026-01-02");
});

test("rollDay: first run sets the day, keeps zeros", () => {
  const s = rollDay(emptyStats(), "2026-11-19");
  assert.equal(s.day, "2026-11-19");
  assert.equal(s.today.net, 0);
});

test("rollDay: same day keeps today; new day resets today but keeps total", () => {
  let s = rollDay(emptyStats(), "2026-11-19");
  addDelta(s, "net", 5);
  s = rollDay(s, "2026-11-19"); // same day
  assert.equal(s.today.net, 5);
  assert.equal(s.total.net, 5);
  s = rollDay(s, "2026-11-20"); // next day
  assert.equal(s.today.net, 0, "today resets at midnight");
  assert.equal(s.total.net, 5, "lifetime total survives the roll-over");
  assert.equal(s.day, "2026-11-20");
});

test("rollDay: repairs partial/legacy/negative objects", () => {
  const s = rollDay({ day: "2026-11-19", today: { net: -3 }, total: null }, "2026-11-19");
  assert.equal(s.today.net, 0);
  assert.equal(s.today.cos, 0);
  assert.deepEqual(s.total, { net: 0, cos: 0, pop: 0, sensor: 0 });
});

test("addDelta: adds to today + total, ignores non-positive / unknown keys", () => {
  const s = rollDay(emptyStats(), "d");
  addDelta(s, "cos", 3);
  addDelta(s, "cos", 2);
  assert.equal(s.today.cos, 5);
  assert.equal(s.total.cos, 5);
  addDelta(s, "cos", 0);
  addDelta(s, "cos", -4);
  addDelta(s, "cos", 1.9); // floored to 1
  assert.equal(s.total.cos, 6);
  addDelta(s, "bogus", 10);
  assert.equal(s.total.net, 0);
});

test("blockedSum: net+cos+pop, excludes sensor", () => {
  assert.equal(blockedSum({ net: 10, cos: 5, pop: 2, sensor: 100 }), 17);
  assert.equal(blockedSum(null), 0);
});

test("fmtCount: compact formatting", () => {
  assert.equal(fmtCount(0), "0");
  assert.equal(fmtCount(42), "42");
  assert.equal(fmtCount(999), "999");
  assert.equal(fmtCount(1000), "1k");
  assert.equal(fmtCount(1200), "1.2k");
  assert.equal(fmtCount(12000), "12k");
  assert.equal(fmtCount(1300000), "1.3M");
  assert.equal(fmtCount(-5), "0");
});
