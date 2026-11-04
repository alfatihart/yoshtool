import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseColor, relativeLuminance, isDarkColor,
  rgbToHsl, hslToRgb, remapBackground, remapForeground,
} from "../darkmode-core.js";

test("parseColor: rgb / rgba / hex (+ alpha)", () => {
  assert.deepEqual(parseColor("rgb(255, 255, 255)"), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(parseColor("rgba(18, 18, 18, 0.9)"), { r: 18, g: 18, b: 18, a: 0.9 });
  assert.deepEqual(parseColor("#fff"), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(parseColor("#1a1a1a"), { r: 26, g: 26, b: 26, a: 1 });
  assert.deepEqual(parseColor("rgb(0 0 0)"), { r: 0, g: 0, b: 0, a: 1 });
});

test("parseColor: transparent / empty / garbage → null", () => {
  assert.equal(parseColor("transparent"), null);
  assert.equal(parseColor(""), null);
  assert.equal(parseColor("inherit"), null);
  assert.equal(parseColor(null), null);
});

test("relativeLuminance / isDarkColor", () => {
  assert.ok(Math.abs(relativeLuminance({ r: 255, g: 255, b: 255 }) - 1) < 1e-6);
  assert.equal(relativeLuminance({ r: 0, g: 0, b: 0 }), 0);
  assert.equal(isDarkColor("#121212"), true);
  assert.equal(isDarkColor("#ffffff"), false);
  assert.equal(isDarkColor("#808080"), false);
  assert.equal(isDarkColor("transparent"), false);
});

test("rgbToHsl / hslToRgb round-trip", () => {
  for (const c of [{ r: 255, g: 0, b: 0 }, { r: 26, g: 115, b: 232 }, { r: 128, g: 128, b: 128 }, { r: 0, g: 0, b: 0 }]) {
    const back = hslToRgb(rgbToHsl(c));
    assert.ok(Math.abs(back.r - c.r) <= 1 && Math.abs(back.g - c.g) <= 1 && Math.abs(back.b - c.b) <= 1);
  }
});

test("remapBackground: light → dark, order preserved, dark stays dark", () => {
  const lum = (css) => relativeLuminance(parseColor(css));
  const white = lum(remapBackground("#ffffff"));
  const gray = lum(remapBackground("#f0f0f0"));
  const darkIn = lum(remapBackground("#1a1a1a"));
  assert.ok(white < 0.1, "white background becomes dark"); // #2e2e2e-ish
  assert.ok(white > gray, "brighter original stays relatively lighter (hierarchy preserved, not flipped)");
  assert.ok(darkIn < 0.03, "already-dark stays dark");
  // preserves alpha
  assert.match(remapBackground("rgba(255,255,255,0.5)"), /^rgba\(/);
  assert.equal(remapBackground("transparent"), null);
});

test("remapForeground: dark text → light, light text kept", () => {
  const lum = (css) => relativeLuminance(parseColor(css));
  assert.ok(lum(remapForeground("#000000")) > 0.8, "black text becomes light");
  assert.ok(lum(remapForeground("#333333")) > 0.4, "dark-gray text lightened");
  assert.ok(lum(remapForeground("#ffffff")) > 0.9, "already-light text kept light");
  // hue preserved-ish for links (blue stays blue-ish, just lighter)
  const link = parseColor(remapForeground("rgb(26,115,232)"));
  assert.ok(link.b > link.r && link.b > link.g, "blue link stays blue-dominant");
});
