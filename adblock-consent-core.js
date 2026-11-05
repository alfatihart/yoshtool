// adblock-consent-core.js
// Pure helper for the cookie-consent auto-reject (no chrome.*, runs under `node --test`).
// The content script adblock-consent.js keeps a BYTE-IDENTICAL inline copy of isRejectText
// (keep the function body in sync — see CONTRIBUTING).

// True when a (short) button label looks like a "reject / decline" consent action and NOT like an
// "accept / agree" one. Used only as a fallback, inside a consent-ish container, after the known
// per-CMP selectors miss — so it stays conservative to avoid clicking the wrong button.
export function isRejectText(text) {
  const t = String(text || "").trim().toLowerCase();
  if (!t || t.length > 40) return false;
  const rejecty = /(reject|decline|refuse|\bdeny\b|disagree|only (necessary|essential|required)|(necessary|essential|required) (only|cookies)|continue without (accepting|agreeing)|tolak)/;
  if (!rejecty.test(t)) return false;
  const accepty = /(\baccept\b|\bagree\b|allow all|enable all|got it|^ok$|setuju|\bterima\b)/;
  if (accepty.test(t)) return false;
  return true;
}
