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
  let target = "id";

  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
    let range, rect, el;
    try {
      range = sel.getRangeAt(0);
      rect = range.getBoundingClientRect();
      el = range.commonAncestorContainer;
      if (el && el.nodeType === 3) el = el.parentElement;
    } catch (e) { return null; }
    if (!rect || (rect.width === 0 && rect.height === 0)) return null;
    return { text, rect, el };
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
  function removeAll() { removeTip(); if (pill) { pill.remove(); pill = null; } anchor = null; }

  function positionPill(rect) {
    if (!pill) return;
    const w = pill.offsetWidth, h = pill.offsetHeight;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - w - 10));
    let top = rect.top - h - 8;
    if (top < 8) top = rect.bottom + 8;
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

  function doTranslate(info) {
    const t = mkTip();
    t.textContent = "Translating…";
    positionBelow(info.rect, t);
    const text = info.text.slice(0, 5000);
    try {
      chrome.runtime.sendMessage({ cmd: "translate", text }, (res) => {
        void chrome.runtime.lastError;
        if (!tip) return;
        if (!res || !res.ok) {
          tip.innerHTML = `<div style="color:#f4a3a0">${esc((res && res.error) || "Translation unavailable")}</div>`;
          positionBelow(info.rect, tip);
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
        positionBelow(info.rect, tip);
      });
    } catch (e) {
      t.innerHTML = `<div style="color:#f4a3a0">Translation unavailable</div>`;
    }
  }

  function doFont(info) {
    const t = mkTip();
    const el = info.el || document.body;
    let cs;
    try { cs = getComputedStyle(el); } catch (e) { t.textContent = "Can't read font here."; positionBelow(info.rect, t); return; }
    const actual = actualFont(cs.fontFamily);
    t.innerHTML =
      `<div style="font-weight:700;margin-bottom:3px">${esc(actual)}</div>` +
      `<div style="color:#9aa1ab;font-size:12px">${esc(cs.fontSize)} · ${esc(cs.fontWeight)} · ${esc(cs.fontStyle)} · lh ${esc(cs.lineHeight)}</div>` +
      `<div style="margin-top:4px;color:#8b93a0;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(cs.fontFamily)}</div>`;
    positionBelow(info.rect, t);
  }

  function showPill(info) {
    if (pill) pill.remove();
    pill = document.createElement("div");
    pill.setAttribute(UI, "pill");
    style(pill,
      `position:fixed;z-index:${Z + 3};display:flex;gap:4px;background:#1f2328;border:1px solid rgba(255,255,255,.14);` +
      "border-radius:10px;padding:4px;box-shadow:0 8px 24px rgba(0,0,0,.45)");
    const mk = (label, title, onClick) => {
      const b = document.createElement("button");
      b.setAttribute(UI, "btn");
      b.textContent = label;
      b.title = title;
      style(b, "appearance:none;border:0;border-radius:7px;padding:5px 10px;cursor:pointer;background:transparent;color:#e7e9ec;font:600 12px system-ui,-apple-system,sans-serif;white-space:nowrap");
      b.addEventListener("mouseenter", () => { b.style.background = "rgba(255,255,255,.1)"; });
      b.addEventListener("mouseleave", () => { b.style.background = "transparent"; });
      b.addEventListener("mousedown", (e) => e.preventDefault()); // keep the text selection
      b.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
      return b;
    };
    pill.append(
      mk("🌐 Translate", "Translate the selection", () => doTranslate(info)),
      mk("🔤 Font", "Show the font of the selection", () => doFont(info)),
    );
    document.documentElement.appendChild(pill);
    anchor = info;
    positionPill(info.rect); // just above the selection (flips below if no room)
  }

  // ---- events ----------------------------------------------------------------
  const onSelect = () => {
    if (!active) return;
    setTimeout(() => {
      const info = selectionInfo();
      if (info) showPill(info);
    }, 10);
  };
  const onDown = (e) => { if (!inOwnUi(e.target)) removeAll(); };
  const onKey = (e) => { if (e.key === "Escape") removeAll(); };
  // Follow the selection while scrolling; hide only once it's scrolled out of view.
  let scrollRaf = 0;
  const onScroll = () => {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      if (!pill && !tip) return;
      const info = selectionInfo();
      if (!info) { removeAll(); return; }
      const r = info.rect;
      if (r.bottom < 0 || r.top > window.innerHeight) { removeAll(); return; }
      anchor = info;
      positionPill(r);
      if (tip) positionBelow(r, tip);
    });
  };

  document.addEventListener("mouseup", onSelect, true);
  document.addEventListener("mousedown", onDown, true);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("scroll", onScroll, true);

  try {
    chrome.storage.local.get("translateTarget", (r) => { if (r && typeof r.translateTarget === "string") target = r.translateTarget; });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.translateTarget) target = changes.translateTarget.newValue || "id";
      if (changes.selHelperEnabled && changes.selHelperEnabled.newValue === false) {
        active = false;
        removeAll();
        document.removeEventListener("mouseup", onSelect, true);
        document.removeEventListener("mousedown", onDown, true);
        document.removeEventListener("keydown", onKey, true);
        window.removeEventListener("scroll", onScroll, true);
        try { delete window.__yoshtoolSelHelper; } catch (e) {}
      }
    });
  } catch (e) {}
})();
