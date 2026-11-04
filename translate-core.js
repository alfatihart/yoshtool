// translate-core.js
// Pure helpers for the translation tooltip: build the request URL for the free, auth-free Google
// Translate web endpoint, and parse its (nested-array) response. Node-tested. Imported by the
// background service worker (a module); the content script never calls the endpoint directly —
// browsers can't satisfy the endpoint's missing CORS, but the SW (with host permission) can.
//
// Provider abstraction: a provider is { id, label, buildUrl(text,to,from), parse(json) }. v1 ships
// the free Google endpoint; more can be added as config without touching the content script. No
// third-party brand names appear here.

// Build the Google "gtx" single-translation URL. `from` defaults to "auto" (auto-detect source).
export function buildTranslateUrl(text, to, from = "auto") {
  const q = encodeURIComponent(String(text || ""));
  const tl = encodeURIComponent(String(to || "en"));
  const sl = encodeURIComponent(String(from || "auto"));
  return `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${q}`;
}

// Parse the endpoint's response → { text, source }. The shape is roughly
// [ [ [translatedChunk, originalChunk, …], … ], …, detectedSourceLang, … ].
export function parseTranslateResponse(data) {
  if (!Array.isArray(data) || !Array.isArray(data[0])) return { text: "", source: "" };
  const text = data[0].map((seg) => (Array.isArray(seg) && typeof seg[0] === "string" ? seg[0] : "")).join("");
  const source = typeof data[2] === "string" ? data[2] : "";
  return { text, source };
}

// Target languages offered in the popup (code → label). A curated subset, not the full list.
export const TARGET_LANGUAGES = [
  ["id", "Indonesian"],
  ["en", "English"],
  ["ar", "Arabic"],
  ["zh-CN", "Chinese (Simplified)"],
  ["ja", "Japanese"],
  ["ko", "Korean"],
  ["es", "Spanish"],
  ["fr", "French"],
  ["de", "German"],
  ["ru", "Russian"],
  ["hi", "Hindi"],
  ["pt", "Portuguese"],
  ["th", "Thai"],
  ["vi", "Vietnamese"],
  ["ms", "Malay"],
];
