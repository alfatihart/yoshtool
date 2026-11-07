import { test } from "node:test";
import assert from "node:assert/strict";
import {
  domainsOf,
  selectorsForHost,
  buildCosmeticCss,
} from "../adblock-cosmetic-core.js";

test("domainsOf returns host + parent domains (minus bare TLD)", () => {
  assert.deepEqual(domainsOf("a.b.example.com"), ["a.b.example.com", "b.example.com", "example.com"]);
  assert.deepEqual(domainsOf("example.com"), ["example.com"]);
  assert.deepEqual(domainsOf("WWW.Example.COM"), ["www.example.com", "example.com"]);
  assert.deepEqual(domainsOf(".example.com."), ["example.com"]);
  assert.deepEqual(domainsOf(""), []);
  assert.deepEqual(domainsOf("localhost"), []); // single label -> no parent
});

test("selectorsForHost merges generic + applicable per-domain, de-duped", () => {
  const data = {
    generic: [".ad", "#banner"],
    specific: {
      "example.com": [".site-ad", ".ad"], // ".ad" dup with generic
      "other.com": [".nope"],
      "sub.example.com": [".sub-only"],
    },
  };
  const got = selectorsForHost(data, "www.example.com").sort();
  assert.deepEqual(got, [".ad", ".site-ad", "#banner"].sort());
  // a deeper host also picks up a matching deeper specific key
  const got2 = selectorsForHost(data, "sub.example.com").sort();
  assert.deepEqual(got2, [".ad", ".site-ad", ".sub-only", "#banner"].sort());
  // unrelated host -> generic only
  assert.deepEqual(selectorsForHost(data, "foo.net").sort(), [".ad", "#banner"].sort());
});

test("selectorsForHost tolerates missing/empty data", () => {
  assert.deepEqual(selectorsForHost(null, "example.com"), []);
  assert.deepEqual(selectorsForHost({}, "example.com"), []);
  assert.deepEqual(selectorsForHost({ generic: [".x"] }, ""), [".x"]);
});

test("buildCosmeticCss produces one display:none rule, or empty", () => {
  assert.equal(buildCosmeticCss([]), "");
  assert.equal(buildCosmeticCss(null), "");
  const css = buildCosmeticCss([".a", "#b"]);
  assert.ok(css.endsWith("{display:none!important}"));
  assert.ok(css.includes(".a"));
  assert.ok(css.includes("#b"));
});

test('selectorsForHost honors ABP "domain.*" keys (any TLD), without leaking to other hosts', () => {
  const data = { generic: [], specific: { "anichin.*": [".ad-x"], "example.com": ["#y"] } };
  assert.deepEqual(selectorsForHost(data, "anichin.foo"), [".ad-x"]);
  assert.deepEqual(selectorsForHost(data, "www.anichin.tv"), [".ad-x"]);
  assert.deepEqual(selectorsForHost(data, "example.com"), ["#y"]);
});
