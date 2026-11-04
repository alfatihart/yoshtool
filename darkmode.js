// darkmode.js
// Lightweight "dynamic" dark mode (Dark Reader-style, in miniature): instead of a blanket
// `filter: invert` — which flips the page's light/dark hierarchy and turns already-dark bits light
// — it reads each element's own background/text color and remaps the LIGHTNESS into a dark palette
// while preserving the relative order (a brighter surface stays relatively brighter). Images /
// video / canvas are left untouched, so photos keep their real colors. A MutationObserver re-skins
// nodes added later. Injected on-demand (classic script) and TOGGLE: re-injecting restores the
// page. Before applying, it skips pages that are ALREADY dark (their own dark theme).
//
// Known limits: CSS-defined background images/gradients and pseudo-elements aren't remapped (they
// keep their light look); :hover/:focus colors are only remapped at scan time; very large/churny
// pages (web apps) get a brief scan cost. No persistence across reloads yet. Uses an inline copy of
// darkmode-core.js (keep the logic IDENTICAL).
(() => {
  const GUARD = "__yoshtoolDarkMode";
  if (window[GUARD]) { window[GUARD].teardown(); return; } // re-inject → toggle off

  const STYLE_ID = "__yoshtool_darkmode_style";
  const UI = "data-yoshtool-darkmode-ui"; // our own nodes (style/toast) — never skin these
  const DONE = "data-yoshtool-dm"; // elements we've already skinned
  const Z = 2147483000;

  // ---- inline copy of darkmode-core.js (keep IDENTICAL) ----------------------
  function parseColor(str) {
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
  function relativeLuminance({ r, g, b }) {
    const f = (c) => {
      c /= 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }
  function isDarkColor(str, threshold = 0.2) {
    const c = parseColor(str);
    if (!c) return false;
    return relativeLuminance(c) < threshold;
  }
  function rgbToHsl({ r, g, b }) {
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
  function hslToRgb({ h, s, l }) {
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
  function toCss({ r, g, b, a = 1 }) {
    return a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  function remapBackground(str) {
    const c = parseColor(str);
    if (!c || c.a === 0) return null;
    const hsl = rgbToHsl(c);
    const newL = 0.05 + 0.13 * hsl.l;
    return toCss({ ...hslToRgb({ h: hsl.h, s: hsl.s, l: newL }), a: c.a });
  }
  function remapForeground(str) {
    const c = parseColor(str);
    if (!c || c.a === 0) return null;
    const hsl = rgbToHsl(c);
    const newL = hsl.l < 0.5 ? 0.95 - 0.9 * hsl.l : hsl.l;
    return toCss({ ...hslToRgb({ h: hsl.h, s: hsl.s, l: newL }), a: c.a });
  }
  // ---- end of inline copy ----------------------------------------------------

  // ---- already-dark detection (skip, don't double-darken) --------------------
  const bgOf = (el) => { try { return el ? getComputedStyle(el).backgroundColor : ""; } catch (e) { return ""; } };
  const hasDarkMarkup = () => {
    const de = document.documentElement, bd = document.body;
    const sel = '[data-theme="dark"],[data-bs-theme="dark"],[data-color-mode="dark"],[data-mode="dark"],.dark,.dark-mode,.theme-dark,.night';
    try {
      if ((de && de.matches && de.matches(sel)) || (bd && bd.matches && bd.matches(sel))) return true;
      const cs = de ? getComputedStyle(de).colorScheme : "";
      if (cs && /\bdark\b/.test(cs) && !/\blight\b/.test(cs)) return true;
    } catch (e) {}
    return false;
  };
  const isAlreadyDark = () => {
    if (hasDarkMarkup()) return true;
    const c = (parseColor(bgOf(document.body)) && bgOf(document.body)) ||
      (parseColor(bgOf(document.documentElement)) && bgOf(document.documentElement)) || null;
    return c ? isDarkColor(c) : false;
  };

  // ---- skinning --------------------------------------------------------------
  const SKIP_TAGS = new Set(["IMG", "VIDEO", "CANVAS", "SVG", "PICTURE", "IFRAME", "OBJECT", "EMBED", "SCRIPT", "STYLE", "NOSCRIPT", "LINK", "META", "HEAD"]);
  const hasDirectText = (el) => {
    for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) return true;
    return false;
  };
  const skin = (el) => {
    if (!el || el.nodeType !== 1 || el.hasAttribute(DONE) || el.hasAttribute(UI)) return;
    if (SKIP_TAGS.has(el.tagName) || (el.closest && el.closest(`[${UI}]`))) return;
    let cs;
    try { cs = getComputedStyle(el); } catch (e) { return; }
    const nb = remapBackground(cs.backgroundColor);
    if (nb) el.style.setProperty("background-color", nb, "important");
    if (hasDirectText(el)) {
      const nf = remapForeground(cs.color);
      if (nf) el.style.setProperty("color", nf, "important");
    }
    const nbd = remapBackground(cs.borderColor); // reuse bg map → subtle dark borders
    if (nbd && cs.borderStyle && cs.borderStyle !== "none") el.style.setProperty("border-color", nbd, "important");
    el.setAttribute(DONE, "1");
  };
  const skinTree = (root) => {
    try {
      skin(root);
      if (root.querySelectorAll) root.querySelectorAll("*").forEach(skin);
    } catch (e) {}
  };

  // ---- dynamic content (debounced) -------------------------------------------
  let observer = null;
  let pending = [];
  let timer = null;
  const flush = () => {
    timer = null;
    const nodes = pending;
    pending = [];
    for (const n of nodes) skinTree(n);
  };
  const onMutations = (muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) if (n.nodeType === 1) pending.push(n);
    }
    if (pending.length && !timer) timer = setTimeout(flush, 350);
  };

  function toast(msg) {
    const t = document.createElement("div");
    t.setAttribute(UI, "toast");
    t.style.cssText =
      `position:fixed;right:12px;bottom:12px;z-index:${Z + 1};background:#1f2328;color:#e7e9ec;` +
      "padding:9px 13px;border-radius:12px;border:1px solid rgba(255,255,255,.1);box-sizing:border-box;" +
      "font:600 12.5px/1.3 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;" +
      "box-shadow:0 10px 30px rgba(0,0,0,.45);max-width:280px;opacity:0;transition:opacity .2s";
    t.textContent = msg;
    document.documentElement.appendChild(t);
    requestAnimationFrame(() => { t.style.opacity = "1"; });
    setTimeout(() => { t.style.opacity = "0"; setTimeout(() => t.remove(), 250); }, 3200);
  }

  function teardown() {
    if (observer) { observer.disconnect(); observer = null; }
    if (timer) { clearTimeout(timer); timer = null; }
    const s = document.getElementById(STYLE_ID);
    if (s) s.remove();
    // Undo our inline overrides (restores the stylesheet-driven colors).
    document.querySelectorAll(`[${DONE}]`).forEach((el) => {
      el.style.removeProperty("background-color");
      el.style.removeProperty("color");
      el.style.removeProperty("border-color");
      el.removeAttribute(DONE);
    });
    document.querySelectorAll(`[${UI}="toast"]`).forEach((n) => n.remove());
    try { delete window[GUARD]; } catch (e) { window[GUARD] = undefined; }
    toast("Dark mode off");
  }

  if (isAlreadyDark()) {
    toast("Page already looks dark — left unchanged");
    return;
  }

  // Base: a dark canvas for areas we don't paint, plus color-scheme:dark so form controls,
  // scrollbars and UA defaults render dark.
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.setAttribute(UI, "style");
  style.textContent = "html{color-scheme:dark!important;background-color:#141414!important}";
  (document.head || document.documentElement).appendChild(style);

  skinTree(document.documentElement);
  try {
    observer = new MutationObserver(onMutations);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}

  toast("Dark mode on");
  window[GUARD] = { teardown };
})();
