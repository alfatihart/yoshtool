// redact-overlay.js
// Disuntik ke halaman (lewat chrome.scripting.executeScript) saat screenshot dijalankan
// dengan opsi "Sensor data sensitif" aktif. Mendeteksi data sensitif di teks DOM,
// menampilkan kotak kandidat yang bisa di-toggle/tambah/hapus, lalu saat dikonfirmasi
// menjadikannya kotak OPAK SOLID yang akan ikut ter-capture (sensor permanen pada
// gambar karena pixel teks tak pernah terpotret). Pendeteksian dibungkus IIFE karena
// executeScript tidak mengeksekusi sebagai modul.
(() => {
  if (window.__yoshtoolRedactActive) return;
  window.__yoshtoolRedactActive = true;

  const Z = 2147483000;
  const KIND_COLOR = {
    email: "#1565c0",
    phone: "#6a1b9a",
    credit_card: "#c62828",
    api_key: "#ad1457",
    jwt: "#00695c",
    iban: "#4527a0",
    secret: "#b71c1c",
    manual: "#37474f",
  };

  // Detektor di-inline di sini (content script non-modul tak bisa import redact.js).
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
    { kind: "phone", regex: /(?:\+62|62|0)8\d{1,2}[ -]?\d{3,4}[ -]?\d{3,5}|\+\d{1,3}[ -]?\d{2,4}(?:[ -]?\d{2,4}){2,4}/g, validate: (m) => m.replace(/\D/g, "").length >= 9 },
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

  // Deteksi konteks field & entropi (lihat redact.js — di-inline karena content script
  // non-modul). Dipakai untuk nilai <input>/<textarea> yang tak terlihat oleh TreeWalker.
  const SECRET_FIELD_RE = /(api[\s_-]?key|secret|token|password|passwd|private[\s_-]?key|client[\s_-]?secret|access[\s_-]?key|credential|auth)/i;
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

  // ---- Kumpulkan rect kandidat dari teks DOM ----
  // Rect disimpan dalam koordinat absolut dokumen (page), supaya tetap benar untuk
  // full-page capture (viewport di-resize) maupun area/screen.
  const boxes = []; // {el, kind, enabled}
  const layer = document.createElement("div");
  layer.style.cssText = `position:absolute;top:0;left:0;width:0;height:0;z-index:${Z};`;
  document.documentElement.appendChild(layer);

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
    const el = document.createElement("div");
    el.style.cssText =
      `position:absolute;left:${rect.x}px;top:${rect.y}px;width:${rect.w}px;height:${rect.h}px;` +
      `background:${KIND_COLOR[kind] || KIND_COLOR.manual};opacity:0.45;` +
      `outline:1px solid rgba(255,255,255,0.7);cursor:pointer;box-sizing:border-box;`;
    el.title = `${kind} — klik untuk aktif/nonaktif`;
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
          // offset tak valid (teks berubah) — lewati
        }
      }
    }
  }

  // Nilai <input>/<textarea> TIDAK terlihat oleh TreeWalker (bukan text node), padahal
  // di dashboard API key/secret justru ada di field form. Scan terpisah: kalau isinya
  // cocok pola, atau labelnya mengandung kata kunci rahasia, atau nilainya berentropi
  // tinggi → redaksi seluruh kotak field (isi input tak bisa di-sub-range).
  const SKIP_INPUT_TYPES = new Set([
    "hidden", "button", "submit", "reset", "checkbox", "radio", "file", "image", "color", "range",
  ]);

  function fieldContext(el) {
    const parts = [el.name, el.id, el.placeholder, el.getAttribute("aria-label")];
    if (el.labels) for (const lab of el.labels) parts.push(lab.textContent);
    return parts.filter(Boolean).join(" ");
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
      if (SECRET_FIELD_RE.test(fieldContext(el))) {
        kind = "secret";
      } else {
        const matches = findMatches(value);
        if (matches.length) kind = matches[0].kind;
        else if (looksLikeSecret(value)) kind = "secret";
      }
      if (!kind) continue;

      const rect = fieldBox(el);
      if (rect) addBox(rect, KIND_COLOR[kind] ? kind : "secret");
    }
  }

  // ---- Mode tambah kotak manual (drag) ----
  let manualMode = false;
  let dragStart = null;
  let dragEl = null;

  function onManualDown(e) {
    if (!manualMode) return;
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
    `background:#1e1e1e;color:#fff;padding:8px 10px;border-radius:8px;` +
    `font:13px/1.3 Arial,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,0.4);` +
    `display:flex;gap:8px;align-items:center;`;

  function mkBtn(label, bg) {
    const b = document.createElement("button");
    b.textContent = label;
    b.style.cssText =
      `cursor:pointer;border:0;border-radius:5px;padding:6px 10px;font:inherit;` +
      `background:${bg};color:#fff;`;
    return b;
  }

  const info = document.createElement("span");
  const btnManual = mkBtn("+ Kotak manual", "#455a64");
  const btnApply = mkBtn("Sensor & tangkap", "#2e7d32");
  const btnCancel = mkBtn("Batal", "#c62828");
  bar.append(info, btnManual, btnApply, btnCancel);
  document.documentElement.appendChild(bar);

  function updateInfo() {
    info.textContent = `${boxes.length} area terdeteksi`;
  }

  btnManual.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    manualMode = !manualMode;
    btnManual.style.background = manualMode ? "#0277bd" : "#455a64";
    btnManual.textContent = manualMode ? "Selesai manual" : "+ Kotak manual";
  });

  function cleanup() {
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
    // Jadikan kotak aktif OPAK SOLID, buang toolbar & kotak nonaktif, lalu beri jeda
    // repaint sebelum capture supaya sensor sudah ter-render.
    bar.remove();
    for (const box of boxes) {
      if (box.enabled) {
        box.el.style.opacity = "1";
        box.el.style.background = "#000";
        box.el.style.outline = "0";
      } else {
        box.el.remove();
      }
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(() => {
          // Tandai layer agar bisa dibersihkan background setelah capture.
          layer.setAttribute("data-yoshtool-redact", "1");
          chrome.runtime.sendMessage({ type: "redact-ready" });
        }, 60);
      });
    });
  });

  // Perintah pembersihan dari background setelah capture selesai.
  chrome.runtime.onMessage.addListener(function onMsg(msg) {
    if (msg?.type === "redact-cleanup") {
      chrome.runtime.onMessage.removeListener(onMsg);
      cleanup(); // melepas layer + semua listener window/keydown
    }
  });

  scanDom();
  scanFields();
  updateInfo();
})();
