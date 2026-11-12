// editpage.js — content script (classic; injected on demand). Quick inspect & edit, DevTools-lite.
// Hover to highlight, click to pick an element, then edit its text (in place), attributes and inline
// style, or duplicate / delete / copy it. Plus an "Edit all text" toggle (document.designMode). All
// changes are to your LOCAL view only and reset on reload — to hide an element for good use the
// element blocker (picker/Block); to remove once use Zap. Re-injecting toggles the tool off. The UI
// renders inside a Shadow DOM so the page's CSS can't touch it. Esc exits (or ends text editing).
(() => {
  const FLAG = "__yoshtoolEditPage";
  if (window[FLAG]) { try { window[FLAG].stop(); } catch (e) {} return; }

  // ---- selector generation (mirrors picker.js — DOM code, not a shared core) ----
  function looksStable(token) {
    const t = String(token || "");
    if (t.length < 2) return false;
    if (/\d/.test(t)) return false;
    // React useId() ids are ephemeral (regenerated each render): `_r_rg_`, `_R_2j_`, `:r0:`, `«r1»`.
    // They pass the other checks (no digits), but a selector built on them breaks on reload.
    if (/^_?[rR][_:]/.test(t) || /^[«:][rR]/.test(t)) return false;
    if (/^(sc|css|jss|jsx|mui|makestyles|emotion|chakra|styled)-/i.test(t)) return false;
    for (const w of t.split(/[-_]|(?=[A-Z])/)) { if (w && w.length >= 6 && !/[aeiouAEIOU]/.test(w)) return false; }
    return true;
  }
  function stableClasses(classes) { const out = []; for (const c of classes || []) if (looksStable(c)) out.push(c); return out; }
  const escId = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/[^\w-]/g, "\\$&"));
  const cssAttr = (v) => String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  function uniqueFor(sel, el) { try { const m = document.querySelectorAll(sel); return m.length === 1 && m[0] === el; } catch (e) { return false; } }
  function nthOfType(el) { let i = 1, s = el; while ((s = s.previousElementSibling)) if (s.tagName === el.tagName) i++; return i; }
  function countClass(c) { try { return document.getElementsByClassName(c).length; } catch (e) { return 1e9; } }
  function fragFor(node) {
    const tag = node.tagName.toLowerCase();
    const cls = stableClasses(node.classList ? [...node.classList] : []);
    if (cls.length) { cls.sort((a, b) => countClass(a) - countClass(b)); return tag + cls.slice(0, 2).map((c) => "." + escId(c)).join(""); }
    for (const name of ["data-testid", "data-test", "data-qa", "data-id", "name", "aria-label", "role", "itemprop"]) {
      const v = node.getAttribute && node.getAttribute(name);
      if (v && v.length <= 40) return tag + "[" + name + '="' + cssAttr(v) + '"]';
    }
    return tag;
  }
  function anchorFor(node) {
    if (node.id && looksStable(node.id)) { const s = "#" + escId(node.id); if (uniqueFor(s, node)) return s; }
    const f = fragFor(node); if (uniqueFor(f, node)) return f; return null;
  }
  function selectorFor(el) {
    if (!el || el.nodeType !== 1) return "";
    const own = anchorFor(el); if (own) return own;
    const frag = fragFor(el), fragNth = frag + ":nth-of-type(" + nthOfType(el) + ")";
    let node = el.parentElement;
    while (node && node.nodeType === 1 && node.tagName !== "HTML") {
      const anchor = anchorFor(node);
      if (anchor) for (const comb of [" ", " > "]) for (const leaf of [frag, fragNth]) { const cand = anchor + comb + leaf; if (uniqueFor(cand, el)) return cand; }
      node = node.parentElement;
    }
    const chain = []; node = el;
    while (node && node.nodeType === 1 && node.tagName !== "HTML") { chain.unshift(fragFor(node)); if (uniqueFor(chain.join(" > "), el)) break; if (node.tagName === "BODY") break; node = node.parentElement; }
    let parts = chain; while (parts.length > 1 && uniqueFor(parts.slice(1).join(" > "), el)) parts = parts.slice(1);
    let sel = parts.join(" > "); if (!uniqueFor(sel, el)) sel = sel.replace(/[^>]*$/, fragNth); return sel;
  }

  // ---- unlock-scroll heuristic (mirrors zapper.js) ----
  function unlockScroll(el) {
    let n = el, overlayish = false;
    for (let i = 0; n && i < 6; i++, n = n.parentElement) { let cs; try { cs = getComputedStyle(n); } catch (e) { break; } if (cs.position === "fixed" || cs.position === "sticky" || (parseInt(cs.zIndex, 10) || 0) >= 1000) { overlayish = true; break; } }
    if (!overlayish) return;
    for (const root of [document.documentElement, document.body]) { if (!root) continue; try { const cs = getComputedStyle(root); if (cs.overflow === "hidden" || cs.overflowY === "hidden") root.style.setProperty("overflow", "auto", "important"); if (cs.position === "fixed") root.style.setProperty("position", "static", "important"); } catch (e) {} }
  }

  // ---- UI ----
  const UI = "data-yoshtool-editpage";
  const Z = 2147483000;
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  let phase = "hover"; // "hover" | "picked"
  let picked = null, pickedSel = "", editing = false, designOn = false;
  const inOwnUi = (node) => { try { const el = node && node.nodeType === 1 ? node : node && node.parentElement; return !!(el && el.closest && el.closest(`[${UI}]`)); } catch (e) { return false; } };

  const hostEl = document.createElement("div");
  hostEl.setAttribute(UI, "host");
  hostEl.style.cssText = `position:fixed;inset:0;z-index:${Z + 1};pointer-events:none`;
  const root = hostEl.attachShadow ? hostEl.attachShadow({ mode: "open" }) : hostEl;
  const reset = document.createElement("style");
  reset.textContent = "*{box-sizing:border-box;margin:0;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}";
  root.appendChild(reset);

  const layer = document.createElement("div");
  layer.setAttribute(UI, "layer");
  layer.style.cssText = `position:fixed;inset:0;z-index:${Z};pointer-events:none`;
  const hl = document.createElement("div");
  hl.setAttribute(UI, "hl");
  hl.style.cssText = "position:fixed;box-sizing:border-box;background:rgba(37,99,235,.14);outline:2px solid #2563eb;outline-offset:-1px;border-radius:2px;display:none";
  layer.appendChild(hl);
  function highlight(el) {
    if (!el) { hl.style.display = "none"; return; }
    const r = el.getBoundingClientRect();
    hl.style.left = r.left + "px"; hl.style.top = r.top + "px"; hl.style.width = r.width + "px"; hl.style.height = r.height + "px"; hl.style.display = "block";
  }

  const bar = document.createElement("div");
  bar.setAttribute(UI, "bar");
  bar.style.cssText =
    `position:fixed;z-index:${Z + 1};left:50%;bottom:20px;transform:translateX(-50%);width:min(460px,calc(100vw - 32px));pointer-events:auto;` +
    "background:#1b1e23;color:#e9ebee;border-radius:14px;border:1px solid rgba(255,255,255,.12);overflow:hidden;" +
    "box-shadow:0 18px 50px rgba(0,0,0,.55);font:13px/1.45 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";
  const PRIMARY = "appearance:none;border:0;border-radius:9px;padding:7px 13px;cursor:pointer;font:600 12.5px system-ui,sans-serif;background:#2563eb;color:#fff";
  const GHOST = "appearance:none;border:1px solid rgba(255,255,255,.16);border-radius:9px;padding:6px 11px;cursor:pointer;font:600 12.5px system-ui,sans-serif;background:transparent;color:#e9ebee";
  const DANGER = "appearance:none;border:0;border-radius:9px;padding:6px 11px;cursor:pointer;font:600 12.5px system-ui,sans-serif;background:rgba(220,38,38,.9);color:#fff";
  const FIELD = "width:100%;box-sizing:border-box;background:#111419;color:#e9ebee;border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:6px 8px;font:12px ui-monospace,Menlo,Consolas,monospace";
  bar.innerHTML =
    `<div style="display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.08)">
       <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex:none"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>
       <strong style="font-size:13.5px;flex:1">Inspect &amp; edit</strong>
       <button ${UI}="design" style="${GHOST}">Edit all text</button>
       <button ${UI}="close" title="Exit (Esc)" style="appearance:none;border:0;background:transparent;color:#aab0b8;cursor:pointer;font-size:16px;line-height:1;padding:2px 4px">✕</button>
     </div>
     <div ${UI}="body" style="padding:12px 14px;max-height:50vh;overflow:auto"></div>`;
  const $ = (k) => bar.querySelector(`[${UI}="${k}"]`);
  const body = $("body");

  function renderHint() {
    body.innerHTML = `<div style="color:#aab0b8;font-size:12.5px">Hover an element, then click to inspect &amp; edit it. Esc to exit.</div>`;
  }

  function flash(btn, txt) { const old = btn.textContent; btn.textContent = txt; setTimeout(() => { btn.textContent = old; }, 1400); }
  async function copy(text, btn) { try { await navigator.clipboard.writeText(text); flash(btn, "Copied ✓"); } catch (e) { flash(btn, "Failed"); } }

  // "Save to site CSS": turn the picked element's selector + edited inline style into a persistent
  // rule in chrome.storage("siteCss") — the same store the popup's Custom CSS card + userstyle.js use.
  // Each declaration gets !important so it beats the site's own styles. Applied live now; it persists
  // across reloads once the site's permission is granted (do that once in the popup's Custom CSS card).
  function importantize(style) {
    return String(style || "").split(";").map((s) => s.trim()).filter(Boolean)
      .map((d) => (/!important/i.test(d) ? d : d + " !important")).join("; ");
  }
  async function saveElementCss(btn) {
    // Use the selector captured AT PICK TIME (while the element was attached), and the inline-style
    // the user typed in our bar — so it still works even if the page's own modal closed when the
    // user clicked into the bar (e.g. ChatGPT's project-settings dialog dismisses on outside click),
    // which detaches the element. The saved rule re-applies on reload against the fresh element.
    const styleEl = bar.querySelector(`[${UI}="style"]`);
    const sel = pickedSel || (picked ? selectorFor(picked) : "");
    const decls = importantize((styleEl && styleEl.value) || "");
    if (!sel) { flash(btn, "Pick an element first"); return; }
    if (!decls) { flash(btn, "Type an inline style first (e.g. min-height:320px)"); return; }
    const rule = `${sel} { ${decls} }`;
    const hostname = location.hostname;
    let map = {};
    try { map = (await chrome.storage.local.get("siteCss")).siteCss || {}; } catch (e) {}
    map[hostname] = (map[hostname] ? String(map[hostname]).trimEnd() + "\n" : "") + rule + "\n";
    try { await chrome.storage.local.set({ siteCss: map }); } catch (e) { flash(btn, "Save failed"); return; }
    try {
      let st = document.getElementById("__yoshtool_userstyle");
      if (!st) { st = document.createElement("style"); st.id = "__yoshtool_userstyle"; (document.head || document.documentElement).appendChild(st); }
      st.textContent = map[hostname];
    } catch (e) {}
    flash(btn, "Saved to site CSS ✓");
  }

  function renderCard(el) {
    const tag = el.tagName.toLowerCase();
    const idPart = el.id ? "#" + el.id : "";
    const clsPart = el.classList && el.classList.length ? "." + [...el.classList].join(".") : "";
    const attrs = [...el.attributes].filter((a) => a.name !== "style");
    const styleVal = el.getAttribute("style") || "";
    body.innerHTML =
      `<div style="font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;color:#8bd6ff;word-break:break-all;margin-bottom:10px">${esc(tag)}<span style="color:#f0a">${esc(idPart)}</span><span style="color:#9fe0a0">${esc(clsPart)}</span></div>
       <div style="display:flex;gap:8px;margin-bottom:12px">
         <button ${UI}="edittext" style="${GHOST}">Edit text</button>
         <span style="flex:1"></span>
         <button ${UI}="dup" style="${GHOST}">Duplicate</button>
         <button ${UI}="del" style="${DANGER}">Delete</button>
       </div>
       <div style="color:#aab0b8;font-size:11px;text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px">Attributes</div>
       <div ${UI}="attrs" style="display:flex;flex-direction:column;gap:6px;margin-bottom:8px"></div>
       <div style="display:flex;gap:6px;margin-bottom:12px">
         <input ${UI}="newname" placeholder="new attr" style="${FIELD};flex:0 0 34%" />
         <input ${UI}="newval" placeholder="value" style="${FIELD};flex:1" />
         <button ${UI}="addattr" style="${GHOST};flex:none">Add</button>
       </div>
       <div style="color:#aab0b8;font-size:11px;text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px">Inline style</div>
       <input ${UI}="style" value="${esc(styleVal)}" placeholder="min-height:320px  (height = CSS, not the rows attr)" style="${FIELD};margin-bottom:8px" />
       <button ${UI}="savecss" style="${PRIMARY};width:100%;background:#157c69;margin-bottom:6px">Save style → persistent site CSS</button>
       <div style="color:#8a929c;font-size:11px;margin-bottom:12px">Saves the <b>inline style</b> above as a rule for <code>${esc(selectorFor(el))}</code>. Applies now; to keep it after reload open YoshTool → Tools → <b>Custom CSS</b> → Save. (On pop-up dialogs that close when you click away — e.g. ChatGPT settings — just type the rule straight into Custom CSS instead.)</div>
       <div style="display:flex;gap:8px;flex-wrap:wrap">
         <button ${UI}="ctext" style="${GHOST}">Copy text</button>
         <button ${UI}="csel" style="${GHOST}">Copy selector</button>
         <button ${UI}="chtml" style="${GHOST}">Copy HTML</button>
       </div>`;
    // attribute rows
    const wrap = $("attrs");
    for (const a of attrs) {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:6px;align-items:center";
      const name = document.createElement("span");
      name.textContent = a.name;
      name.style.cssText = "flex:0 0 34%;font:12px ui-monospace,Menlo,Consolas,monospace;color:#aab0b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
      const val = document.createElement("input");
      val.value = a.value; val.style.cssText = FIELD + ";flex:1";
      val.addEventListener("input", () => { try { el.setAttribute(a.name, val.value); if (a.name === "id" || a.name === "class") refreshHeader(el); } catch (e) {} });
      const x = document.createElement("button");
      x.textContent = "✕"; x.title = "Remove attribute"; x.style.cssText = GHOST + ";flex:none;padding:4px 9px";
      x.addEventListener("click", (e) => { e.preventDefault(); try { el.removeAttribute(a.name); } catch (e2) {} renderCard(el); });
      row.append(name, val, x);
      wrap.appendChild(row);
    }
    // wire actions
    $("edittext").onclick = (e) => { e.preventDefault(); toggleTextEdit(el); };
    $("dup").onclick = (e) => { e.preventDefault(); try { const c = el.cloneNode(true); el.parentNode.insertBefore(c, el.nextSibling); } catch (e2) {} };
    $("del").onclick = (e) => { e.preventDefault(); try { el.remove(); } catch (e2) { try { el.style.setProperty("display", "none", "important"); } catch (e3) {} } unlockScroll(el); picked = null; highlight(null); renderHint(); };
    $("addattr").onclick = (e) => { e.preventDefault(); const n = $("newname").value.trim(); if (!n) return; try { el.setAttribute(n, $("newval").value); } catch (e2) {} renderCard(el); };
    $("style").addEventListener("input", (e) => { try { el.setAttribute("style", e.target.value); } catch (e2) {} });
    $("ctext").onclick = (e) => { e.preventDefault(); copy(el.textContent || "", e.currentTarget); };
    $("csel").onclick = (e) => { e.preventDefault(); copy(selectorFor(el), e.currentTarget); };
    $("savecss").onclick = (e) => { e.preventDefault(); saveElementCss(e.currentTarget); };
    $("chtml").onclick = (e) => { e.preventDefault(); copy(el.outerHTML || "", e.currentTarget); };
    const et = $("edittext"); if (editing && picked === el) { et.textContent = "Done editing"; et.style.background = "rgba(180,83,9,.9)"; et.style.borderColor = "transparent"; }
  }
  function refreshHeader(el) { /* light re-render of just the header line */ renderCard(el); }

  function toggleTextEdit(el) {
    if (editing) { endEdit(); return; }
    editing = true; picked = el;
    try {
      el.setAttribute("contenteditable", "plaintext-only");
      if (el.contentEditable !== "plaintext-only") el.setAttribute("contenteditable", "true"); // fallback for older engines
      el.dataset.yoshtoolEdit = "1";
      el.focus();
    } catch (e) {}
    renderCard(el);
  }
  function endEdit() {
    editing = false;
    try { const el = document.querySelector('[data-yoshtool-edit="1"]'); if (el) { el.removeAttribute("contenteditable"); delete el.dataset.yoshtoolEdit; } } catch (e) {}
    try { window.getSelection().removeAllRanges(); } catch (e) {}
    if (picked) renderCard(picked);
  }

  function pick(el) { phase = "picked"; picked = el; try { pickedSel = selectorFor(el); } catch (e) { pickedSel = ""; } highlight(el); renderCard(el); }

  function toggleDesign() {
    designOn = !designOn;
    try { document.designMode = designOn ? "on" : "off"; if (!designOn) window.getSelection().removeAllRanges(); } catch (e) {}
    const b = $("design");
    b.textContent = designOn ? "Stop editing text" : "Edit all text";
    b.style.background = designOn ? "rgba(180,83,9,.9)" : "transparent";
    b.style.borderColor = designOn ? "transparent" : "rgba(255,255,255,.16)";
  }

  // ---- events ----
  const onMove = (e) => {
    if (editing) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || inOwnUi(el) || el === document.documentElement || el === document.body) { if (phase !== "picked") highlight(null); return; }
    highlight(el);
  };
  const onClick = (e) => {
    if (inOwnUi(e.target)) return;   // toolbar
    if (editing) return;              // let clicks place the caret in the element being edited
    const el = document.elementFromPoint(e.clientX, e.clientY);
    e.preventDefault(); e.stopPropagation();
    if (!el || inOwnUi(el) || el === document.documentElement || el === document.body) return;
    pick(el);
  };
  const onKey = (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault(); e.stopPropagation();
    if (editing) endEdit();
    else stop();
  };
  let raf = 0;
  const onScroll = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; if (picked && picked.isConnected) highlight(picked); }); };

  $("design").addEventListener("click", (e) => { e.preventDefault(); toggleDesign(); });
  $("close").addEventListener("click", (e) => { e.preventDefault(); stop(); });

  function stop() {
    if (editing) endEdit();
    if (designOn) { try { document.designMode = "off"; } catch (e) {} }
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", onScroll, true);
    try { hostEl.remove(); } catch (e) {}
    try { delete window[FLAG]; } catch (e) { window[FLAG] = null; }
  }

  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onScroll, true);
  root.append(layer, bar);
  (document.body || document.documentElement).appendChild(hostEl);
  renderHint();
  window[FLAG] = { stop };
})();
