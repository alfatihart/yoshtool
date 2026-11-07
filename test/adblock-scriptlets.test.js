import { test } from "node:test";
import assert from "node:assert/strict";
import { domainsOf, scriptletsForHost, SCRIPTLET_NAMES } from "../adblock-scriptlets-core.js";

test("domainsOf yields host + parent domains, excluding the bare TLD", () => {
  assert.deepEqual(domainsOf("a.b.example.com"), ["a.b.example.com", "b.example.com", "example.com"]);
  assert.deepEqual(domainsOf("example.com"), ["example.com"]);
  assert.deepEqual(domainsOf(""), []);
});

test("scriptletsForHost applies generic '*' then matching parent domains, in order", () => {
  const rules = {
    "*": [["abort-on-property-read", "FuckAdBlock"]],
    "example.com": [["set-constant", "adblock", "false"]],
    "ads.example.com": [["nowebrtc"]],
  };
  const r = scriptletsForHost(rules, "ads.example.com");
  // Order: generic "*" first, then domainsOf() most-specific → least-specific
  // (ads.example.com before its parent example.com).
  assert.deepEqual(r, [
    { name: "abort-on-property-read", args: ["FuckAdBlock"] },
    { name: "nowebrtc", args: [] }, // ads.example.com
    { name: "set-constant", args: ["adblock", "false"] }, // parent example.com
  ]);
});

test("scriptletsForHost: a parent-domain rule also applies to subdomains", () => {
  const rules = { "example.com": [["set-constant", "x", "true"]] };
  assert.deepEqual(scriptletsForHost(rules, "sub.example.com"), [
    { name: "set-constant", args: ["x", "true"] },
  ]);
});

test("scriptletsForHost drops unknown scriptlet names and malformed rules", () => {
  const rules = {
    "*": [["not-a-real-scriptlet", "x"], [], "nope", ["set-constant", "a", "1"]],
  };
  assert.deepEqual(scriptletsForHost(rules, "any.test"), [{ name: "set-constant", args: ["a", "1"] }]);
});

test("scriptletsForHost returns [] for empty/invalid rule tables", () => {
  assert.deepEqual(scriptletsForHost(null, "example.com"), []);
  assert.deepEqual(scriptletsForHost({}, "example.com"), []);
  assert.deepEqual(scriptletsForHost({ "other.com": [["nowebrtc"]] }, "example.com"), []);
});

test("every bundled SCRIPTLET_NAME is a non-empty string", () => {
  assert.ok(SCRIPTLET_NAMES.length >= 4);
  for (const n of SCRIPTLET_NAMES) assert.equal(typeof n, "string");
});
