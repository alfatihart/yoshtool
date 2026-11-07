// picker-core.js
// Pure helpers for the element picker / zapper — NO chrome.*/DOM, so they run under `node --test`.
// picker.js (a classic content script that CANNOT import) keeps a BYTE-IDENTICAL inline copy of
// looksStable / stableClasses / ruleDomain / serializeHasText / serializeUpward (see CONTRIBUTING).
//
// The picker lets the user point at a page element and generate a cosmetic selector to hide it. These
// helpers cover the parts that don't need the DOM: deciding which class/id tokens are STABLE (so the
// generated selector survives randomized class names — the whole point for "judol"/CSS-in-JS ad
// markup), deriving the per-site storage key, and serializing the procedural refinements
// (:has-text / :upward) into exactly the grammar adblock-procedural-core.js already parses.

// Storage key for user element-block rules: { "<domain>": ["selector", …], "*": [ …global… ] }.
export const USER_COSMETICS_KEY = "userCosmetics";

// A class/id token is "stable" if it looks like an authored name, not an auto-generated/hashed one.
// Inspired by @medv/finder's wordLike, but relaxed to KEEP short ad-relevant words ("ad", "ads",
// "promo") that finder would drop — we only need to reject the churn: anything with a digit
// (css-1a2b3c, ad_7f3kd, jsx-349582 — covers Tailwind JIT, CSS modules, styled-components), the
// common CSS-in-JS prefixes, and random consonant-run hashes.
export function looksStable(token) {
  const t = String(token || "");
  if (t.length < 2) return false;
  if (/\d/.test(t)) return false; // any digit → almost always auto-generated
  if (/^(sc|css|jss|jsx|mui|makestyles|emotion|chakra|styled)-/i.test(t)) return false; // CSS-in-JS prefixes
  // A hyphen/underscore/camelCase segment that is one long consonant run (>=6, no vowel) is a hash.
  for (const w of t.split(/[-_]|(?=[A-Z])/)) {
    if (w && w.length >= 6 && !/[aeiouAEIOU]/.test(w)) return false;
  }
  return true;
}

// Keep only the stable classes from a class list (order preserved).
export function stableClasses(classes) {
  const out = [];
  for (const c of classes || []) if (looksStable(c)) out.push(c);
  return out;
}

// Per-site rule key: lowercased host with a leading "www." dropped so a rule saved on www.x.com also
// applies on x.com (and vice-versa) — adblock-cosmetic.js matches via domainsOf(host), which walks
// parent domains, so this key covers the host and its subdomains.
export function ruleDomain(hostname) {
  let h = String(hostname || "").trim().toLowerCase().replace(/^\.+|\.+$/g, "");
  if (h.startsWith("www.")) h = h.slice(4);
  return h;
}

// Build a :has-text(...) refinement that round-trips through parseProcedural + parseValueArg. A
// /regex/flags needle passes through as-is; a literal is quoted (quotes protect any "(" / ")" from
// the paren scanner). Falls back to an escaped regex only if the text contains BOTH quote types.
export function serializeHasText(needle) {
  const s = String(needle == null ? "" : needle).trim();
  if (/^\/.*\/[a-z]*$/i.test(s)) return `:has-text(${s})`;
  if (!s.includes('"')) return `:has-text("${s}")`;
  if (!s.includes("'")) return `:has-text('${s}')`;
  return `:has-text(/${s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}/)`;
}

// Build an :upward(...) refinement. N (climb N levels) or a bare CSS selector (nearest matching
// ancestor, used raw by the engine's climb()/closest() — so it is NOT quoted).
export function serializeUpward(arg) {
  return `:upward(${String(arg == null ? "" : arg).trim()})`;
}
