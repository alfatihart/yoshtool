// darkmode.js
// Dark mode, two engines (chosen by window.__yoshtoolDarkModePref, default "dynamic"):
//   • DYNAMIC (default, Dark Reader "Dynamic"-style): walks the page and REMAPS each element's
//     colours — flips LIGHTNESS while keeping hue/saturation, so a white card becomes dark, dark
//     text becomes light, and a light-blue panel stays blue (just dark). Images/video/canvas are
//     NEVER touched, so nothing gets colour-"flipped" the way an invert filter does. A
//     MutationObserver re-processes content added later.
//   • FILTER (fallback): the cheap `filter: invert(1) hue-rotate(180deg)` with media re-inverted —
//     works on sites where the dynamic walk misbehaves, at the cost of flipped photo/brand colours.
//
// Injected on-demand (classic script) and TOGGLE: re-injecting restores the page. Before applying,
// it checks whether the page is ALREADY dark (its own dark theme) and, if so, does nothing — avoiding
// double-darkening. The colour maths is an inline copy of darkmode-core.js (keep IDENTICAL).
//
// v1 scope: on-demand toggle only (no persistence across reloads). Known limits: CSS gradients and
// background-image artwork aren't remapped; inline <svg> colours are left as-is; very large pages
// take a moment to process on the first pass.
(() => {
  const GUARD = "__yoshtoolDarkMode";
  if (window[GUARD]) { window[GUARD].teardown(); return; } // re-inject → toggle off

  const STYLE_ID = "__yoshtool_darkmode_style";
  const MARK = "data-yoshtool-darkmode";
  const PROC = "data-yoshtool-dm"; // "already processed" marker for the dynamic walk
  const Z = 2147483000;
  const mode = window.__yoshtoolDarkModePref === "filter" ? "filter" : "dynamic";

  // ---- inline copy of darkmode-core.js (keep IDENTICAL) ----------------------
  function parseColor(str) {
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
  function parseRgba(str) {
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
  function rgbToHsl({ r, g, b }) {
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
  function hslToRgb({ h, s, l }) {
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
  function darkenBackground(rgb, gate = 0.4) {
    const hsl = rgbToHsl(rgb);
    if (hsl.l <= gate) return null; // already dark enough
    const l = 0.08 + (1 - hsl.l) * 0.15; // white→0.08, light-grey→~0.1, mid→~0.16
    return hslToRgb({ h: hsl.h, s: hsl.s * 0.9, l });
  }
  function lightenText(rgb, gate = 0.5) {
    const hsl = rgbToHsl(rgb);
    if (hsl.l >= gate) return null; // already light
    const l = 0.78 + (1 - hsl.l) * 0.17; // black→0.95, dark-grey→~0.87
    return hslToRgb({ h: hsl.h, s: hsl.s, l });
  }
  function adjustBorder(rgb, gate = 0.4) {
    const hsl = rgbToHsl(rgb);
    if (hsl.l <= gate) return null;
    return hslToRgb({ h: hsl.h, s: hsl.s * 0.8, l: 0.28 });
  }
  // ---- end of inline copy ----------------------------------------------------

  const bgOf = (el) => {
    try { return el ? getComputedStyle(el).backgroundColor : ""; } catch (e) { return ""; }
  };
  const hasDarkMarkup = () => {
    const de = document.documentElement;
    const bd = document.body;
    const sel =
      '[data-theme="dark"],[data-bs-theme="dark"],[data-color-mode="dark"],[data-mode="dark"],.dark,.dark-mode,.theme-dark,.night';
    try {
      if ((de && de.matches && de.matches(sel)) || (bd && bd.matches && bd.matches(sel))) return true;
      const cs = de ? getComputedStyle(de).colorScheme : "";
      if (cs && /\bdark\b/.test(cs) && !/\blight\b/.test(cs)) return true;
    } catch (e) {}
    return false;
  };
  const isAlreadyDark = () => {
    if (hasDarkMarkup()) return true;
    const b = bgOf(document.body);
    const h = bgOf(document.documentElement);
    const c = (parseColor(b) && b) || (parseColor(h) && h) || null; // first non-transparent bg
    return c ? isDarkColor(c) : false; // no explicit bg → treat as light
  };

  const rgbaStr = ({ r, g, b }, a) => (a != null && a < 1 ? `rgba(${r},${g},${b},${a})` : `rgb(${r},${g},${b})`);

  function toast(msg) {
    const t = document.createElement("div");
    t.setAttribute(MARK, "toast");
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

  // ======================= DYNAMIC engine =======================
  const touched = []; // [element, previous inline cssText] — restored on teardown
  let observer = null;
  let flushTimer = 0;
  let pending = [];

  function processEl(el) {
    if (!el || el.nodeType !== 1) return;
    if (el instanceof SVGElement) return; // SVG colour handling is left alone (v1)
    if (el.hasAttribute(PROC) || el.hasAttribute(MARK)) return;
    const tag = el.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "LINK" || tag === "HEAD") return;
    let cs;
    try { cs = getComputedStyle(el); } catch (e) { return; }
    const prev = el.style.cssText;
    let changed = false;

    const bg = parseRgba(cs.backgroundColor);
    if (bg && bg.a > 0) {
      const d = darkenBackground({ r: bg.r, g: bg.g, b: bg.b });
      if (d) { el.style.setProperty("background-color", rgbaStr(d, bg.a), "important"); changed = true; }
    }
    const fg = parseRgba(cs.color);
    if (fg && fg.a > 0) {
      const l = lightenText({ r: fg.r, g: fg.g, b: fg.b });
      if (l) { el.style.setProperty("color", rgbaStr(l, fg.a), "important"); changed = true; }
    }
    if (cs.borderTopStyle && cs.borderTopStyle !== "none" && parseFloat(cs.borderTopWidth) > 0) {
      const bc = parseRgba(cs.borderTopColor);
      if (bc && bc.a > 0) {
        const ab = adjustBorder({ r: bc.r, g: bc.g, b: bc.b });
        if (ab) { el.style.setProperty("border-color", rgbaStr(ab, bc.a), "important"); changed = true; }
      }
    }

    el.setAttribute(PROC, "1");
    if (changed) touched.push([el, prev]);
  }

  function processTree(node) {
    processEl(node);
    let list;
    try { list = node.querySelectorAll ? node.querySelectorAll("*") : []; } catch (e) { return; }
    for (const el of list) processEl(el);
  }

  function flush() {
    flushTimer = 0;
    const batch = pending;
    pending = [];
    for (const n of batch) {
      if (n && n.isConnected) processTree(n);
    }
  }

  function applyDynamic() {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    // color-scheme:dark fixes form controls, scrollbars and default UA colours for free; the html/body
    // defaults cover the page chrome before/around the per-element walk.
    style.textContent =
      ":root{color-scheme:dark!important}" +
      "html{background-color:#1b1b1b!important}" +
      "body{background-color:#1b1b1b!important;color:#e8e6e3!important}";
    (document.head || document.documentElement).appendChild(style);

    processTree(document.body || document.documentElement);

    try {
      observer = new MutationObserver((muts) => {
        for (const m of muts) {
          for (const n of m.addedNodes) if (n && n.nodeType === 1) pending.push(n);
        }
        if (!flushTimer && pending.length) flushTimer = setTimeout(flush, 200);
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) {}
  }

  function teardownDynamic() {
    if (observer) { try { observer.disconnect(); } catch (e) {} observer = null; }
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = 0; }
    pending = [];
    const s = document.getElementById(STYLE_ID);
    if (s) s.remove();
    for (const [el, prev] of touched) {
      try { el.style.cssText = prev; } catch (e) {}
    }
    touched.length = 0;
    try { document.querySelectorAll(`[${PROC}]`).forEach((e) => e.removeAttribute(PROC)); } catch (e) {}
    document.querySelectorAll(`[${MARK}="toast"]`).forEach((n) => n.remove());
    try { delete window[GUARD]; } catch (e) { window[GUARD] = undefined; }
    toast("Dark mode off");
  }

  // ======================= FILTER engine (fallback) =======================
  function applyFilter() {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent =
      "html{background:#fafafa!important;filter:invert(1) hue-rotate(180deg)!important}" +
      "img,video,picture,canvas,svg image,[style*=\"background-image\"],[style*=\"background:url\"],[style*=\"background: url\"]," +
      `[${MARK}="toast"]` +
      "{filter:invert(1) hue-rotate(180deg)!important}";
    document.documentElement.appendChild(style);
  }
  function teardownFilter() {
    const s = document.getElementById(STYLE_ID);
    if (s) s.remove();
    document.querySelectorAll(`[${MARK}="toast"]`).forEach((n) => n.remove());
    try { delete window[GUARD]; } catch (e) { window[GUARD] = undefined; }
    toast("Dark mode off");
  }

  // ======================= apply =======================
  if (isAlreadyDark()) {
    toast("Page already looks dark — left unchanged");
    return; // don't double-darken
  }
  if (mode === "filter") {
    applyFilter();
    window[GUARD] = { teardown: teardownFilter };
    toast("Dark mode on (filter)");
  } else {
    applyDynamic();
    window[GUARD] = { teardown: teardownDynamic };
    toast("Dark mode on");
  }
})();
