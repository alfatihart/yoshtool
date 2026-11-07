// Tests for picker-core.js (pure helpers). Also round-trips the procedural serializers through
// adblock-procedural-core.js's parser, so the picker can only ever emit selectors the engine parses.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  looksStable,
  stableClasses,
  ruleDomain,
  serializeHasText,
  serializeUpward,
} from "../picker-core.js";
import { parseProcedural, parseValueArg, isProcedural } from "../adblock-procedural-core.js";

test("looksStable keeps authored names, drops hashes", () => {
  // stable (authored) — including short ad-relevant words finder would drop
  for (const t of ["ad", "ads", "ad-banner", "promo", "sponsor", "nav", "header", "sidebar"]) {
    assert.equal(looksStable(t), true, `${t} should be stable`);
  }
  // unstable (auto-generated / hashed)
  for (const t of ["css-1a2b3c", "sc-bdVaJa", "ad_7f3kd", "jsx-349582", "mui-1xyz", "x8ff2", "bdvxkqz", "a", ""]) {
    assert.equal(looksStable(t), false, `${t} should be unstable`);
  }
});

test("stableClasses filters a class list", () => {
  assert.deepEqual(
    stableClasses(["ad-banner", "css-1a2b3c", "promo", "sc-bdVaJa"]),
    ["ad-banner", "promo"],
  );
  assert.deepEqual(stableClasses([]), []);
  assert.deepEqual(stableClasses(undefined), []);
});

test("ruleDomain lowercases and strips a leading www.", () => {
  assert.equal(ruleDomain("www.Example.COM"), "example.com");
  assert.equal(ruleDomain("example.com"), "example.com");
  assert.equal(ruleDomain("sub.example.co.id"), "sub.example.co.id");
  assert.equal(ruleDomain(".example.com."), "example.com");
  assert.equal(ruleDomain(""), "");
});

test("serializeHasText round-trips through the parser (literal)", () => {
  const sel = "div.box" + serializeHasText("Sponsored");
  assert.equal(sel, 'div.box:has-text("Sponsored")');
  assert.equal(isProcedural(sel), true);
  const p = parseProcedural(sel);
  assert.equal(p.subject, "div.box");
  assert.equal(p.ops.length, 1);
  assert.equal(p.ops[0].op, "has-text");
  assert.deepEqual(parseValueArg(p.ops[0].arg), { text: "Sponsored" });
});

test("serializeHasText passes a /regex/ through unquoted", () => {
  const sel = "span" + serializeHasText("/iklan/i");
  assert.equal(sel, "span:has-text(/iklan/i)");
  const p = parseProcedural(sel);
  assert.deepEqual(parseValueArg(p.ops[0].arg), { re: { source: "iklan", flags: "i" } });
});

test("serializeHasText survives parentheses in the literal", () => {
  const sel = "p" + serializeHasText("Ad (sponsored)");
  const p = parseProcedural(sel); // must not choke on the inner parens (quotes protect them)
  assert.ok(p);
  assert.deepEqual(parseValueArg(p.ops[0].arg), { text: "Ad (sponsored)" });
});

test("serializeUpward round-trips (levels and selector)", () => {
  const n = "a.x" + serializeUpward("2");
  assert.equal(n, "a.x:upward(2)");
  assert.equal(parseProcedural(n).ops[0].arg, "2");

  const s = "img" + serializeUpward(".ad-wrap");
  assert.equal(s, "img:upward(.ad-wrap)");
  assert.equal(parseProcedural(s).ops[0].arg, ".ad-wrap");
});
