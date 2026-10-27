// redact-overlay.js
// Injected into the page (via chrome.scripting.executeScript) when a screenshot runs
// with the "Redact sensitive data" option on. Detects sensitive data in DOM text, shows
// candidate boxes the user can toggle/add/remove, and on confirmation turns them into
// SOLID OPAQUE boxes that are captured with the image (permanent redaction, since the
// text pixels are never photographed). Wrapped in an IIFE because executeScript does not
// run as a module.
(() => {
  // Clear any leftover overlay from a previous session that may be stuck, so a new
  // capture always starts clean WITHOUT a manual page refresh.
  document.querySelectorAll("[data-yoshtool-redact-ui]").forEach((n) => n.remove());
  window.__yoshtoolRedactActive = true;

  const Z = 2147483000;
  const KIND_COLOR = {
    email: "#1565c0",
    phone: "#6a1b9a",
    credit_card: "#c62828",
    api_key: "#ad1457",
    jwt: "#00695c",
    iban: "#4527a0",
    address: "#5d4037",
    secret: "#b71c1c",
    pii: "#00838f",
    manual: "#37474f",
  };

  // Detectors are inlined here (a non-module content script can't import redact.js).
  function luhnValid(digits) {
    const s = String(digits).replace(/[\s-]/g, "");
    if (!/^\d{12,19}$/.test(s)) return false;
    let sum = 0, alt = false;
    for (let i = s.length - 1; i >= 0; i--) {
      let n = s.charCodeAt(i) - 48;
      if (alt) { n *= 2; if (n > 9) n -= 9; }
      sum += n; alt = !alt;
    }
    return sum % 10 === 0;
  }
  const DETECTORS = [
    { kind: "email", regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
    { kind: "jwt", regex: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g },
    { kind: "api_key", regex: /\b(?:AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|(?:sk|pk)_live_[0-9A-Za-z]{16,}|gh[pousr]_[0-9A-Za-z]{36,})\b/g },
    { kind: "credit_card", regex: /\b(?:\d[ -]?){13,19}\b/g, validate: (m) => luhnValid(m) },
    { kind: "iban", regex: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g },
    { kind: "phone", regex: /(?<![0-9A-Za-z])(?:(?:\+62|62|0)8\d{1,2}[ -]?\d{3,4}[ -]?\d{3,5}|\+\d{1,3}[ -]?\d{2,4}(?:[ -]?\d{2,4}){2,4})(?![0-9A-Za-z])/g, validate: (m) => m.replace(/\D/g, "").length >= 9 },
    { kind: "address", regex: /\b(?:Jl\.?|Jalan|Gg\.?|Gang|Perumahan|Komp(?:\.|lek|leks)?|Blok)\s+[^\n;]{1,70}?(?:\bNo\.?\s*\d+[A-Za-z]?\b|\bRT[\s.]*\d|\b\d{5}\b)[^\n;]{0,40}|\bRT[\s.]*\d{1,3}\s*\/\s*RW[\s.]*\d{1,3}\b/gi },
  ];
  function findMatches(text) {
    if (!text) return [];
    const raw = [];
    for (const det of DETECTORS) {
      det.regex.lastIndex = 0;
      let m;
      while ((m = det.regex.exec(text)) !== null) {
        const value = m[0];
        if (det.validate && !det.validate(value)) continue;
        raw.push({ start: m.index, end: m.index + value.length, kind: det.kind });
        if (m.index === det.regex.lastIndex) det.regex.lastIndex++;
      }
    }
    raw.sort((a, b) => a.start - b.start || b.end - a.end);
    const out = [];
    let lastEnd = -1;
    for (const r of raw) {
      if (r.start >= lastEnd) { out.push(r); lastEnd = r.end; }
    }
    return out;
  }

  // Field-context & entropy detection (see redact.js — inlined since this is a non-module
  // content script). Used for <input>/<textarea> values the TreeWalker can't see.
  const SECRET_FIELD_RE = /(api[\s_-]?key|secret|token|password|passwd|private[\s_-]?key|client[\s_-]?secret|access[\s_-]?key|credential|auth)/i;
  const PII_FIELD_RE = /(alamat|address|e-?mail|telp|telepon|phone|no\.?\s*hp|nomor\s*hp|whatsapp|kode\s*pos|postal|zip\s*code|provinsi|province|\bkota\b|\bcity\b|kabupaten|regency|\bkab\b|kecamatan|subdistrict|\bkec\b|kelurahan|\bkel\b|\bdistrict\b|\bdesa\b|village|account\s*(?:number|no\b|#)|no\.?\s*rek|rekening|norek|card\s*(?:number|no\b)|no\.?\s*kartu|nomor\s*kartu|kartu\s*(?:kredit|debit|atm)|\bcvv\b|\bcvc\b|\biban\b|virtual\s*account|callback|webhook|whitelist|\bip\b)/i;
  function shannonEntropy(str) {
    if (!str) return 0;
    const freq = new Map();
    for (const ch of str) freq.set(ch, (freq.get(ch) || 0) + 1);
    let h = 0;
    for (const count of freq.values()) {
      const p = count / str.length;
      h -= p * Math.log2(p);
    }
    return h;
  }
  function looksLikeSecret(value) {
    const v = String(value || "").trim();
    if (v.length < 20 || /\s/.test(v) || /^https?:\/\//i.test(v)) return false;
    let classes = 0;
    if (/[a-z]/.test(v)) classes++;
    if (/[A-Z]/.test(v)) classes++;
    if (/[0-9]/.test(v)) classes++;
    if (/[^A-Za-z0-9]/.test(v)) classes++;
    if (classes < 2) return false;
    return shannonEntropy(v) >= 3.3;
  }
  function looksLikeIp(value) {
    const v = String(value || "").trim();
    if (!v) return false;
    for (const m of v.matchAll(/\d{1,3}(?:\.\d{1,3}){3}/g)) {
      if (m[0].split(".").every((o) => Number(o) <= 255)) return true;
    }
    if (/(?:[0-9a-f]{1,4}:){2,}[0-9a-f]{0,4}/i.test(v) || /::[0-9a-f]/i.test(v)) return true;
    return false;
  }
  function looksLikeAccountNumber(value) {
    return /^\d{10,19}$/.test(String(value || "").replace(/[\s-]/g, ""));
  }
  const SENSITIVE_COL_RE = /(destination\s*account|account\s*(?:number|no\b)|rekening|norek|card\s*(?:number|no\b)|no\.?\s*kartu|nomor\s*kartu|\biban\b|virtual\s*account|\bwhitelist\b)/i;

  // ---- Collect candidate rects from DOM text ----
  // Rects are kept in absolute document (page) coordinates so they stay correct for
  // full-page capture (viewport resized) as well as area/screen capture.
  // Redaction method (solid/blur) & color, read from storage. Used on "Redact & capture";
  // since apply happens after user interaction, the async get has certainly finished by
  // then. Defaults to solid/black.
  let cfg = { method: "solid", color: "#000000" };
  try {
    chrome.storage.local.get(["redactMethod", "redactColor"]).then((v) => {
      if (v.redactMethod === "blur" || v.redactMethod === "solid") cfg.method = v.redactMethod;
      if (v.redactColor) cfg.color = v.redactColor;
    });
  } catch {
    // storage unavailable — use defaults
  }

  const boxes = []; // {el, kind, enabled}
  const layer = document.createElement("div");
  layer.style.cssText = `position:absolute;top:0;left:0;width:0;height:0;z-index:${Z};`;
  layer.setAttribute("data-yoshtool-redact-ui", "1");
  document.documentElement.appendChild(layer);

  // For "Capture area" mode the background sets __yoshtoolRedactClip (viewport coords) so
  // detection candidates are limited to the crop area. Converted to page coordinates.
  let clipPage = null;
  const clipRaw = window.__yoshtoolRedactClip;
  if (clipRaw && clipRaw.width > 0 && clipRaw.height > 0) {
    clipPage = {
      x: clipRaw.x + window.scrollX,
      y: clipRaw.y + window.scrollY,
      w: clipRaw.width,
      h: clipRaw.height,
    };
    try {
      delete window.__yoshtoolRedactClip;
    } catch {
      window.__yoshtoolRedactClip = undefined;
    }
  }

  function intersectsClip(rect) {
    if (!clipPage) return true;
    return (
      rect.x < clipPage.x + clipPage.w &&
      rect.x + rect.w > clipPage.x &&
      rect.y < clipPage.y + clipPage.h &&
      rect.y + rect.h > clipPage.y
    );
  }

  function pageRectFromRange(range) {
    const rects = [];
    for (const r of range.getClientRects()) {
      if (r.width < 2 || r.height < 2) continue;
      rects.push({
        x: r.left + window.scrollX,
        y: r.top + window.scrollY,
        w: r.width,
        h: r.height,
      });
    }
    return rects;
  }

  function addBox(rect, kind) {
    // Detected boxes are filtered to the crop area (if any); manual boxes are not.
    if (kind !== "manual" && !intersectsClip(rect)) return;
    const el = document.createElement("div");
    el.style.cssText =
      `position:absolute;left:${rect.x}px;top:${rect.y}px;width:${rect.w}px;height:${rect.h}px;` +
      `background:${KIND_COLOR[kind] || KIND_COLOR.manual};opacity:0.45;` +
      `outline:1px solid rgba(255,255,255,0.7);cursor:pointer;box-sizing:border-box;`;
    el.title = `${kind} — click to toggle on/off`;
    const box = { el, kind, enabled: true };
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      box.enabled = !box.enabled;
      el.style.opacity = box.enabled ? "0.45" : "0.12";
    });
    layer.appendChild(el);
    boxes.push(box);
  }

  function scanDom() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        const tag = p.tagName;
        if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let node;
    while ((node = walker.nextNode())) {
      const text = node.nodeValue;
      const matches = findMatches(text);
      if (matches.length === 0) continue;
      for (const m of matches) {
        try {
          const range = document.createRange();
          range.setStart(node, m.start);
          range.setEnd(node, m.end);
          for (const rect of pageRectFromRange(range)) addBox(rect, m.kind);
        } catch {
          // invalid offset (text changed) — skip
        }
      }
    }
  }

  // <input>/<textarea> values are NOT visible to the TreeWalker (not text nodes), yet on
  // dashboards API keys/secrets live precisely in form fields. Separate scan: if the value
  // matches a pattern, its label contains a secret keyword, or the value is high-entropy
  // → redact the whole field box (input contents can't be sub-ranged).
  // password: already hidden by the browser. search: an input control, not displayed data.
  const SKIP_INPUT_TYPES = new Set([
    "hidden", "button", "submit", "reset", "checkbox", "radio", "file", "image", "color",
    "range", "password", "search",
  ]);
  const SEARCH_HINT_RE = /\b(search|cari|pencarian)\b|reference\s*no\b/i;

  function fieldContext(el) {
    const parts = [el.name, el.id, el.placeholder, el.getAttribute("aria-label")];
    if (el.labels) for (const lab of el.labels) parts.push(lab.textContent);
    return parts.filter(Boolean).join(" ");
  }

  function isSearchField(el, ctx) {
    if ((el.type || "").toLowerCase() === "search") return true;
    if (el.getAttribute("role") === "searchbox") return true;
    if (el.closest && el.closest('[role="search"]')) return true;
    return SEARCH_HINT_RE.test(ctx);
  }

  function fieldBox(el) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    return { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height };
  }

  function scanFields() {
    const fields = document.querySelectorAll("input, textarea");
    for (const el of fields) {
      if (el.tagName === "INPUT" && SKIP_INPUT_TYPES.has((el.type || "").toLowerCase())) continue;
      const value = el.value;
      if (!value || !value.trim()) continue;

      let kind = null;
      const ctx = fieldContext(el);
      if (isSearchField(el, ctx)) continue; // never redact search boxes
      if (SECRET_FIELD_RE.test(ctx)) {
        kind = "secret";
      } else if (PII_FIELD_RE.test(ctx)) {
        kind = "pii";
      } else {
        const matches = findMatches(value);
        if (matches.length) kind = matches[0].kind;
        else if (looksLikeSecret(value)) kind = "secret";
        else if (looksLikeIp(value)) kind = "pii"; // "Whitelist IP" field (label unreadable)
        else if (looksLikeAccountNumber(value)) kind = "pii"; // "Account Number" field
      }
      if (!kind) continue;

      const rect = fieldBox(el);
      if (rect) addBox(rect, KIND_COLOR[kind] ? kind : "secret");
    }
  }

  // Blur/solid an entire table column whose header is sensitive (Destination Account,
  // Whitelist IP, etc.) — without touching Reference/Description/Amount columns.
  function scanTableColumns() {
    for (const table of document.querySelectorAll("table")) {
      if (table.closest("[data-yoshtool-redact-ui]")) continue;
      let headerRow = table.querySelector("thead tr");
      let headerCells = headerRow ? headerRow.children : null;
      if (!headerCells || !headerCells.length) {
        headerRow = table.querySelector("tr");
        headerCells = headerRow ? headerRow.children : [];
      }
      const sensitiveIdx = [];
      for (let i = 0; i < headerCells.length; i++) {
        if (SENSITIVE_COL_RE.test((headerCells[i].textContent || "").trim())) sensitiveIdx.push(i);
      }
      if (!sensitiveIdx.length) continue;
      for (const row of table.querySelectorAll("tr")) {
        if (row === headerRow) continue;
        const cells = row.children;
        for (const idx of sensitiveIdx) {
          const cell = cells[idx];
          if (!cell || cell.tagName !== "TD") continue;
          const r = cell.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) continue;
          addBox({ x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height }, "pii");
        }
      }
    }
  }

  // ---- Add-manual-box mode (drag) ----
  let manualMode = false;
  let dragStart = null;
  let dragEl = null;

  function onManualDown(e) {
    if (!manualMode) return;
    if (bar.contains(e.target)) return; // don't start a drag when clicking the toolbar
    e.preventDefault();
    dragStart = { x: e.clientX + window.scrollX, y: e.clientY + window.scrollY };
    dragEl = document.createElement("div");
    dragEl.style.cssText =
      `position:absolute;left:${dragStart.x}px;top:${dragStart.y}px;width:0;height:0;` +
      `background:${KIND_COLOR.manual};opacity:0.45;outline:1px solid #fff;box-sizing:border-box;`;
    layer.appendChild(dragEl);
  }
  function onManualMove(e) {
    if (!manualMode || !dragStart || !dragEl) return;
    const cx = e.clientX + window.scrollX;
    const cy = e.clientY + window.scrollY;
    const x = Math.min(cx, dragStart.x);
    const y = Math.min(cy, dragStart.y);
    dragEl.style.left = `${x}px`;
    dragEl.style.top = `${y}px`;
    dragEl.style.width = `${Math.abs(cx - dragStart.x)}px`;
    dragEl.style.height = `${Math.abs(cy - dragStart.y)}px`;
  }
  function onManualUp() {
    if (!manualMode || !dragStart || !dragEl) return;
    const w = parseFloat(dragEl.style.width);
    const h = parseFloat(dragEl.style.height);
    const x = parseFloat(dragEl.style.left);
    const y = parseFloat(dragEl.style.top);
    dragEl.remove();
    dragEl = null;
    dragStart = null;
    if (w >= 6 && h >= 6) addBox({ x, y, w, h }, "manual");
  }
  window.addEventListener("mousedown", onManualDown, true);
  window.addEventListener("mousemove", onManualMove, true);
  window.addEventListener("mouseup", onManualUp, true);

  // ---- Toolbar ----
  const bar = document.createElement("div");
  bar.style.cssText =
    `position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:${Z + 1};` +
    `background:#1f2328;color:#e7e9ec;padding:9px 11px;border-radius:12px;` +
    `border:1px solid rgba(255,255,255,.09);` +
    `font:600 13px/1.3 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;box-shadow:0 12px 34px rgba(0,0,0,.4);` +
    `display:flex;gap:7px;align-items:center;`;
  bar.setAttribute("data-yoshtool-redact-ui", "1");

  function mkBtn(label, bg) {
    const b = document.createElement("button");
    b.textContent = label;
    b.style.cssText =
      `cursor:pointer;border:0;border-radius:7px;padding:6px 11px;font:600 12px system-ui,sans-serif;` +
      `background:${bg};color:#fff;`;
    return b;
  }

  const info = document.createElement("span");
  info.style.cssText = "margin-right:3px;color:#cbd5e1";
  const btnManual = mkBtn("+ Add manual box", "#2a3140");
  const btnResetManual = mkBtn("Reset manual boxes", "#2a3140");
  const btnApply = mkBtn("Redact & capture", "#1f7a45");
  const btnCancel = mkBtn("Cancel", "#7f2d2d");
  bar.append(info, btnManual, btnResetManual, btnApply, btnCancel);
  document.documentElement.appendChild(bar);

  function updateInfo() {
    info.textContent = `${boxes.length} areas detected`;
  }

  // Remove only manually drawn boxes; detected boxes stay.
  btnResetManual.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    for (let i = boxes.length - 1; i >= 0; i--) {
      if (boxes[i].kind === "manual") {
        boxes[i].el.remove();
        boxes.splice(i, 1);
      }
    }
    updateInfo();
  });

  btnManual.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    manualMode = !manualMode;
    btnManual.style.background = manualMode ? "#3f5170" : "#2a3140";
    btnManual.textContent = manualMode ? "Done" : "+ Add manual box";
  });

  let cleanedUp = false;
  let fallbackTimer = null;
  function cleanup() {
    if (cleanedUp) return; // idempotent: safe to call from either the message or the fallback timer
    cleanedUp = true;
    if (fallbackTimer) clearTimeout(fallbackTimer);
    layer.remove();
    bar.remove();
    window.removeEventListener("mousedown", onManualDown, true);
    window.removeEventListener("mousemove", onManualMove, true);
    window.removeEventListener("mouseup", onManualUp, true);
    document.removeEventListener("keydown", onKey, true);
    window.__yoshtoolRedactActive = false;
  }

  function onKey(e) {
    if (e.key === "Escape") {
      cleanup();
      chrome.runtime.sendMessage({ type: "redact-cancelled" });
    }
  }
  document.addEventListener("keydown", onKey, true);

  btnCancel.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    cleanup();
    chrome.runtime.sendMessage({ type: "redact-cancelled" });
  });

  btnApply.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Turn active boxes SOLID OPAQUE, drop the toolbar & inactive boxes, then allow a
    // repaint before capture so the redaction is rendered.
    bar.remove();
    for (const box of boxes) {
      if (box.enabled) {
        box.el.style.opacity = "1";
        box.el.style.outline = "0";
        if (cfg.method === "blur") {
          // Blur the content behind the box (rendered into the capture). Note: blur can
          // be reversed — use Solid for highly sensitive data.
          box.el.style.background = "transparent";
          box.el.style.backdropFilter = "blur(12px)";
          box.el.style.webkitBackdropFilter = "blur(12px)";
        } else {
          box.el.style.background = cfg.color || "#000";
        }
      } else {
        box.el.remove();
      }
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(() => {
          // Tag the layer so the background can clean it up after capture.
          layer.setAttribute("data-yoshtool-redact", "1");
          chrome.runtime.sendMessage({ type: "redact-ready" });
          // Safety net: if the redact-cleanup message from the background is missed, the
          // overlay still removes itself (never stuck permanently / needing a refresh).
          // 12s is enough for the slowest mode (full page + debugger).
          fallbackTimer = setTimeout(cleanup, 12000);
        }, 60);
      });
    });
  });

  // Cleanup command from the background after capture completes.
  chrome.runtime.onMessage.addListener(function onMsg(msg) {
    if (msg?.type === "redact-cleanup") {
      chrome.runtime.onMessage.removeListener(onMsg);
      cleanup(); // releases the layer + all window/keydown listeners
    }
  });

  scanDom();
  scanFields();
  scanTableColumns();
  updateInfo();
})();
