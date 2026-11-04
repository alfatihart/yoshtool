import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTranslateUrl, parseTranslateResponse, TARGET_LANGUAGES } from "../translate-core.js";

test("buildTranslateUrl: encodes query, defaults source to auto", () => {
  const u = buildTranslateUrl("hello world", "id");
  assert.match(u, /^https:\/\/translate\.googleapis\.com\/translate_a\/single\?/);
  assert.match(u, /client=gtx/);
  assert.match(u, /sl=auto/);
  assert.match(u, /tl=id/);
  assert.match(u, /dt=t/);
  assert.match(u, /q=hello%20world/);
  // explicit source + special chars
  assert.match(buildTranslateUrl("café & tea", "en", "fr"), /sl=fr/);
  assert.match(buildTranslateUrl("a&b=c", "en"), /q=a%26b%3Dc/);
});

test("parseTranslateResponse: joins segments + reads detected source", () => {
  const data = [
    [["Halo dunia", "Hello world", null, null, 1], [" lagi", " again", null, null, 1]],
    null,
    "en",
  ];
  assert.deepEqual(parseTranslateResponse(data), { text: "Halo dunia lagi", source: "en" });
});

test("parseTranslateResponse: malformed → empty", () => {
  assert.deepEqual(parseTranslateResponse(null), { text: "", source: "" });
  assert.deepEqual(parseTranslateResponse([]), { text: "", source: "" });
  assert.deepEqual(parseTranslateResponse(["x"]), { text: "", source: "" });
  // non-string chunks are skipped, not crashed on
  assert.deepEqual(parseTranslateResponse([[[null], ["ok", "o"]], null, ""]), { text: "ok", source: "" });
});

test("TARGET_LANGUAGES: has Indonesian & English, all [code,label] pairs", () => {
  const codes = TARGET_LANGUAGES.map((p) => p[0]);
  assert.ok(codes.includes("id") && codes.includes("en"));
  assert.ok(TARGET_LANGUAGES.every((p) => Array.isArray(p) && p.length === 2 && p[0] && p[1]));
});
