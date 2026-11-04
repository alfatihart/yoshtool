// copyunlock.js
// Force-enable text selection, copy / cut / paste, right-click and drag on pages that block
// them. Injected on-demand (classic script) and TOGGLE: re-injecting restores the page's
// behavior. Isolated-world core (enough for the common case): a CSS override (user-select) plus
// capture-phase stopImmediatePropagation on the blocked events, so the page's own canceling
// handler never runs and the BROWSER's default copy/menu/selection proceeds. It does NOT
// preventDefault (that would cancel the real action) and does NOT patch the page's own JS — a
// site that registers a capture-phase handler at document_start can still win (that needs a
// MAIN-world "force mode", a later add).
(() => {
  const GUARD = "__yoshtoolCopyUnlock";
  if (window[GUARD]) { window[GUARD].teardown(); return; } // re-inject → toggle off

  const STYLE_ID = "__yoshtool_copyunlock_style";
  const MARK = "data-yoshtool-copyunlock";
  const Z = 2147483000;

  // 1) CSS override: force selectable text + a visible selection highlight, beating
  //    user-select:none / -webkit-touch-callout:none and a transparent ::selection.
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent =
    "*,*::before,*::after{-webkit-user-select:text!important;-moz-user-select:text!important;" +
    "-ms-user-select:text!important;user-select:text!important;-webkit-touch-callout:default!important}" +
    "::selection{background:Highlight!important;color:HighlightText!important}";
  (document.head || document.documentElement).appendChild(style);

  // 2) Neutralize the page's event cancelers. Capture phase + stopImmediatePropagation means the
  //    page's handler (the one that would call preventDefault) never runs, while the browser
  //    default still happens. Keyboard: only release the clipboard/select shortcuts so the page's
  //    other keyboard handling is left intact.
  const CLIP = /^[cxva]$/i;
  const isClipboardKey = (e) =>
    (e.ctrlKey || e.metaKey) && !e.altKey && typeof e.key === "string" && CLIP.test(e.key);
  const free = (e) => { e.stopImmediatePropagation(); };
  const freeKey = (e) => { if (isClipboardKey(e)) e.stopImmediatePropagation(); };
  const EVENTS = ["copy", "cut", "paste", "contextmenu", "selectstart", "dragstart"];
  for (const t of EVENTS) document.addEventListener(t, free, true);
  document.addEventListener("keydown", freeKey, true);
  document.addEventListener("keyup", freeKey, true);

  // 3) Brief, auto-dismissing confirmation toast (namespaced, self-contained).
  function toast(msg) {
    const t = document.createElement("div");
    t.setAttribute(MARK, "1");
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
    for (const t of EVENTS) document.removeEventListener(t, free, true);
    document.removeEventListener("keydown", freeKey, true);
    document.removeEventListener("keyup", freeKey, true);
    const s = document.getElementById(STYLE_ID);
    if (s) s.remove();
    document.querySelectorAll(`[${MARK}]`).forEach((n) => n.remove());
    try { delete window[GUARD]; } catch { window[GUARD] = undefined; }
    toast("Copy lock restored");
  }

  window[GUARD] = { teardown };
  toast("Copy & selection unlocked ✓");
})();
