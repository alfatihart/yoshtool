// adblock-core.js
// Pure helpers for the ad / tracker blocker (Fase 1 — network blocking only).
// NO chrome.* here, so it runs under `node --test`. The service worker (background.js)
// imports these and does the actual chrome.declarativeNetRequest calls.
//
// Model: two STATIC DNR rulesets ("ads", "trackers") shipped in rule_resources/, declared
// `enabled:false` in the manifest and toggled at runtime from the user's prefs. DNR block/allow
// needs NO host permission, so the base blocker is fully opt-in-friendly. Per-site allowlisting
// uses DYNAMIC `allowAllRequests` rules (also permission-free).

export const ADBLOCK_ADS_KEY = "adblockAds";
export const ADBLOCK_TRACKERS_KEY = "adblockTrackers";
export const ADBLOCK_ALLOWLIST_KEY = "adblockAllowlist";
export const ADBLOCK_COSMETIC_KEY = "adblockCosmetic"; // element-hiding master (needs *://*/* grant)
export const ADBLOCK_CONSENT_KEY = "adblockConsent"; // cookie-banner auto-reject (needs *://*/* grant)

export const RULESET_ADS = "ads";
export const RULESET_TRACKERS = "trackers";
export const RULESET_REDIRECT = "redirect"; // redirect blocked scripts to neutered stubs (anti page-break)
export const ADBLOCK_RULESETS = [RULESET_ADS, RULESET_TRACKERS, RULESET_REDIRECT];

// Dynamic-rule id range reserved for our per-site allowlist rules, so we never clobber
// (and are never clobbered by) any other dynamic rules.
export const ALLOW_ID_START = 100000;
export const ALLOW_ID_END = 200000;

// Which static rulesets should be enabled, given the prefs. The redirect ruleset uses DNR
// `redirect` rules, which require host permission — so it only turns on when the all-sites
// permission is granted AND some blocking is on (it's an anti-breakage layer over the blockers).
export function desiredRulesets({ ads, trackers, redirectGranted } = {}) {
  const ids = [];
  if (ads) ids.push(RULESET_ADS);
  if (trackers) ids.push(RULESET_TRACKERS);
  if ((ads || trackers) && redirectGranted) ids.push(RULESET_REDIRECT);
  return ids;
}

// Diff desired vs currently-enabled → { enable, disable }. Only ever touches OUR ruleset ids,
// so it won't disable rulesets some other feature might enable in the future.
export function rulesetDiff(desired, current) {
  const cur = current || [];
  const want = desired || [];
  const enable = want.filter((id) => ADBLOCK_RULESETS.includes(id) && !cur.includes(id));
  const disable = cur.filter((id) => ADBLOCK_RULESETS.includes(id) && !want.includes(id));
  return { enable, disable };
}

// Normalize a page URL or a bare host string to a lowercase hostname (no scheme, port or
// trailing dot). Returns "" for input we can't turn into a real host.
export function normalizeHost(input) {
  if (!input) return "";
  let h = String(input).trim();
  if (!h) return "";
  try {
    const scheme = h.match(/^([a-z][a-z0-9+.-]*):\/\//i);
    if (scheme) {
      const s = scheme[1].toLowerCase();
      if (s !== "http" && s !== "https" && s !== "ws" && s !== "wss") return ""; // chrome://, about:, file:, …
      h = new URL(h).hostname;
    } else if (/[/:?#]/.test(h)) {
      h = new URL("http://" + h).hostname;
    }
  } catch {
    return "";
  }
  return h.toLowerCase().replace(/\.+$/, "");
}

// Only real DNS-style hosts can be allowlisted (skip chrome://, about:blank, empty, IPs-with-space, etc.).
export function isBlockableHost(h) {
  return typeof h === "string" && /^[a-z0-9.-]+\.[a-z0-9.-]+$/.test(h) && !h.includes("..");
}

// Add a host to an allowlist array (normalized, de-duplicated, sorted). Returns a NEW array.
export function withHost(list, raw) {
  const h = normalizeHost(raw);
  const set = new Set((list || []).map(normalizeHost).filter(isBlockableHost));
  if (isBlockableHost(h)) set.add(h);
  return [...set].sort();
}

// Remove a host from an allowlist array (matches the exact normalized host). Returns a NEW array.
export function withoutHost(list, raw) {
  const h = normalizeHost(raw);
  return (list || []).map(normalizeHost).filter((x) => isBlockableHost(x) && x !== h).sort();
}

// Build DNR dynamic `allowAllRequests` rules exempting whole pages of each allowlisted host.
// High priority so it beats every block rule in the static rulesets.
export function buildAllowRules(hosts, idStart = ALLOW_ID_START) {
  const out = [];
  let id = idStart;
  const seen = new Set();
  for (const raw of hosts || []) {
    const h = normalizeHost(raw);
    if (!isBlockableHost(h) || seen.has(h)) continue;
    seen.add(h);
    out.push({
      id: id++,
      priority: 1000000,
      action: { type: "allowAllRequests" },
      condition: { requestDomains: [h], resourceTypes: ["main_frame", "sub_frame"] },
    });
  }
  return out;
}
