// selection-helper.js
// When the user selects text, a small floating pill appears near the selection with quick actions
// — Translate and Font — so those tools are one click away without the right-click menu. Registered
// dynamically on all sites (document_idle) only while the "Selection helper" toggle is on and the
// all-sites permission is granted (see background.syncSelectionHelper). Translate is done by the
// background service worker (CORS-exempt); Font is computed in-page (getComputedStyle + a canvas
// actual-font check). All UI is namespaced and self-contained.
(() => {
  if (window.__yoshtoolSelHelper) return;
  window.__yoshtoolSelHelper = true;

  const UI = "data-yoshtool-selhelper";
  const Z = 2147483000;
  let active = true;
  let pill = null;
  let tip = null;
  let anchor = null; // last selection info, so the pill can follow the selection on scroll
  let mode = null; // "selection" | "field"
  let fieldEl = null; // the focused form field (field mode)
  let target = "id";
  let hideTimer = 0; // auto-hide timer for the selection pill

  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // After the extension is reloaded/updated, content scripts already in open tabs are orphaned —
  // chrome.runtime is dead. Detect that so we can tell the user to reload the page instead of
  // showing a confusing "unavailable".
  const contextAlive = () => { try { return !!(chrome.runtime && chrome.runtime.id); } catch (e) { return false; } };
  const STALE = "YoshTool was updated — reload the page.";
  const inOwnUi = (node) => {
    try {
      const el = node && node.nodeType === 1 ? node : node && node.parentElement;
      return !!(el && el.closest && el.closest(`[${UI}]`));
    } catch (e) { return false; }
  };

  function selectionInfo() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return null;
    if (inOwnUi(sel.anchorNode) || inOwnUi(sel.focusNode)) return null;
    const text = sel.toString().trim();
    if (!text) return null;
    let range, rect, el, endRect;
    try {
      range = sel.getRangeAt(0);
      rect = range.getBoundingClientRect();
      // Caret rect at the END of the selection (where the drag finished). The pill anchors here
      // and sits just below it, so its position is dynamic AND clear of native selection toolbars
      // (ChatGPT/Claude/etc. place theirs centered ABOVE the selection).
      const endR = range.cloneRange();
      endR.collapse(false);
      let er = endR.getBoundingClientRect();
      if (!er || (!er.width && !er.height && !er.top && !er.left)) {
        const list = endR.getClientRects();
        if (list && list.length) er = list[list.length - 1];
      }
      endRect = (er && (er.width || er.height || er.top || er.left))
        ? er
        : { left: rect.right, right: rect.right, top: rect.top, bottom: rect.bottom, width: 0, height: rect.height };
      el = range.commonAncestorContainer;
      if (el && el.nodeType === 3) el = el.parentElement;
    } catch (e) { return null; }
    if (!rect || (rect.width === 0 && rect.height === 0)) return null;
    return { text, rect, endRect, el };
  }

  // ---- compact "actual font" detection (canvas compare, from fontinspector) --
  const canvas = document.createElement("canvas");
  canvas.width = 200; canvas.height = 40;
  const cctx = canvas.getContext("2d", { willReadFrequently: true });
  const SAMPLE = "mmmlliWWWabcABC012";
  function renderData(family) {
    cctx.clearRect(0, 0, 200, 40);
    cctx.textBaseline = "top";
    cctx.font = `22px ${family}`;
    cctx.fillText(SAMPLE, 0, 8);
    return cctx.getImageData(0, 0, 200, 40).data;
  }
  function sameData(a, b) {
    for (let i = 0; i < a.length; i += 4) { if (a[i + 3] !== b[i + 3] || a[i] !== b[i]) return false; }
    return true;
  }
  const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded|math|emoji|-apple-system|blinkmacsystemfont|inherit|initial)$/i;
  function fontExists(name) {
    try { return sameData(renderData(`"${name}", serif`), renderData(`"${name}", sans-serif`)); }
    catch (e) { return false; }
  }
  function actualFont(stack) {
    const fonts = stack.split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    for (const f of fonts) { if (GENERIC.test(f)) return f; if (fontExists(f)) return f; }
    return fonts[0] || "?";
  }

  // ---- UI --------------------------------------------------------------------
  const style = (el, css) => { el.style.cssText = css; };
  function removeTip() { if (tip) { tip.remove(); tip = null; } }
  function clearHideTimer() { if (hideTimer) { clearTimeout(hideTimer); hideTimer = 0; } }
  function removeAll() { clearHideTimer(); removeTip(); if (pill) { pill.remove(); pill = null; } anchor = null; mode = null; fieldEl = null; }

  // Auto-hide (selection pill only): fade it out if you don't use it, so text selected just for
  // copying / documentation / a screenshot isn't left with a toolbar sitting over it. Hovering the
  // pill cancels the timer; taking an action (which opens the result tip) cancels it too.
  const HIDE_MS = 3000; // after the pill appears
  const HIDE_MS_HOVER = 1200; // after the cursor leaves the pill
  function scheduleHide(ms) {
    clearHideTimer();
    hideTimer = setTimeout(fadeOutPill, ms);
  }
  function fadeOutPill() {
    hideTimer = 0;
    if (!pill || tip) return; // an action opened the tip → keep everything up
    pill.style.opacity = "0";
    pill.style.transform = "translateY(-3px)";
    setTimeout(() => { if (pill && pill.style.opacity === "0") removeAll(); }, 180);
  }

  // Place the SELECTION pill just below the selection end (flips above only when there's no room),
  // so it stays clear of native selection toolbars that appear centered ABOVE the text.
  function placePill(a) {
    if (!pill || !a) return;
    const w = pill.offsetWidth, h = pill.offsetHeight, gap = 6;
    const left = Math.max(8, Math.min(a.left + 2, window.innerWidth - w - 10));
    let top = a.bottom + gap;
    if (top + h > window.innerHeight - 8) top = Math.max(8, a.top - h - gap);
    pill.style.left = left + "px";
    pill.style.top = top + "px";
  }

  // Place the FIELD ("Fill form") pill OUTSIDE the field, hugging its TOP-RIGHT corner — above the
  // input (right-aligned) so it clears both the field's label (top-left) and any password-manager
  // icon (inside-right). Flips just below the field only if there's no room above.
  function placeFieldPill(a) {
    if (!pill || !a) return;
    const w = pill.offsetWidth, h = pill.offsetHeight, gap = 2;
    const left = Math.max(8, Math.min(a.right - w, window.innerWidth - w - 8));
    let top = a.top - h - gap;
    if (top < 2) top = a.bottom + gap; // no room above (field at the very top) → drop below
    top = Math.max(2, Math.min(top, window.innerHeight - h - 8));
    pill.style.left = left + "px";
    pill.style.top = top + "px";
  }

  function mkTip() {
    removeTip();
    tip = document.createElement("div");
    tip.setAttribute(UI, "tip");
    style(tip,
      `position:fixed;z-index:${Z + 2};max-width:340px;background:#1f2328;color:#e7e9ec;box-sizing:border-box;` +
      "padding:10px 12px;border-radius:12px;border:1px solid rgba(255,255,255,.12);" +
      "font:13px/1.45 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;box-shadow:0 12px 34px rgba(0,0,0,.5)");
    document.documentElement.appendChild(tip);
    return tip;
  }

  function positionBelow(anchorRect, box) {
    const w = box.offsetWidth, h = box.offsetHeight;
    let left = Math.max(8, Math.min(anchorRect.left, window.innerWidth - w - 10));
    let top = anchorRect.bottom + 8;
    if (top + h > window.innerHeight - 8) top = Math.max(8, anchorRect.top - h - 8);
    box.style.left = left + "px";
    box.style.top = top + "px";
  }

  // Place the result tip below the selection, then nudge it clear of the pill. For a SHORT selection
  // (e.g. the word "overview") the pill — anchored at the selection end — and the tip — anchored at
  // the selection start — land at the same spot, so the pill (higher z-index) covers the result.
  // When they'd overlap, drop the tip just below the pill instead (flips above only if there's no
  // room). For a wide selection the two anchors are far apart, so there's no overlap and nothing moves.
  function positionTip(info, box) {
    positionBelow(info.rect, box);
    if (!pill) return;
    const p = pill.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    const clear = b.right <= p.left || b.left >= p.right || b.bottom <= p.top || b.top >= p.bottom;
    if (clear) return;
    const h = box.offsetHeight, gap = 6;
    let top = p.bottom + gap;
    if (top + h > window.innerHeight - 8) top = Math.max(8, p.top - h - gap);
    box.style.top = top + "px";
  }

  function doTranslate(info) {
    const t = mkTip();
    if (!contextAlive()) { t.innerHTML = `<div style="color:#f4a3a0">${STALE}</div>`; positionTip(info, t); return; }
    t.textContent = "Translating…";
    positionTip(info, t);
    const text = info.text.slice(0, 5000);
    try {
      chrome.runtime.sendMessage({ cmd: "translate", text }, (res) => {
        void chrome.runtime.lastError;
        if (!tip) return;
        if (!res || !res.ok) {
          tip.innerHTML = `<div style="color:#f4a3a0">${esc((res && res.error) || "Translation unavailable")}</div>`;
          positionTip(info, tip);
          return;
        }
        tip.innerHTML = "";
        const head = document.createElement("div");
        style(head, "display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:5px");
        const lang = document.createElement("span");
        style(lang, "font-size:11px;color:#9aa1ab;text-transform:uppercase;letter-spacing:.4px");
        lang.textContent = (res.source || "auto") + " → " + target;
        const copy = document.createElement("button");
        copy.setAttribute(UI, "btn");
        copy.textContent = "Copy";
        style(copy, "appearance:none;border:0;border-radius:7px;padding:3px 9px;cursor:pointer;background:#157c69;color:#fff;font:600 11.5px system-ui,sans-serif");
        copy.addEventListener("click", async (e) => {
          e.stopPropagation();
          try { await navigator.clipboard.writeText(res.text); copy.textContent = "Copied ✓"; setTimeout(() => { copy.textContent = "Copy"; }, 1400); } catch (err) {}
        });
        head.append(lang, copy);
        const body = document.createElement("div");
        body.textContent = res.text;
        tip.append(head, body);
        positionTip(info, tip);
      });
    } catch (e) {
      t.innerHTML = `<div style="color:#f4a3a0">${contextAlive() ? "Translation unavailable" : STALE}</div>`;
    }
  }

  function doFont(info) {
    const t = mkTip();
    const el = info.el || document.body;
    let cs;
    try { cs = getComputedStyle(el); } catch (e) { t.textContent = "Can't read font here."; positionTip(info, t); return; }
    const actual = actualFont(cs.fontFamily);
    t.innerHTML =
      `<div style="font-weight:700;margin-bottom:3px">${esc(actual)}</div>` +
      `<div style="color:#9aa1ab;font-size:12px">${esc(cs.fontSize)} · ${esc(cs.fontWeight)} · ${esc(cs.fontStyle)} · lh ${esc(cs.lineHeight)}</div>` +
      `<div style="margin-top:4px;color:#8b93a0;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(cs.fontFamily)}</div>`;
    positionTip(info, t);
  }

  // Compact icon-only buttons (names live in the title tooltip) so the pill blocks less content.
  const svgIcon = (paths) =>
    `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none">${paths}</svg>`;
  const ICON = {
    translate: svgIcon('<path d="M5 8l6 6"></path><path d="M4 14l6-6 2-3"></path><path d="M2 5h12"></path><path d="M22 22l-5-10-5 10"></path><path d="M14 18h6"></path>'),
    font: svgIcon('<polyline points="4 7 4 4 20 4 20 7"></polyline><line x1="9" y1="20" x2="15" y2="20"></line><line x1="12" y1="4" x2="12" y2="20"></line>'),
    fill: svgIcon('<path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path>'),
    form: svgIcon('<rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M7 9h10M7 13h10M7 17h6"></path>'),
  };
  function makePill(buttons) {
    if (pill) pill.remove();
    pill = document.createElement("div");
    pill.setAttribute(UI, "pill");
    style(pill,
      `position:fixed;z-index:${Z + 3};display:flex;gap:1px;background:#1f2328;border:1px solid rgba(255,255,255,.14);` +
      "border-radius:8px;padding:2px;box-shadow:0 6px 20px rgba(0,0,0,.4);opacity:1;transition:opacity .16s ease,transform .16s ease");
    // Hovering the pill keeps it alive; leaving it (in selection mode) restarts a short hide timer.
    pill.addEventListener("mouseenter", () => { clearHideTimer(); pill.style.opacity = "1"; pill.style.transform = "none"; });
    pill.addEventListener("mouseleave", () => { if (mode === "selection") scheduleHide(HIDE_MS_HOVER); });
    const mk = (icon, title, onClick) => {
      const b = document.createElement("button");
      b.setAttribute(UI, "btn");
      b.title = title;
      b.setAttribute("aria-label", title);
      b.innerHTML = icon;
      style(b, "appearance:none;border:0;border-radius:6px;width:25px;height:23px;display:flex;align-items:center;justify-content:center;cursor:pointer;background:transparent;color:#e7e9ec;padding:0");
      b.addEventListener("mouseenter", () => { b.style.background = "rgba(255,255,255,.12)"; });
      b.addEventListener("mouseleave", () => { b.style.background = "transparent"; });
      b.addEventListener("mousedown", (e) => e.preventDefault()); // keep the selection / field focus
      b.addEventListener("click", (e) => { e.stopPropagation(); clearHideTimer(); onClick(); });
      return b;
    };
    for (const b of buttons) pill.append(mk(b.icon, b.title, b.onClick));
    document.documentElement.appendChild(pill);
  }

  function showPill(info) {
    mode = "selection"; anchor = info; fieldEl = null;
    makePill([
      { icon: ICON.translate, title: "Translate", onClick: () => doTranslate(info) },
      { icon: ICON.font, title: "Font", onClick: () => doFont(info) },
    ]);
    placePill(info.endRect || info.rect); // just below the selection end (flips above if no room)
    scheduleHide(HIDE_MS); // fade out if the selection isn't acted on
  }

  // ---- form-field "Fill form" pill -------------------------------------------
  const SKIP_TYPES = new Set(["hidden", "submit", "button", "checkbox", "radio", "file", "image", "range", "color", "reset", "search"]);
  function fillableCount() {
    try { return document.querySelectorAll("input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=reset]), textarea").length; }
    catch (e) { return 0; }
  }
  function isFormyField(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName;
    if (tag !== "INPUT" && tag !== "TEXTAREA") return false;
    if (el.disabled || el.readOnly) return false;
    if (tag === "INPUT" && SKIP_TYPES.has((el.type || "text").toLowerCase())) return false;
    // Only surface on real forms (field in a <form>, or a page with a few fillable fields) so a
    // lone search/comment box doesn't get a pill.
    return !!el.form || fillableCount() >= 3;
  }
  function fillForm(targetEl) {
    // targetEl set → fill only that one field (filler.js reads the marker attribute); else fill all.
    if (targetEl) { try { targetEl.setAttribute("data-yoshtool-fill-one", "1"); } catch (e) {} }
    removeAll();
    try { chrome.runtime.sendMessage({ cmd: "fill-form" }); } catch (e) {}
  }
  function showFieldPill(el) {
    mode = "field"; fieldEl = el; anchor = null;
    makePill([
      { icon: ICON.fill, title: "Fill this field with dummy data", onClick: () => fillForm(el) },
      { icon: ICON.form, title: "Fill the whole form with dummy data", onClick: () => fillForm(null) },
    ]);
    placeFieldPill(el.getBoundingClientRect()); // outside the field, top-right corner
  }

  // ---- events ----------------------------------------------------------------
  const onSelect = () => {
    if (!active) return;
    setTimeout(() => {
      const info = selectionInfo();
      if (info) showPill(info);
    }, 10);
  };
  const onFocusIn = (e) => {
    if (!active) return;
    if (inOwnUi(e.target)) return;
    if (isFormyField(e.target)) showFieldPill(e.target);
  };
  const onFocusOut = () => {
    if (mode !== "field") return;
    setTimeout(() => {
      const a = document.activeElement;
      if (inOwnUi(a)) return; // clicking the pill keeps field focus
      if (isFormyField(a)) { if (a !== fieldEl) showFieldPill(a); }
      else removeAll();
    }, 60);
  };
  const onDown = (e) => { if (!inOwnUi(e.target) && mode !== "field") removeAll(); };
  const onKey = (e) => { if (e.key === "Escape") removeAll(); };
  // Follow the selection / field while scrolling; hide only once it's scrolled out of view.
  let scrollRaf = 0;
  const onScroll = () => {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      if (!pill && !tip) return;
      if (mode === "field") {
        if (!fieldEl || !fieldEl.isConnected) { removeAll(); return; }
        const fr = fieldEl.getBoundingClientRect();
        if (fr.bottom < 0 || fr.top > window.innerHeight) { removeAll(); return; }
        placeFieldPill(fr);
        return;
      }
      const info = selectionInfo();
      if (!info) { removeAll(); return; }
      const r = info.rect;
      if (r.bottom < 0 || r.top > window.innerHeight) { removeAll(); return; }
      anchor = info;
      placePill(info.endRect || r);
      if (tip) positionTip(info, tip);
    });
  };

  document.addEventListener("mouseup", onSelect, true);
  document.addEventListener("mousedown", onDown, true);
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("focusin", onFocusIn, true);
  document.addEventListener("focusout", onFocusOut, true);
  window.addEventListener("scroll", onScroll, true);

  const detach = () => {
    document.removeEventListener("mouseup", onSelect, true);
    document.removeEventListener("mousedown", onDown, true);
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("focusin", onFocusIn, true);
    document.removeEventListener("focusout", onFocusOut, true);
    window.removeEventListener("scroll", onScroll, true);
  };

  try {
    chrome.storage.local.get("translateTarget", (r) => { if (r && typeof r.translateTarget === "string") target = r.translateTarget; });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.translateTarget) target = changes.translateTarget.newValue || "id";
      if (changes.selHelperEnabled && changes.selHelperEnabled.newValue === false) {
        active = false;
        removeAll();
        detach();
        try { delete window.__yoshtoolSelHelper; } catch (e) {}
      }
    });
  } catch (e) {}
})();
