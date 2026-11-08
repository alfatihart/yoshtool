// picker.js — content script (classic; injected on demand). Point-and-click element blocker.
// Hover to highlight, click to pick; a toolbar then lets you broaden to an ancestor (slider),
// optionally match by text, preview the live match set + count, and Block — which saves a per-site
// cosmetic rule to chrome.storage.local ("userCosmetics") and hides it now. adblock-cosmetic.js
// re-applies saved rules at document_start on every reload (see background.syncCosmeticScripts).
//
// The blocks below are BYTE-IDENTICAL inline copies of adblock-procedural-core.js and picker-core.js
// (this is a classic script and can't import) — keep them in sync (see CONTRIBUTING). The DOM
// selector generator + procedural evaluator are picker/cosmetic-specific DOM code (not in a core).
(() => {
  const FLAG = "__yoshtoolPicker";
  if (window[FLAG]) { try { window[FLAG].stop(); } catch (e) {} return; }

  // ---- inline copy of adblock-procedural-core.js (keep byte-identical) ----
  const PROCEDURAL_OPS = ["has-text", "min-text-length", "matches-css", "matches-attr", "upward"];
  function isProcedural(selector) {
    const s = String(selector || "");
    for (const op of PROCEDURAL_OPS) if (s.includes(":" + op + "(")) return true;
    return false;
  }
  function parseProcedural(selector) {
    const s = String(selector || "").trim();
    if (!s) return null;
    const ops = [];
    let firstOp = -1;
    let i = 0;
    const n = s.length;
    while (i < n) {
      if (s[i] === ":") {
        let matched = null;
        for (const op of PROCEDURAL_OPS) {
          if (s.startsWith(op + "(", i + 1)) { matched = op; break; }
        }
        if (matched) {
          if (firstOp < 0) firstOp = i;
          const open = i + 1 + matched.length; // index of "("
          let depth = 0;
          let q = null;
          let k = open;
          for (; k < n; k++) {
            const c = s[k];
            if (q) { if (c === q && s[k - 1] !== "\\") q = null; continue; }
            if (c === '"' || c === "'") { q = c; continue; }
            if (c === "(") depth++;
            else if (c === ")") { depth--; if (depth === 0) break; }
          }
          if (k >= n) return null; // unbalanced parentheses
          ops.push({ op: matched, arg: s.slice(open + 1, k) });
          i = k + 1;
          continue;
        }
      }
      i++;
    }
    if (!ops.length) return null;
    const subject = (firstOp < 0 ? s : s.slice(0, firstOp)).trim();
    return { subject, ops };
  }
  function parseValueArg(arg) {
    let a = String(arg == null ? "" : arg).trim();
    const m = a.match(/^\/(.*)\/([a-z]*)$/is);
    if (m) return { re: { source: m[1], flags: m[2] || "" } };
    if ((a.startsWith('"') && a.endsWith('"')) || (a.startsWith("'") && a.endsWith("'"))) {
      a = a.slice(1, -1);
    }
    return { text: a };
  }
  // ---- end inline copy ----

  // ---- inline copy of picker-core.js (keep byte-identical) ----
  function looksStable(token) {
    const t = String(token || "");
    if (t.length < 2) return false;
    if (/\d/.test(t)) return false; // any digit → almost always auto-generated
    if (/^(sc|css|jss|jsx|mui|makestyles|emotion|chakra|styled)-/i.test(t)) return false; // CSS-in-JS prefixes
    // A hyphen/underscore/camelCase segment that is one long consonant run (>=6, no vowel) is a hash.
    for (const w of t.split(/[-_]|(?=[A-Z])/)) {
      if (w && w.length >= 6 && !/[aeiouAEIOU]/.test(w)) return false;
    }
    return true;
  }
  function stableClasses(classes) {
    const out = [];
    for (const c of classes || []) if (looksStable(c)) out.push(c);
    return out;
  }
  function ruleDomain(hostname) {
    let h = String(hostname || "").trim().toLowerCase().replace(/^\.+|\.+$/g, "");
    if (h.startsWith("www.")) h = h.slice(4);
    return h;
  }
  function serializeHasText(needle) {
    const s = String(needle == null ? "" : needle).trim();
    if (/^\/.*\/[a-z]*$/i.test(s)) return `:has-text(${s})`;
    if (!s.includes('"')) return `:has-text("${s}")`;
    if (!s.includes("'")) return `:has-text('${s}')`;
    return `:has-text(/${s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}/)`;
  }
  // ---- end inline copy ----

  // ---- procedural evaluation (DOM; mirrors adblock-cosmetic.js) ----
  function makeTester(arg) {
    const v = parseValueArg(arg);
    if (v.re) {
      try { const re = new RegExp(v.re.source, v.re.flags); return (s) => re.test(String(s == null ? "" : s)); }
      catch (e) { return () => false; }
    }
    const t = v.text;
    return (s) => String(s == null ? "" : s).includes(t);
  }
  function attrTesters(arg) {
    const a = String(arg || "").trim();
    const m = a.match(/^("[^"]*"|'[^']*'|\/.*?\/[a-z]*|[\w:-]+)\s*(?:=\s*([\s\S]+))?$/i);
    if (!m) return null;
    return { name: makeTester(m[1]), val: m[2] != null ? makeTester(m[2]) : null };
  }
  function attrMatch(el, t) {
    const attrs = el.attributes;
    for (let i = 0; i < attrs.length; i++) {
      if (t.name(attrs[i].name) && (!t.val || t.val(attrs[i].value))) return true;
    }
    return false;
  }
  function climb(el, arg) {
    const a = String(arg || "").trim();
    if (/^\d+$/.test(a)) {
      let node = el;
      let n = parseInt(a, 10);
      while (n-- > 0 && node) node = node.parentElement;
      return node || null;
    }
    try { return el.closest(a); } catch (e) { return null; }
  }
  function evalProcedural(sel) {
    const p = parseProcedural(sel);
    if (!p) return null; // invalid
    let list;
    try { list = Array.prototype.slice.call(document.querySelectorAll(p.subject || "*")); }
    catch (e) { return null; }
    for (const { op, arg } of p.ops) {
      if (!list.length) break;
      if (op === "has-text") { const test = makeTester(arg); list = list.filter((el) => test(el.textContent)); }
      else if (op === "min-text-length") { const nn = parseInt(arg, 10) || 0; list = list.filter((el) => (el.textContent || "").length >= nn); }
      else if (op === "matches-css") {
        const idx = arg.indexOf(":");
        if (idx < 0) { list = []; break; }
        const prop = arg.slice(0, idx).trim();
        const test = makeTester(arg.slice(idx + 1));
        list = list.filter((el) => { try { return test(getComputedStyle(el).getPropertyValue(prop)); } catch (e) { return false; } });
      } else if (op === "matches-attr") {
        const t = attrTesters(arg);
        list = t ? list.filter((el) => attrMatch(el, t)) : [];
      } else if (op === "upward") {
        const out = [];
        for (const el of list) { const t = climb(el, arg); if (t && out.indexOf(t) === -1) out.push(t); }
        list = out;
      }
    }
    return list;
  }
  // Resolve a selector to its match list. null = invalid selector; [] = valid, nothing matched.
  function queryMatches(sel) {
    sel = String(sel || "").trim();
    if (!sel) return [];
    if (isProcedural(sel)) return evalProcedural(sel);
    try { return Array.prototype.slice.call(document.querySelectorAll(sel)); } catch (e) { return null; }
  }

  // ---- DOM selector generation ----
  const escId = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/[^\w-]/g, "\\$&"));
  const cssAttr = (v) => String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  function uniqueFor(sel, el) {
    try { const m = document.querySelectorAll(sel); return m.length === 1 && m[0] === el; } catch (e) { return false; }
  }
  function nthOfType(el) {
    let i = 1, sib = el;
    while ((sib = sib.previousElementSibling)) if (sib.tagName === el.tagName) i++;
    return i;
  }
  function countClass(c) { try { return document.getElementsByClassName(c).length; } catch (e) { return 1e9; } }
  // A short, robust fragment for one node: tag + at most the 2 RAREST stable classes (so we don't
  // emit a brittle 7-class chain like article.entry.content-bg.single-entry.page.type-page.hentry),
  // else a stable attribute, else the tag.
  function fragFor(node) {
    const tag = node.tagName.toLowerCase();
    const cls = stableClasses(node.classList ? [...node.classList] : []);
    if (cls.length) {
      cls.sort((a, b) => countClass(a) - countClass(b)); // rarest (most distinctive) first
      return tag + cls.slice(0, 2).map((c) => "." + escId(c)).join("");
    }
    for (const name of ["data-testid", "data-test", "data-qa", "data-id", "name", "aria-label", "role", "itemprop"]) {
      const v = node.getAttribute && node.getAttribute(name);
      if (v && v.length <= 40) return tag + "[" + name + '="' + cssAttr(v) + '"]';
    }
    return tag;
  }
  // The strongest standalone selector for a node, if any: a unique stable #id or a unique fragment.
  function anchorFor(node) {
    if (node.id && looksStable(node.id)) { const s = "#" + escId(node.id); if (uniqueFor(s, node)) return s; }
    const f = fragFor(node);
    if (uniqueFor(f, node)) return f;
    return null;
  }
  // Prefer a SHORT selector: the element's own unique fragment, else anchor on the nearest strong
  // ancestor and use a descendant combinator (skipping noisy intermediate levels) — e.g.
  // "#main h2:nth-of-type(1)" — falling back to a direct-child chain only when nothing anchors.
  function selectorFor(el) {
    if (!el || el.nodeType !== 1) return "";
    const own = anchorFor(el);
    if (own) return own;
    const frag = fragFor(el);
    const fragNth = frag + ":nth-of-type(" + nthOfType(el) + ")";
    let node = el.parentElement;
    while (node && node.nodeType === 1 && node.tagName !== "HTML") {
      const anchor = anchorFor(node);
      if (anchor) {
        for (const comb of [" ", " > "]) {
          for (const leaf of [frag, fragNth]) {
            const cand = anchor + comb + leaf;
            if (uniqueFor(cand, el)) return cand;
          }
        }
      }
      node = node.parentElement;
    }
    // Fallback: direct-child chain to the first unique point, then drop redundant leading levels.
    const chain = [];
    node = el;
    while (node && node.nodeType === 1 && node.tagName !== "HTML") {
      chain.unshift(fragFor(node));
      if (uniqueFor(chain.join(" > "), el)) break;
      if (node.tagName === "BODY") break;
      node = node.parentElement;
    }
    let parts = chain;
    while (parts.length > 1 && uniqueFor(parts.slice(1).join(" > "), el)) parts = parts.slice(1);
    let sel = parts.join(" > ");
    if (!uniqueFor(sel, el)) sel = sel.replace(/[^>]*$/, fragNth);
    return sel;
  }

  // ---- UI ----
  const UI = "data-yoshtool-picker";
  const Z = 2147483000;
  const host = location.hostname;
  let phase = "hover"; // "hover" | "picked"
  let picked = null, chain = [], depth = 0;
  const inOwnUi = (node) => {
    try { const el = node && node.nodeType === 1 ? node : node && node.parentElement; return !!(el && el.closest && el.closest(`[${UI}]`)); }
    catch (e) { return false; }
  };

  // Highlight layer (pointer-events:none so hover hit-tests reach the page).
  const layer = document.createElement("div");
  layer.setAttribute(UI, "layer");
  layer.style.cssText = `position:fixed;inset:0;z-index:${Z};pointer-events:none`;
  const HL_CSS = "position:fixed;box-sizing:border-box;background:rgba(37,99,235,.18);outline:2px solid #2563eb;outline-offset:-1px;border-radius:2px;display:none";
  const pool = [];
  function highlight(list) {
    for (const d of pool) d.style.display = "none";
    (list || []).slice(0, 300).forEach((el, i) => {
      let d = pool[i];
      if (!d) { d = document.createElement("div"); d.setAttribute(UI, "hl"); d.style.cssText = HL_CSS; layer.appendChild(d); pool[i] = d; }
      const r = el.getBoundingClientRect();
      d.style.left = r.left + "px"; d.style.top = r.top + "px"; d.style.width = r.width + "px"; d.style.height = r.height + "px"; d.style.display = "block";
    });
  }

  // Toolbar.
  const bar = document.createElement("div");
  bar.setAttribute(UI, "bar");
  bar.style.cssText =
    `position:fixed;z-index:${Z + 1};left:50%;bottom:20px;transform:translateX(-50%);width:min(440px,calc(100vw - 32px));` +
    "background:#1b1e23;color:#e9ebee;border-radius:14px;border:1px solid rgba(255,255,255,.12);overflow:hidden;" +
    "box-shadow:0 18px 50px rgba(0,0,0,.55);font:13px/1.45 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";
  const PRIMARY = "appearance:none;border:0;border-radius:9px;padding:8px 16px;cursor:pointer;font:600 13px system-ui,sans-serif;background:#2563eb;color:#fff";
  const GHOST = "appearance:none;border:1px solid rgba(255,255,255,.16);border-radius:9px;padding:7px 14px;cursor:pointer;font:600 13px system-ui,sans-serif;background:transparent;color:#e9ebee";
  const FIELD = "width:100%;box-sizing:border-box;background:#111419;color:#e9ebee;border:1px solid rgba(255,255,255,.12);border-radius:9px;padding:8px 10px";
  bar.innerHTML =
    `<div style="display:flex;align-items:center;gap:10px;padding:13px 16px;border-bottom:1px solid rgba(255,255,255,.08)">
       <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex:none"><path d="m3 3 7.07 16.97 2.51-7.39 7.39-2.51L3 3z"></path><path d="m13 13 6 6"></path></svg>
       <strong style="font-size:13.5px;flex:1" ${UI}="h">Block element</strong>
       <span ${UI}="count" style="font-size:11px;color:#aab0b8;background:rgba(255,255,255,.07);padding:3px 9px;border-radius:999px;display:none"></span>
       <button ${UI}="close" title="Cancel (Esc)" style="appearance:none;border:0;background:transparent;color:#aab0b8;cursor:pointer;font-size:16px;line-height:1;padding:2px 4px">✕</button>
     </div>
     <div style="padding:14px 16px">
       <div ${UI}="hint" style="color:#aab0b8;font-size:12.5px">Hover an element, then click to pick it. Press Esc to cancel.</div>
       <div ${UI}="editor" style="display:none">
         <textarea ${UI}="sel" spellcheck="false" rows="2" style="${FIELD};resize:vertical;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;line-height:1.5"></textarea>
         <div style="display:flex;align-items:center;gap:10px;margin-top:12px">
           <span style="color:#aab0b8;font-size:12.5px;flex:none">Expand</span>
           <input ${UI}="slider" type="range" min="0" max="0" value="0" style="flex:1;accent-color:#2563eb" />
           <span ${UI}="depth" style="font-size:11.5px;color:#aab0b8;min-width:70px;text-align:right">element</span>
         </div>
         <label style="display:flex;align-items:center;gap:8px;margin-top:12px;cursor:pointer">
           <input ${UI}="htoggle" type="checkbox" style="accent-color:#2563eb" />
           <span style="font-size:12.5px">Match by its text</span>
         </label>
         <input ${UI}="htext" type="text" placeholder="text contained in the element" style="${FIELD};margin-top:8px;font-size:12px;display:none" />
         <div style="display:flex;align-items:center;gap:8px;margin-top:14px">
           <select ${UI}="scope" style="${FIELD};flex:1;font-size:12px;padding:7px 9px">
             <option value="site"></option>
             <option value="all">All sites</option>
           </select>
           <button ${UI}="preview" style="${GHOST}">Preview</button>
           <button ${UI}="block" style="${PRIMARY}">Block</button>
         </div>
       </div>
     </div>`;

  const $ = (k) => bar.querySelector(`[${UI}="${k}"]`);
  const elHint = $("hint"), elEditor = $("editor"), elSel = $("sel"), elCount = $("count"),
    elSlider = $("slider"), elDepth = $("depth"), elHtoggle = $("htoggle"), elHtext = $("htext"),
    elScope = $("scope"), elH = $("h"), elPreview = $("preview");
  $("scope").querySelector('option[value="site"]').textContent = "This site (" + (ruleDomain(host) || host) + ")";

  function baseSelector() { return selectorFor(chain[depth] || picked); }
  function compose() {
    let sel = baseSelector();
    if (elHtoggle.checked && elHtext.value.trim()) sel += serializeHasText(elHtext.value.trim());
    return sel;
  }
  function refreshFromControls() { elSel.value = compose(); preview(); }

  let pvTimer = 0;
  function preview() {
    clearTimeout(pvTimer);
    pvTimer = setTimeout(() => {
      const sel = elSel.value.trim();
      const m = queryMatches(sel);
      elCount.style.display = "";
      if (m === null) { elCount.textContent = "invalid selector"; elCount.style.color = "#f4a3a0"; highlight([]); return; }
      elCount.style.color = "#aab0b8";
      elCount.textContent = m.length === 1 ? "1 match" : m.length + " matches";
      if (previewing) applyPreview(m); // keep the "after" view in sync with the current selector
      else highlight(m);
    }, 80);
  }

  // Live "after" preview: temporarily hide the matched elements so the user sees the page WITHOUT
  // them before committing (like AdGuard Assistant's Preview). Restored by clearPreview() on toggle
  // off, on Cancel/Esc (stop), and before Block (so persistence re-hides cleanly).
  let previewing = false;
  let previewed = []; // [{ el, prev }]
  function clearPreview() {
    for (const p of previewed) { try { p.el.style.removeProperty("display"); if (p.prev) p.el.style.display = p.prev; } catch (e) {} }
    previewed = [];
  }
  function applyPreview(list) {
    clearPreview();
    const m = list || queryMatches(elSel.value.trim()) || [];
    for (const el of m) {
      try { previewed.push({ el, prev: el.style.display }); el.style.setProperty("display", "none", "important"); } catch (e) {}
    }
  }
  function setPreview(on) {
    previewing = on;
    if (on) {
      layer.style.display = "none"; // hide outlines so the clean result is visible
      applyPreview();
      elPreview.textContent = "End preview";
      elPreview.style.background = "rgba(180,83,9,.9)";
      elPreview.style.borderColor = "transparent";
    } else {
      clearPreview();
      layer.style.display = "";
      elPreview.textContent = "Preview";
      elPreview.style.background = "transparent";
      elPreview.style.borderColor = "rgba(255,255,255,.16)";
      preview();
    }
  }

  function pick(el) {
    phase = "picked";
    picked = el;
    chain = [];
    let n = el;
    while (n && n.nodeType === 1 && n.tagName !== "HTML") { chain.push(n); if (n.tagName === "BODY") break; n = n.parentElement; }
    depth = 0;
    elSlider.max = String(Math.max(0, chain.length - 1));
    elSlider.value = "0";
    const txt = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40);
    elHtext.value = txt;
    elHtoggle.checked = false;
    elHtext.style.display = "none";
    elHint.style.display = "none";
    elEditor.style.display = "";
    updateDepthLabel();
    refreshFromControls();
  }
  function updateDepthLabel() {
    const el = chain[depth] || picked;
    elDepth.textContent = (depth === 0 ? "element" : "+" + depth) + " · " + (el ? el.tagName.toLowerCase() : "");
  }

  elSlider.addEventListener("input", () => { depth = parseInt(elSlider.value, 10) || 0; updateDepthLabel(); refreshFromControls(); });
  elHtoggle.addEventListener("change", () => { elHtext.style.display = elHtoggle.checked ? "" : "none"; if (elHtoggle.checked) elHtext.focus(); refreshFromControls(); });
  elHtext.addEventListener("input", refreshFromControls);
  elSel.addEventListener("input", preview);
  elPreview.addEventListener("click", (e) => { e.preventDefault(); setPreview(!previewing); });
  $("close").addEventListener("click", (e) => { e.preventDefault(); stop(); });
  $("block").addEventListener("click", (e) => { e.preventDefault(); commit(); });

  async function commit() {
    const sel = elSel.value.trim();
    const m = queryMatches(sel);
    if (!sel || m === null) { elCount.textContent = "invalid selector — fix it first"; elCount.style.color = "#f4a3a0"; return; }
    clearPreview(); // undo the temporary hide; applyNow re-hides via the saved rule
    const key = elScope.value === "all" ? "*" : (ruleDomain(host) || host);
    try {
      const store = await chrome.storage.local.get("userCosmetics");
      const data = store.userCosmetics && typeof store.userCosmetics === "object" ? store.userCosmetics : {};
      const list = Array.isArray(data[key]) ? data[key] : [];
      if (!list.includes(sel)) list.push(sel);
      data[key] = list;
      await chrome.storage.local.set({ userCosmetics: data });
    } catch (e) {
      elCount.textContent = "couldn't save (extension reloaded?)"; elCount.style.color = "#f4a3a0"; return;
    }
    applyNow(sel);
    stop();
  }
  function applyNow(sel) {
    if (isProcedural(sel)) {
      for (const el of queryMatches(sel) || []) { try { el.style.setProperty("display", "none", "important"); } catch (e) {} }
    } else {
      try {
        const s = document.createElement("style");
        s.setAttribute("data-yoshtool", "user-cosmetic");
        s.textContent = sel + "{display:none!important}";
        (document.head || document.documentElement).appendChild(s);
      } catch (e) {}
    }
  }

  // Events.
  const onMove = (e) => {
    if (phase !== "hover") return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || inOwnUi(el) || el === document.documentElement || el === document.body) { highlight([]); return; }
    highlight([el]);
  };
  const onClick = (e) => {
    if (inOwnUi(e.target)) return; // let the toolbar work
    if (phase !== "hover") { e.preventDefault(); e.stopPropagation(); return; }
    const el = document.elementFromPoint(e.clientX, e.clientY);
    e.preventDefault(); e.stopPropagation();
    if (!el || inOwnUi(el) || el === document.documentElement || el === document.body) return;
    pick(el);
  };
  const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); stop(); } };
  let raf = 0;
  const onScroll = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; if (phase === "picked") preview(); });
  };

  function stop() {
    clearPreview(); // Cancel/Esc must leave the page exactly as it was
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", onScroll, true);
    try { layer.remove(); } catch (e) {}
    try { bar.remove(); } catch (e) {}
    try { delete window[FLAG]; } catch (e) { window[FLAG] = null; }
  }

  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onScroll, true);
  (document.body || document.documentElement).append(layer, bar);
  window[FLAG] = { stop };
})();
