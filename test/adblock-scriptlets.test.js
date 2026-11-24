import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("nofab is a known scriptlet (safe anti-adblock neuter, no throwing getter)", () => {
  assert.ok(SCRIPTLET_NAMES.includes("nofab"));
  assert.deepEqual(scriptletsForHost({ "*": [["nofab"]] }, "shopee.co.id"), [{ name: "nofab", args: [] }]);
});

// Regression guard: the YouTube scriptlet must NOT tamper with the player response at all. Any pruning
// of the ad descriptors (inline-literal trap, JSON.parse, fetch(.json) or XHR) is detected by YouTube's
// anti-adblock enforcement, which then refuses to serve the stream (videoplayback → 403 /
// ERR_NAME_NOT_RESOLVED / black video). It may only auto-dismiss the enforcement modal (DOM-only).
test("youtubeAds does not tamper with the YouTube player response", () => {
  const src = readFileSync(new URL("../adblock-scriptlets.js", import.meta.url), "utf8");
  const start = src.indexOf("function youtubeAds");
  const end = src.indexOf("function nowebrtc", start);
  assert.ok(start >= 0 && end > start, "youtubeAds body found");
  // Strip line comments so the explanatory note (which names the old patterns) doesn't trip the guard.
  const body = src.slice(start, end).replace(/\/\/[^\n]*/g, "");
  assert.ok(!/ytInitialPlayerResponse/.test(body), "must not trap ytInitialPlayerResponse");
  assert.ok(!/Response\.prototype\.json/.test(body), "must not override Response.prototype.json");
  assert.ok(!/\bJSON\.parse\s*=/.test(body), "must not override the global JSON.parse");
  assert.ok(!/JSON\.stringify/.test(body), "must not re-serialize the response");
  assert.ok(!/XMLHttpRequest\.prototype/.test(body), "must not hook XHR responseText/response");
  assert.ok(!/google_ad_status/.test(body), "must not spoof google_ad_status");
  assert.ok(!/\bdelete\b/.test(body), "must not delete any player-response keys");
  // The one safe thing it still does: auto-dismiss the enforcement modal.
  assert.ok(/enforcement-message-view-model/.test(body), "keeps the DOM-only nag auto-dismiss");
});
