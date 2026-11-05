// adblock-consent.js — content script (classic; cannot import). Auto-clicks the "reject all"
// button on common cookie-consent banners. Registered on all sites (document_idle, top frame)
// only when the consent toggle is on AND the all-sites permission is granted. Respects the same
// per-site allowlist as the blocker.
//
// isRejectText below is a BYTE-IDENTICAL inline copy of adblock-consent-core.js (keep the function
// body in sync — see CONTRIBUTING).
(() => {
  if (window.__yoshtoolAdblockConsent) return;
  window.__yoshtoolAdblockConsent = true;

  // ---- inline copy of adblock-consent-core.js (keep byte-identical) ----
  function isRejectText(text) {
    const t = String(text || "").trim().toLowerCase();
    if (!t || t.length > 40) return false;
    const rejecty = /(reject|decline|refuse|\bdeny\b|disagree|only (necessary|essential|required)|(necessary|essential|required) (only|cookies)|continue without (accepting|agreeing)|tolak)/;
    if (!rejecty.test(t)) return false;
    const accepty = /(\baccept\b|\bagree\b|allow all|enable all|got it|^ok$|setuju|\bterima\b)/;
    if (accepty.test(t)) return false;
    return true;
  }
  // ---- end inline copy ----

  // Precise per-CMP "reject all" selectors (most reliable — tried before the generic fallback).
  const CMP_SELECTORS = [
    "#onetrust-reject-all-handler",
    ".ot-pc-refuse-all-handler",
    "#CybotCookiebotDialogBodyButtonDecline",
    "#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll",
    "#didomi-notice-disagree-button",
    ".didomi-continue-without-agreeing",
    'button[data-testid="uc-deny-all-button"]',
    "#cookiescript_reject",
    ".osano-cm-denyAll",
    ".cmplz-deny",
    ".cky-btn-reject",
    "._brlbs-refuse-btn",
    "#W0wltc",
    'button[aria-label*="Reject" i]',
  ];
  const CONSENTISH =
    '[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i],' +
    '[id*="gdpr" i],[class*="gdpr" i],[class*="cmp" i],[id*="cmp" i],' +
    '[aria-label*="cookie" i],[aria-label*="consent" i],[role="dialog"]';

  const host = location.hostname.toLowerCase();
  function allowlisted(list) {
    if (!Array.isArray(list)) return false;
    return list.some((d) => {
      d = String(d).toLowerCase();
      return host === d || host.endsWith("." + d);
    });
  }
  function visible(el) {
    return !!el && el.offsetParent !== null && el.getClientRects().length > 0;
  }

  let done = false;
  function tryReject() {
    if (done) return true;
    for (const sel of CMP_SELECTORS) {
      let el;
      try {
        el = document.querySelector(sel);
      } catch {
        continue;
      }
      if (visible(el)) {
        el.click();
        done = true;
        return true;
      }
    }
    // Generic fallback: a visible reject-labelled button INSIDE a consent-ish container.
    const nodes = document.querySelectorAll('button, a[role="button"], [role="button"], input[type="button"]');
    for (const el of nodes) {
      if (!visible(el)) continue;
      const txt = el.innerText || el.textContent || el.value || "";
      if (!isRejectText(txt)) continue;
      if (!el.closest(CONSENTISH)) continue;
      el.click();
      done = true;
      return true;
    }
    return false;
  }

  let obs = null;
  const timers = [];
  function cleanup() {
    if (obs) obs.disconnect();
    timers.forEach(clearTimeout);
  }
  async function start() {
    try {
      const st = await chrome.storage.local.get("adblockAllowlist");
      if (allowlisted(st.adblockAllowlist)) return;
    } catch {
      return; // context gone
    }
    if (tryReject()) return;
    // Banners load asynchronously — watch for them, retry on a short schedule, then give up.
    obs = new MutationObserver(() => {
      if (tryReject()) cleanup();
    });
    try {
      obs.observe(document.documentElement, { childList: true, subtree: true });
    } catch {}
    for (const ms of [500, 1200, 2500, 4000, 6000]) {
      timers.push(setTimeout(() => {
        if (tryReject()) cleanup();
      }, ms));
    }
    timers.push(setTimeout(cleanup, 8000));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
