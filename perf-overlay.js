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
  let cpuSel = null, netSel = null, devSel = null, bodyEl = null, statusEl = null, recBtn = null;
  let filmstrip = []; // the current run's frames, for the zoom lightbox
  let lbEl = null, lbIdx = 0;

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const CSS = `
    :host { all: initial; }
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
    .fld select { width: 100%; appearance: none; background: transparent; border: 0; color: #e7e9ec; font: 600 12px system-ui;
      cursor: pointer; padding: 0; outline: none; }
    .fld select option { color: #111; }
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
    .film .f { flex: 0 0 76px; cursor: pointer; }
    .film .f .thumb { height: 92px; border-radius: 5px; border: 1px solid rgba(255,255,255,.1); background: #11161d top/cover no-repeat; transition: outline-color .1s; }
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
    .wf .r { display: grid; grid-template-columns: 120px 1fr 52px; gap: 8px; align-items: center; font-size: 11px; }
    .wf .r .n { color: #c6ccd4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: ui-monospace, Menlo, monospace; }
    .wf .r .track { height: 8px; background: rgba(255,255,255,.05); border-radius: 3px; position: relative; }
    .wf .r .seg { position: absolute; height: 8px; border-radius: 3px; min-width: 2px; }
    .wf .r .sz { color: #8b93a0; text-align: right; font-family: ui-monospace, Menlo, monospace; }
    .note { font-size: 10.5px; color: #8b93a0; margin-top: 12px; }
    .empty { color: #8b93a0; font-size: 11.5px; margin-top: 12px; }
  `;

  const ICON_CHART = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m7 14 3-4 3 3 4-6"/></svg>';
  const ICON_REC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>';

  function options(list, cur) {
    return list.map((o) => `<option value="${o.k}"${o.k === cur ? " selected" : ""}>${esc(o.label)}</option>`).join("");
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
          <label class="fld"><span class="k">CPU</span><select data-sel="cpu">${options(CPU_OPTS, profile.cpu)}</select></label>
          <label class="fld"><span class="k">Network</span><select data-sel="net">${options(NET_OPTS, profile.net)}</select></label>
          <label class="fld"><span class="k">Device</span><select data-sel="device">${options(DEV_OPTS, profile.device)}</select></label>
        </div>
        <button class="rec" type="button"><span class="ic">${ICON_REC}</span>Record &amp; reload</button>
        <div class="status" hidden></div>
        <div class="body"></div>
      </div>`;
    root.append(style, ov);
    (document.documentElement || document.body).appendChild(hostEl);

    cpuSel = root.querySelector('[data-sel="cpu"]');
    netSel = root.querySelector('[data-sel="net"]');
    devSel = root.querySelector('[data-sel="device"]');
    recBtn = root.querySelector(".rec");
    statusEl = root.querySelector(".status");
    bodyEl = root.querySelector(".body");

    root.querySelector(".x").addEventListener("click", teardown);
    recBtn.addEventListener("click", onRun);
    for (const s of [cpuSel, netSel, devSel]) s.addEventListener("change", () => { profile = readPickers(); });
  }

  function readPickers() {
    return { cpu: cpuSel.value, net: netSel.value, device: devSel.value };
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
    if (!res) { bodyEl.innerHTML = ""; setStatus(""); return; }
    if (!res.ok) { bodyEl.innerHTML = ""; setStatus(res.error || "Run failed.", "err"); return; }
    setStatus("");
    const v = res.vitals || {};
    const nav = v.nav || {};
    const p = res.profile || profile;
    filmstrip = res.filmstrip || [];
    const strip = filmstrip;
    const wf = res.waterfall || { rows: [], total: 1, count: 0, totalBytes: 0 };

    const vitals = `
      <div class="sec">
        <h5>Speed · this load</h5>
        <div class="vit">
          ${metric("FCP", "fcp", v.fcp, fmtDuration(v.fcp))}
          ${metric("LCP", "lcp", v.lcp, fmtDuration(v.lcp))}
          ${metric("CLS", "cls", v.cls, v.cls != null ? v.cls.toFixed(3) : "—")}
          ${metric("TTFB", "ttfb", nav.ttfb, fmtDuration(nav.ttfb))}
          ${metric("Load", "load", nav.load, fmtDuration(nav.load))}
        </div>
      </div>`;

    const film = strip.length
      ? `<div class="sec"><h5>Filmstrip · tap a frame to zoom</h5><div class="film">${strip
          .map(
            (f, i) =>
              `<div class="f${f.isLcp ? " lcp" : ""}" data-idx="${i}" title="Zoom frame at ${((f.rel || 0) / 1000).toFixed(2)}s"><div class="thumb" style="background-image:url('${f.data}')"></div><div class="t">${((f.rel || 0) / 1000).toFixed(1)}s${f.isLcp ? " · LCP" : ""}</div></div>`
          )
          .join("")}</div></div>`
      : "";

    const total = wf.total || 1;
    const rows = (wf.rows || [])
      .map((r) => {
        const left = Math.max(0, Math.min(100, (r.start / total) * 100));
        const width = Math.max(0.6, Math.min(100 - left, (r.dur / total) * 100));
        return `<div class="r"><span class="n" title="${esc(r.name)}">${esc(r.name)}</span><span class="track"><span class="seg" style="left:${left.toFixed(1)}%;width:${width.toFixed(1)}%;background:${r.color}"></span></span><span class="sz">${esc(fmtBytes(r.size))}</span></div>`;
      })
      .join("");
    const waterfall = wf.count
      ? `<div class="sec"><h5>Requests · ${wf.count} · ${esc(fmtBytes(wf.totalBytes))}</h5><div class="wf">${rows}</div></div>`
      : "";

    const profNote = `${LABELS.device[p.device] || "Desktop"} · ${LABELS.net[p.net] || "No throttle"} · ${LABELS.cpu[p.cpu] || "No throttle"} CPU`;
    bodyEl.innerHTML =
      vitals +
      film +
      waterfall +
      `<p class="note">${esc(profNote)}. One lab run (cold reload) — numbers vary between runs; this isn't Google's field (CrUX) data.</p>`;
    const filmEl = bodyEl.querySelector(".film");
    if (filmEl) filmEl.addEventListener("click", onFilmClick);
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
      if (cpuSel) cpuSel.value = profile.cpu;
      if (netSel) netSel.value = profile.net;
      if (devSel) devSel.value = profile.device;
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
    try { if (hostEl && hostEl.parentNode) hostEl.parentNode.removeChild(hostEl); } catch (e) {}
    hostEl = root = bodyEl = statusEl = recBtn = cpuSel = netSel = devSel = null;
    filmstrip = [];
    window.__yoshtoolPerfOverlay = null;
  }

  window.__yoshtoolPerfOverlay = { teardown, refresh };

  mount();
  loadState(true);
})();
