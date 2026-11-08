import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseColor,
  relativeLuminance,
  isDarkColor,
  parseRgba,
  rgbToHsl,
  hslToRgb,
  darkenBackground,
  lightenText,
  adjustBorder,
} from "../darkmode-core.js";

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

test("parseRgba: keeps alpha", () => {
  assert.deepEqual(parseRgba("rgba(255,255,255,0.1)"), { r: 255, g: 255, b: 255, a: 0.1 });
  assert.deepEqual(parseRgba("rgb(10,20,30)"), { r: 10, g: 20, b: 30, a: 1 });
  assert.deepEqual(parseRgba("transparent"), { r: 0, g: 0, b: 0, a: 0 });
  assert.deepEqual(parseRgba("#ffffff80"), { r: 255, g: 255, b: 255, a: 128 / 255 });
  assert.equal(parseRgba("inherit"), null);
});

test("rgbToHsl / hslToRgb: round-trip and anchors", () => {
  assert.deepEqual(rgbToHsl({ r: 0, g: 0, b: 0 }), { h: 0, s: 0, l: 0 });
  assert.deepEqual(rgbToHsl({ r: 255, g: 255, b: 255 }), { h: 0, s: 0, l: 1 });
  const red = rgbToHsl({ r: 255, g: 0, b: 0 });
  assert.equal(Math.round(red.h), 0);
  assert.equal(red.s, 1);
  assert.equal(red.l, 0.5);
  // round-trip a few colours within rounding tolerance
  for (const c of [{ r: 37, g: 99, b: 235 }, { r: 204, g: 229, b: 255 }, { r: 90, g: 60, b: 20 }]) {
    const back = hslToRgb(rgbToHsl(c));
    assert.ok(Math.abs(back.r - c.r) <= 1 && Math.abs(back.g - c.g) <= 1 && Math.abs(back.b - c.b) <= 1,
      `round-trip ${JSON.stringify(c)} → ${JSON.stringify(back)}`);
  }
});

test("darkenBackground: light bg → dark, hue preserved, dark bg untouched", () => {
  // white → very dark grey
  const w = darkenBackground({ r: 255, g: 255, b: 255 });
  assert.ok(relativeLuminance(w) < 0.03, "white → dark");
  // light blue keeps a blue hue (not flipped to orange like invert+hue-rotate would)
  const lightBlue = { r: 204, g: 229, b: 255 }; // hue ~210
  const db = darkenBackground(lightBlue);
  assert.ok(relativeLuminance(db) < 0.1, "light blue → dark");
  const hue = rgbToHsl(db).h;
  assert.ok(hue > 190 && hue < 230, `blue hue preserved (got ${Math.round(hue)})`);
  // already-dark background → leave it (null)
  assert.equal(darkenBackground({ r: 27, g: 27, b: 27 }), null);
});

test("lightenText: dark text → light, light text untouched", () => {
  const black = lightenText({ r: 0, g: 0, b: 0 });
  assert.ok(relativeLuminance(black) > 0.8, "black text → light");
  // already-light text → null
  assert.equal(lightenText({ r: 240, g: 240, b: 240 }), null);
  // dark-blue text keeps hue, becomes light
  const t = lightenText({ r: 20, g: 40, b: 120 });
  assert.ok(relativeLuminance(t) > 0.6, "dark blue text → light");
  const hue = rgbToHsl(t).h;
  assert.ok(hue > 210 && hue < 250, `text hue preserved (got ${Math.round(hue)})`);
});

test("adjustBorder: light border → mid-dark, dark border untouched", () => {
  const b = adjustBorder({ r: 221, g: 221, b: 221 });
  const l = relativeLuminance(b);
  assert.ok(l > 0.02 && l < 0.15, `border mid-dark (got ${l.toFixed(3)})`);
  assert.equal(adjustBorder({ r: 30, g: 30, b: 30 }), null);
});
