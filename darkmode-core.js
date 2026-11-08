// darkmode-core.js
// Pure color helpers for the dark-mode "is this page already dark?" check — so YoshTool doesn't
// double-darken a site that already has its own dark theme. Node-tested; an IDENTICAL inline copy
// lives in darkmode.js (a classic content script that can't `import`).

// Parse a CSS color string to { r, g, b } (0–255), or null when there's no real color.
// getComputedStyle returns rgb()/rgba(), so those are the cases that matter; hex is handled too.
export function parseColor(str) {
  if (!str) return null;
  str = String(str).trim().toLowerCase();
  if (str === "transparent") return null;
  let m = str.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const p = m[1].split(/[ ,/]+/).map((s) => parseFloat(s)).filter((n) => !Number.isNaN(n));
    if (p.length >= 3) {
      if (p.length >= 4 && p[3] === 0) return null; // fully transparent → no color
      return { r: p[0], g: p[1], b: p[2] };
    }
    return null;
  }
  m = str.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  }
  return null;
}

// WCAG relative luminance, 0 (black) … 1 (white).
export function relativeLuminance({ r, g, b }) {
  const f = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

// Is a color "dark"? Luminance below `threshold` (default 0.2 → only clearly-dark backgrounds).
// Returns false for null/unparseable/transparent (so a page with no explicit bg reads as light).
export function isDarkColor(str, threshold = 0.2) {
  const c = parseColor(str);
  if (!c) return false;
  return relativeLuminance(c) < threshold;
}

// ============================================================================
// Dynamic dark mode — per-element colour REMAP (not an invert filter).
// Keeps hue & saturation, flips LIGHTNESS: a light background becomes dark, dark
// text becomes light. Images/photos are never touched by the engine, so nothing
// gets "inverted"/colour-flipped the way `filter: invert()` does.
// ============================================================================

// Parse a CSS colour to { r, g, b, a } (a = 0..1). Like parseColor but keeps alpha, so the engine
// can preserve translucency (a faint rgba(255,255,255,.1) overlay must not become a solid block).
export function parseRgba(str) {
  if (!str) return null;
  str = String(str).trim().toLowerCase();
  if (str === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  let m = str.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const p = m[1].split(/[ ,/]+/).map((s) => parseFloat(s)).filter((n) => !Number.isNaN(n));
    if (p.length >= 3) return { r: p[0], g: p[1], b: p[2], a: p.length >= 4 ? p[3] : 1 };
    return null;
  }
  m = str.match(/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a };
  }
  return null;
}

// RGB (0–255) → HSL (h 0–360, s/l 0–1).
export function rgbToHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return { h: h * 360, s, l };
}

// HSL (h 0–360, s/l 0–1) → RGB (0–255, rounded).
export function hslToRgb({ h, s, l }) {
  h = ((h % 360) + 360) % 360 / 360;
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

// Remap a BACKGROUND colour for dark mode. Light backgrounds (lightness above the gate) are flipped
// into a dark band, keeping hue (a light-blue panel stays blue, just dark). Already-dark backgrounds
// return null (leave them alone → no double-darkening of dark sections). gate default 0.4.
export function darkenBackground(rgb, gate = 0.4) {
  const hsl = rgbToHsl(rgb);
  if (hsl.l <= gate) return null; // already dark enough
  const l = 0.08 + (1 - hsl.l) * 0.15; // white→0.08, light-grey→~0.1, mid→~0.16
  return hslToRgb({ h: hsl.h, s: hsl.s * 0.9, l });
}

// Remap a TEXT/foreground colour. Dark text (below gate) is flipped into a light band, keeping hue.
// Already-light text returns null (leave it). gate default 0.5.
export function lightenText(rgb, gate = 0.5) {
  const hsl = rgbToHsl(rgb);
  if (hsl.l >= gate) return null; // already light
  const l = 0.78 + (1 - hsl.l) * 0.17; // black→0.95, dark-grey→~0.87
  return hslToRgb({ h: hsl.h, s: hsl.s, l });
}

// Remap a BORDER colour to a mid-dark tone that stays visible on a dark background. Light borders
// only; dark borders return null.
export function adjustBorder(rgb, gate = 0.4) {
  const hsl = rgbToHsl(rgb);
  if (hsl.l <= gate) return null;
  return hslToRgb({ h: hsl.h, s: hsl.s * 0.8, l: 0.28 });
}
