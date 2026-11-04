// translate-overlay.js
// Selection-translate tooltip. Injected on-demand (classic script) and TOGGLE: re-injecting turns
// it off. While active, selecting text (or the current selection at inject time) shows a small
// tooltip with the translation. The content script only detects text + renders the tooltip; the
// actual translation is fetched by the background service worker (which holds the host permission
// and isn't blocked by the endpoint's missing CORS). Target language comes from storage. Esc exits.
(() => {
  const GUARD = "__yoshtoolTranslate";
  if (window[GUARD]) { window[GUARD].teardown(); return; } // re-inject → toggle off

  const UI = "data-yoshtool-translate";
  const Z = 2147483000;
  const MAX = 5000; // don't send huge selections to the free endpoint
  let tip = null;
  let lastText = "";

  const inOwnUi = (node) => {
    try { return !!(node && node.nodeType === 1 ? node.closest(`[${UI}]`) : node && node.parentElement && node.parentElement.closest(`[${UI}]`)); }
    catch (e) { return false; }
  };

  function removeTip() {
    if (tip) { tip.remove(); tip = null; }
  }

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
    setTimeout(() => { t.style.opacity = "0"; setTimeout(() => t.remove(), 250); }, 2600);
  }

  function showTip(rect, { loading, text, source, error }) {
    removeTip();
    tip = document.createElement("div");
    tip.setAttribute(UI, "tip");
    tip.style.cssText =
      `position:fixed;z-index:${Z + 2};max-width:360px;background:#1f2328;color:#e7e9ec;box-sizing:border-box;` +
      "padding:10px 12px;border-radius:12px;border:1px solid rgba(255,255,255,.12);" +
      "font:13px/1.45 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;" +
      "box-shadow:0 12px 34px rgba(0,0,0,.5)";
    if (loading) {
      tip.textContent = "Translating…";
    } else if (error) {
      tip.innerHTML = `<div style="color:#f4a3a0">${esc(error)}</div>`;
    } else {
      const head = document.createElement("div");
      head.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:5px";
      const lang = document.createElement("span");
      lang.style.cssText = "font-size:11px;color:#9aa1ab;text-transform:uppercase;letter-spacing:.4px";
      lang.textContent = (source || "auto") + " → " + target();
      const copy = document.createElement("button");
      copy.setAttribute(UI, "copy");
      copy.textContent = "Copy";
      copy.style.cssText = "appearance:none;border:0;border-radius:7px;padding:3px 9px;cursor:pointer;background:#157c69;color:#fff;font:600 11.5px system-ui,sans-serif";
      copy.addEventListener("click", async (e) => {
        e.stopPropagation();
        try { await navigator.clipboard.writeText(text); copy.textContent = "Copied ✓"; setTimeout(() => { copy.textContent = "Copy"; }, 1400); } catch (err) {}
      });
      head.append(lang, copy);
      const body = document.createElement("div");
      body.textContent = text || "(no translation)";
      tip.append(head, body);
    }
    document.documentElement.appendChild(tip);
    position(rect);
  }

  function position(rect) {
    if (!tip) return;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let left = Math.min(rect.left, window.innerWidth - w - 10);
    left = Math.max(8, left);
    let top = rect.bottom + 8;
    if (top + h > window.innerHeight - 8) top = Math.max(8, rect.top - h - 8); // flip above
    tip.style.left = left + "px";
    tip.style.top = top + "px";
  }

  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  let _target = "id";
  const target = () => _target;

  function currentSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return null;
    if (inOwnUi(sel.anchorNode) || inOwnUi(sel.focusNode)) return null;
    const text = sel.toString().trim();
    if (!text) return null;
    let rect;
    try { rect = sel.getRangeAt(0).getBoundingClientRect(); } catch (e) { return null; }
    if (!rect || (rect.width === 0 && rect.height === 0)) return null;
    return { text, rect };
  }

  function translateSelection() {
    const s = currentSelection();
    if (!s) return;
    if (s.text === lastText && tip) return; // already shown
    lastText = s.text;
    const text = s.text.slice(0, MAX);
    showTip(s.rect, { loading: true });
    try {
      chrome.runtime.sendMessage({ cmd: "translate", text }, (res) => {
        void chrome.runtime.lastError;
        const cur = currentSelection();
        const rect = (cur && cur.text === lastText ? cur.rect : s.rect);
        if (!res) { showTip(rect, { error: "Translation unavailable (is the host permission granted?)" }); return; }
        if (!res.ok) { showTip(rect, { error: res.error || "Translation failed (rate-limited?)" }); return; }
        showTip(rect, { text: res.text, source: res.source });
      });
    } catch (e) {
      showTip(s.rect, { error: "Translation unavailable" });
    }
  }

  const onMouseUp = () => { setTimeout(translateSelection, 10); };
  const onKeyDown = (e) => { if (e.key === "Escape") { if (tip) removeTip(); else teardown(); } };
  const onDocClick = (e) => { if (tip && !inOwnUi(e.target)) { lastText = ""; removeTip(); } };
  const onScroll = () => removeTip();

  function teardown() {
    document.removeEventListener("mouseup", onMouseUp, true);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("mousedown", onDocClick, true);
    window.removeEventListener("scroll", onScroll, true);
    removeTip();
    document.querySelectorAll(`[${UI}]`).forEach((n) => n.remove());
    try { delete window[GUARD]; } catch (e) { window[GUARD] = undefined; }
    toast("Translate mode off");
  }

  // Read the configured target language, then arm.
  try {
    chrome.storage.local.get("translateTarget", (r) => {
      if (r && typeof r.translateTarget === "string") _target = r.translateTarget;
      const s = currentSelection();
      if (s) translateSelection();
    });
  } catch (e) {}

  document.addEventListener("mouseup", onMouseUp, true);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("mousedown", onDocClick, true);
  window.addEventListener("scroll", onScroll, true);
  window[GUARD] = { teardown };
  toast("Translate mode on — select text");
})();
