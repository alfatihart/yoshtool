import { test } from "node:test";
import assert from "node:assert/strict";
import {
  base64UrlDecode, decodeJwt, formatJwt, formatJson, minifyJson,
  base64Encode, base64Decode, urlEncode, urlDecode, applyDevOp, DEV_OPS,
} from "../devtools-core.js";

// A real-shaped JWT: {"alg":"HS256","typ":"JWT"} . {"sub":"123","name":"Budi","iat":1700000000,"exp":1700003600}
const JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
  "eyJzdWIiOiIxMjMiLCJuYW1lIjoiQnVkaSIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjoxNzAwMDAzNjAwfQ." +
  "sig";

test("base64UrlDecode: handles base64url + missing padding + unicode", () => {
  assert.equal(base64UrlDecode("eyJhIjoxfQ"), '{"a":1}'); // no padding
  assert.equal(base64UrlDecode(base64Encode("héllo → ☕").text), "héllo → ☕"); // unicode round-trip
});

test("decodeJwt: valid token → header + payload", () => {
  const d = decodeJwt(JWT);
  assert.equal(d.ok, true);
  assert.equal(d.header.alg, "HS256");
  assert.equal(d.payload.name, "Budi");
  assert.equal(d.payload.exp, 1700003600);
  assert.equal(decodeJwt("notajwt").ok, false);
  assert.equal(decodeJwt("a.b.c").ok, false); // b/a not valid base64 json
});

test("formatJwt: humanizes times + expiry status + decode-only note", () => {
  const r = formatJwt(JWT);
  assert.equal(r.ok, true);
  assert.match(r.text, /"name": "Budi"/);
  assert.match(r.text, /iat: 2023-11-14T/); // 1700000000 → 2023-11-14
  assert.match(r.text, /Status: EXPIRED/); // exp 1700003600 is in the past
  assert.match(r.text, /signature NOT verified/);
});

test("formatJson / minifyJson", () => {
  assert.equal(formatJson('{"a":1,"b":[2,3]}').text, '{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}');
  assert.equal(minifyJson('{ "a" : 1 }').text, '{"a":1}');
  assert.equal(formatJson("{bad}").ok, false);
});

test("base64 encode/decode round-trip (incl. unicode)", () => {
  const enc = base64Encode("Hello, dünya! 🚀");
  assert.equal(enc.ok, true);
  assert.equal(base64Decode(enc.text).text, "Hello, dünya! 🚀");
  assert.equal(base64Decode("====").ok === true || base64Decode("====").ok === false, true); // no throw
});

test("url encode/decode", () => {
  assert.equal(urlEncode("a b&c=d").text, "a%20b%26c%3Dd");
  assert.equal(urlDecode("a%20b%26c%3Dd").text, "a b&c=d");
  assert.equal(urlDecode("%E0%A4%A").ok, false); // malformed
});

test("applyDevOp: dispatch + empty input", () => {
  assert.equal(applyDevOp("json-minify", '{ "x": 1 }').text, '{"x":1}');
  assert.equal(applyDevOp("b64-encode", "hi").text, "aGk=");
  assert.equal(applyDevOp("jwt", JWT).ok, true);
  assert.equal(applyDevOp("anything", "").text, ""); // blank input → empty, no error
  assert.equal(applyDevOp("nope", "x").ok, false);
  assert.ok(DEV_OPS.length >= 7 && DEV_OPS.every((p) => p.length === 2));
});
