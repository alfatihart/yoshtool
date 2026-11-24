// adblock-scriptlets.js — MAIN-world content script (classic; it CANNOT import). Runs small
// "surgical" scriptlets at document_start to defuse JS-state anti-adblock (e.g. FuckAdBlock /
// BlockAdBlock) and no-op known ad globals, before the page's own scripts run. Registered on all
// sites only when the "anti-adblock scriptlets" toggle is on AND the all-sites permission is
// granted (see background.js syncScriptletScripts). MAIN world = no chrome.* here.
//
// domainsOf / scriptletsForHost below are a BYTE-IDENTICAL inline copy of adblock-scriptlets-core.js
// — keep the function bodies in sync (see CONTRIBUTING). The scriptlet IMPLEMENTATIONS and the
// bundled RULES table are MAIN-world-only, so they live only here.
(() => {
  if (window.__yoshtoolAdblockScriptlets) return;
  window.__yoshtoolAdblockScriptlets = true;

  const SCRIPTLET_NAMES = ["set-constant", "abort-on-property-read", "nofab", "json-prune", "nowebrtc", "youtube-ads"];

  // ---- inline copy of adblock-scriptlets-core.js (keep byte-identical) ----
  function domainsOf(host) {
    const h = String(host || "").toLowerCase().replace(/^\.+|\.+$/g, "");
    if (!h) return [];
    const parts = h.split(".");
    const out = [];
    for (let i = 0; i < parts.length - 1; i++) out.push(parts.slice(i).join("."));
    return out;
  }
  function scriptletsForHost(rules, host) {
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
  // ---- end inline copy ----

  // Map a set-constant string argument to its real value.
  function constValue(v) {
    switch (v) {
      case "false": return false;
      case "true": return true;
      case "null": return null;
      case "undefined": return undefined;
      case "''": case '""': case "emptyStr": return "";
      case "[]": case "emptyArr": return [];
      case "{}": case "emptyObj": return {};
      case "noopFunc": return function () {};
      case "trueFunc": return function () { return true; };
      case "falseFunc": return function () { return false; };
      default: {
        const n = Number(v);
        return Number.isNaN(n) ? v : n;
      }
    }
  }

  // Define window.<path> as a locked constant (getter returns value, setter is a no-op). Used to
  // force an anti-adblock flag to a harmless value before the page reads it.
  function setConstant(path, rawValue) {
    const value = constValue(rawValue);
    const parts = String(path || "").split(".");
    const prop = parts.pop();
    let owner = window;
    for (const p of parts) {
      if (owner[p] === undefined || owner[p] === null) {
        try { Object.defineProperty(owner, p, { value: {}, writable: true, configurable: true }); } catch (e) { return; }
      }
      owner = owner[p];
      if (!owner || (typeof owner !== "object" && typeof owner !== "function")) return;
    }
    try {
      Object.defineProperty(owner, prop, {
        get() { return value; },
        set() {},
        configurable: false,
      });
    } catch (e) {}
  }

  // Throw a ReferenceError when the page reads window.<prop> — breaks a detector that reads a known
  // anti-adblock global so its init never completes. DANGEROUS GLOBALLY: a throwing getter crashes any
  // (unrelated) site that merely enumerates/probes window globals, so this is NOT used in the generic
  // "*" rules — prefer nofab() there. Kept for optional per-site rules only.
  function abortOnPropertyRead(prop) {
    const name = String(prop || "");
    if (!name) return;
    try {
      Object.defineProperty(window, name, {
        get() { throw new ReferenceError(name); },
        set() {},
        configurable: false,
      });
    } catch (e) {}
  }

  // Neutralise the FuckAdBlock / BlockAdBlock family with HARMLESS no-op stubs (uBO's `nofab`) rather
  // than a throwing getter. Reading these globals returns an inert object, so a detector's
  // onNotDetected callback fires (content shows) AND an unrelated site that enumerates window globals
  // (e.g. a marketplace SPA) does not crash. This replaces the old global abort-on-property-read list.
  function noFab() {
    const noop = function () {};
    const Fab = function () {};
    Fab.prototype.check = noop;
    Fab.prototype.clearEvent = noop;
    Fab.prototype.emitEvent = noop;
    Fab.prototype.on = function (detected, fn) { if (!detected && typeof fn === "function") fn(); return this; };
    Fab.prototype.onDetected = function () { return this; };
    Fab.prototype.onNotDetected = function (fn) { if (typeof fn === "function") fn(); return this; };
    Fab.prototype.setOption = function () { return this; };
    Fab.prototype.options = { set: noop, get: noop };
    const inst = new Fab();
    const define = (name, value) => {
      try {
        if (Object.prototype.hasOwnProperty.call(window, name)) { try { window[name] = value; } catch (e) {} }
        else Object.defineProperty(window, name, { get() { return value; }, set() {} });
      } catch (e) {}
    };
    // Constructors return the stub class; the lower-case names return a stub instance.
    define("FuckAdBlock", Fab); define("BlockAdBlock", Fab); define("SniffAdBlock", Fab);
    define("fuckAdBlock", inst); define("blockAdBlock", inst); define("sniffAdBlock", inst);
    // Variants the previous global list also covered.
    define("sadbl", Fab); define("sadblock", inst);
  }

  // Wrap JSON.parse and Response.prototype.json to delete the given dotted properties from the
  // parsed object before the page sees them (strip ad metadata from API/config responses).
  function jsonPrune(props) {
    const paths = (props || []).filter(Boolean).map((p) => String(p).split("."));
    if (!paths.length) return;
    const prune = (obj) => {
      if (!obj || typeof obj !== "object") return obj;
      for (const path of paths) {
        let o = obj;
        for (let i = 0; i < path.length - 1 && o; i++) o = o[path[i]];
        if (o && typeof o === "object") { try { delete o[path[path.length - 1]]; } catch (e) {} }
      }
      return obj;
    };
    try {
      const origParse = JSON.parse;
      JSON.parse = function (text, reviver) { return prune(origParse.call(this, text, reviver)); };
    } catch (e) {}
    try {
      const origJson = Response.prototype.json;
      Response.prototype.json = function () { return origJson.apply(this, arguments).then(prune); };
    } catch (e) {}
  }

  // YouTube ad removal. The generic json-prune (JSON.parse / Response.json hooks) misses the ad on a
  // PAGE REFRESH because YouTube embeds the player response as an inline literal
  // (`ytInitialPlayerResponse = {…}`) — no parse call fires. So we also install a property TRAP on
  // window that prunes the ad fields as YouTube assigns the literal (we run at document_start MAIN
  // world, before that inline script), AND keep the parse/fetch hooks for SPA navigations.
  function youtubeAds() {
    // IMPORTANT: we no longer tamper with YouTube's player response. Pruning the ad descriptors
    // (adPlacements/playerAds/adSlots) — by any path: the inline-literal trap, JSON.parse, fetch(.json)
    // or XHR — is now DETECTED by YouTube's anti-adblock enforcement, which retaliates by refusing to
    // serve the stream (videoplayback → 403 Forbidden / ERR_NAME_NOT_RESOLVED → black video) and showing
    // the "ad blocker not allowed" nag. MV3 can't win that cat-and-mouse (no hourly remote scriptlet
    // updates like uBO Origin), and once detected the pruning blocked nothing anyway. So on YouTube we
    // now ONLY auto-dismiss the enforcement modal if one appears and resume playback — ads play as
    // normal. Reliable ad-free YouTube = YouTube Premium. See docs/hard-to-block-ads-research.md.
    //
    // Auto-dismiss the "ad blocker not allowed" enforcement modal (if it appears) and resume the video.
    // DOM-only — it never touches the player response, so it can't break playback.
    try {
      const dismissNag = () => {
        const modal = document.querySelector(
          "ytd-enforcement-message-view-model, tp-yt-paper-dialog:has(ytd-enforcement-message-view-model), ytd-popup-container tp-yt-paper-dialog:has(ytd-enforcement-message-view-model)"
        );
        if (!modal) return;
        try { (modal.closest("tp-yt-paper-dialog") || modal).remove(); } catch (e) {}
        document.querySelectorAll("tp-yt-iron-overlay-backdrop").forEach((b) => { try { b.remove(); } catch (e) {} });
        try {
          document.documentElement.style.removeProperty("overflow");
          if (document.body) { document.body.style.removeProperty("overflow"); document.body.removeAttribute("scroll-lock"); }
        } catch (e) {}
        const v = document.querySelector("video.html5-main-video") || document.querySelector("video");
        if (v && v.paused) { try { const p = v.play(); if (p && p.catch) p.catch(() => {}); } catch (e) {} }
      };
      let scheduled = false;
      const flush = () => { scheduled = false; dismissNag(); };
      const schedule = () => { if (scheduled) return; scheduled = true; (window.requestAnimationFrame || window.setTimeout)(flush, 0); };
      const begin = () => {
        dismissNag();
        try { new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
      };
      if (document.documentElement) begin();
      else document.addEventListener("DOMContentLoaded", begin, { once: true });
    } catch (e) {}
  }

  // Neuter WebRTC (RTCPeerConnection) — a common IP-leak / fingerprinting vector some ad SDKs use.
  function nowebrtc() {
    const Noop = function () {};
    for (const k of ["RTCPeerConnection", "webkitRTCPeerConnection", "mozRTCPeerConnection"]) {
      try {
        if (window[k]) Object.defineProperty(window, k, { value: Noop, writable: false, configurable: false });
      } catch (e) {}
    }
  }

  const IMPL = {
    "set-constant": (path, value) => setConstant(path, value),
    "abort-on-property-read": (prop) => abortOnPropertyRead(prop),
    "nofab": () => noFab(),
    "json-prune": (...props) => jsonPrune(props),
    "nowebrtc": () => nowebrtc(),
    "youtube-ads": () => youtubeAds(),
  };

  // ---- bundled rules (data; growable). "*" entries are safe GENERIC anti-adblock-library
  // defusers — the names are specific to those libs, so false-positive risk is low. Per-site
  // entries go under their hostname. Updating this table requires an extension release (MV3
  // forbids remote code), same as AdGuard's MV3 build. ----
  const RULES = {
    "*": [
      // FuckAdBlock / BlockAdBlock family (common on pirate/stream sites). Neutralised with HARMLESS
      // stubs — NOT a throwing getter, which crashed unrelated sites that enumerate window globals
      // (e.g. Shopee Seller: its bundle read window.FuckAdBlock and the ReferenceError broke its init).
      ["nofab"],
    ],
    // YouTube: strip the ad metadata from the innertube player response (the uBO/AdGuard json-prune
    // approach). Covers both shapes — the response delivered at top level (fetch /youtubei/v1/player
    // → Response.json) and nested under `playerResponse`. BEST-EFFORT: YouTube changes this often and
    // some ads are server-stitched (can't be removed client-side); updating needs an extension release
    // (MV3 forbids remote code). An ad-block "nag" may still appear on some accounts.
    "youtube.com": [
      ["youtube-ads"],
    ],
  };

  try {
    for (const { name, args } of scriptletsForHost(RULES, location.hostname)) {
      const fn = IMPL[name];
      if (fn) { try { fn.apply(null, args); } catch (e) {} }
    }
  } catch (e) {}
})();
