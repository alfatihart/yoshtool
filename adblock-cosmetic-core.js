// adblock-cosmetic-core.js
// Pure helpers for cosmetic (element-hiding) filtering — no chrome.*, so they run under
// `node --test`. The content script adblock-cosmetic.js keeps a BYTE-IDENTICAL inline copy of
// domainsOf / selectorsForHost / buildCosmeticCss (it's a classic script and can't import).
// Keep the two function bodies identical (see CONTRIBUTING).

export const COSMETIC_STYLE_ID = "__yoshtool_adblock_cosmetic";

// "a.b.example.com" -> ["a.b.example.com","b.example.com","example.com"] (excludes the bare TLD),
// so a selector keyed on any parent domain also applies to the subdomain.
export function domainsOf(host) {
  const h = String(host || "").toLowerCase().replace(/^\.+|\.+$/g, "");
  if (!h) return [];
  const parts = h.split(".");
  const out = [];
  for (let i = 0; i < parts.length - 1; i++) out.push(parts.slice(i).join("."));
  return out;
}

// Combine the generic selectors with the per-domain ones that apply to this host.
export function selectorsForHost(data, host) {
  const generic = data && Array.isArray(data.generic) ? data.generic : [];
  const specific = (data && data.specific) || {};
  const set = new Set(generic);
  for (const d of domainsOf(host)) {
    const list = specific[d];
    if (Array.isArray(list)) for (const s of list) set.add(s);
  }
  return [...set];
}

// One CSS rule hiding every applicable selector. Selectors are pre-validated at build time, so a
// single comma-joined rule is safe (no invalid selector to invalidate the whole list).
export function buildCosmeticCss(selectors) {
  if (!selectors || !selectors.length) return "";
  return selectors.join(",\n") + "{display:none!important}";
}
