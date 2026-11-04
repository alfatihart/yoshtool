// darkmode.js
// Lightweight dark mode (Dark Reader "Filter"-style): inverts the page and re-inverts media, so
// most light sites become readable in the dark. Injected on-demand (classic script) and TOGGLE:
// re-injecting restores the page. Before applying, it checks whether the page is ALREADY dark
// (its own dark theme) and, if so, does nothing — avoiding the double-darkening problem. The
// decision uses an inline copy of darkmode-core.js (keep the logic IDENTICAL).
//
// v1 scope: on-demand toggle only (no persistence across reloads — that needs a document_start
// registered injection + host grant, a later add). Known limits: CSS-defined background images and
// canvas/WebGL aren't perfectly handled; a `filter` on <html> can shift some fixed layouts.
(() => {
  const GUARD = "__yoshtoolDarkMode";
  if (window[GUARD]) { window[GUARD].teardown(); return; } // re-inject → toggle off

  const STYLE_ID = "__yoshtool_darkmode_style";
  const MARK = "data-yoshtool-darkmode";
  const Z = 2147483000;

  // ---- inline copy of darkmode-core.js (keep IDENTICAL) ----------------------
  function parseColor(str) {
    if (!str) return null;
    str = String(str).trim().toLowerCase();
    if (str === "transparent") return null;
    let m = str.match(/^rgba?\(([^)]+)\)$/);
    if (m) {
      const p = m[1].split(/[ ,/]+/).map((s) => parseFloat(s)).filter((n) => !Number.isNaN(n));
      if (p.length >= 3) {
        if (p.length >= 4 && p[3] === 0) return null;
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
  // ---- end of inline copy ----------------------------------------------------

  const bgOf = (el) => {
    try { return el ? getComputedStyle(el).backgroundColor : ""; } catch (e) { return ""; }
  };
  // Markup/CSS signals that a site already ships a dark theme. (Luminance alone is unreliable —
  // Dark Reader keeps a curated match list for exactly this; we approximate with a few flags.)
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

  function teardown() {
    const s = document.getElementById(STYLE_ID);
    if (s) s.remove();
    document.querySelectorAll(`[${MARK}="toast"]`).forEach((n) => n.remove());
    try { delete window[GUARD]; } catch (e) { window[GUARD] = undefined; }
    toast("Dark mode off");
  }

  if (isAlreadyDark()) {
    toast("Page already looks dark — left unchanged");
    return; // don't double-darken
  }

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent =
    "html{background:#fafafa!important;filter:invert(1) hue-rotate(180deg)!important}" +
    "img,video,picture,canvas,svg image,[style*=\"background-image\"],[style*=\"background:url\"],[style*=\"background: url\"]," +
    `[${MARK}="toast"]` +
    "{filter:invert(1) hue-rotate(180deg)!important}";
  document.documentElement.appendChild(style);
  toast("Dark mode on");
  window[GUARD] = { teardown };
})();
