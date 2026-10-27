import { test } from "node:test";
import assert from "node:assert/strict";
import {
  serialize,
  parse,
  detectFormat,
  validateCookie,
  buildCookieUrl,
  resolveCookieHostname,
  toSetDetails,
} from "../cookies.js";

const sample = [
  { name: "a", value: "1", domain: "example.com", path: "/", secure: true, httpOnly: false },
  {
    name: "b",
    value: "2",
    domain: ".example.com",
    path: "/app",
    secure: false,
    httpOnly: true,
    expirationDate: 1999999999,
  },
];

test("round-trip json", () => {
  const text = serialize(sample, "json");
  assert.equal(detectFormat(text), "json");
  assert.deepEqual(parse(text), sample);
});

test("round-trip header (name/value only)", () => {
  const text = serialize(sample, "header");
  assert.equal(text, "a=1; b=2");
  assert.equal(detectFormat(text), "header");
  assert.deepEqual(parse(text), [
    { name: "a", value: "1", domain: "", path: "/" },
    { name: "b", value: "2", domain: "", path: "/" },
  ]);
});

test("round-trip netscape", () => {
  const text = serialize(sample, "netscape");
  assert.equal(detectFormat(text), "netscape");
  const parsed = parse(text);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].domain, "example.com");
  assert.equal(parsed[0].secure, true);
  assert.equal(parsed[0].httpOnly, false);
  assert.equal(parsed[1].domain, ".example.com");
  assert.equal(parsed[1].httpOnly, true);
  assert.equal(parsed[1].expirationDate, 1999999999);
});

test("detectFormat: empty text treated as json", () => {
  assert.equal(detectFormat(""), "json");
});

test("detectFormat: header string not confused with netscape", () => {
  assert.equal(detectFormat("a=1; b=2"), "header");
});

test("validateCookie rejects malformed entries", () => {
  assert.equal(validateCookie({ name: "", value: "1" }), "Cookie name is empty");
  assert.equal(validateCookie({ name: "x" }), "Cookie value is empty");
  assert.equal(validateCookie({ name: "x", value: "1" }), null);
});

test("buildCookieUrl uses fallback hostname when domain is empty", () => {
  const url = buildCookieUrl({ name: "a", value: "1", domain: "", path: "/", secure: true }, "example.com");
  assert.equal(url, "https://example.com/");
});

test("buildCookieUrl forces https for __Secure- cookie even without secure (Header String case)", () => {
  const url = buildCookieUrl(
    { name: "__Secure-better-auth.session_token", value: "x", domain: "", path: "/" },
    "www.example.com",
  );
  assert.equal(url, "https://www.example.com/");
});

test("buildCookieUrl forces https for __Host- cookie", () => {
  const url = buildCookieUrl({ name: "__Host-a", value: "x", domain: "", path: "/" }, "example.com");
  assert.equal(url, "https://example.com/");
});

test("buildCookieUrl stays http for a normal cookie without secure", () => {
  const url = buildCookieUrl({ name: "a", value: "x", domain: "", path: "/" }, "example.com");
  assert.equal(url, "http://example.com/");
});

test("toSetDetails omits domain for a hostOnly cookie", () => {
  const details = toSetDetails(
    { name: "a", value: "1", domain: "example.com", path: "/", hostOnly: true },
    "https://example.com/",
  );
  assert.equal("domain" in details, false);
});

test("toSetDetails includes domain when not hostOnly", () => {
  const details = toSetDetails(
    { name: "a", value: "1", domain: "example.com", path: "/", hostOnly: false },
    "https://example.com/",
  );
  assert.equal(details.domain, "example.com");
});

test("resolveCookieHostname uses the cookie's own domain when present", () => {
  assert.equal(
    resolveCookieHostname({ name: "a", value: "1", domain: "example.com" }, "fallback.test"),
    "example.com",
  );
});

test("resolveCookieHostname uses fallback only when the cookie carries no domain", () => {
  assert.equal(resolveCookieHostname({ name: "a", value: "1", domain: "" }, "fallback.test"), "fallback.test");
  assert.equal(resolveCookieHostname({ name: "a", value: "1" }, "fallback.test"), "fallback.test");
  assert.equal(resolveCookieHostname({ name: "a", value: "1" }, ""), "");
});

test("toSetDetails does NOT pass through storeId (so incognito uses its own store)", () => {
  const details = toSetDetails(
    { name: "a", value: "1", domain: "example.com", path: "/", storeId: "0" },
    "https://example.com/",
  );
  assert.equal("storeId" in details, false);
});

test("toSetDetails uses the explicit target storeId (third arg), not the cookie's", () => {
  const details = toSetDetails(
    { name: "a", value: "1", domain: "example.com", path: "/", storeId: "0" },
    "https://example.com/",
    "1",
  );
  assert.equal(details.storeId, "1");
});

test("toSetDetails passes through partitionKey when present", () => {
  const partitionKey = { topLevelSite: "https://example.com" };
  const details = toSetDetails(
    { name: "a", value: "1", domain: "example.com", path: "/", partitionKey },
    "https://example.com/",
  );
  assert.deepEqual(details.partitionKey, partitionKey);
});

test("toSetDetails enforces __Host- and __Secure- prefix rules", () => {
  const host = toSetDetails(
    { name: "__Host-a", value: "1", domain: "example.com", path: "/sub", secure: false },
    "https://example.com/sub",
  );
  assert.equal(host.secure, true);
  assert.equal(host.path, "/");
  assert.equal("domain" in host, false);

  const secure = toSetDetails(
    { name: "__Secure-a", value: "1", domain: "example.com", path: "/", secure: false },
    "https://example.com/",
  );
  assert.equal(secure.secure, true);
});
