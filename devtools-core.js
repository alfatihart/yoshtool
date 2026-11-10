// devtools-core.js
// Pure converters for the "Dev converter" tool — JWT decode, JSON format/minify, Base64 and URL
// encode/decode. No chrome.*/DOM (uses atob/btoa/TextEncoder/TextDecoder, which exist in both the
// browser and Node), so it's Node-tested and imported directly by popup.js (a module). The converter
// is popup-only; there is no content script, so no inline copy to keep in sync.
//
// Security note: JWT decode is DECODE ONLY — it does not verify the signature. Never trust a decoded
// JWT as authenticated.

// base64url (and plain base64) → UTF-8 string.
export function base64UrlDecode(str) {
  let s = String(str || "").replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function decodeJwt(token) {
  const t = String(token || "").trim();
  const parts = t.split(".");
  if (parts.length < 2) return { ok: false, error: "Not a JWT (expected header.payload.signature)" };
  try {
    const header = JSON.parse(base64UrlDecode(parts[0]));
    const payload = JSON.parse(base64UrlDecode(parts[1]));
    return { ok: true, header, payload, signature: parts[2] || "" };
  } catch (e) {
    return { ok: false, error: "Invalid JWT: " + (e && e.message ? e.message : "decode failed") };
  }
}

// Human-readable JWT dump: header + payload (pretty) + humanized time claims + expiry status.
export function formatJwt(token) {
  const d = decodeJwt(token);
  if (!d.ok) return d;
  let text = "// Header\n" + JSON.stringify(d.header, null, 2) + "\n\n// Payload\n" + JSON.stringify(d.payload, null, 2);
  const times = [];
  for (const k of ["iat", "nbf", "exp", "auth_time"]) {
    if (typeof d.payload[k] === "number") times.push(k + ": " + new Date(d.payload[k] * 1000).toISOString());
  }
  if (times.length) text += "\n\n// Times (UTC)\n" + times.join("\n");
  if (typeof d.payload.exp === "number") {
    text += "\n// Status: " + (d.payload.exp * 1000 < Date.now() ? "EXPIRED" : "not expired");
  }
  text += "\n\n// (decode only — signature NOT verified)";
  return { ok: true, text };
}

export function formatJson(text) {
  try { return { ok: true, text: JSON.stringify(JSON.parse(text), null, 2) }; }
  catch (e) { return { ok: false, error: "Invalid JSON: " + e.message }; }
}
export function minifyJson(text) {
  try { return { ok: true, text: JSON.stringify(JSON.parse(text)) }; }
  catch (e) { return { ok: false, error: "Invalid JSON: " + e.message }; }
}

export function base64Encode(text) {
  try {
    const bytes = new TextEncoder().encode(String(text));
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return { ok: true, text: btoa(bin) };
  } catch (e) {
    return { ok: false, error: "Encode failed: " + e.message };
  }
}
export function base64Decode(text) {
  try { return { ok: true, text: base64UrlDecode(text) }; } // handles base64 + base64url + padding
  catch (e) { return { ok: false, error: "Invalid Base64" }; }
}

export function urlEncode(text) {
  try { return { ok: true, text: encodeURIComponent(String(text)) }; }
  catch (e) { return { ok: false, error: e.message }; }
}
export function urlDecode(text) {
  try { return { ok: true, text: decodeURIComponent(String(text)) }; }
  catch (e) { return { ok: false, error: "Invalid percent-encoding" }; }
}

// Operations offered in the popup dropdown (value → label).
export const DEV_OPS = [
  ["jwt", "JWT decode"],
  ["json-format", "JSON · format"],
  ["json-minify", "JSON · minify"],
  ["b64-encode", "Base64 · encode"],
  ["b64-decode", "Base64 · decode"],
  ["url-encode", "URL · encode"],
  ["url-decode", "URL · decode"],
];

export function applyDevOp(op, input) {
  const s = String(input == null ? "" : input);
  if (!s.trim()) return { ok: true, text: "" };
  switch (op) {
    case "jwt": return formatJwt(s);
    case "json-format": return formatJson(s);
    case "json-minify": return minifyJson(s);
    case "b64-encode": return base64Encode(s);
    case "b64-decode": return base64Decode(s);
    case "url-encode": return urlEncode(s);
    case "url-decode": return urlDecode(s);
    default: return { ok: false, error: "Unknown operation" };
  }
}
