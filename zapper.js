// zapper.js — content script (classic; injected on demand from the popup / a command).
// "Zap" mode: hover highlights the element under the cursor, click removes it from the page. This is
// a ONE-SHOT cleanup — nothing is saved and nothing re-applies on reload (that's the picker's job).
// Great for killing a stray overlay/ad (e.g. a judol interstitial) the filters missed. Re-injecting
// while active tears it down (toggle). All UI is namespaced + self-contained; Esc quits.
(() => {
  const FLAG = "__yoshtoolZapper";
  if (window[FLAG]) { try { window[FLAG].stop(); } catch (e) {} return; }

  const UI = "data-yoshtool-zapper";
  const Z = 2147483000;
  let target = null;

  const inOwnUi = (node) => {
    try {
      const el = node && node.nodeType === 1 ? node : node && node.parentElement;
      return !!(el && el.closest && el.closest(`[${UI}]`));
    } catch (e) { return false; }
  };

  // Full-viewport highlight box (pointer-events:none so it never eats the hover hit-test).
  const box = document.createElement("div");
  box.setAttribute(UI, "box");
  box.style.cssText =
    `position:fixed;z-index:${Z};pointer-events:none;display:none;box-sizing:border-box;` +
    "background:rgba(220,38,38,.18);outline:2px solid #dc2626;outline-offset:-1px;border-radius:2px;" +
    "transition:all .04s linear";

  // Small hint bar (bottom-center) with a Done button.
  const bar = document.createElement("div");
  bar.setAttribute(UI, "bar");
  bar.style.cssText =
    `position:fixed;z-index:${Z + 1};left:50%;bottom:20px;transform:translateX(-50%);` +
    "display:flex;align-items:center;gap:11px;background:#1b1e23;color:#e9ebee;padding:9px 11px 9px 14px;" +
    "border-radius:12px;border:1px solid rgba(255,255,255,.12);box-shadow:0 14px 40px rgba(0,0,0,.5);" +
    "font:13px/1.3 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;max-width:calc(100vw - 32px)";
  const icon = document.createElement("span");
  icon.innerHTML =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#dc2626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 3 7.07 16.97 2.51-7.39 7.39-2.51L3 3z"></path><path d="m13 13 6 6"></path></svg>';
  icon.style.cssText = "display:flex;flex:none";
  const label = document.createElement("span");
  label.textContent = "Click an element to remove it · Esc to exit";
  const done = document.createElement("button");
  done.setAttribute(UI, "done");
  done.textContent = "Done";
  done.style.cssText =
    "appearance:none;border:1px solid rgba(255,255,255,.16);border-radius:9px;padding:6px 14px;cursor:pointer;" +
    "background:transparent;color:#e9ebee;font:600 12.5px system-ui,sans-serif;flex:none";
  done.addEventListener("click", (e) => { e.stopPropagation(); e.preventDefault(); stop(); });
  bar.append(icon, label, done);

  function place(el) {
    const r = el.getBoundingClientRect();
    box.style.left = r.left + "px";
    box.style.top = r.top + "px";
    box.style.width = r.width + "px";
    box.style.height = r.height + "px";
    box.style.display = "block";
  }

  // After removing a modal/overlay, pages often leave the body scroll-locked. If the zapped element
  // (or an ancestor) was fixed/sticky or high z-index, restore scrolling. (uBO does the same.)
  function unlockScroll(el) {
    let n = el, overlayish = false;
    for (let i = 0; n && i < 6; i++, n = n.parentElement) {
      let cs; try { cs = getComputedStyle(n); } catch (e) { break; }
      const pos = cs.position;
      if (pos === "fixed" || pos === "sticky" || (parseInt(cs.zIndex, 10) || 0) >= 1000) { overlayish = true; break; }
    }
    if (!overlayish) return;
    for (const root of [document.documentElement, document.body]) {
      if (!root) continue;
      try {
        const cs = getComputedStyle(root);
        if (cs.overflow === "hidden" || cs.overflowY === "hidden") {
          root.style.setProperty("overflow", "auto", "important");
        }
        if (cs.position === "fixed") root.style.setProperty("position", "static", "important");
      } catch (e) {}
    }
  }

  const onMove = (e) => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || inOwnUi(el) || el === document.documentElement || el === document.body) {
      target = null; box.style.display = "none"; return;
    }
    target = el;
    place(el);
  };
  const onClick = (e) => {
    if (inOwnUi(e.target)) return; // clicking the bar / Done
    e.preventDefault(); e.stopPropagation();
    const el = target || document.elementFromPoint(e.clientX, e.clientY);
    if (!el || inOwnUi(el) || el === document.documentElement || el === document.body) return;
    box.style.display = "none";
    try { el.remove(); } catch (e2) { try { el.style.setProperty("display", "none", "important"); } catch (e3) {} }
    unlockScroll(el);
    target = null;
  };
  const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); stop(); } };
  let raf = 0;
  const onScroll = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; if (target && target.isConnected) place(target); else box.style.display = "none"; });
  };

  function stop() {
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", onScroll, true);
    try { box.remove(); } catch (e) {}
    try { bar.remove(); } catch (e) {}
    try { delete window[FLAG]; } catch (e) { window[FLAG] = null; }
  }

  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onScroll, true);
  (document.body || document.documentElement).append(box, bar);
  window[FLAG] = { stop };
})();
