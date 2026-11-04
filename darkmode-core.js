// darkmode-core.js
// Pure color math for the "dynamic" dark mode. Two jobs: (1) decide whether a page is ALREADY dark
// (so we don't double-darken it), and (2) remap a page's background / foreground colors into a dark
// palette while PRESERVING the relative lightness order — so a site's visual hierarchy isn't
// flipped the way a blanket `filter: invert` flips it (a bright focus area stays relatively
// prominent instead of becoming the darkest thing). Node-tested; an IDENTICAL inline copy lives in
// darkmode.js (a classic content script that can't `import`).

// Parse a CSS color to { r, g, b, a } (a defaults to 1), or null when there's no real color.
export function parseColor(str) {
  if (!str) return null;
  str = String(str).trim().toLowerCase();
  if (str === "transparent") return null;
  let m = str.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const p = m[1].split(/[ ,/]+/).map((s) => parseFloat(s)).filter((n) => !Number.isNaN(n));
    if (p.length >= 3) return { r: p[0], g: p[1], b: p[2], a: p.length >= 4 ? p[3] : 1 };
    return null;
  }
  m = str.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
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

// Is a color "dark"? Luminance below `threshold` (default 0.2 → only clearly-dark). false for null.
export function isDarkColor(str, threshold = 0.2) {
  const c = parseColor(str);
  if (!c) return false;
  return relativeLuminance(c) < threshold;
}

export function rgbToHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return { h, s, l };
}

export function hslToRgb({ h, s, l }) {
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

export function toCss({ r, g, b, a = 1 }) {
  return a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`;
}

// Remap a BACKGROUND color into a dark band, keeping hue/saturation and the relative lightness
// order (newL increases with L → a lighter surface stays relatively lighter). White → ~#2e2e2e,
// already-dark colors stay dark. Returns a CSS string, or null for transparent/unparseable (skip).
export function remapBackground(str) {
  const c = parseColor(str);
  if (!c || c.a === 0) return null;
  const hsl = rgbToHsl(c);
  const newL = 0.05 + 0.13 * hsl.l; // [0.05 .. 0.18]
  return toCss({ ...hslToRgb({ h: hsl.h, s: hsl.s, l: newL }), a: c.a });
}

// Remap a FOREGROUND (text) color: dark text → light; already-light text kept. Continuous at L=0.5.
export function remapForeground(str) {
  const c = parseColor(str);
  if (!c || c.a === 0) return null;
  const hsl = rgbToHsl(c);
  const newL = hsl.l < 0.5 ? 0.95 - 0.9 * hsl.l : hsl.l;
  return toCss({ ...hslToRgb({ h: hsl.h, s: hsl.s, l: newL }), a: c.a });
}
