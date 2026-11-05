import { test } from "node:test";
import assert from "node:assert/strict";
import {
  desiredRulesets,
  rulesetDiff,
  normalizeHost,
  isBlockableHost,
  withHost,
  withoutHost,
  buildAllowRules,
  RULESET_ADS,
  RULESET_TRACKERS,
  RULESET_REDIRECT,
  ALLOW_ID_START,
  prepareExtendedRules,
  EXTENDED_ID_START,
} from "../adblock-core.js";

test("desiredRulesets maps prefs to ruleset ids", () => {
  assert.deepEqual(desiredRulesets({ ads: false, trackers: false }), []);
  assert.deepEqual(desiredRulesets({ ads: true, trackers: false }), [RULESET_ADS]);
  assert.deepEqual(desiredRulesets({ ads: false, trackers: true }), [RULESET_TRACKERS]);
  assert.deepEqual(desiredRulesets({ ads: true, trackers: true }), [RULESET_ADS, RULESET_TRACKERS]);
  assert.deepEqual(desiredRulesets(), []);
  // redirect ruleset: only when all-sites is granted AND some blocking is on
  assert.deepEqual(desiredRulesets({ ads: true, redirectGranted: true }), [RULESET_ADS, RULESET_REDIRECT]);
  assert.deepEqual(desiredRulesets({ ads: true, trackers: true, redirectGranted: true }), [RULESET_ADS, RULESET_TRACKERS, RULESET_REDIRECT]);
  assert.deepEqual(desiredRulesets({ ads: false, trackers: false, redirectGranted: true }), []);
  assert.deepEqual(desiredRulesets({ trackers: true, redirectGranted: false }), [RULESET_TRACKERS]);
});

test("rulesetDiff enables/disables only our rulesets", () => {
  assert.deepEqual(rulesetDiff(["ads"], []), { enable: ["ads"], disable: [] });
  assert.deepEqual(rulesetDiff([], ["ads"]), { enable: [], disable: ["ads"] });
  assert.deepEqual(rulesetDiff(["ads", "trackers"], ["ads"]), { enable: ["trackers"], disable: [] });
  // an unrelated ruleset enabled by some other feature is never disabled by us
  assert.deepEqual(rulesetDiff(["ads"], ["other", "trackers"]), { enable: ["ads"], disable: ["trackers"] });
  assert.deepEqual(rulesetDiff(["ads"], ["ads"]), { enable: [], disable: [] });
});

test("normalizeHost strips scheme/port/path and lowercases", () => {
  assert.equal(normalizeHost("https://www.Example.com/path?x=1"), "www.example.com");
  assert.equal(normalizeHost("Example.COM:8080/x"), "example.com");
  assert.equal(normalizeHost("sub.example.co.id"), "sub.example.co.id");
  assert.equal(normalizeHost("example.com."), "example.com");
  assert.equal(normalizeHost(""), "");
  assert.equal(normalizeHost("   "), "");
  assert.equal(normalizeHost("chrome://extensions"), "");
});

test("isBlockableHost accepts real hosts, rejects junk", () => {
  assert.ok(isBlockableHost("example.com"));
  assert.ok(isBlockableHost("a.b.co.id"));
  assert.ok(!isBlockableHost(""));
  assert.ok(!isBlockableHost("localhost")); // no dot
  assert.ok(!isBlockableHost("a..b.com"));
  assert.ok(!isBlockableHost("has space.com"));
});

test("withHost / withoutHost normalize, de-dupe, sort", () => {
  let l = withHost([], "https://Foo.com/x");
  assert.deepEqual(l, ["foo.com"]);
  l = withHost(l, "bar.com");
  l = withHost(l, "FOO.com"); // dup after normalize
  assert.deepEqual(l, ["bar.com", "foo.com"]);
  l = withoutHost(l, "https://foo.com/");
  assert.deepEqual(l, ["bar.com"]);
  // junk is dropped
  assert.deepEqual(withHost(["ok.com"], "chrome://x"), ["ok.com"]);
});

test("prepareExtendedRules normalizes raw input into dynamic block rules", () => {
  const raw = [
    { id: 1, action: { type: "block" }, condition: { urlFilter: "||a.com^" }, metadata: { x: 1 } }, // dummy -> dropped
    { id: 2, action: { type: "block" }, condition: { urlFilter: "||b.com^" } },
    { id: 3, action: { type: "allow" }, condition: { urlFilter: "||c.com^" } }, // non-block -> dropped
    { id: 4, action: { type: "block" }, condition: { regexFilter: "d" } }, // regex -> dropped
    { id: 5, action: { type: "block" }, condition: { urlFilter: "||e.com^" }, priority: 7 },
    { id: 6, action: { type: "block" }, condition: {} }, // no matchable field -> dropped
  ];
  const out = prepareExtendedRules(raw, EXTENDED_ID_START, 1000);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((r) => r.condition.urlFilter), ["||b.com^", "||e.com^"]);
  assert.equal(out[0].id, EXTENDED_ID_START);
  assert.equal(out[1].id, EXTENDED_ID_START + 1);
  assert.equal(out[1].priority, 7);
  assert.ok(out.every((r) => r.action.type === "block"));
  // cap is honored; bad input is safe
  assert.equal(prepareExtendedRules(raw, EXTENDED_ID_START, 1).length, 1);
  assert.deepEqual(prepareExtendedRules(null), []);
  assert.deepEqual(prepareExtendedRules("nope"), []);
});

test("buildAllowRules makes permission-free allowAllRequests rules in the reserved id range", () => {
  const rules = buildAllowRules(["https://a.com/x", "b.com", "a.com", "bad host"]);
  assert.equal(rules.length, 2); // a.com (deduped) + b.com; "bad host" rejected
  for (const r of rules) {
    assert.equal(r.action.type, "allowAllRequests");
    assert.deepEqual(r.condition.resourceTypes, ["main_frame", "sub_frame"]);
    assert.equal(r.condition.requestDomains.length, 1);
    assert.ok(r.id >= ALLOW_ID_START);
    assert.ok(r.priority >= 1000);
  }
  assert.deepEqual(rules.map((r) => r.condition.requestDomains[0]), ["a.com", "b.com"]);
  // unique ids
  assert.equal(new Set(rules.map((r) => r.id)).size, rules.length);
});
