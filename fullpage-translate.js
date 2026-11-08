// fullpage-translate.js — on-demand (classic) content script, TOGGLE (re-inject → off).
// Inline, reversible bilingual full-page translation: it groups the page's visible text by its
// nearest block element, sends every block's text to the background in ONE batched request (the
// background translates with a concurrency pool + backoff, since the free endpoint rate-limits on
// bulk), then inserts each translation BENEATH its block — the original stays, so you read both.
// Toggling off removes every inserted node. Esc also exits.
//
// Only the background may call the translation endpoint (CORS/host permission), so this script just
// collects text and renders results. isTranslatableText is a BYTE-IDENTICAL inline copy of the one in
// translate-core.js (keep in sync).
(() => {
  const GUARD = "__yoshtoolFullpageTranslate";
  if (window[GUARD]) { window[GUARD].teardown(); return; } // re-inject → toggle off

  const UI = "data-yoshtool-fptr"; // our own nodes (toast)
  const TR = "data-yoshtool-tr";   // inserted translation nodes
  const Z = 2147483000;
  const MAX_UNITS = 800;           // cap work on huge pages
  const MAX_TOTAL_CHARS = 200000;

  // ---- inline copy of translate-core.js isTranslatableText (keep IDENTICAL) ----
  function isTranslatableText(s) {
    const t = String(s == null ? "" : s).trim();
    if (t.length < 2) return false;
    if (!/\p{L}/u.test(t)) return false; // no letters at all
    if (/^(?:https?:\/\/|www\.)\S+$/i.test(t)) return false; // bare URL
    return true;
  }
  // ---- end inline copy ----

  let active = true;

  function toast(msg, ms) {
    document.querySelectorAll(`[${UI}="toast"]`).forEach((n) => n.remove());
    const t = document.createElement("div");
    t.setAttribute(UI, "toast");
    t.style.cssText =
      `position:fixed;right:12px;bottom:12px;z-index:${Z + 1};background:#1f2328;color:#e7e9ec;` +
      "padding:9px 13px;border-radius:12px;border:1px solid rgba(255,255,255,.1);box-sizing:border-box;" +
      "font:600 12.5px/1.3 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;" +
      "box-shadow:0 10px 30px rgba(0,0,0,.45);max-width:300px;opacity:0;transition:opacity .2s";
    t.textContent = msg;
    document.documentElement.appendChild(t);
    requestAnimationFrame(() => { t.style.opacity = "1"; });
    setTimeout(() => { t.style.opacity = "0"; setTimeout(() => t.remove(), 250); }, ms || 3200);
  }

  const onKey = (e) => { if (e.key === "Escape") teardown(); };

  // Clear state but leave any current toast in place (used on error so the message stays visible).
  function cleanup() {
    document.removeEventListener("keydown", onKey, true);
    document.querySelectorAll(`[${TR}]`).forEach((n) => n.remove());
    active = false;
    try { delete window[GUARD]; } catch (e) { window[GUARD] = undefined; }
  }
  function teardown() {
    cleanup();
    document.querySelectorAll(`[${UI}]`).forEach((n) => n.remove());
    toast("Full-page translate off");
  }

  const isBlockDisplay = (d) => d && !/^inline/.test(d) && d !== "none" && d !== "contents";
  function closestBlock(node) {
    let el = node.parentElement;
    while (el && el !== document.documentElement) {
      let d;
      try { d = getComputedStyle(el).display; } catch (e) { return el; }
      if (isBlockDisplay(d)) return el;
      el = el.parentElement;
    }
    return el || document.body;
  }
  function isHidden(el) {
    try {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return true;
      return el.offsetParent === null && cs.position !== "fixed";
    } catch (e) { return false; }
  }

  // Group visible text nodes by their nearest block element → one translatable unit per block.
  function collectUnits() {
    const root = document.body || document.documentElement;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const v = n.nodeValue;
        if (!v || !v.trim()) return NodeFilter.FILTER_REJECT;
        const p = n.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        const tag = p.tagName;
        if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "TEXTAREA" || tag === "OPTION") return NodeFilter.FILTER_REJECT;
        if (p instanceof SVGElement) return NodeFilter.FILTER_REJECT;
        if (p.closest(`[${TR}],[${UI}],[contenteditable=""],[contenteditable="true"]`)) return NodeFilter.FILTER_REJECT;
        if (!isTranslatableText(v)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const map = new Map(); // block element → [text parts]
    const order = [];
    let n;
    while ((n = walker.nextNode())) {
      const block = closestBlock(n);
      if (!block || isHidden(block)) continue;
      if (!map.has(block)) { map.set(block, []); order.push(block); }
      map.get(block).push(n.nodeValue.trim());
    }
    const units = [];
    let total = 0;
    for (const block of order) {
      const text = map.get(block).join(" ").replace(/\s+/g, " ").trim();
      if (!isTranslatableText(text)) continue;
      if (units.length >= MAX_UNITS || total > MAX_TOTAL_CHARS) break;
      total += text.length;
      units.push({ block, text });
    }
    return units;
  }

  function insertTranslation(block, text) {
    if (!text) return;
    const span = document.createElement("span");
    span.setAttribute(TR, "1");
    // span (not div) so it's valid phrasing content inside <p>; display:block puts it on its own line.
    // Inherit the page's colour/font so it reads on any background; a subtle left accent marks it.
    span.style.cssText =
      "display:block;margin:4px 0 0;padding:1px 0 1px 8px;border-left:3px solid rgba(21,124,105,.65);" +
      "opacity:.9;font-style:normal;font-weight:inherit";
    span.textContent = text;
    try { block.appendChild(span); } catch (e) {}
  }

  async function run() {
    const units = collectUnits();
    if (!units.length) { toast("No translatable text found"); cleanup(); return; }
    toast(`Translating ${units.length} blocks…`, 60000);
    let to = "id";
    try {
      const r = await chrome.storage.local.get("translateTarget");
      if (r && typeof r.translateTarget === "string") to = r.translateTarget;
    } catch (e) {}
    let res;
    try {
      res = await chrome.runtime.sendMessage({ cmd: "translate-batch", texts: units.map((u) => u.text), to });
      void chrome.runtime.lastError;
    } catch (e) {
      toast("Translation unavailable (is the host permission granted?)");
      cleanup();
      return;
    }
    if (!active) return; // toggled off while awaiting
    if (!res || !res.ok) { toast("Translation failed (rate-limited?)"); cleanup(); return; }
    const tr = res.translations || [];
    let done = 0;
    for (let i = 0; i < units.length; i++) {
      if (tr[i] && tr[i] !== units[i].text) { insertTranslation(units[i].block, tr[i]); done++; }
    }
    if (!done) { toast("Couldn't translate this page (rate-limited?)"); cleanup(); return; }
    const partial = res.failures ? ` (${res.failures} failed — rate limit)` : "";
    toast(`Translated ${done} blocks${partial}. Run again to undo.`);
  }

  document.addEventListener("keydown", onKey, true);
  window[GUARD] = { teardown };
  run();
})();
