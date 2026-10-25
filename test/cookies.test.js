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

test("round-trip header (hanya nama/value)", () => {
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

test("detectFormat: teks kosong dianggap json", () => {
  assert.equal(detectFormat(""), "json");
});

test("detectFormat: header string tidak tertukar dengan netscape", () => {
  assert.equal(detectFormat("a=1; b=2"), "header");
});

test("validateCookie menolak entri rusak", () => {
  assert.equal(validateCookie({ name: "", value: "1" }), "Nama cookie kosong");
  assert.equal(validateCookie({ name: "x" }), "Value cookie kosong");
  assert.equal(validateCookie({ name: "x", value: "1" }), null);
});

test("buildCookieUrl memakai fallback hostname bila domain kosong", () => {
  const url = buildCookieUrl({ name: "a", value: "1", domain: "", path: "/", secure: true }, "example.com");
  assert.equal(url, "https://example.com/");
});

test("buildCookieUrl memaksa https untuk cookie __Secure- walau secure tak ada (kasus Header String)", () => {
  const url = buildCookieUrl(
    { name: "__Secure-better-auth.session_token", value: "x", domain: "", path: "/" },
    "www.example.com",
  );
  assert.equal(url, "https://www.example.com/");
});

test("buildCookieUrl memaksa https untuk cookie __Host-", () => {
  const url = buildCookieUrl({ name: "__Host-a", value: "x", domain: "", path: "/" }, "example.com");
  assert.equal(url, "https://example.com/");
});

test("buildCookieUrl tetap http untuk cookie biasa tanpa secure", () => {
  const url = buildCookieUrl({ name: "a", value: "x", domain: "", path: "/" }, "example.com");
  assert.equal(url, "http://example.com/");
});

test("toSetDetails tidak menyertakan domain untuk cookie hostOnly", () => {
  const details = toSetDetails(
    { name: "a", value: "1", domain: "example.com", path: "/", hostOnly: true },
    "https://example.com/",
  );
  assert.equal("domain" in details, false);
});

test("toSetDetails menyertakan domain bila bukan hostOnly", () => {
  const details = toSetDetails(
    { name: "a", value: "1", domain: "example.com", path: "/", hostOnly: false },
    "https://example.com/",
  );
  assert.equal(details.domain, "example.com");
});

test("resolveCookieHostname memakai domain cookie sendiri bila ada", () => {
  assert.equal(
    resolveCookieHostname({ name: "a", value: "1", domain: "example.com" }, "fallback.test"),
    "example.com",
  );
});

test("resolveCookieHostname memakai fallback hanya bila cookie tidak membawa domain", () => {
  assert.equal(resolveCookieHostname({ name: "a", value: "1", domain: "" }, "fallback.test"), "fallback.test");
  assert.equal(resolveCookieHostname({ name: "a", value: "1" }, "fallback.test"), "fallback.test");
  assert.equal(resolveCookieHostname({ name: "a", value: "1" }, ""), "");
});

test("toSetDetails TIDAK meneruskan storeId (biar incognito pakai store sendiri)", () => {
  const details = toSetDetails(
    { name: "a", value: "1", domain: "example.com", path: "/", storeId: "0" },
    "https://example.com/",
  );
  assert.equal("storeId" in details, false);
});

test("toSetDetails memakai storeId target eksplisit (arg ketiga), bukan dari cookie", () => {
  const details = toSetDetails(
    { name: "a", value: "1", domain: "example.com", path: "/", storeId: "0" },
    "https://example.com/",
    "1",
  );
  assert.equal(details.storeId, "1");
});

test("toSetDetails meneruskan partitionKey bila ada", () => {
  const partitionKey = { topLevelSite: "https://example.com" };
  const details = toSetDetails(
    { name: "a", value: "1", domain: "example.com", path: "/", partitionKey },
    "https://example.com/",
  );
  assert.deepEqual(details.partitionKey, partitionKey);
});

test("toSetDetails memaksa aturan prefix __Host- dan __Secure-", () => {
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
