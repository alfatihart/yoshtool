// redact.js
// Deteksi data sensitif berbasis teks (Fase 1). Modul murni tanpa chrome.* supaya
// bisa diuji dengan `node --test`. Dipakai oleh redact-overlay.js untuk menandai
// kandidat area yang akan disensor pada screenshot.

// Validasi Luhn untuk nomor kartu (buang spasi/strip dulu).
export function luhnValid(digits) {
  const s = String(digits).replace(/[\s-]/g, "");
  if (!/^\d{12,19}$/.test(s)) return false;
  let sum = 0;
  let alt = false;
  for (let i = s.length - 1; i >= 0; i--) {
    let n = s.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

// Tiap detektor punya: kind (label kategori), regex global, dan validate(match) opsional.
const DETECTORS = [
  {
    kind: "email",
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },
  {
    kind: "jwt",
    regex: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  },
  {
    kind: "api_key",
    // AWS access key, Google API key, Stripe live keys, GitHub token.
    regex: /\b(?:AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|(?:sk|pk)_live_[0-9A-Za-z]{16,}|gh[pousr]_[0-9A-Za-z]{36,})\b/g,
  },
  {
    kind: "credit_card",
    // 13–19 digit berkelompok; divalidasi Luhn agar tidak asal angka.
    regex: /\b(?:\d[ -]?){13,19}\b/g,
    validate: (m) => luhnValid(m),
  },
  {
    kind: "iban",
    regex: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g,
  },
  {
    kind: "phone",
    // Format Indonesia (+62/0…) dan E.164 umum. Minimal 9 digit setelah normalisasi.
    regex: /(?:\+62|62|0)8\d{1,2}[ -]?\d{3,4}[ -]?\d{3,5}|\+\d{1,3}[ -]?\d{2,4}(?:[ -]?\d{2,4}){2,4}/g,
    validate: (m) => (m.replace(/\D/g, "").length >= 9),
  },
];

// Cari semua kecocokan dalam sebuah string. Mengembalikan daftar rentang
// {start, end, kind, value} tanpa tumpang tindih (yang lebih dulu/lebih panjang menang).
export function findMatches(text) {
  if (!text) return [];
  const raw = [];
  for (const det of DETECTORS) {
    det.regex.lastIndex = 0;
    let m;
    while ((m = det.regex.exec(text)) !== null) {
      const value = m[0];
      if (det.validate && !det.validate(value)) continue;
      raw.push({ start: m.index, end: m.index + value.length, kind: det.kind, value });
      if (m.index === det.regex.lastIndex) det.regex.lastIndex++; // cegah loop pada match kosong
    }
  }
  // Urutkan lalu buang yang tumpang tindih (prioritas: mulai lebih awal, lalu lebih panjang).
  raw.sort((a, b) => a.start - b.start || b.end - a.end);
  const out = [];
  let lastEnd = -1;
  for (const r of raw) {
    if (r.start >= lastEnd) {
      out.push(r);
      lastEnd = r.end;
    }
  }
  return out;
}

export const DETECTOR_KINDS = DETECTORS.map((d) => d.kind);
