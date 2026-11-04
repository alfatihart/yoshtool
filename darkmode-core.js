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
