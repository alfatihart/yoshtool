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
    // The durable core both AdBlocker Ultimate (AdGuard) and Ghostery (uBO) use: delete the player's
    // ad descriptors wherever the response arrives. Only these three keys are load-bearing (stable for
    // years). Covered paths: inline literal (refresh), JSON.parse, fetch(.json), and XHR responseText.
    const AD = ["adPlacements", "playerAds", "adSlots"];
    const prune = (o) => {
      if (o && typeof o === "object") {
        for (const k of AD) { try { delete o[k]; } catch (e) {} }
        const pr = o.playerResponse;
        if (pr && typeof pr === "object") for (const k of AD) { try { delete pr[k]; } catch (e) {} }
      }
      return o;
    };
    // (A) Inline literal on a hard load / refresh: `ytInitialPlayerResponse = {…}` (and `playerResponse`)
    // never hit JSON.parse, so trap the global assignment (= AdGuard/uBO set-constant chain-trap).
    for (const name of ["ytInitialPlayerResponse", "playerResponse"]) {
      try {
        let val;
        Object.defineProperty(window, name, {
          configurable: true,
          get() { return val; },
          set(o) { val = prune(o); },
        });
      } catch (e) {}
    }
    // (B) JSON.parse + fetch(…).json() paths (SPA navigations fetch /youtubei/v1/player).
    try { const p = JSON.parse; JSON.parse = function (t, r) { return prune(p.call(this, t, r)); }; } catch (e) {}
    try { const j = Response.prototype.json; Response.prototype.json = function () { return j.apply(this, arguments).then(prune); }; } catch (e) {}
    // (C) XHR responseText/response path (uBO json-prune-xhr-response) — some player/get_watch reads.
    try {
      const dT = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, "responseText");
      const dR = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, "response");
      const cache = new WeakMap();
      const wrapStr = (self, raw) => {
        if (typeof raw !== "string" || (raw.indexOf("adPlacements") < 0 && raw.indexOf("playerAds") < 0 && raw.indexOf("adSlots") < 0)) return raw;
        const hit = cache.get(self);
        if (hit && hit.raw === raw) return hit.out;
        let out = raw;
        try { out = JSON.stringify(prune(JSON.parse(raw))); } catch (e) {}
        cache.set(self, { raw, out });
        return out;
      };
      if (dT && dT.get) Object.defineProperty(XMLHttpRequest.prototype, "responseText", { configurable: true, get() { return wrapStr(this, dT.get.call(this)); } });
      if (dR && dR.get) Object.defineProperty(XMLHttpRequest.prototype, "response", { configurable: true, get() { const r = dR.get.call(this); return typeof r === "string" ? wrapStr(this, r) : (r && typeof r === "object" ? prune(r) : r); } });
    } catch (e) {}
    // (D) Anti-nag: make YouTube's ad code believe ads loaded, defusing one detection path
    // (= set-constant google_ad_status 1). Page writes are swallowed.
    try { Object.defineProperty(window, "google_ad_status", { configurable: true, get() { return 1; }, set() {} }); } catch (e) {}
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
