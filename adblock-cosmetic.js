// adblock-cosmetic.js — content script (classic; it CANNOT import). Hides ad/tracker elements.
// Plain CSS selectors are applied as a single <style>; PROCEDURAL selectors (uBO/AdGuard "#?#"
// style: :has-text / :matches-attr / :matches-css / :upward / :min-text-length) are evaluated in
// JS and re-applied on DOM mutations, so they survive randomized class names. Registered on all
// sites (document_start) only when the cosmetic toggle is on AND the all-sites permission is
// granted (see background.js syncCosmeticScripts). Respects the per-site allowlist.
//
// The function bodies below are BYTE-IDENTICAL inline copies of adblock-cosmetic-core.js and
// adblock-procedural-core.js — keep them in sync (see CONTRIBUTING).
(() => {
  if (window.__yoshtoolAdblockCosmetic) return;
  window.__yoshtoolAdblockCosmetic = true;

  // ---- inline copy of adblock-cosmetic-core.js (keep byte-identical) ----
  function domainsOf(host) {
    const h = String(host || "").toLowerCase().replace(/^\.+|\.+$/g, "");
    if (!h) return [];
    const parts = h.split(".");
    const out = [];
    for (let i = 0; i < parts.length - 1; i++) out.push(parts.slice(i).join("."));
    return out;
  }
  function selectorsForHost(data, host) {
    const generic = data && Array.isArray(data.generic) ? data.generic : [];
    const specific = (data && data.specific) || {};
    const set = new Set(generic);
    for (const d of domainsOf(host)) {
      const list = specific[d];
      if (Array.isArray(list)) for (const s of list) set.add(s);
    }
    return [...set];
  }
  function buildCosmeticCss(selectors) {
    if (!selectors || !selectors.length) return "";
    return selectors.join(",\n") + "{display:none!important}";
  }
  // ---- end inline copy ----

  // ---- inline copy of adblock-procedural-core.js (keep byte-identical) ----
  const PROCEDURAL_OPS = ["has-text", "min-text-length", "matches-css", "matches-attr", "upward"];
  function isProcedural(selector) {
    const s = String(selector || "");
    for (const op of PROCEDURAL_OPS) if (s.includes(":" + op + "(")) return true;
    return false;
  }
  function splitList(selectors) {
    const plain = [];
    const procedural = [];
    for (const s of selectors || []) (isProcedural(s) ? procedural : plain).push(s);
    return { plain, procedural };
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

  const STYLE_ID = "__yoshtool_adblock_cosmetic";
  const host = location.hostname;

  // Same semantics as the network allowlist: an entry covers that host and its subdomains.
  function hostAllowlisted(list) {
    if (!Array.isArray(list)) return false;
    const h = host.toLowerCase();
    return list.some((d) => {
      d = String(d).toLowerCase();
      return h === d || h.endsWith("." + d);
    });
  }

  // ---- procedural evaluation (DOM-only; not in the core module) ----
  function makeTester(arg) {
    const v = parseValueArg(arg);
    if (v.re) {
      try { const re = new RegExp(v.re.source, v.re.flags); return (s) => re.test(String(s == null ? "" : s)); }
      catch (e) { return () => false; }
    }
    const t = v.text;
    return (s) => String(s == null ? "" : s).includes(t);
  }
  // Split a :matches-attr arg into a name tester and an optional value tester.
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
    if (!p) return [];
    let list;
    try { list = Array.prototype.slice.call(document.querySelectorAll(p.subject || "*")); }
    catch (e) { return []; }
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

  const HIDDEN = "__yoshtoolHidden";
  function applyProcedural(selectors) {
    for (const sel of selectors) {
      let nodes;
      try { nodes = evalProcedural(sel); } catch (e) { continue; }
      for (const el of nodes) {
        if (el && el.nodeType === 1 && !el.dataset[HIDDEN]) {
          try { el.style.setProperty("display", "none", "important"); el.dataset[HIDDEN] = "1"; } catch (e) {}
        }
      }
    }
  }

  async function run() {
    let data, allowlist;
    try {
      const [res, st] = await Promise.all([
        fetch(chrome.runtime.getURL("rule_resources/cosmetics.json")),
        chrome.storage.local.get("adblockAllowlist"),
      ]);
      data = await res.json();
      allowlist = st.adblockAllowlist;
    } catch {
      return; // extension updated / context gone
    }
    if (hostAllowlisted(allowlist)) return;

    const { plain, procedural } = splitList(selectorsForHost(data, host));

    // Plain selectors → one <style> (fast, handled by the browser's CSS engine).
    const css = buildCosmeticCss(plain);
    if (css && !document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = css;
      (document.head || document.documentElement).appendChild(style);
    }

    // Procedural selectors → JS evaluation now + on DOM mutations (debounced).
    if (procedural.length) {
      const apply = () => applyProcedural(procedural);
      apply();
      let raf = 0;
      const schedule = () => { if (raf) return; raf = setTimeout(() => { raf = 0; apply(); }, 300); };
      try {
        const mo = new MutationObserver(schedule);
        mo.observe(document.documentElement || document, { childList: true, subtree: true });
      } catch (e) {}
      // A couple of settle passes for late-rendered content.
      setTimeout(apply, 800);
      setTimeout(apply, 2000);
    }
  }
  run();
})();
