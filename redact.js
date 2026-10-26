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
    // Dibatasi non-alfanumerik di kedua sisi agar tidak cocok di DALAM token
    // alfanumerik panjang (mis. kode transaksi "T3008621783083XR3Z4").
    regex: /(?<![0-9A-Za-z])(?:(?:\+62|62|0)8\d{1,2}[ -]?\d{3,4}[ -]?\d{3,5}|\+\d{1,3}[ -]?\d{2,4}(?:[ -]?\d{2,4}){2,4})(?![0-9A-Za-z])/g,
    validate: (m) => (m.replace(/\D/g, "").length >= 9),
  },
  {
    kind: "address",
    // Alamat Indonesia: diawali penanda jalan/komplek, lalu DIWAJIBKAN ada sinyal
    // angka (No. rumah, RT/RW, atau kode pos 5 digit) agar kalimat biasa seperti
    // "Jalan menuju sukses" tidak ikut tertandai. Pola RT/RW berdiri sendiri juga cocok.
    regex:
      /\b(?:Jl\.?|Jalan|Gg\.?|Gang|Perumahan|Komp(?:\.|lek|leks)?|Blok)\s+[^\n;]{1,70}?(?:\bNo\.?\s*\d+[A-Za-z]?\b|\bRT[\s.]*\d|\b\d{5}\b)[^\n;]{0,40}|\bRT[\s.]*\d{1,3}\s*\/\s*RW[\s.]*\d{1,3}\b/gi,
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

// Kata kunci konteks field yang menandakan isinya rahasia — dipakai untuk menandai
// seluruh input/textarea sebagai sensitif berdasarkan label/name/id/placeholder-nya,
// meski format nilainya custom (mis. API key TriPay "DEV-...", private key "NXoNL-...").
export const SECRET_FIELD_RE =
  /(api[\s_-]?key|secret|token|password|passwd|private[\s_-]?key|client[\s_-]?secret|access[\s_-]?key|credential|auth)/i;

// Kata kunci konteks field data pribadi/sensitif (PII + lokasi + finansial + endpoint).
// Dipakai menandai seluruh input/textarea sebagai sensitif berdasarkan
// label/name/id/placeholder-nya (mis. "Alamat", "Email", "Province", "Account Number",
// "Callback URL") untuk fitur capture & auto-sensor. Catatan: "Account Owner" sengaja
// TIDAK cocok (account wajib diikuti number/no/#) agar nama pemilik tak ikut ter-blur.
export const PII_FIELD_RE =
  /(alamat|address|e-?mail|telp|telepon|phone|no\.?\s*hp|nomor\s*hp|whatsapp|kode\s*pos|postal|zip\s*code|provinsi|province|\bkota\b|\bcity\b|kabupaten|regency|\bkab\b|kecamatan|subdistrict|\bkec\b|kelurahan|\bkel\b|\bdistrict\b|\bdesa\b|village|account\s*(?:number|no\b|#)|no\.?\s*rek|rekening|norek|card\s*(?:number|no\b)|no\.?\s*kartu|nomor\s*kartu|kartu\s*(?:kredit|debit|atm)|\bcvv\b|\bcvc\b|\biban\b|virtual\s*account|callback|webhook|whitelist|\bip\b)/i;

// Shannon entropy per karakter (bit/char). Dipakai untuk mendeteksi token acak
// berentropi tinggi pada nilai field yang tak berlabel jelas.
export function shannonEntropy(str) {
  if (!str) return 0;
  const freq = new Map();
  for (const ch of str) freq.set(ch, (freq.get(ch) || 0) + 1);
  let h = 0;
  const n = str.length;
  for (const count of freq.values()) {
    const p = count / n;
    h -= p * Math.log2(p);
  }
  return h;
}

// Heuristik "ini kemungkinan secret/token": panjang, tanpa spasi, entropi tinggi,
// dan campuran minimal 2 kelas karakter. Sengaja dibatasi untuk nilai field saja
// (bukan teks bebas) agar false-positive rendah. URL dikecualikan.
export function looksLikeSecret(value) {
  const v = String(value || "").trim();
  if (v.length < 20) return false;
  if (/\s/.test(v)) return false; // token rahasia tidak mengandung spasi
  if (/^https?:\/\//i.test(v)) return false; // URL, bukan secret
  let classes = 0;
  if (/[a-z]/.test(v)) classes++;
  if (/[A-Z]/.test(v)) classes++;
  if (/[0-9]/.test(v)) classes++;
  if (/[^A-Za-z0-9]/.test(v)) classes++;
  if (classes < 2) return false;
  return shannonEntropy(v) >= 3.3;
}

// Nilai field berisi alamat IP (IPv4 oktet-valid 0–255, atau IPv6). Dipakai HANYA
// pada nilai field (mis. "Whitelist IP" yang label-nya tak selalu terbaca), bukan
// teks bebas — agar contoh "192.168.1.1" di teks bantuan tak ikut ter-blur.
export function looksLikeIp(value) {
  const v = String(value || "").trim();
  if (!v) return false;
  for (const m of v.matchAll(/\d{1,3}(?:\.\d{1,3}){3}/g)) {
    if (m[0].split(".").every((o) => Number(o) <= 255)) return true;
  }
  // IPv6: beberapa grup heksa dipisah ":" (termasuk bentuk terkompres "::").
  if (/(?:[0-9a-f]{1,4}:){2,}[0-9a-f]{0,4}/i.test(v) || /::[0-9a-f]/i.test(v)) return true;
  return false;
}

// Kata kunci HEADER kolom tabel yang isinya sensitif. Dipakai untuk menutup seluruh
// kolom (mis. "Destination Account", "Whitelist IP") TANPA menyentuh kolom lain
// seperti "Reference No"/"Description" — menghindari sensor nomor transaksi.
export const SENSITIVE_COL_RE =
  /(destination\s*account|account\s*(?:number|no\b)|rekening|norek|card\s*(?:number|no\b)|no\.?\s*kartu|nomor\s*kartu|\biban\b|virtual\s*account|\bwhitelist\b)/i;
