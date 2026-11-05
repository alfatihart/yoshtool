// adblock-cosmetic.js — content script (classic; it CANNOT import). Hides ad/tracker elements by
// injecting a single <style>. Registered on all sites (document_start) only when the cosmetic
// toggle is on AND the all-sites permission is granted (see background.js syncCosmeticScripts).
// Respects the same per-site allowlist as the network blocker.
//
// domainsOf / selectorsForHost / buildCosmeticCss below are a BYTE-IDENTICAL inline copy of
// adblock-cosmetic-core.js — keep the function bodies in sync (see CONTRIBUTING).
(() => {
  if (window.__yoshtoolAdblockCosmetic) return;
  window.__yoshtoolAdblockCosmetic = true;

  // ---- inline copy of adblock-cosmetic-core.js (keep byte-identical) ----
  function domainsOf(host) {
    const h = String(host || "").toLowerCase().replace(/^\.+|\.+$/g, "");
    if (!h) return [];
    const parts = h.split(".");
    const out = [];
    for (let i = 0; i < parts.length - 1; i++) out.push(parts.slice(i).join("."));
    return out;
  }
  function selectorsForHost(data, host) {
    const generic = data && Array.isArray(data.generic) ? data.generic : [];
    const specific = (data && data.specific) || {};
    const set = new Set(generic);
    for (const d of domainsOf(host)) {
      const list = specific[d];
      if (Array.isArray(list)) for (const s of list) set.add(s);
    }
    return [...set];
  }
  function buildCosmeticCss(selectors) {
    if (!selectors || !selectors.length) return "";
    return selectors.join(",\n") + "{display:none!important}";
  }
  // ---- end inline copy ----

  const STYLE_ID = "__yoshtool_adblock_cosmetic";
  const host = location.hostname;

  // Same semantics as the network allowlist: an entry covers that host and its subdomains.
  function hostAllowlisted(list) {
    if (!Array.isArray(list)) return false;
    const h = host.toLowerCase();
    return list.some((d) => {
      d = String(d).toLowerCase();
      return h === d || h.endsWith("." + d);
    });
  }

  async function run() {
    let data, allowlist;
    try {
      const [res, st] = await Promise.all([
        fetch(chrome.runtime.getURL("rule_resources/cosmetics.json")),
        chrome.storage.local.get("adblockAllowlist"),
      ]);
      data = await res.json();
      allowlist = st.adblockAllowlist;
    } catch {
      return; // extension updated / context gone
    }
    if (hostAllowlisted(allowlist)) return;
    const css = buildCosmeticCss(selectorsForHost(data, host));
    if (!css || document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }
  run();
})();
