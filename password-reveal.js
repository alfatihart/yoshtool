// password-reveal.js — content script (classic; injected on demand, all frames).
// Chrome has no native "reveal password" control on page fields (Edge's ::-ms-reveal is Edge-only),
// so this adds one: it flips every visible <input type=password> to type=text (and back). Re-injecting
// toggles it off. Pierces open shadow roots; re-masks on submit / page-hide so a plaintext value isn't
// left for the browser's autocomplete or a screen reader. The value is never read, stored, or logged.
(() => {
  const FLAG = "__yoshtoolPwReveal";
  if (window[FLAG]) { try { window[FLAG].toggle(); } catch (e) {} return; }

  const MARK = "yoshtoolPwReveal"; // dataset key ↔ attribute data-yoshtool-pw-reveal

  const visible = (el) => {
    try {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return false; // offsetParent is unreliable in shadow DOM
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    } catch (e) { return false; }
  };
  // Collect visible password inputs in a document/shadow tree, recursing into open shadow roots.
  function fields(root, out) {
    out = out || [];
    try {
      root.querySelectorAll("input[type=password]").forEach((f) => { if (visible(f)) out.push(f); });
      root.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) fields(el.shadowRoot, out); });
    } catch (e) {}
    return out;
  }

  let shown = false;
  function reveal() {
    const list = fields(document);
    for (const f of list) { try { f.dataset[MARK] = "1"; f.type = "text"; } catch (e) {} }
    shown = true;
    toast(list.length ? "Passwords shown — click again to hide" : "No hidden password field found");
  }
  // Re-mask every field we revealed, recursing into open shadow roots (a flat querySelectorAll would
  // miss shadow-DOM fields).
  function maskDeep(root) {
    try {
      root.querySelectorAll("input[data-yoshtool-pw-reveal]").forEach((f) => { try { f.type = "password"; } catch (e) {} delete f.dataset[MARK]; });
      root.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) maskDeep(el.shadowRoot); });
    } catch (e) {}
  }
  function mask() { maskDeep(document); shown = false; }
  function remaskAll() { if (shown) mask(); }

  // Minimal self-contained toast (bottom-center), auto-removed. No page CSS dependency.
  let toastEl = null, toastTimer = 0;
  function toast(msg) {
    try {
      if (!toastEl) {
        toastEl = document.createElement("div");
        toastEl.setAttribute("data-yoshtool-pw-reveal-ui", "toast");
        toastEl.style.cssText =
          "position:fixed;z-index:2147483000;left:50%;bottom:22px;transform:translateX(-50%);" +
          "background:#1b1e23;color:#e9ebee;padding:9px 14px;border-radius:10px;border:1px solid rgba(255,255,255,.14);" +
          "box-shadow:0 12px 34px rgba(0,0,0,.5);font:13px/1.3 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;pointer-events:none";
        (document.body || document.documentElement).appendChild(toastEl);
      }
      toastEl.textContent = msg;
      toastEl.style.opacity = "1";
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { if (toastEl) { toastEl.style.transition = "opacity .25s"; toastEl.style.opacity = "0"; setTimeout(() => { try { toastEl.remove(); } catch (e) {} toastEl = null; }, 260); } }, 2200);
    } catch (e) {}
  }

  // Re-mask before the value could leak via autocomplete/screen-reader on submit or navigation.
  document.addEventListener("submit", remaskAll, true);
  window.addEventListener("pagehide", remaskAll, true);

  window[FLAG] = {
    toggle() { shown ? mask() : reveal(); },
  };
  reveal();
})();
