// color.js
// Konversi warna murni (tanpa chrome.*) supaya bisa diuji dengan `node --test` dan
// di-import langsung oleh popup (modul). Dipakai fitur Color picker + palette.

// "rgb(12, 34, 56)" / "rgba(12,34,56,0.5)" → [r,g,b] (alpha diabaikan).
export function parseRGB(str) {
  const nums = String(str || "").match(/-?\d*\.?\d+/g);
  if (!nums || nums.length < 3) return null;
  return nums.slice(0, 3).map((n) => Math.max(0, Math.min(255, Math.round(Number(n)))));
}

export function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join("");
}

export function hexToRgb(hex) {
  let h = String(hex || "").trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// RGB (0–255) → HSL (h 0–360, s 0–100, l 0–100).
export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

// Terima HEX atau rgb()/rgba() → {hex, rgb:"rgb(r, g, b)", hsl:"hsl(h, s%, l%)"} atau null.
export function normalizeColor(input) {
  const s = String(input || "").trim();
  let rgb = null;
  if (/^#?[0-9a-fA-F]{3}$/.test(s) || /^#?[0-9a-fA-F]{6}$/.test(s)) {
    const c = hexToRgb(s);
    if (c) rgb = [c.r, c.g, c.b];
  } else if (/^rg/i.test(s)) {
    rgb = parseRGB(s);
  }
  if (!rgb) return null;
  const [r, g, b] = rgb;
  const { h, s: sat, l } = rgbToHsl(r, g, b);
  return {
    hex: rgbToHex(r, g, b),
    rgb: `rgb(${r}, ${g}, ${b})`,
    hsl: `hsl(${h}, ${sat}%, ${l}%)`,
  };
}
