// rail.js
// A floating, collapsible action rail — like an Android edge sidebar — that puts the on-page YoshTool
// tools one click away without opening the popup or the right-click menu. All UI lives in a Shadow DOM
// (fully isolated from page CSS), pinned to the left/right edge; it collapses to a small handle, can be
// dragged up/down and flipped to the other edge, and can be hidden per-site. Registered dynamically on
// all sites (document_idle) only while the "Floating rail" toggle is on and the all-sites permission is
// granted (see background.syncRail). Each action is run by the service worker (which injects the right
// content script); the rail only sends { cmd:"rail-run", action }.
(() => {
  if (window.__yoshtoolRail) return;
  window.__yoshtoolRail = true;

  // Don't run inside frames (top frame only) or on non-http(s) pages.
  try { if (window.top !== window.self) return; } catch (e) { return; }
  if (!/^https?:$/.test(location.protocol)) return;

  const Z = 2147483600;
  const host = (() => { try { return location.hostname || ""; } catch (e) { return ""; } })();
  const contextAlive = () => { try { return !!(chrome.runtime && chrome.runtime.id); } catch (e) { return false; } };

  // ---- state (persisted in chrome.storage.local) ----
  let st = { railOpen: false, railSide: "right", railTop: 0.5, railDisabledHosts: [], railPing: false };
  let mounted = false;
  let hostEl = null, root = null, wrap = null, panel = null, handleEl = null;
  let chipEl = null, pvalEl = null, pdotEl = null, pingTimer = 0;
  let dragging = false, moved = false, dragDX = 0, dragStartY = 0, dragStartClientY = 0;

  const svg = (p) =>
    `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none">${p}</svg>`;

  // On-page actions — each maps to a background "rail-run" action (reusing the same content scripts the
  // context menu / shortcuts inject). Toggling scripts (dark/unlock/font/edit) flip off on a second run.
  const ACTIONS = [
    { key: "screenshot-area", title: "Screenshot area", hide: true, icon: svg('<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"></path><circle cx="12" cy="13" r="3.5"></circle>') },
    { key: "translate", title: "Translate selection", icon: svg('<path d="M5 8l6 6"></path><path d="M4 14l6-6 2-3"></path><path d="M2 5h12"></path><path d="M22 22l-5-10-5 10"></path><path d="M14 18h6"></path>') },
    { key: "fill", title: "Fill form with dummy data", icon: svg('<rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M7 9h4M7 13h7"></path>') },
    { key: "font", title: "Inspect fonts (hover)", icon: svg('<polyline points="4 7 4 4 20 4 20 7"></polyline><line x1="9" y1="20" x2="15" y2="20"></line><line x1="12" y1="4" x2="12" y2="20"></line>') },
    { key: "dark", title: "Toggle dark mode", icon: svg('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"></path>') },
    { key: "unlock", title: "Unlock copy & selection", icon: svg('<rect x="3" y="11" width="18" height="11" rx="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path>') },
    { key: "edit", title: "Inspect & edit an element", icon: svg('<path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path>') },
  ];
  const ICON_FLIP = svg('<path d="m8 6-6 6 6 6"></path><path d="m16 6 6 6-6 6"></path><path d="M3 12h18"></path>');
  const ICON_CLOSE = svg('<path d="M18 6 6 18M6 6l12 12"></path>');

  const CSS = `
    :host { all: initial; }
    .wrap { position: fixed; z-index: 2; display: flex; flex-direction: column; align-items: stretch;
      gap: 5px; pointer-events: auto; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      -webkit-font-smoothing: antialiased; }
    .wrap.left { align-items: flex-start; }
    .wrap.right { align-items: flex-end; }
    /* Collapsed: a slim, translucent tab that barely blocks the page. Hover / open -> solid tosca. */
    .handle { display: flex; align-items: center; justify-content: center; width: 10px; height: 44px;
      background: rgba(21,124,105,.30); color: #fff; border: 0; cursor: grab; padding: 0;
      box-shadow: 0 2px 10px rgba(0,0,0,.16);
      transition: background .15s ease, width .15s ease, box-shadow .15s ease;
      touch-action: none; user-select: none; }
    .wrap.right .handle { border-radius: 9px 0 0 9px; }
    .wrap.left .handle { border-radius: 0 9px 9px 0; }
    .handle:hover, .wrap.open .handle { background: #157c69; width: 16px; box-shadow: 0 4px 14px rgba(0,0,0,.34); }
    .handle:active { cursor: grabbing; }
    .dots { display: flex; flex-direction: column; gap: 3px; pointer-events: none; }
    .dots i { width: 3px; height: 3px; border-radius: 50%; background: currentColor; opacity: .55; }
    .handle:hover .dots i, .wrap.open .dots i { opacity: .95; }
    .panel { display: flex; flex-direction: column; gap: 2px; background: #1f2328;
      border: 1px solid rgba(255,255,255,.14); border-radius: 13px; padding: 5px;
      box-shadow: 0 10px 30px rgba(0,0,0,.5); }
    .btn { width: 36px; height: 34px; display: flex; align-items: center; justify-content: center; border: 0;
      background: transparent; color: #e7e9ec; border-radius: 9px; cursor: pointer; padding: 0; }
    .btn:hover { background: rgba(255,255,255,.13); }
    .sep { height: 1px; background: rgba(255,255,255,.1); margin: 3px 4px; }
    .foot { display: flex; flex-direction: column; gap: 2px; }
    .foot .btn { height: 26px; color: #9aa1ab; }
    .foot .btn:hover { color: #e7e9ec; }
    .foot .btn svg { width: 14px; height: 14px; }
    /* live ping chip (current site round-trip) */
    .chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px; border-radius: 8px;
      background: rgba(31,35,40,.82); color: #e7e9ec; cursor: pointer;
      font: 600 10.5px/1 ui-monospace, Menlo, Consolas, monospace; white-space: nowrap;
      box-shadow: 0 2px 10px rgba(0,0,0,.25); }
    .chip .pdot { width: 6px; height: 6px; border-radius: 50%; background: #9aa1ab; flex: none; }
    .hidden { display: none !important; }
  `;

  function isDisabledHere() {
    return Array.isArray(st.railDisabledHosts) && host && st.railDisabledHosts.includes(host);
  }

  function run(action) {
    if (!contextAlive()) return;
    try { chrome.runtime.sendMessage({ cmd: "rail-run", action }); } catch (e) {}
  }

  // For a screenshot the rail must not be in the shot: hide the whole host, restore when the window
  // regains focus (after the capture) or after a fallback timeout.
  function hideForCapture() {
    if (!hostEl) return;
    hostEl.style.visibility = "hidden";
    const restore = () => { if (hostEl) hostEl.style.visibility = ""; window.removeEventListener("focus", restore); clearTimeout(t); };
    const t = setTimeout(restore, 12000);
    window.addEventListener("focus", restore);
  }

  // ---- live ping chip (same-origin round-trip to the current site) ----
  function pingOnce() {
    return new Promise((resolve) => {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 4000);
      const t0 = performance.now();
      fetch(location.origin + "/?__yoshping=" + Date.now(), { method: "HEAD", cache: "no-store", signal: ctrl.signal })
        .then(() => resolve(performance.now() - t0))
        .catch(() => resolve(null))
        .finally(() => clearTimeout(to));
    });
  }
  function paintChip(rtt) {
    if (!pvalEl || !pdotEl) return;
    if (rtt == null) { pvalEl.textContent = "—"; pdotEl.style.background = "#9aa1ab"; return; }
    const ms = Math.round(rtt);
    pvalEl.textContent = ms + "ms";
    pdotEl.style.background = ms < 100 ? "#4ade80" : ms < 300 ? "#fbbf24" : "#f87171";
  }
  async function pingTick() { paintChip(await pingOnce()); }
  function startPingLoop() {
    if (pingTimer || !chipEl) return;
    chipEl.classList.remove("hidden");
    pvalEl.textContent = "…"; pdotEl.style.background = "#9aa1ab";
    pingTick();
    pingTimer = setInterval(pingTick, 3000);
    place();
  }
  function stopPingLoop() {
    if (pingTimer) { clearInterval(pingTimer); pingTimer = 0; }
    if (chipEl) chipEl.classList.add("hidden");
    if (mounted) place();
  }

  function persist() {
    if (!contextAlive()) return;
    try {
      chrome.storage.local.set({
        railOpen: st.railOpen, railSide: st.railSide, railTop: st.railTop,
        railDisabledHosts: st.railDisabledHosts,
      });
    } catch (e) {}
  }

  // ---- layout ----
  function place() {
    if (!wrap) return;
    wrap.classList.toggle("left", st.railSide === "left");
    wrap.classList.toggle("right", st.railSide !== "left");
    wrap.style.left = st.railSide === "left" ? "0px" : "";
    wrap.style.right = st.railSide === "left" ? "" : "0px";
    const h = wrap.offsetHeight || 60;
    const top = Math.max(6, Math.min((st.railTop || 0.5) * window.innerHeight - h / 2, window.innerHeight - h - 6));
    wrap.style.top = top + "px";
  }

  function renderOpen() {
    if (!panel || !wrap) return;
    panel.classList.toggle("hidden", !st.railOpen);
    wrap.classList.toggle("open", st.railOpen); // solid tosca handle while open
    place();
  }

  // ---- build ----
  function build() {
    if (mounted) return;
    mounted = true;
    hostEl = document.createElement("div");
    hostEl.setAttribute("data-yoshtool-rail", "");
    hostEl.style.cssText = `position:fixed;inset:0;z-index:${Z};pointer-events:none`;
    root = hostEl.attachShadow ? hostEl.attachShadow({ mode: "open" }) : hostEl;
    const style = document.createElement("style");
    style.textContent = CSS;
    root.appendChild(style);

    wrap = document.createElement("div");
    wrap.className = "wrap " + (st.railSide === "left" ? "left" : "right") + (st.railOpen ? " open" : "");

    chipEl = document.createElement("div");
    chipEl.className = "chip" + (st.railPing ? "" : " hidden");
    chipEl.title = "Round-trip to this site (HTTP, not ICMP)";
    chipEl.innerHTML = `<span class="pdot"></span><span class="pval">…</span>`;
    pdotEl = chipEl.querySelector(".pdot");
    pvalEl = chipEl.querySelector(".pval");
    chipEl.addEventListener("click", (e) => { e.stopPropagation(); toggleOpen(); });

    handleEl = document.createElement("button");
    handleEl.className = "handle";
    handleEl.title = "YoshTool — drag to move, click to open/close";
    handleEl.innerHTML = `<span class="dots"><i></i><i></i><i></i></span>`;
    handleEl.addEventListener("pointerdown", onDown);
    handleEl.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); if (!moved) toggleOpen(); });

    panel = document.createElement("div");
    panel.className = "panel" + (st.railOpen ? "" : " hidden");
    for (const a of ACTIONS) {
      const b = document.createElement("button");
      b.className = "btn";
      b.title = a.title;
      b.setAttribute("aria-label", a.title);
      b.innerHTML = a.icon;
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        if (a.hide) hideForCapture();
        run(a.key);
      });
      panel.appendChild(b);
    }
    const sep = document.createElement("div");
    sep.className = "sep";
    panel.appendChild(sep);

    const foot = document.createElement("div");
    foot.className = "foot";
    const flip = document.createElement("button");
    flip.className = "btn";
    flip.title = "Move to the other edge";
    flip.innerHTML = ICON_FLIP;
    flip.addEventListener("click", (e) => { e.stopPropagation(); st.railSide = st.railSide === "left" ? "right" : "left"; place(); persist(); });
    const close = document.createElement("button");
    close.className = "btn";
    close.title = "Hide the rail on this site";
    close.innerHTML = ICON_CLOSE;
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      if (host && !st.railDisabledHosts.includes(host)) st.railDisabledHosts = [...st.railDisabledHosts, host];
      persist();
      teardown();
    });
    foot.append(flip, close);
    panel.appendChild(foot);

    wrap.append(chipEl, handleEl, panel);
    root.appendChild(wrap);
    (document.body || document.documentElement).appendChild(hostEl);
    requestAnimationFrame(place);

    window.addEventListener("resize", place);
    window.addEventListener("fullscreenchange", onFullscreen);
    if (st.railPing) startPingLoop();
  }

  function teardown() {
    stopPingLoop();
    window.removeEventListener("resize", place);
    window.removeEventListener("fullscreenchange", onFullscreen);
    if (hostEl) { try { hostEl.remove(); } catch (e) {} }
    hostEl = root = wrap = panel = handleEl = chipEl = pvalEl = pdotEl = null;
    mounted = false;
  }

  function onFullscreen() {
    if (!hostEl) return;
    hostEl.style.display = document.fullscreenElement ? "none" : "";
  }

  function toggleOpen() { st.railOpen = !st.railOpen; renderOpen(); persist(); }

  // ---- drag (handle) ----
  function onDown(e) {
    if (e.button != null && e.button !== 0) return;
    dragging = true; moved = false;
    dragStartClientY = e.clientY;
    const rect = wrap.getBoundingClientRect();
    dragStartY = rect.top;
    dragDX = e.clientX;
    try { handleEl.setPointerCapture(e.pointerId); } catch (err) {}
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }
  function onMove(e) {
    if (!dragging || !wrap) return;
    const dy = e.clientY - dragStartClientY;
    if (Math.abs(dy) > 4 || Math.abs(e.clientX - dragDX) > 4) moved = true;
    if (!moved) return;
    const h = wrap.offsetHeight || 60;
    const top = Math.max(6, Math.min(dragStartY + dy, window.innerHeight - h - 6));
    wrap.style.top = top + "px";
    st.railTop = (top + h / 2) / window.innerHeight;
    // flip side when dragged across the horizontal midpoint
    const side = e.clientX < window.innerWidth / 2 ? "left" : "right";
    if (side !== st.railSide) { st.railSide = side; place(); wrap.style.top = top + "px"; }
  }
  function onUp(e) {
    dragging = false;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    try { handleEl.releasePointerCapture(e.pointerId); } catch (err) {}
    if (moved) persist();
    // a tiny timeout so the click handler can read `moved` before it resets
    setTimeout(() => { moved = false; }, 0);
  }

  // ---- mount/unmount driven by per-site disable + storage ----
  function refresh() {
    if (isDisabledHere()) { if (mounted) teardown(); return; }
    if (!mounted) build();
    else { renderOpen(); place(); }
  }

  try {
    chrome.storage.local.get(["railOpen", "railSide", "railTop", "railDisabledHosts", "railPing"], (r) => {
      if (r) {
        if (typeof r.railOpen === "boolean") st.railOpen = r.railOpen;
        if (r.railSide === "left" || r.railSide === "right") st.railSide = r.railSide;
        if (typeof r.railTop === "number") st.railTop = r.railTop;
        if (Array.isArray(r.railDisabledHosts)) st.railDisabledHosts = r.railDisabledHosts;
        if (typeof r.railPing === "boolean") st.railPing = r.railPing;
      }
      refresh();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.railEnabled && changes.railEnabled.newValue === false) { teardown(); try { delete window.__yoshtoolRail; } catch (e) {} return; }
      if (changes.railDisabledHosts) { st.railDisabledHosts = Array.isArray(changes.railDisabledHosts.newValue) ? changes.railDisabledHosts.newValue : []; refresh(); }
      if (changes.railSide && (changes.railSide.newValue === "left" || changes.railSide.newValue === "right")) { st.railSide = changes.railSide.newValue; if (mounted) place(); }
      if (changes.railTop && typeof changes.railTop.newValue === "number") { st.railTop = changes.railTop.newValue; if (mounted) place(); }
      if (changes.railOpen && typeof changes.railOpen.newValue === "boolean") { st.railOpen = changes.railOpen.newValue; if (mounted) renderOpen(); }
      if (changes.railPing && typeof changes.railPing.newValue === "boolean") {
        st.railPing = changes.railPing.newValue;
        if (mounted) { if (st.railPing) startPingLoop(); else stopPingLoop(); }
      }
    });
  } catch (e) { refresh(); }
})();
