import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isProcedural, splitList, parseProcedural, parseValueArg, PROCEDURAL_OPS,
} from "../adblock-procedural-core.js";

test("isProcedural detects procedural operators, not plain CSS (incl. native :has)", () => {
  assert.ok(isProcedural("div:has-text(sponsor)"));
  assert.ok(isProcedural('a:matches-attr("href"=/track/)'));
  assert.ok(isProcedural(".x:upward(2)"));
  assert.ok(!isProcedural(".ad-banner"));
  assert.ok(!isProcedural("div.box > span"));
  assert.ok(!isProcedural("div:has(> .ad)")); // native :has stays plain CSS
});

test("splitList separates plain from procedural", () => {
  const { plain, procedural } = splitList([".ad", "div:has-text(ads)", "#promo", ".x:upward(1)"]);
  assert.deepEqual(plain, [".ad", "#promo"]);
  assert.deepEqual(procedural, ["div:has-text(ads)", ".x:upward(1)"]);
});

test("parseProcedural splits subject + chained ops", () => {
  const p = parseProcedural('div.box:has-text(/sponsored/i):upward(2)');
  assert.equal(p.subject, "div.box");
  assert.deepEqual(p.ops, [
    { op: "has-text", arg: "/sponsored/i" },
    { op: "upward", arg: "2" },
  ]);
});

test("parseProcedural: no leading subject → subject '' (defaults to * at eval time)", () => {
  const p = parseProcedural(":has-text(hello)");
  assert.equal(p.subject, "");
  assert.deepEqual(p.ops, [{ op: "has-text", arg: "hello" }]);
});

test("parseProcedural respects quotes/nested parens/brackets in args", () => {
  const p = parseProcedural('[data-x]:matches-attr("class"=/(a|b)\\d+/):has-text(")(")');
  assert.equal(p.subject, "[data-x]");
  assert.deepEqual(p.ops, [
    { op: "matches-attr", arg: '"class"=/(a|b)\\d+/' },
    { op: "has-text", arg: '")("' },
  ]);
});

test("parseProcedural returns null for plain selectors and unbalanced args", () => {
  assert.equal(parseProcedural(".ad"), null);
  assert.equal(parseProcedural("div:has-text(oops"), null); // unbalanced
  assert.equal(parseProcedural(""), null);
});

test("parseValueArg distinguishes /regex/flags from quoted/bare literals", () => {
  assert.deepEqual(parseValueArg("/spon.*/i"), { re: { source: "spon.*", flags: "i" } });
  assert.deepEqual(parseValueArg('"hello world"'), { text: "hello world" });
  assert.deepEqual(parseValueArg("plain"), { text: "plain" });
  assert.deepEqual(parseValueArg("/x/"), { re: { source: "x", flags: "" } });
});

test("PROCEDURAL_OPS is the expected set", () => {
  assert.deepEqual(PROCEDURAL_OPS, ["has-text", "min-text-length", "matches-css", "matches-attr", "upward"]);
});
