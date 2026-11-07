// adblock-scriptlets-core.js
// Pure helpers for the anti-adblock scriptlet engine — NO chrome.* / no DOM, so they run under
// `node --test`. The MAIN-world content script adblock-scriptlets.js keeps a BYTE-IDENTICAL inline
// copy of `domainsOf` and `scriptletsForHost` (it's a classic script and can't import). Keep the
// two function bodies in sync (see CONTRIBUTING).
//
// Model: a bundled table maps a hostname (or a parent domain, or "*") → a list of scriptlet
// invocations `[name, ...args]`. On each page the MAIN-world script runs the scriptlets whose key
// matches the host, injecting small "surgical" fixes (defuse anti-adblock detectors, no-op ad
// globals) before the page's own scripts run. This is the one thing MV3 still allows that can beat
// JS-state anti-adblock — but, per MV3's remote-code ban, the scriptlet CODE ships inside the
// extension (updatable only via a release), exactly like AdGuard's MV3 build and uBO Lite.

export const ADBLOCK_SCRIPTLETS_KEY = "adblockScriptlets"; // master (needs the *://*/* grant)

// Names the engine knows how to run. Kept here so tests and the popup can validate rule tables.
export const SCRIPTLET_NAMES = [
  "set-constant",
  "abort-on-property-read",
  "json-prune",
  "nowebrtc",
];

// "a.b.example.com" -> ["a.b.example.com","b.example.com","example.com"] (excludes the bare TLD),
// so a rule keyed on any parent domain also applies to the subdomain. (Same shape as the cosmetic
// engine's domainsOf — duplicated, not shared, to keep each core module self-contained.)
export function domainsOf(host) {
  const h = String(host || "").toLowerCase().replace(/^\.+|\.+$/g, "");
  if (!h) return [];
  const parts = h.split(".");
  const out = [];
  for (let i = 0; i < parts.length - 1; i++) out.push(parts.slice(i).join("."));
  return out;
}

// Resolve the scriptlets that apply to `host`: the generic "*" entry first, then every matching
// parent-domain entry. Each raw rule is `[name, ...args]`; invalid/unknown-name rules are dropped.
// Returns `[{ name, args }]` in application order.
export function scriptletsForHost(rules, host) {
  const out = [];
  if (!rules || typeof rules !== "object") return out;
  const known = new Set(SCRIPTLET_NAMES);
  const push = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const r of arr) {
      if (!Array.isArray(r) || !r.length) continue;
      const name = r[0];
      if (!known.has(name)) continue;
      out.push({ name, args: r.slice(1) });
    }
  };
  push(rules["*"]);
  for (const d of domainsOf(host)) push(rules[d]);
  return out;
}
