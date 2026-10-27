// redact.js
// Text-based sensitive-data detection (Phase 1). A pure module with no chrome.* calls so
// it can be tested with `node --test`. Used by redact-overlay.js to flag candidate areas
// to redact in a screenshot.

// Luhn validation for card numbers (strip spaces/dashes first).
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

// Each detector has: kind (category label), a global regex, and an optional validate(match).
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
    // 13-19 grouped digits, Luhn-validated so it won't match arbitrary numbers.
    regex: /\b(?:\d[ -]?){13,19}\b/g,
    validate: (m) => luhnValid(m),
  },
  {
    kind: "iban",
    regex: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g,
  },
  {
    kind: "phone",
    // Indonesian format (+62/0…) and general E.164. At least 9 digits after normalization.
    // Bounded by non-alphanumerics on both sides so it won't match INSIDE a long
    // alphanumeric token (e.g. transaction code "T3008621783083XR3Z4").
    regex: /(?<![0-9A-Za-z])(?:(?:\+62|62|0)8\d{1,2}[ -]?\d{3,4}[ -]?\d{3,5}|\+\d{1,3}[ -]?\d{2,4}(?:[ -]?\d{2,4}){2,4})(?![0-9A-Za-z])/g,
    validate: (m) => (m.replace(/\D/g, "").length >= 9),
  },
  {
    kind: "address",
    // Indonesian addresses: a street/complex marker, then a REQUIRED numeric signal
    // (house No., RT/RW, or a 5-digit postal code) so ordinary phrases like "Jalan
    // menuju sukses" aren't flagged. A standalone RT/RW pattern also matches.
    regex:
      /\b(?:Jl\.?|Jalan|Gg\.?|Gang|Perumahan|Komp(?:\.|lek|leks)?|Blok)\s+[^\n;]{1,70}?(?:\bNo\.?\s*\d+[A-Za-z]?\b|\bRT[\s.]*\d|\b\d{5}\b)[^\n;]{0,40}|\bRT[\s.]*\d{1,3}\s*\/\s*RW[\s.]*\d{1,3}\b/gi,
  },
];

// Find all matches in a string. Returns a list of non-overlapping ranges
// {start, end, kind, value} (earlier start wins, then longer).
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
      if (m.index === det.regex.lastIndex) det.regex.lastIndex++; // avoid looping on an empty match
    }
  }
  // Sort, then drop overlaps (priority: earlier start, then longer).
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

// Field-context keywords signaling secret contents — used to flag an entire
// input/textarea as sensitive from its label/name/id/placeholder, even when the value's
// format is custom (e.g. TriPay API key "DEV-...", private key "NXoNL-...").
export const SECRET_FIELD_RE =
  /(api[\s_-]?key|secret|token|password|passwd|private[\s_-]?key|client[\s_-]?secret|access[\s_-]?key|credential|auth)/i;

// Field-context keywords for personal/sensitive data (PII + location + financial + endpoint).
// Used to flag an entire input/textarea as sensitive from its label/name/id/placeholder
// (e.g. "Alamat", "Email", "Province", "Account Number", "Callback URL") for the capture
// & auto-redact features. Note: "Account Owner" deliberately does NOT match (account must
// be followed by number/no/#) so the owner's name isn't blurred.
export const PII_FIELD_RE =
  /(alamat|address|e-?mail|telp|telepon|phone|no\.?\s*hp|nomor\s*hp|whatsapp|kode\s*pos|postal|zip\s*code|provinsi|province|\bkota\b|\bcity\b|kabupaten|regency|\bkab\b|kecamatan|subdistrict|\bkec\b|kelurahan|\bkel\b|\bdistrict\b|\bdesa\b|village|account\s*(?:number|no\b|#)|no\.?\s*rek|rekening|norek|card\s*(?:number|no\b)|no\.?\s*kartu|nomor\s*kartu|kartu\s*(?:kredit|debit|atm)|\bcvv\b|\bcvc\b|\biban\b|virtual\s*account|callback|webhook|whitelist|\bip\b)/i;

// Per-character Shannon entropy (bits/char). Used to spot high-entropy random tokens in
// field values that lack a clear label.
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

// Heuristic for "this is probably a secret/token": long, no spaces, high entropy, and a
// mix of at least 2 character classes. Deliberately limited to field values (not free
// text) to keep false positives low. URLs are excluded.
export function looksLikeSecret(value) {
  const v = String(value || "").trim();
  if (v.length < 20) return false;
  if (/\s/.test(v)) return false; // a secret token contains no whitespace
  if (/^https?:\/\//i.test(v)) return false; // a URL, not a secret
  let classes = 0;
  if (/[a-z]/.test(v)) classes++;
  if (/[A-Z]/.test(v)) classes++;
  if (/[0-9]/.test(v)) classes++;
  if (/[^A-Za-z0-9]/.test(v)) classes++;
  if (classes < 2) return false;
  return shannonEntropy(v) >= 3.3;
}

// Field value holding an IP address (IPv4 with valid octets 0-255, or IPv6). Applied
// ONLY to field values (e.g. "Whitelist IP", whose label isn't always readable), never
// free text — so an example "192.168.1.1" in help text isn't blurred.
export function looksLikeIp(value) {
  const v = String(value || "").trim();
  if (!v) return false;
  for (const m of v.matchAll(/\d{1,3}(?:\.\d{1,3}){3}/g)) {
    if (m[0].split(".").every((o) => Number(o) <= 255)) return true;
  }
  // IPv6: several hex groups separated by ":" (including the compressed "::" form).
  if (/(?:[0-9a-f]{1,4}:){2,}[0-9a-f]{0,4}/i.test(v) || /::[0-9a-f]/i.test(v)) return true;
  return false;
}

// Field value that's a run of 10-19 plain digits (typical of account number/NIK/NPWP) —
// for an "Account Number" field whose label is unreadable and whose value matches no
// other detector. Applied ONLY to field values, not free text, so reference numbers in
// text/tables (alphanumeric) aren't blurred.
export function looksLikeAccountNumber(value) {
  return /^\d{10,19}$/.test(String(value || "").replace(/[\s-]/g, ""));
}

// Table-column HEADER keywords whose contents are sensitive. Used to redact a whole
// column (e.g. "Destination Account", "Whitelist IP") WITHOUT touching other columns
// like "Reference No"/"Description" — avoiding redaction of transaction numbers.
export const SENSITIVE_COL_RE =
  /(destination\s*account|account\s*(?:number|no\b)|rekening|norek|card\s*(?:number|no\b)|no\.?\s*kartu|nomor\s*kartu|\biban\b|virtual\s*account|\bwhitelist\b)/i;
