// userstyle.js
// Injects the persistent custom CSS saved for this site (Tools → Custom CSS) on every page load.
// Registered dynamically (document_start) by background.syncSiteCss for the hosts that have CSS AND
// whose host permission is granted. Reads the CSS from chrome.storage.local("siteCss") keyed by
// hostname, and keeps it live via storage.onChanged. One <style> element, replaced in place — so a
// re-save (same id) updates rather than stacks.
(() => {
  if (window.__yoshtoolUserstyle) return;
  window.__yoshtoolUserstyle = true;

  const STYLE_ID = "__yoshtool_userstyle";
  const host = (() => { try { return location.hostname || ""; } catch (e) { return ""; } })();

  function apply(css) {
    let el = document.getElementById(STYLE_ID);
    if (!css) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement("style");
      el.id = STYLE_ID;
      el.setAttribute("data-yoshtool", "userstyle");
      // document_start: <head> may not exist yet — a <style> under <html> still applies, and it
      // keeps working once <head> is parsed. Re-home it to <head> when available (tidier).
      (document.head || document.documentElement).appendChild(el);
    }
    el.textContent = css;
  }

  function cssForHost(map) {
    return (map && typeof map === "object" && typeof map[host] === "string") ? map[host] : "";
  }

  try {
    chrome.storage.local.get("siteCss", (r) => {
      void chrome.runtime.lastError;
      apply(cssForHost(r && r.siteCss));
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes.siteCss) return;
      apply(cssForHost(changes.siteCss.newValue));
    });
  } catch (e) { /* context gone */ }
})();
