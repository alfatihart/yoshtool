// popblock-core.js
// Popup-blocker decision logic — PURE (no DOM / chrome.*), so it can be unit-tested in
// Node and reused as an inline copy in popblock-isolated.js.
//
// Faithful port of `blocker.policy` from "Popup Blocker (strict)" v0.9.4
// (schomery/popup-blocker, MPL-2.0), with one deliberate change for YoshTool:
// the CLICK/submit path (target=_blank etc.) is blocked only when `cfg.strict` is on.
// The original always blocks every target=_blank (hence "strict"); YoshTool's default
// is softer — only programmatic window.open is blocked, so ordinary user-click
// navigation is left alone. Enable "Strict" to mirror the original.
//
// request = {
//   type,            // "window.open" | "element.click" | "dynamic.a.click" | ...
//   href,            // window.open: the URL arg, already resolved to absolute by the caller
//   target, download, tag,
//   hasAnchor,       // element.click: whether there's an associated <a>/[target]
//   hasBase,         // element.click/dynamic: <base target> check result (default true)
//   metaKey, button, isTrusted, defaultPrevented
// }
// cfg = { strict, allowSameOrigin, protocols:[], whitelist:[], topHost }

export function parseUrl(href) {
  try {
    return new URL(href);
  } catch {
    return null;
  }
}

export function hostnameOf(href) {
  const u = parseUrl(href);
  return u ? (u.hostname || "").toLowerCase() : "";
}

// Match a host against a single entry (equal or subdomain, BOTH ways) — exactly like
// the original extension's whitelist & same-domain checks.
export function hostMatches(hostname, entry) {
  hostname = String(hostname || "").toLowerCase();
  entry = String(entry || "").toLowerCase();
  if (!hostname || !entry) return false;
  return (
    hostname === entry ||
    hostname.endsWith("." + entry) ||
    entry.endsWith("." + hostname)
  );
}

export function shouldBlockPopup(request, cfg = {}) {
  const type = request.type || "";
  const href = request.href || "";
  let hostname = "";
  let block = true;
  let sameContext = false;

  if (type === "window.open") {
    sameContext = true;
    // Non-strict mode: a user-gesture window.open (a download, a popup the user
    // actually clicked) is NOT blocked — only programmatic ones (no activation, e.g.
    // a popunder from a timer/onload). Strict mode still blocks EVERY window.open.
    if (!cfg.strict && request.userActive) {
      return { block: false, href, hostname: "", sameContext };
    }
  } else {
    // Click / submit / dispatch path: only blocked in strict mode.
    if (!cfg.strict) {
      return { block: false, href, hostname: "", sameContext: false };
    }
    if (type === "element.click") {
      block = Boolean(request.hasAnchor) || Boolean(href);
    }
    block = block && request.hasBase !== false;
  }

  // Force-block synthetic click tricks (ctrl/middle-click not from a real user).
  if (request.metaKey && request.isTrusted === false) block = true;
  if ("button" in request && request.button !== 0 && request.isTrusted === false) {
    block = true;
  }
  // Don't block: user cancelled, a REAL ctrl/cmd-click, or A[download].
  if (request.defaultPrevented || (request.metaKey && request.isTrusted)) block = false;
  if (request.tag === "A" && request.download) block = false;

  // Allow-overrides, while still blocking and we have an href.
  if (block && href) {
    const loc = parseUrl(href);
    if (loc) {
      hostname = (loc.hostname || "").toLowerCase();
      // Allow popups to the same (registrable) domain when opted in.
      if (cfg.allowSameOrigin && cfg.topHost && hostMatches(hostname, cfg.topHost)) {
        block = false;
      }
      // Accepted protocols (e.g. magnet:).
      if (loc.protocol && (cfg.protocols || []).indexOf(loc.protocol) !== -1) {
        block = false;
      }
      // Host whitelist (OAuth/payments, etc.).
      if (hostname && block) {
        for (const h of cfg.whitelist || []) {
          if (hostMatches(hostname, h)) {
            block = false;
            break;
          }
        }
      }
    }
  }

  return { block, href, hostname, sameContext };
}
