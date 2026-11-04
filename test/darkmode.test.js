import { test } from "node:test";
import assert from "node:assert/strict";
import { parseColor, relativeLuminance, isDarkColor } from "../darkmode-core.js";

test("parseColor: rgb / rgba / hex", () => {
  assert.deepEqual(parseColor("rgb(255, 255, 255)"), { r: 255, g: 255, b: 255 });
  assert.deepEqual(parseColor("rgba(18, 18, 18, 0.9)"), { r: 18, g: 18, b: 18 });
  assert.deepEqual(parseColor("#fff"), { r: 255, g: 255, b: 255 });
  assert.deepEqual(parseColor("#1a1a1a"), { r: 26, g: 26, b: 26 });
  assert.deepEqual(parseColor("rgb(0 0 0)"), { r: 0, g: 0, b: 0 }); // space-separated
});

test("parseColor: transparent / empty / garbage → null", () => {
  assert.equal(parseColor("transparent"), null);
  assert.equal(parseColor("rgba(0,0,0,0)"), null); // fully transparent
  assert.equal(parseColor(""), null);
  assert.equal(parseColor("inherit"), null);
  assert.equal(parseColor(null), null);
});

test("relativeLuminance: anchors", () => {
  assert.ok(Math.abs(relativeLuminance({ r: 255, g: 255, b: 255 }) - 1) < 1e-6); // white
  assert.equal(relativeLuminance({ r: 0, g: 0, b: 0 }), 0); // black
  const mid = relativeLuminance({ r: 128, g: 128, b: 128 });
  assert.ok(mid > 0.2 && mid < 0.25); // mid gray ≈ 0.215
});

test("isDarkColor: dark backgrounds flagged, light ones not", () => {
  assert.equal(isDarkColor("#121212"), true); // common dark theme bg
  assert.equal(isDarkColor("rgb(26,26,26)"), true);
  assert.equal(isDarkColor("#1f2328"), true);
  assert.equal(isDarkColor("#ffffff"), false); // white page
  assert.equal(isDarkColor("rgb(250,250,250)"), false);
  assert.equal(isDarkColor("transparent"), false); // no color → not dark
  assert.equal(isDarkColor("#808080"), false); // mid gray → not "already dark"
  // threshold override
  assert.equal(isDarkColor("#808080", 0.3), true);
});
