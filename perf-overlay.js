// perf-overlay.js — on-demand (classic) content script. A floating, self-contained performance LAB in
// a Shadow DOM (fully isolated from page CSS), like DevTools' Performance panel but as an overlay that
// does NOT resize the page. It offers CPU / Network / device throttle pickers and a "Record & reload"
// button; the service worker (background.handlePerfOverlayRun) does the cold reload under that profile
// while recording a screencast (filmstrip) and the Network timeline (request waterfall), plus Core Web
// Vitals. Because the cold reload destroys this overlay, background stores the run in
// chrome.storage.local ("perfOverlayResult") and re-injects this script, which then reads it and shows
// the results. Injected via chrome.scripting.executeScript({files:["perf-overlay.js"]}).
//
// THRESHOLDS / rate / fmtDuration / fmtBytes below are a BYTE-IDENTICAL inline copy of perf-core.js
// (a classic content script can't import) — keep in sync. The heavy lifting (filmstrip downsampling,
// waterfall shaping) is done in background via perf-core and arrives pre-computed, so it isn't copied.
(() => {
  // Re-inject from the popup should refresh (not toggle off); a fresh page load re-initialises.
  if (window.__yoshtoolPerfOverlay) {
    try { window.__yoshtoolPerfOverlay.refresh(); } catch (e) {}
    return;
  }
  try { if (window.top !== window.self) return; } catch (e) { return; }
  if (!/^https?:$/.test(location.protocol)) return;

  const Z = 2147483600;
  const contextAlive = () => { try { return !!(chrome.runtime && chrome.runtime.id); } catch (e) { return false; } };

  // ---- inline copy of perf-core.js helpers (keep IDENTICAL) ----
  const THRESHOLDS = {
    lcp: [2500, 4000],
    cls: [0.1, 0.25],
    inp: [200, 500],
    fcp: [1800, 3000],
    ttfb: [800, 1800],
    load: [2500, 5000],
  };
  function rate(name, value) {
    const t = THRESHOLDS[name];
    if (!t || value == null || Number.isNaN(value)) return "";
    return value <= t[0] ? "good" : value <= t[1] ? "needs-improvement" : "poor";
  }
  function fmtDuration(ms) {
    if (ms == null || Number.isNaN(ms)) return "—";
    return ms >= 1000 ? (ms / 1000).toFixed(2) + " s" : Math.round(ms) + " ms";
  }
  function fmtBytes(n) {
    if (!n || Number.isNaN(n)) return "—";
    if (n >= 1048576) return (n / 1048576).toFixed(1) + " MB";
    if (n >= 1024) return Math.round(n / 1024) + " KB";
    return n + " B";
  }
  // ---- end inline copy ----

  const RATE_COLOR = { good: "#4ade80", "needs-improvement": "#fbbf24", poor: "#f87171", "": "#e7e9ec" };
  // Waterfall phase colours — keep in sync with perf-core.js PHASE_COLORS.
  const PHASE_COLOR = { stalled: "#8b93a0", dns: "#14b8a6", connect: "#f59e0b", ssl: "#a855f7", send: "#38bdf8", wait: "#22c55e", download: "#2f74c0", total: "#2f74c0" };
  const LCP_PHASE_CLS = { TTFB: "p-ttfb", "Load delay": "p-delay", "Load duration": "p-load", "Render delay": "p-render" };
  const SEV_COLOR = { bad: "#f87171", warn: "#fbbf24", good: "#4ade80", info: "#8b93a0" };
  const CPU_OPTS = [
    { k: "none", label: "No throttle" },
    { k: "4x", label: "4× slowdown" },
    { k: "6x", label: "6× slowdown" },
  ];
  const NET_OPTS = [
    { k: "none", label: "No throttle" },
    { k: "slow4g", label: "Slow 4G" },
    { k: "fast4g", label: "Fast 4G" },
    { k: "slow3g", label: "Slow 3G" },
  ];
  const DEV_OPTS = [
    { k: "desktop", label: "Desktop" },
    { k: "mobile", label: "Mobile" },
  ];
  const LABELS = {
    cpu: Object.fromEntries(CPU_OPTS.map((o) => [o.k, o.label])),
    net: Object.fromEntries(NET_OPTS.map((o) => [o.k, o.label])),
    device: Object.fromEntries(DEV_OPTS.map((o) => [o.k, o.label])),
  };

  let profile = { cpu: "4x", net: "slow4g", device: "desktop" };
  let hostEl = null, root = null;
  let bodyEl = null, statusEl = null, recBtn = null;
  let ddMenuEl = null, ddOutside = null, ddOpenKey = null; // custom dropdown state
  let filmstrip = []; // the current run's frames, for the zoom lightbox
  let lbEl = null, lbIdx = 0;
  let lastRes = null, activeTab = "speed"; // tabbed results (Speed / Insights / Network)

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const CSS = `
    :host { all: initial; }
    /* subtle, themed scrollbars (match the popup's) instead of the browser default. Uses the webkit
       pseudo-elements only — setting scrollbar-width/color would disable these in current Chrome. */
    ::-webkit-scrollbar { width: 9px; height: 9px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(255,255,255,.22); border-radius: 9px; border: 2px solid #1b1e23; }
    ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,.34); }
    ::-webkit-scrollbar-corner { background: transparent; }
    .ov { position: fixed; top: 16px; right: 16px; width: 440px; max-width: calc(100vw - 32px);
      max-height: calc(100vh - 32px); overflow: auto; background: #1b1e23; color: #e7e9ec;
      border: 1px solid rgba(255,255,255,.12); border-radius: 14px; box-shadow: 0 20px 55px rgba(0,0,0,.5);
      font: 12.5px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; -webkit-font-smoothing: antialiased; }
    .hd { display: flex; align-items: center; gap: 9px; padding: 11px 13px; border-bottom: 1px solid rgba(255,255,255,.08);
      position: sticky; top: 0; background: #1b1e23; z-index: 1; }
    .hd svg { width: 16px; height: 16px; color: #35b49b; flex: none; }
    .hd b { font-size: 13.5px; flex: 1; }
    .hd .sub { color: #8b93a0; font: 10.5px ui-monospace, Menlo, Consolas, monospace; }
    .hd .x { color: #9aa1ab; cursor: pointer; font-size: 16px; line-height: 1; padding: 2px 4px; border-radius: 6px; }
    .hd .x:hover { background: rgba(255,255,255,.1); color: #e7e9ec; }
    .bd { padding: 12px 13px; }
    .ctrls { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-bottom: 10px; }
    .fld { background: #0f1419; border: 1px solid rgba(255,255,255,.14); border-radius: 8px; padding: 5px 8px; }
    .fld .k { color: #8b93a0; font-size: 9px; text-transform: uppercase; letter-spacing: .05em; display: block; margin-bottom: 2px; }
    /* custom dropdown (styled to the overlay, not the OS/browser default select) */
    .dd { position: relative; }
    .ddbtn { width: 100%; appearance: none; background: transparent; border: 0; color: #e7e9ec; font: 600 12px system-ui;
      cursor: pointer; padding: 0; outline: none; display: flex; align-items: center; justify-content: space-between; gap: 6px; text-align: left; }
    .ddbtn .lbl { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ddbtn .chev { width: 12px; height: 12px; color: #8b93a0; flex: none; }
    .ddmenu { position: fixed; z-index: 6; background: #11161d; border: 1px solid rgba(255,255,255,.18); border-radius: 9px;
      padding: 4px; box-shadow: 0 14px 34px rgba(0,0,0,.55); pointer-events: auto; }
    .ddmenu .opt { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 7px 9px; border-radius: 6px;
      cursor: pointer; color: #e7e9ec; font: 12px system-ui; white-space: nowrap; }
    .ddmenu .opt:hover { background: rgba(255,255,255,.08); }
    .ddmenu .opt.sel { background: rgba(53,180,155,.16); }
    .ddmenu .opt .ck { color: #35b49b; width: 12px; text-align: right; }
    .rec { width: 100%; appearance: none; border: 0; border-radius: 9px; padding: 9px; cursor: pointer;
      font: 700 13px system-ui; background: #157c69; color: #fff; display: flex; align-items: center; justify-content: center; gap: 7px; }
    .rec:hover { background: #1a8f78; }
    .rec:disabled { opacity: .6; cursor: default; }
    .rec svg { width: 15px; height: 15px; }
    .status { margin-top: 9px; font-size: 11.5px; color: #8b93a0; display: flex; align-items: center; gap: 7px; }
    .status.err { color: #f87171; }
    .spin { width: 12px; height: 12px; border: 2px solid rgba(255,255,255,.25); border-top-color: #35b49b; border-radius: 50%;
      animation: pov-spin .7s linear infinite; flex: none; }
    @keyframes pov-spin { to { transform: rotate(360deg); } }
    .sec { margin-top: 14px; }
    h5 { margin: 0 0 6px; font-size: 9.5px; letter-spacing: .07em; text-transform: uppercase; color: #8b93a0; font-weight: 700; }
    .vit { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; }
    .vit .m { background: #0f1419; border: 1px solid rgba(255,255,255,.08); border-radius: 8px; padding: 7px 4px; text-align: center; }
    .vit .m .lab { color: #8b93a0; font-size: 9.5px; font-weight: 700; letter-spacing: .03em; }
    .vit .m .num { font-weight: 800; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 13px; margin-top: 2px; }
    .film { display: flex; gap: 5px; overflow-x: auto; padding-bottom: 3px; }
    .film::-webkit-scrollbar { height: 6px; }
    .film::-webkit-scrollbar-thumb { background: rgba(255,255,255,.18); border-radius: 3px; }
    .film .f { flex: 0 0 136px; cursor: pointer; }
    .film .f .thumb { height: 86px; border-radius: 5px; border: 1px solid rgba(255,255,255,.1); background: #11161d top/cover no-repeat; transition: outline-color .1s; }
    .film .f:hover .thumb { outline: 2px solid rgba(53,180,155,.6); outline-offset: -2px; }
    .film .f.lcp .thumb { outline: 2px solid #35b49b; outline-offset: -2px; }
    .film .f .t { font: 10px ui-monospace, Menlo, monospace; color: #8b93a0; text-align: center; margin-top: 3px; }
    .film .f.lcp .t { color: #35b49b; }
    /* frame zoom lightbox */
    .lb { position: fixed; inset: 0; z-index: 5; background: rgba(8,10,13,.88); display: flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 12px; padding: 28px 24px; pointer-events: auto; }
    .lb img { max-width: min(92vw, 1100px); max-height: 70vh; border-radius: 8px; border: 1px solid rgba(255,255,255,.16);
      box-shadow: 0 20px 60px rgba(0,0,0,.6); background: #fff; }
    .lb .cap { display: flex; align-items: center; gap: 12px; color: #e7e9ec; font: 12.5px system-ui; }
    .lb .cap .time { font-family: ui-monospace, Menlo, monospace; font-weight: 700; }
    .lb .cap .lcpb { background: #157c69; color: #fff; border-radius: 6px; padding: 2px 8px; font-size: 10px; font-weight: 700; letter-spacing: .05em; }
    .lb .nav { display: flex; align-items: center; gap: 10px; }
    .lb .nav button { appearance: none; border: 1px solid rgba(255,255,255,.2); background: rgba(255,255,255,.08); color: #e7e9ec;
      width: 38px; height: 38px; border-radius: 9px; cursor: pointer; font-size: 18px; line-height: 1; }
    .lb .nav button:hover { background: rgba(255,255,255,.16); }
    .lb .nav button:disabled { opacity: .35; cursor: default; }
    .lb .nav .idx { color: #c6ccd4; font: 11.5px ui-monospace, Menlo, monospace; min-width: 58px; text-align: center; }
    .lb .close { position: absolute; top: 14px; right: 18px; color: #cdd3da; cursor: pointer; font-size: 22px; line-height: 1; padding: 4px 6px; border-radius: 7px; }
    .lb .close:hover { background: rgba(255,255,255,.12); color: #fff; }
    .lb .hint { color: #8b93a0; font-size: 11px; }
    .wf { display: flex; flex-direction: column; gap: 4px; }
    .note { font-size: 10.5px; color: #8b93a0; margin-top: 12px; }
    .empty { color: #8b93a0; font-size: 11.5px; margin-top: 12px; }
    /* tabs */
    .tabs { display: flex; gap: 4px; background: #0f1419; border: 1px solid rgba(255,255,255,.1); border-radius: 9px; padding: 3px; margin-bottom: 4px; }
    .tab { flex: 1; appearance: none; border: 0; background: transparent; color: #9aa1ab; font: 600 11.5px system-ui; padding: 6px 4px;
      border-radius: 7px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 5px; }
    .tab:hover { color: #e7e9ec; }
    .tab.on { background: #273041; color: #fff; }
    .tab .badge { background: #f59e0b; color: #11161d; font: 700 9.5px ui-monospace, monospace; border-radius: 8px; padding: 0 5px; min-width: 15px; text-align: center; }
    /* LCP phase bar */
    .lbar { display: flex; height: 16px; border-radius: 5px; overflow: hidden; background: #0f1419; border: 1px solid rgba(255,255,255,.08); }
    .lseg { height: 100%; }
    .lseg.p-ttfb { background: #8b93a0; } .lseg.p-delay { background: #f59e0b; } .lseg.p-load { background: #2f74c0; } .lseg.p-render { background: #22c55e; }
    .lleg { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 7px; }
    .lkey { display: inline-flex; align-items: center; gap: 5px; font-size: 10.5px; color: #c6ccd4; }
    .lkey i { width: 9px; height: 9px; border-radius: 2px; flex: none; }
    .lkey.p-ttfb i, .lkey i.p-ttfb { background: #8b93a0; } .lkey i.p-delay { background: #f59e0b; } .lkey i.p-load { background: #2f74c0; } .lkey i.p-render { background: #22c55e; }
    .lkey b { color: #e7e9ec; font-weight: 700; }
    /* insight cards */
    .ins { background: #0f1419; border: 1px solid rgba(255,255,255,.08); border-left: 3px solid #8b93a0; border-radius: 8px; padding: 9px 11px; margin-bottom: 7px; cursor: pointer; }
    .ins.sev-bad { border-left-color: #f87171; } .ins.sev-warn { border-left-color: #fbbf24; } .ins.sev-good { border-left-color: #4ade80; } .ins.sev-info { border-left-color: #8b93a0; }
    .ins .ihd { display: flex; align-items: center; gap: 7px; }
    .ins .ihd b { flex: 1; font-size: 12.5px; }
    .ins .dot { width: 8px; height: 8px; border-radius: 50%; background: #8b93a0; flex: none; }
    .ins.sev-bad .dot { background: #f87171; } .ins.sev-warn .dot { background: #fbbf24; } .ins.sev-good .dot { background: #4ade80; } .ins.sev-info .dot { background: #8b93a0; }
    .ins .chev { color: #8b93a0; font-size: 10px; transition: transform .12s; }
    .ins.open .chev { transform: rotate(90deg); }
    .ins .isum { color: #c6ccd4; font-size: 11px; margin-top: 4px; }
    .ins .idet { display: none; margin-top: 7px; border-top: 1px solid rgba(255,255,255,.08); padding-top: 6px; }
    .ins.open .idet { display: block; }
    .irow { display: flex; justify-content: space-between; gap: 10px; font-size: 10.5px; color: #9aa1ab; padding: 2px 0; }
    .irow .iv { color: #e7e9ec; font-family: ui-monospace, Menlo, monospace; text-align: right; word-break: break-all; }
    /* rich waterfall */
    .wfleg { margin: 4px 0 8px; }
    .wf .r { border-radius: 5px; }
    .wf .r.open { background: #0f1419; }
    .wf .rmain { display: grid; grid-template-columns: 128px 1fr 52px; gap: 8px; align-items: center; font-size: 11px; cursor: pointer; padding: 2px 3px; }
    .wf .rmain .n { color: #c6ccd4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: ui-monospace, Menlo, monospace; display: flex; align-items: center; gap: 4px; }
    .wf .rmain .track { height: 9px; position: relative; background: rgba(255,255,255,.05); border-radius: 3px; overflow: hidden; }
    .wf .rmain .bars { display: inline-flex; height: 9px; border-radius: 3px; overflow: hidden; vertical-align: top; min-width: 2px; }
    .wf .rmain .pseg { height: 9px; min-width: 1px; }
    .wf .rmain .sz { color: #8b93a0; text-align: right; font-family: ui-monospace, Menlo, monospace; }
    .wf .rb { background: #f87171; color: #11161d; font: 700 8px ui-monospace, monospace; border-radius: 3px; padding: 0 3px; flex: none; }
    .wf .rdet { display: none; padding: 4px 8px 8px; }
    .wf .r.open .rdet { display: block; }
  `;

  const ICON_CHART = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m7 14 3-4 3 3 4-6"/></svg>';
  const ICON_REC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>';
  const ICON_CHEV = '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

  const OPTS = { cpu: CPU_OPTS, net: NET_OPTS, device: DEV_OPTS };

  // One custom dropdown "field" (a button; the option list is built on demand in openMenu).
  function ddField(key, cur) {
    return `<div class="dd" data-key="${key}"><button class="ddbtn" type="button"><span class="lbl">${esc(LABELS[key][cur] || cur)}</span>${ICON_CHEV}</button></div>`;
  }

  function mount() {
    hostEl = document.createElement("div");
    hostEl.id = "__yoshtool_perf_overlay";
    hostEl.style.cssText = `position:fixed;inset:0;z-index:${Z};pointer-events:none`;
    root = hostEl.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = CSS;
    const ov = document.createElement("div");
    ov.className = "ov";
    ov.style.pointerEvents = "auto";
    ov.innerHTML = `
      <div class="hd">
        ${ICON_CHART}
        <b>Performance</b>
        <span class="sub">cold reload</span>
        <span class="x" title="Close">✕</span>
      </div>
      <div class="bd">
        <div class="ctrls">
          <div class="fld"><span class="k">CPU</span>${ddField("cpu", profile.cpu)}</div>
          <div class="fld"><span class="k">Network</span>${ddField("net", profile.net)}</div>
          <div class="fld"><span class="k">Device</span>${ddField("device", profile.device)}</div>
        </div>
        <button class="rec" type="button"><span class="ic">${ICON_REC}</span>Record &amp; reload</button>
        <div class="status" hidden></div>
        <div class="body"></div>
      </div>`;
    root.append(style, ov);
    (document.documentElement || document.body).appendChild(hostEl);

    recBtn = root.querySelector(".rec");
    statusEl = root.querySelector(".status");
    bodyEl = root.querySelector(".body");

    root.querySelector(".x").addEventListener("click", teardown);
    recBtn.addEventListener("click", onRun);
    root.querySelectorAll(".ddbtn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const key = btn.closest(".dd").getAttribute("data-key");
        if (ddOpenKey === key) closeMenu();
        else openMenu(key, btn);
      });
    });
  }

  function ddBtnFor(key) {
    return root ? root.querySelector('.dd[data-key="' + key + '"] .ddbtn') : null;
  }
  function updateDdLabels() {
    for (const key of Object.keys(OPTS)) {
      const btn = ddBtnFor(key);
      const lbl = btn && btn.querySelector(".lbl");
      if (lbl) lbl.textContent = LABELS[key][profile[key]] || profile[key];
    }
  }
  function openMenu(key, btn) {
    closeMenu();
    ddOpenKey = key;
    ddMenuEl = document.createElement("div");
    ddMenuEl.className = "ddmenu";
    ddMenuEl.innerHTML = OPTS[key]
      .map((o) => `<div class="opt${o.k === profile[key] ? " sel" : ""}" data-k="${o.k}"><span>${esc(o.label)}</span><span class="ck">${o.k === profile[key] ? "✓" : ""}</span></div>`)
      .join("");
    root.appendChild(ddMenuEl);
    const r = btn.getBoundingClientRect();
    ddMenuEl.style.left = r.left + "px";
    ddMenuEl.style.top = r.bottom + 4 + "px";
    ddMenuEl.style.minWidth = r.width + "px";
    ddMenuEl.addEventListener("click", (e) => {
      const opt = e.target.closest ? e.target.closest(".opt") : null;
      if (!opt) return;
      profile[key] = opt.getAttribute("data-k");
      const lbl = btn.querySelector(".lbl");
      if (lbl) lbl.textContent = LABELS[key][profile[key]] || profile[key];
      closeMenu();
    });
    ddOutside = (e) => {
      const path = e.composedPath ? e.composedPath() : [];
      if (ddMenuEl && path.indexOf(ddMenuEl) === -1 && !path.some((n) => n && n.classList && n.classList.contains("dd"))) closeMenu();
    };
    setTimeout(() => { if (ddOutside) document.addEventListener("click", ddOutside, true); }, 0);
  }
  function closeMenu() {
    if (ddOutside) { document.removeEventListener("click", ddOutside, true); ddOutside = null; }
    try { if (ddMenuEl && ddMenuEl.parentNode) ddMenuEl.parentNode.removeChild(ddMenuEl); } catch (e) {}
    ddMenuEl = null;
    ddOpenKey = null;
  }

  function readPickers() {
    return { cpu: profile.cpu, net: profile.net, device: profile.device };
  }

  function setStatus(text, kind) {
    if (!statusEl) return;
    if (!text) { statusEl.hidden = true; statusEl.textContent = ""; return; }
    statusEl.hidden = false;
    statusEl.className = "status" + (kind === "err" ? " err" : "");
    statusEl.innerHTML = (kind === "run" ? '<span class="spin"></span>' : "") + `<span>${esc(text)}</span>`;
  }

  function onRun() {
    if (!contextAlive()) return;
    profile = readPickers();
    recBtn.disabled = true;
    setStatus("Recording — the page will reload…", "run");
    try { chrome.storage.local.set({ perfOverlayProfile: profile }); } catch (e) {}
    // Fire-and-forget: the cold reload tears this overlay down; background re-injects it with the run.
    try { chrome.runtime.sendMessage({ cmd: "perf-overlay-run", profile }); } catch (e) {}
  }

  function metric(lab, name, value, text) {
    const r = rate(name, value);
    return `<div class="m"><div class="lab">${esc(lab)}</div><div class="num" style="color:${RATE_COLOR[r] || "#e7e9ec"}">${esc(text)}</div></div>`;
  }

  function renderResult(res) {
    if (!bodyEl) return;
    recBtn.disabled = false;
    if (!res) { bodyEl.innerHTML = ""; setStatus(""); lastRes = null; return; }
    if (!res.ok) { bodyEl.innerHTML = ""; setStatus(res.error || "Run failed.", "err"); lastRes = null; return; }
    setStatus("");
    lastRes = res;
    filmstrip = res.filmstrip || [];
    const flagged = (res.insights || []).filter((c) => c.severity === "bad" || c.severity === "warn").length;
    bodyEl.innerHTML = `
      <div class="tabs">
        <button class="tab" type="button" data-tab="speed">Speed</button>
        <button class="tab" type="button" data-tab="insights">Insights${flagged ? `<span class="badge">${flagged}</span>` : ""}</button>
        <button class="tab" type="button" data-tab="network">Network</button>
      </div>
      <div class="tabc"></div>`;
    bodyEl.querySelectorAll(".tab").forEach((t) =>
      t.addEventListener("click", () => { activeTab = t.getAttribute("data-tab"); renderTab(); })
    );
    renderTab();
  }

  function renderTab() {
    if (!bodyEl || !lastRes) return;
    const host = bodyEl.querySelector(".tabc");
    if (!host) return;
    bodyEl.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.getAttribute("data-tab") === activeTab));
    if (activeTab === "insights") {
      host.innerHTML = insightsHtml(lastRes);
      host.querySelectorAll(".ins").forEach((c) => c.addEventListener("click", () => c.classList.toggle("open")));
    } else if (activeTab === "network") {
      host.innerHTML = networkHtml(lastRes);
      host.querySelectorAll(".wf .r").forEach((row) => row.addEventListener("click", () => row.classList.toggle("open")));
    } else {
      host.innerHTML = speedHtml(lastRes);
      const f = host.querySelector(".film");
      if (f) f.addEventListener("click", onFilmClick);
    }
  }

  function profNote(res) {
    const p = res.profile || profile;
    return `${LABELS.device[p.device] || "Desktop"} · ${LABELS.net[p.net] || "No throttle"} · ${LABELS.cpu[p.cpu] || "No throttle"} CPU. One lab run (cold reload) — numbers vary; not Google's field (CrUX) data.`;
  }

  // --- Speed tab: vitals + LCP phase bar + filmstrip ---
  function speedHtml(res) {
    const v = res.vitals || {};
    const nav = v.nav || {};
    const strip = res.filmstrip || [];
    const lcpCard = (res.insights || []).find((c) => c.id === "lcp");
    const lb = lcpCard && lcpCard.lcp;

    const vitals = `<div class="sec"><h5>Speed · this load</h5><div class="vit">
      ${metric("FCP", "fcp", v.fcp, fmtDuration(v.fcp))}
      ${metric("LCP", "lcp", v.lcp, fmtDuration(v.lcp))}
      ${metric("CLS", "cls", v.cls, v.cls != null ? v.cls.toFixed(3) : "—")}
      ${metric("TTFB", "ttfb", nav.ttfb, fmtDuration(nav.ttfb))}
      ${metric("Load", "load", nav.load, fmtDuration(nav.load))}
    </div></div>`;

    let lcpBar = "";
    if (lb && lb.phases) {
      const seg = lb.phases
        .filter((p) => p.ms > 0)
        .map((p) => `<span class="lseg ${LCP_PHASE_CLS[p.name] || ""}" style="width:${p.pct.toFixed(1)}%" title="${esc(p.name)} ${fmtDuration(p.ms)}"></span>`)
        .join("");
      const legend = lb.phases
        .map((p) => `<span class="lkey"><i class="${LCP_PHASE_CLS[p.name] || ""}"></i>${esc(p.name)} <b>${fmtDuration(p.ms)}</b></span>`)
        .join("");
      lcpBar = `<div class="sec"><h5>LCP breakdown${lcpCard.element ? " · " + esc(lcpCard.element) : ""}</h5>
        <div class="lbar">${seg}</div><div class="lleg">${legend}</div></div>`;
    }

    const film = strip.length
      ? `<div class="sec"><h5>Filmstrip · tap a frame to zoom</h5><div class="film">${strip
          .map(
            (f, i) =>
              `<div class="f${f.isLcp ? " lcp" : ""}" data-idx="${i}" title="Zoom frame at ${((f.rel || 0) / 1000).toFixed(2)}s"><div class="thumb" style="background-image:url('${f.data}')"></div><div class="t">${((f.rel || 0) / 1000).toFixed(1)}s${f.isLcp ? " · LCP" : ""}</div></div>`
          )
          .join("")}</div></div>`
      : "";

    return vitals + lcpBar + film + `<p class="note">${esc(profNote(res))}</p>`;
  }

  // --- Insights tab: cards (excluding the LCP card, which is the bar on Speed) ---
  function insightsHtml(res) {
    const cards = (res.insights || []).filter((c) => c.id !== "lcp");
    if (!cards.length) return `<p class="empty">No insights for this load.</p>`;
    return (
      `<div class="sec">` +
      cards
        .map((c) => {
          const items = (c.items || [])
            .map((it) => `<div class="irow"><span>${esc(it.label)}</span><span class="iv">${esc(it.value)}</span></div>`)
            .join("");
          return `<div class="ins sev-${esc(c.severity)}">
            <div class="ihd"><span class="dot"></span><b>${esc(c.title)}</b><span class="chev">▸</span></div>
            <div class="isum">${esc(c.summary)}</div>
            ${items ? `<div class="idet">${items}</div>` : ""}
          </div>`;
        })
        .join("") +
      `</div>`
    );
  }

  // --- Network tab: phase-segmented waterfall with click-to-expand detail ---
  function networkHtml(res) {
    const wf = res.waterfall || { rows: [], total: 1, count: 0, totalBytes: 0 };
    if (!wf.count) return `<p class="empty">No requests captured.</p>`;
    const total = wf.total || 1;
    const legend = ["wait", "download", "connect", "dns", "ssl", "send", "stalled"]
      .map((n) => `<span class="lkey"><i style="background:${PHASE_COLOR[n]}"></i>${n}</span>`)
      .join("");
    const rows = (wf.rows || [])
      .map((r) => {
        const left = Math.max(0, Math.min(100, (r.start / total) * 100));
        const segs = (r.phases || [])
          .map((p) => `<span class="pseg" style="width:${((p.ms / total) * 100).toFixed(2)}%;background:${PHASE_COLOR[p.name] || r.color}" title="${esc(p.name)} ${fmtDuration(p.ms)}"></span>`)
          .join("");
        const badge = r.renderBlocking ? `<span class="rb" title="render-blocking">RB</span>` : "";
        const detail = `<div class="rdet">
          <div class="irow"><span>URL</span><span class="iv">${esc(r.url)}</span></div>
          <div class="irow"><span>Type · Status</span><span class="iv">${esc(r.type)} · ${r.status || "—"}</span></div>
          <div class="irow"><span>Protocol · Priority</span><span class="iv">${esc(r.protocol || "?")} · ${esc(r.priority || "?")}</span></div>
          <div class="irow"><span>Transfer · Duration</span><span class="iv">${esc(fmtBytes(r.transfer))} · ${fmtDuration(r.dur)}</span></div>
          ${(r.phases || []).map((p) => `<div class="irow"><span>${esc(p.name)}</span><span class="iv">${fmtDuration(p.ms)}</span></div>`).join("")}
        </div>`;
        return `<div class="r"><div class="rmain"><span class="n" title="${esc(r.url)}">${badge}${esc(r.name)}</span><span class="track"><span class="bars" style="margin-left:${left.toFixed(1)}%">${segs}</span></span><span class="sz">${esc(fmtBytes(r.transfer))}</span></div>${detail}</div>`;
      })
      .join("");
    return `<div class="sec"><h5>Requests · ${wf.count} · ${esc(fmtBytes(wf.totalBytes))}</h5>
      <div class="lleg wfleg">${legend}</div>
      <div class="wf">${rows}</div>
      <p class="note">Tap a request for its timing phases.</p></div>`;
  }

  function onFilmClick(e) {
    const f = e.target.closest ? e.target.closest(".f") : null;
    if (!f) return;
    openLightbox(parseInt(f.getAttribute("data-idx"), 10) || 0);
  }

  function openLightbox(i) {
    if (!filmstrip.length || !root) return;
    lbIdx = Math.max(0, Math.min(filmstrip.length - 1, i));
    if (!lbEl) {
      lbEl = document.createElement("div");
      lbEl.className = "lb";
      lbEl.innerHTML =
        '<span class="close" title="Close (Esc)">✕</span>' +
        '<img alt="Captured frame">' +
        '<div class="cap"><span class="time"></span><span class="lcpb" hidden>LCP — largest paint</span></div>' +
        '<div class="nav"><button class="prev" type="button" title="Previous frame (←)">‹</button><span class="idx"></span><button class="next" type="button" title="Next frame (→)">›</button></div>' +
        '<div class="hint">Step frames with ← / → to spot a FOUC flash or when the LCP element painted · Esc or click outside to close</div>';
      root.appendChild(lbEl);
      lbEl.addEventListener("click", (e) => { if (e.target === lbEl) closeLightbox(); });
      lbEl.querySelector(".close").addEventListener("click", closeLightbox);
      lbEl.querySelector(".prev").addEventListener("click", () => stepLightbox(-1));
      lbEl.querySelector(".next").addEventListener("click", () => stepLightbox(1));
      document.addEventListener("keydown", onLbKey, true);
    }
    renderLightbox();
  }

  function stepLightbox(d) {
    if (!lbEl) return;
    lbIdx = Math.max(0, Math.min(filmstrip.length - 1, lbIdx + d));
    renderLightbox();
  }

  function renderLightbox() {
    if (!lbEl) return;
    const f = filmstrip[lbIdx];
    if (!f) return;
    lbEl.querySelector("img").src = f.data;
    lbEl.querySelector(".time").textContent = ((f.rel || 0) / 1000).toFixed(2) + " s after navigation";
    lbEl.querySelector(".lcpb").hidden = !f.isLcp;
    lbEl.querySelector(".idx").textContent = lbIdx + 1 + " / " + filmstrip.length;
    lbEl.querySelector(".prev").disabled = lbIdx <= 0;
    lbEl.querySelector(".next").disabled = lbIdx >= filmstrip.length - 1;
  }

  function closeLightbox() {
    document.removeEventListener("keydown", onLbKey, true);
    try { if (lbEl && lbEl.parentNode) lbEl.parentNode.removeChild(lbEl); } catch (e) {}
    lbEl = null;
  }

  function onLbKey(e) {
    if (!lbEl) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeLightbox(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); e.stopPropagation(); stepLightbox(-1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); stepLightbox(1); }
  }

  async function loadState(renderIfFresh) {
    if (!contextAlive()) return;
    let r = {};
    try { r = await chrome.storage.local.get(["perfOverlayProfile", "perfOverlayResult"]); } catch (e) {}
    if (r.perfOverlayProfile) {
      profile = Object.assign({}, profile, r.perfOverlayProfile);
      updateDdLabels();
    }
    const res = r.perfOverlayResult;
    if (renderIfFresh && res && res.at && Date.now() - res.at < 45000) renderResult(res);
  }

  function refresh() {
    if (!hostEl || !hostEl.isConnected) { mount(); }
    loadState(true);
  }

  function teardown() {
    closeLightbox();
    closeMenu();
    try { if (hostEl && hostEl.parentNode) hostEl.parentNode.removeChild(hostEl); } catch (e) {}
    hostEl = root = bodyEl = statusEl = recBtn = null;
    filmstrip = [];
    window.__yoshtoolPerfOverlay = null;
  }

  window.__yoshtoolPerfOverlay = { teardown, refresh };

  mount();
  loadState(true);
})();
