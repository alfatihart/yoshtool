// device-presets.js
// Pure data + helpers for the "Device mode" tool (responsive / mobile simulation). NO chrome.* and
// no DOM, so it runs under `node --test` and is imported directly by BOTH popup.js and background.js
// (both are ES modules — there is no classic content script here, so no byte-identical inline copy
// to keep in sync, unlike the adblock/sensor cores).
//
// Device mode drives Chrome's own emulation engine over the Chrome DevTools Protocol
// (chrome.debugger → Emulation.setDeviceMetricsOverride / setUserAgentOverride /
// setTouchEmulationEnabled) on the REAL tab — the same engine DevTools "Device Mode" uses. This
// module only computes the parameter objects for those CDP calls; background.js issues them.
//
// Why CDP and not an <iframe> simulator (how the "Mobile Simulator" extension works): the real tab
// keeps the site's own first-party cookies, so logged-in SPA dashboards stay logged in, and there
// is no need to strip X-Frame-Options/CSP. The trade-off is the yellow "started debugging" infobar
// and no decorative phone bezel.

// Each preset is one curated device. Fields:
//   id              stable key (stored + used by the dropdown)
//   label           shown in the UI
//   group           "phone" | "tablet" (for optgroups)
//   os              "ios" | "android" (drives UA + client-hint shape)
//   width, height   CSS px, portrait
//   deviceScaleFactor  DPR (may be fractional, as on real Android)
//   mobile          CDP "mobile" flag (true shows the mobile viewport/overlay behaviour)
//   maxTouchPoints  touch points to emulate
//   model           device model string for Sec-CH-UA-Model (Android only)
//   platformVersion OS version for Sec-CH-UA-Platform-Version (Android only)
//   ua              full navigator.userAgent string
//
// Android UAs carry a "Chrome/NNN.0.0.0" token; patchChromeVersion() rewrites it to the running
// Chrome's major version at apply time so sites never see a stale Chrome. iOS Safari UAs have no
// Chrome token and are left untouched.

export const DEVICES = [
  // ---- Phones: iOS (Safari) ----
  {
    id: "iphone-se",
    label: "iPhone SE",
    group: "phone",
    os: "ios",
    width: 375,
    height: 667,
    deviceScaleFactor: 2,
    mobile: true,
    maxTouchPoints: 5,
    model: "",
    platformVersion: "",
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  },
  {
    id: "iphone-13",
    label: "iPhone 13 / 14",
    group: "phone",
    os: "ios",
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true,
    maxTouchPoints: 5,
    model: "",
    platformVersion: "",
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  },
  {
    id: "iphone-15-pro",
    label: "iPhone 15 Pro",
    group: "phone",
    os: "ios",
    width: 393,
    height: 852,
    deviceScaleFactor: 3,
    mobile: true,
    maxTouchPoints: 5,
    model: "",
    platformVersion: "",
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  },
  {
    id: "iphone-15-pro-max",
    label: "iPhone 15 Pro Max",
    group: "phone",
    os: "ios",
    width: 430,
    height: 932,
    deviceScaleFactor: 3,
    mobile: true,
    maxTouchPoints: 5,
    model: "",
    platformVersion: "",
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  },
  // ---- Phones: Android (Chrome) ----
  {
    id: "pixel-7",
    label: "Pixel 7",
    group: "phone",
    os: "android",
    width: 412,
    height: 915,
    deviceScaleFactor: 2.625,
    mobile: true,
    maxTouchPoints: 5,
    model: "Pixel 7",
    platformVersion: "14.0.0",
    ua: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  },
  {
    id: "pixel-8-pro",
    label: "Pixel 8 Pro",
    group: "phone",
    os: "android",
    width: 448,
    height: 998,
    deviceScaleFactor: 2.625,
    mobile: true,
    maxTouchPoints: 5,
    model: "Pixel 8 Pro",
    platformVersion: "14.0.0",
    ua: "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  },
  {
    id: "galaxy-s23",
    label: "Galaxy S23",
    group: "phone",
    os: "android",
    width: 360,
    height: 780,
    deviceScaleFactor: 3,
    mobile: true,
    maxTouchPoints: 5,
    model: "SM-S911B",
    platformVersion: "14.0.0",
    ua: "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  },
  {
    id: "galaxy-s23-ultra",
    label: "Galaxy S23 Ultra",
    group: "phone",
    os: "android",
    width: 384,
    height: 824,
    deviceScaleFactor: 3.75,
    mobile: true,
    maxTouchPoints: 5,
    model: "SM-S918B",
    platformVersion: "14.0.0",
    ua: "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  },
  {
    id: "surface-duo",
    label: "Surface Duo",
    group: "phone",
    os: "android",
    width: 540,
    height: 720,
    deviceScaleFactor: 2.5,
    mobile: true,
    maxTouchPoints: 5,
    model: "Surface Duo",
    platformVersion: "11.0.0",
    ua: "Mozilla/5.0 (Linux; Android 11; Surface Duo) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  },
  // ---- Tablets ----
  {
    id: "ipad-mini",
    label: "iPad Mini",
    group: "tablet",
    os: "ios",
    width: 768,
    height: 1024,
    deviceScaleFactor: 2,
    mobile: true,
    maxTouchPoints: 5,
    model: "",
    platformVersion: "",
    ua: "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  },
  {
    id: "ipad-air",
    label: "iPad Air",
    group: "tablet",
    os: "ios",
    width: 820,
    height: 1180,
    deviceScaleFactor: 2,
    mobile: true,
    maxTouchPoints: 5,
    model: "",
    platformVersion: "",
    ua: "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  },
  {
    id: "ipad-pro-11",
    label: 'iPad Pro 11"',
    group: "tablet",
    os: "ios",
    width: 834,
    height: 1194,
    deviceScaleFactor: 2,
    mobile: true,
    maxTouchPoints: 5,
    model: "",
    platformVersion: "",
    ua: "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  },
  {
    id: "ipad-pro-12",
    label: 'iPad Pro 12.9"',
    group: "tablet",
    os: "ios",
    width: 1024,
    height: 1366,
    deviceScaleFactor: 2,
    mobile: true,
    maxTouchPoints: 5,
    model: "",
    platformVersion: "",
    ua: "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  },
  {
    id: "galaxy-tab-s9",
    label: "Galaxy Tab S9",
    group: "tablet",
    os: "android",
    width: 800,
    height: 1280,
    deviceScaleFactor: 2,
    mobile: true,
    maxTouchPoints: 5,
    model: "SM-X710",
    platformVersion: "14.0.0",
    // Android TABLET Chrome UA has no "Mobile" token.
    ua: "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  },
];

// Low-entropy brand fallback used in Sec-CH-UA. The "Not*A-Brand" entry rotates between Chrome
// versions; this is a representative current value and does not need to be exact.
const NOT_A_BRAND = { brand: "Not_A Brand", version: "24" };

// Parse the major Chrome version from a UA string (the running browser's navigator.userAgent).
// Returns a number, or null when no Chrome token is present.
export function getLiveChromeMajor(ua) {
  const m = /Chrome\/(\d+)/.exec(String(ua || ""));
  return m ? parseInt(m[1], 10) : null;
}

// Rewrite the "Chrome/NNN.0.0.0" token in an Android UA to the running Chrome's major version, so
// an emulated Android device never reports a stale Chrome. iOS Safari UAs have no Chrome token and
// come back unchanged. A falsy/invalid chromeMajor leaves the UA as-is.
export function patchChromeVersion(ua, chromeMajor) {
  const s = String(ua || "");
  const major = parseInt(chromeMajor, 10);
  if (!major || Number.isNaN(major)) return s;
  return s.replace(/Chrome\/\d+(?:\.\d+)*/g, `Chrome/${major}.0.0.0`);
}

// Look a device up by id (returns undefined when not found / for "custom"/"off").
export function getDevice(id) {
  return DEVICES.find((d) => d.id === id);
}

// Portrait → landscape swaps width/height. Pure; used for both the metrics and the stored state.
export function orientDimensions(width, height, landscape) {
  return landscape ? { width: height, height: width } : { width, height };
}

// Build the Emulation.setDeviceMetricsOverride parameter object for a device (+ orientation).
// Accepts either a preset object or a plain {width,height,deviceScaleFactor,mobile} (custom size).
export function buildMetricsOverride(device, landscape) {
  const { width, height } = orientDimensions(device.width, device.height, !!landscape);
  return {
    width,
    height,
    deviceScaleFactor: device.deviceScaleFactor || 1,
    mobile: device.mobile !== false,
    screenOrientation: landscape
      ? { type: "landscapePrimary", angle: 90 }
      : { type: "portraitPrimary", angle: 0 },
  };
}

// Build the userAgentMetadata (Client Hints) object. Android devices get full Chromium brands keyed
// to the running Chrome's major version plus platform/model, matching what real Android Chrome
// sends. iOS devices get EMPTY brands and no platform data — real iOS Safari sends no Client Hints,
// so forging Chromium hints on an iOS UA would be incoherent; empty metadata is the closest match.
export function buildUserAgentMetadata(device, chromeMajor) {
  const major = parseInt(chromeMajor, 10) || 0;
  if (device.os === "ios") {
    return {
      brands: [],
      fullVersionList: [],
      platform: "",
      platformVersion: "",
      architecture: "",
      model: "",
      mobile: device.mobile !== false,
      bitness: "",
      wow64: false,
    };
  }
  const brands = major
    ? [
        NOT_A_BRAND,
        { brand: "Chromium", version: String(major) },
        { brand: "Google Chrome", version: String(major) },
      ]
    : [];
  const fullVersionList = major
    ? [
        NOT_A_BRAND,
        { brand: "Chromium", version: `${major}.0.0.0` },
        { brand: "Google Chrome", version: `${major}.0.0.0` },
      ]
    : [];
  return {
    brands,
    fullVersionList,
    platform: "Android",
    platformVersion: device.platformVersion || "14.0.0",
    architecture: "",
    model: device.model || "",
    mobile: device.mobile !== false,
    bitness: "",
    wow64: false,
  };
}

// Build the full Emulation.setUserAgentOverride parameter object (UA + patched Chrome version +
// client-hint metadata). chromeMajor is the running browser's Chrome major version.
export function buildUserAgentOverride(device, chromeMajor) {
  return {
    userAgent: patchChromeVersion(device.ua, chromeMajor),
    userAgentMetadata: buildUserAgentMetadata(device, chromeMajor),
  };
}

// Build the Emulation.setTouchEmulationEnabled parameter object.
export function buildTouchOverride(device) {
  return { enabled: true, maxTouchPoints: device.maxTouchPoints || 1 };
}
