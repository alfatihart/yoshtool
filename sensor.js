// sensor.js
// Auto-sensor realtime ("mode privasi"). Didaftarkan dinamis oleh background.js
// (chrome.scripting.registerContentScripts) HANYA untuk domain yang pengguna tambahkan
// ke daftar sensor DAN izinnya di-grant. Menutup (blur) data sensitif di halaman secara
// langsung saat browsing — untuk proteksi screen-share/rekaman, di luar fitur screenshot.
//
// Deteksi memakai pola yang SAMA dengan redact.js/redact-overlay.js (di-inline karena
// content script bukan modul): email, telepon, kartu kredit (Luhn), IBAN, API key, JWT,
// alamat; plus field rahasia (SECRET_FIELD_RE), field PII (PII_FIELD_RE), dan nilai field
// berentropi tinggi (looksLikeSecret). Blur dipilih (bukan solid) karena ini proteksi
// tampilan layar, bukan artefak ekspor — reversibilitas tak relevan, dan pengguna bisa
// "klik untuk tampil sementara".
(() => {
  if (window.__yoshtoolSensorActive) return; // idempotent per-dokumen
  window.__yoshtoolSensorActive = true;

  const SENSOR_ENABLED_KEY = "sensorEnabled";
  const FIELD_BLUR = "blur(6px)";
  const TEXT_BLUR = "blur(5px)";
  const REVEAL_MS = 5000;

  // ---- Detektor (disalin dari redact.js; jaga tetap sinkron) ----
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
  // Nilai field berisi IP (IPv4 oktet-valid / IPv6) — untuk field "Whitelist IP" yang
  // label-nya kadang tak terbaca. HANYA dipakai pada nilai field, bukan teks bebas.
  function looksLikeIp(value) {
    const v = String(value || "").trim();
    if (!v) return false;
    for (const m of v.matchAll(/\d{1,3}(?:\.\d{1,3}){3}/g)) {
      if (m[0].split(".").every((o) => Number(o) <= 255)) return true;
    }
    if (/(?:[0-9a-f]{1,4}:){2,}[0-9a-f]{0,4}/i.test(v) || /::[0-9a-f]/i.test(v)) return true;
    return false;
  }
  // Header kolom tabel yang isinya sensitif (tutup seluruh kolom, tanpa menyentuh
  // kolom Reference/Description/Amount).
  const SENSITIVE_COL_RE = /(destination\s*account|account\s*(?:number|no\b)|rekening|norek|card\s*(?:number|no\b)|no\.?\s*kartu|nomor\s*kartu|\biban\b|virtual\s*account|\bwhitelist\b)/i;

  // ---- State & util ----
  let enabled = true;
  const origFilter = new WeakMap(); // field/sel → filter inline asli (untuk pulih)

  // Lewati UI milik YoshTool sendiri (toast, overlay sensor-capture, span sensor).
  function isOwnUi(el) {
    return !!(el && el.closest &&
      el.closest("#__yoshtool_toast__, [data-yoshtool-redact-ui], [data-yoshtool-sensor]"));
  }

  // ---- Masking teks ----
  function revealText(e) {
    const span = e.currentTarget;
    span.style.filter = "none";
    clearTimeout(span.__yoshtoolTimer);
    const reblur = () => { if (enabled && span.isConnected) span.style.filter = TEXT_BLUR; };
    span.__yoshtoolTimer = setTimeout(reblur, REVEAL_MS);
    span.addEventListener("mouseleave", function onLeave() {
      span.removeEventListener("mouseleave", onLeave);
      clearTimeout(span.__yoshtoolTimer);
      reblur();
    });
  }
  function makeTextSpan() {
    const span = document.createElement("span");
    span.dataset.yoshtoolSensor = "text";
    span.style.filter = TEXT_BLUR;
    span.style.cursor = "pointer";
    span.style.borderRadius = "2px";
    span.title = "Data disensor — klik untuk tampil sementara";
    span.addEventListener("click", revealText);
    return span;
  }
  // Bungkus tiap match dalam satu text node dengan span ter-blur. Proses dari belakang
  // supaya offset match yang lebih awal tetap valid setelah splitText.
  function wrapMatches(node, matches) {
    for (let i = matches.length - 1; i >= 0; i--) {
      const m = matches[i];
      try {
        const tail = node.splitText(m.end);   // node = [0,end)
        void tail;
        const mid = node.splitText(m.start);  // node = [0,start), mid = [start,end)
        const span = makeTextSpan();
        mid.parentNode.insertBefore(span, mid);
        span.appendChild(mid);
      } catch {
        // offset tak valid (teks berubah) — lewati
      }
    }
  }
  function scanText(root) {
    const base = root && root.nodeType === 1 ? root : document.body;
    if (!base) return;
    // Kumpulkan dulu (jangan modifikasi DOM saat TreeWalker aktif).
    const jobs = [];
    const walker = document.createTreeWalker(base, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        const tag = p.tagName;
        if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "TEXTAREA")
          return NodeFilter.FILTER_REJECT;
        if (isOwnUi(p)) return NodeFilter.FILTER_REJECT; // sudah disensor / UI sendiri
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let node;
    while ((node = walker.nextNode())) {
      const matches = findMatches(node.nodeValue);
      if (matches.length) jobs.push({ node, matches });
    }
    for (const j of jobs) wrapMatches(j.node, j.matches);
  }

  // ---- Masking field (input/textarea) ----
  // password: sudah disembunyikan browser. search: kontrol input, bukan data tampilan.
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
  // Kotak pencarian jangan di-blur (mengganggu UX). Deteksi lewat tipe/role/konteks.
  function isSearchField(el, ctx) {
    if ((el.type || "").toLowerCase() === "search") return true;
    if (el.getAttribute("role") === "searchbox") return true;
    if (el.closest && el.closest('[role="search"]')) return true;
    return SEARCH_HINT_RE.test(ctx);
  }
  function onFieldFocus(e) {
    e.currentTarget.style.filter = origFilter.get(e.currentTarget) || "none";
  }
  function onFieldBlur(e) {
    if (enabled) e.currentTarget.style.filter = FIELD_BLUR;
  }
  function maskField(el) {
    if (el.dataset.yoshtoolSensor) return;
    el.dataset.yoshtoolSensor = "field";
    origFilter.set(el, el.style.filter || "");
    el.style.filter = FIELD_BLUR;
    // Reveal saat fokus (agar bisa diedit/dibaca), blur lagi saat kehilangan fokus.
    el.addEventListener("focus", onFieldFocus);
    el.addEventListener("blur", onFieldBlur);
  }
  function shouldMaskField(el) {
    if (el.tagName === "INPUT" && SKIP_INPUT_TYPES.has((el.type || "").toLowerCase())) return false;
    // JANGAN blur field kosong (mis. password/search yang belum diisi) — ganggu UX.
    const value = el.value;
    if (!value || !value.trim()) return false;
    const ctx = fieldContext(el);
    if (isSearchField(el, ctx)) return false;
    if (SECRET_FIELD_RE.test(ctx) || PII_FIELD_RE.test(ctx)) return true;
    if (findMatches(value).length) return true;
    if (looksLikeSecret(value)) return true;
    if (looksLikeIp(value)) return true; // mis. field "Whitelist IP" (label tak terbaca)
    return false;
  }
  function scanFields(root) {
    const scope = root && root.nodeType === 1 ? root : document;
    const fields = scope.querySelectorAll ? scope.querySelectorAll("input, textarea") : [];
    for (const el of fields) {
      if (el.dataset.yoshtoolSensor) continue;
      if (isOwnUi(el)) continue;
      if (shouldMaskField(el)) maskField(el);
    }
    // root sendiri bisa berupa input (mis. ditambah langsung ke DOM).
    if (root && root.nodeType === 1 && (root.tagName === "INPUT" || root.tagName === "TEXTAREA")) {
      if (!root.dataset.yoshtoolSensor && !isOwnUi(root) && shouldMaskField(root)) maskField(root);
    }
  }

  // ---- Masking kolom tabel sensitif ----
  function revealCell(e) {
    const td = e.currentTarget;
    td.style.filter = "none";
    clearTimeout(td.__yoshtoolTimer);
    const reblur = () => {
      if (enabled && td.isConnected && td.dataset.yoshtoolSensor === "cell") td.style.filter = "blur(6px)";
    };
    td.__yoshtoolTimer = setTimeout(reblur, REVEAL_MS);
    td.addEventListener("mouseleave", function onLeave() {
      td.removeEventListener("mouseleave", onLeave);
      clearTimeout(td.__yoshtoolTimer);
      reblur();
    });
  }
  function maskCell(td) {
    if (td.dataset.yoshtoolSensor) return;
    td.dataset.yoshtoolSensor = "cell";
    origFilter.set(td, td.style.filter || "");
    td.style.filter = "blur(6px)";
    td.style.cursor = "pointer";
    td.title = "Data disensor — klik untuk tampil sementara";
    td.addEventListener("click", revealCell);
  }
  // Blur seluruh kolom yang header-nya cocok SENSITIVE_COL_RE (Destination Account,
  // Whitelist IP, dll). Kolom Reference/Description/Amount tak tersentuh (header tak cocok).
  function maskSensitiveTableColumns(scope) {
    const root = scope && scope.querySelectorAll ? scope : document;
    let tables;
    try { tables = root.querySelectorAll("table"); } catch { return; }
    for (const table of tables) {
      if (isOwnUi(table)) continue;
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
        if (row === headerRow) continue; // jangan blur baris header
        const cells = row.children;
        for (const idx of sensitiveIdx) {
          const cell = cells[idx];
          if (cell && cell.tagName === "TD" && !cell.dataset.yoshtoolSensor && !isOwnUi(cell)) maskCell(cell);
        }
      }
    }
  }

  function scanFieldsAndTables(scope) {
    try { scanFields(scope); } catch { /* best-effort */ }
    try { maskSensitiveTableColumns(scope); } catch { /* best-effort */ }
  }

  function scan(root) {
    if (!enabled) return;
    try { scanText(root); } catch { /* best-effort */ }
    scanFieldsAndTables(root);
  }

  // ---- Lepas semua mask (saat master dimatikan) ----
  function removeAllMasks() {
    document.querySelectorAll('[data-yoshtool-sensor="field"]').forEach((el) => {
      el.style.filter = origFilter.get(el) || "";
      el.removeEventListener("focus", onFieldFocus);
      el.removeEventListener("blur", onFieldBlur);
      delete el.dataset.yoshtoolSensor;
    });
    document.querySelectorAll('span[data-yoshtool-sensor="text"]').forEach((span) => {
      clearTimeout(span.__yoshtoolTimer);
      const parent = span.parentNode;
      if (!parent) return;
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      parent.removeChild(span);
      if (parent.normalize) parent.normalize(); // gabungkan kembali text node
    });
    document.querySelectorAll('[data-yoshtool-sensor="cell"]').forEach((td) => {
      clearTimeout(td.__yoshtoolTimer);
      td.style.filter = origFilter.get(td) || "";
      td.style.cursor = "";
      td.removeEventListener("click", revealCell);
      delete td.dataset.yoshtoolSensor;
    });
  }

  // ---- Realtime: MutationObserver ter-debounce ----
  const pendingRoots = new Set();
  let debounceTimer = null;
  const observer = new MutationObserver((mutations) => {
    for (const mut of mutations) {
      for (const n of mut.addedNodes) {
        if (n.nodeType === 1) pendingRoots.add(n);
        else if (n.nodeType === 3 && n.parentElement) pendingRoots.add(n.parentElement);
      }
    }
    if (pendingRoots.size) scheduleScan();
  });
  function observe() {
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
  function scheduleScan() {
    if (debounceTimer) return;
    debounceTimer = setTimeout(runScan, 300);
  }
  function runScan() {
    debounceTimer = null;
    if (!enabled) { pendingRoots.clear(); return; }
    const roots = [...pendingRoots];
    pendingRoots.clear();
    // Putus observer selama kita menyisipkan span agar perubahan DOM kita sendiri
    // tidak memicu putaran scan tak berujung.
    observer.disconnect();
    try {
      for (const root of roots) {
        if (root.isConnected && !isOwnUi(root)) scanText(root);
      }
      // Field & tabel selalu dipindai se-dokumen: nilai yang dimuat async bisa diisi ke
      // input/sel yang sudah ada (di luar root yang bermutasi), dan set .value tak
      // memicu observer.
      scanFieldsAndTables(document);
    } finally {
      if (enabled) observe();
    }
  }

  // Set .value pada input yang sudah ada TIDAK memicu MutationObserver maupun event
  // fokus, jadi field yang dimuat async (Province/Address/Account Number/Whitelist IP)
  // bisa luput. Pindai ulang field beberapa kali setelah load untuk menangkapnya.
  // Aman: scanFields hanya ubah style/dataset (bukan tambah node) → tak memicu observer.
  const settleTimers = [];
  function scheduleSettleScans() {
    for (const delay of [400, 900, 1800, 3000, 5000, 8000]) {
      settleTimers.push(setTimeout(() => {
        if (enabled) scanFieldsAndTables(document);
      }, delay));
    }
  }

  // Field yang baru diisi (mis. user mengetik rahasia ke field yang tadinya kosong)
  // tidak terdeteksi MutationObserver. Saat fokus lepas, cek ulang: bila kini ber-nilai
  // dan memenuhi syarat → mask. Field kosong tetap tak di-blur. Dipasang sekali,
  // digerbangi `enabled` di dalam. (Reveal-on-focus tetap membuka saat diedit.)
  document.addEventListener("focusout", (e) => {
    if (!enabled) return;
    const el = e.target;
    if (!el || (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA")) return;
    if (el.dataset.yoshtoolSensor || isOwnUi(el)) return;
    if (shouldMaskField(el)) maskField(el);
  }, true);

  function start() {
    scan(document.body || document.documentElement);
    observe();
    scheduleSettleScans();
  }
  function stop() {
    observer.disconnect();
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    while (settleTimers.length) clearTimeout(settleTimers.pop());
    pendingRoots.clear();
    removeAllMasks();
  }

  // ---- Toggle master realtime via storage ----
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[SENSOR_ENABLED_KEY]) return;
    const now = changes[SENSOR_ENABLED_KEY].newValue !== false;
    if (now === enabled) return;
    enabled = now;
    if (enabled) start();
    else stop();
  });

  // ---- Mulai ----
  chrome.storage.local.get(SENSOR_ENABLED_KEY).then((v) => {
    enabled = v[SENSOR_ENABLED_KEY] !== false; // default ON
    if (enabled) start();
  }).catch(() => {
    // storage tak tersedia — default ON, tetap jalan.
    start();
  });
})();
