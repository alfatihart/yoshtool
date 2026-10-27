import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRGB, rgbToHex, hexToRgb, rgbToHsl, normalizeColor } from "../color.js";

test("rgbToHex", () => {
  assert.equal(rgbToHex(0, 0, 0), "#000000");
  assert.equal(rgbToHex(255, 255, 255), "#ffffff");
  assert.equal(rgbToHex(255, 0, 0), "#ff0000");
  assert.equal(rgbToHex(161, 178, 195), "#a1b2c3");
});

test("hexToRgb (6 & 3 digit, with/without #)", () => {
  assert.deepEqual(hexToRgb("#a1b2c3"), { r: 161, g: 178, b: 195 });
  assert.deepEqual(hexToRgb("a1b2c3"), { r: 161, g: 178, b: 195 });
  assert.deepEqual(hexToRgb("#fff"), { r: 255, g: 255, b: 255 });
  assert.equal(hexToRgb("xyz"), null);
});

test("round-trip hex ↔ rgb", () => {
  for (const hex of ["#000000", "#ffffff", "#ff0000", "#1565c0", "#5d4037"]) {
    const { r, g, b } = hexToRgb(hex);
    assert.equal(rgbToHex(r, g, b), hex);
  }
});

test("parseRGB rgb/rgba", () => {
  assert.deepEqual(parseRGB("rgb(12, 34, 56)"), [12, 34, 56]);
  assert.deepEqual(parseRGB("rgba(12, 34, 56, 0.5)"), [12, 34, 56]);
  assert.equal(parseRGB("transparent"), null);
});

test("rgbToHsl reference points", () => {
  assert.deepEqual(rgbToHsl(0, 0, 0), { h: 0, s: 0, l: 0 });
  assert.deepEqual(rgbToHsl(255, 255, 255), { h: 0, s: 0, l: 100 });
  assert.deepEqual(rgbToHsl(255, 0, 0), { h: 0, s: 100, l: 50 });
  assert.deepEqual(rgbToHsl(0, 255, 0), { h: 120, s: 100, l: 50 });
  assert.deepEqual(rgbToHsl(0, 0, 255), { h: 240, s: 100, l: 50 });
});

test("normalizeColor from hex & rgb", () => {
  assert.deepEqual(normalizeColor("#ff0000"), {
    hex: "#ff0000", rgb: "rgb(255, 0, 0)", hsl: "hsl(0, 100%, 50%)",
  });
  assert.deepEqual(normalizeColor("rgb(255, 0, 0)"), {
    hex: "#ff0000", rgb: "rgb(255, 0, 0)", hsl: "hsl(0, 100%, 50%)",
  });
  assert.equal(normalizeColor("transparent"), null);
});
