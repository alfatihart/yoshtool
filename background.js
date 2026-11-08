// background.js
// Service worker: seeds the default allowlist on install and orchestrates screenshots
// (capture area/screen/full page), since the popup closes as soon as the user interacts
// with the page or while a capture is running.

import {
  seedDefaultIfEmpty,
  domainsFromOrigins,
  addDomainsToStore,
  addSensorDomainsToStore,
  removeDomainsFromStore,
  removeSensorDomainsFromStore,
  readPendingGrant,
  clearPendingGrant,
  getSensorMatchPatterns,
  isSensorEnabled,
  SENSOR_KEY,
  SENSOR_ENABLED_KEY,
  seedPopblockDefaults,
  isGlobalGranted,
  isPbEnabled,
  setPbEnabled,
  addPbWhitelistHost,
  addPbDisabledHost,
  rememberPbHostAction,
  clearPbHostActions,
  PB_ENABLED_KEY,
  isSelHelperEnabled,
  setSelHelperEnabled,
  SELHELPER_ENABLED_KEY,
  isCosmeticEnabled,
  setCosmeticEnabled,
  isConsentEnabled,
  setConsentEnabled,
  isScriptletsEnabled,
  hasUserCosmetics,
  getUserCosmetics,
} from "./allowlist.js";
import { ADBLOCK_SCRIPTLETS_KEY } from "./adblock-scriptlets-core.js";
import { USER_COSMETICS_KEY } from "./picker-core.js";
import { selectorsForHost } from "./adblock-cosmetic-core.js";
import { isProcedural } from "./adblock-procedural-core.js";
import { showToastInTab } from "./toast.js";
import { buildTranslateUrl, parseTranslateResponse } from "./translate-core.js";
import {
  getDevice,
  getLiveChromeMajor,
  buildMetricsOverride,
  buildUserAgentOverride,
  buildTouchOverride,
} from "./device-presets.js";
import {
  desiredRulesets,
  rulesetDiff,
  buildAllowRules,
  ALLOW_ID_START,
  ALLOW_ID_END,
  ADBLOCK_ADS_KEY,
  ADBLOCK_TRACKERS_KEY,
  ADBLOCK_ALLOWLIST_KEY,
  ADBLOCK_COSMETIC_KEY,
  ADBLOCK_CONSENT_KEY,
  ADBLOCK_PARAMSTRIP_KEY,
  ADBLOCK_EXTENDED_KEY,
  ADBLOCK_EXTENDED_META_KEY,
  EXTENDED_ID_START,
  EXTENDED_ID_END,
  EXTENDED_MAX,
  prepareExtendedRules,
} from "./adblock-core.js";

chrome.runtime.onInstalled.addListener(() => {
  seedDefaultIfEmpty().then(syncSensorContentScripts);
  seedPopblockDefaults().then(syncPopblockScripts);
  syncSelectionHelper();
  syncAdblock();
  syncCosmeticScripts();
  syncConsentScripts();
  syncScriptletScripts();
  syncExtended();
  createContextMenus();
});
chrome.runtime.onStartup.addListener(() => {
  syncSensorContentScripts();
  syncPopblockScripts();
  syncSelectionHelper();
  syncAdblock();
  syncCosmeticScripts();
  syncConsentScripts();
  syncScriptletScripts();
  syncExtended();
});

// Right-click menu: quick access to the Dev tools without opening the popup.
function createContextMenus() {
  try {
    chrome.contextMenus.removeAll(() => {
      // All under one "YoshTool" submenu, in every context so none disappear depending on
      // whether text is selected / a field is focused / etc.
      const C = ["all"];
      chrome.contextMenus.create({ id: "yosh-fill", title: "Fill form with dummy data", contexts: C });
      chrome.contextMenus.create({ id: "yosh-font", title: "Inspect fonts (WhatFont)", contexts: C });
      chrome.contextMenus.create({ id: "yosh-copyunlock", title: "Unlock copy & selection", contexts: C });
      chrome.contextMenus.create({ id: "yosh-darkmode", title: "Toggle dark mode", contexts: C });
      chrome.contextMenus.create({ id: "yosh-translate", title: "Translate selection", contexts: C });
      chrome.contextMenus.create({ id: "yosh-translate-page", title: "Translate full page", contexts: C });
    });
  } catch { /* contextMenus unavailable */ }
}
chrome.contextMenus?.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  // Dark mode reads its engine choice from window.__yoshtoolDarkModePref — set it first from storage.
  if (info.menuItemId === "yosh-darkmode") {
    injectDarkMode(tab.id);
    return;
  }
  const file = info.menuItemId === "yosh-fill" ? "filler.js"
    : info.menuItemId === "yosh-font" ? "fontinspector.js"
    : info.menuItemId === "yosh-copyunlock" ? "copyunlock.js"
    : info.menuItemId === "yosh-translate" ? "translate-overlay.js"
    : info.menuItemId === "yosh-translate-page" ? "fullpage-translate.js" : null;
  if (file) chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [file] }).catch(() => {});
});

// Inject dark mode, seeding the engine choice (dynamic | filter) so darkmode.js picks it up. Used by
// the context menu and the keyboard command; the popup does the same two-step inline.
async function injectDarkMode(tabId) {
  let mode = "dynamic";
  try {
    const r = await chrome.storage.local.get("darkModeMode");
    if (r && r.darkModeMode === "filter") mode = "filter";
  } catch (e) {}
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (m) => { window.__yoshtoolDarkModePref = m; },
      args: [mode],
    });
    await chrome.scripting.executeScript({ target: { tabId }, files: ["darkmode.js"] });
  } catch (e) {}
}

// Allowlist persistence is handled here, NOT in the popup. When Chrome's permission dialog
// appears, the popup loses focus and closes, so any code after chrome.permissions.request in
// the popup never runs. These onAdded/onRemoved events still reach the service worker even
// after the popup closes, so a domain enters/leaves the list with a single dialog approval.
//
// Important (security): from the origin pattern alone we CAN'T tell which list (cookie vs
// redact) is meant. The popup records its intent in `pendingGrant` before triggering the
// dialog; here we route to the matching list. No pendingGrant → do nothing, so a permission
// requested by a redact button can't leak into a cookie permission.
chrome.permissions.onAdded.addListener(async (perms) => {
  syncAdblockRulesets(); // a newly granted host may let the redirect ruleset turn on
  const pending = await readPendingGrant();
  if (!pending) return; // intent unknown → don't guess
  // Popup blocker: GLOBAL permission (*://*/*), not per-domain — enable the master & register the scripts.
  if (pending.type === "popblock") {
    await setPbEnabled(true);
    await syncPopblockScripts();
    await clearPendingGrant();
    return;
  }
  if (pending.type === "selhelper") {
    await setSelHelperEnabled(true);
    await syncSelectionHelper();
    await clearPendingGrant();
    return;
  }
  if (pending.type === "cosmetic") {
    await setCosmeticEnabled(true);
    await syncCosmeticScripts();
    await clearPendingGrant();
    return;
  }
  // Element blocker: no master flag — just (re)register the cosmetic script so saved picker rules
  // re-apply now that the all-sites permission exists.
  if (pending.type === "elemblock") {
    await syncCosmeticScripts();
    await clearPendingGrant();
    return;
  }
  if (pending.type === "consent") {
    await setConsentEnabled(true);
    await syncConsentScripts();
    await clearPendingGrant();
    return;
  }
  const domains = domainsFromOrigins(perms.origins);
  if (domains.length === 0) {
    await clearPendingGrant();
    return;
  }
  const target = domains.includes(pending.domain) ? [pending.domain] : domains;
  if (pending.type === "sensor") {
    await addSensorDomainsToStore(target);
    await syncSensorContentScripts();
  } else {
    await addDomainsToStore(target);
  }
  await clearPendingGrant();
});
chrome.permissions.onRemoved.addListener(async (perms) => {
  const domains = domainsFromOrigins(perms.origins);
  if (domains.length === 0) return;
  // Host permission gone → nothing can run on this domain anymore; prune BOTH lists.
  await removeDomainsFromStore(domains);
  await removeSensorDomainsFromStore(domains);
  await syncSensorContentScripts();
  // If the global permission is revoked, the popup blocker / selection helper can't run → sync.
  await syncPopblockScripts();
  await syncSelectionHelper();
  await syncCosmeticScripts();
  await syncConsentScripts();
  await syncScriptletScripts();
  await syncAdblockRulesets();
});

// Redact list / master toggle / popup-blocker master changed → sync the scripts.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[SENSOR_KEY] || changes[SENSOR_ENABLED_KEY]) {
    syncSensorContentScripts();
  }
  if (changes[PB_ENABLED_KEY]) {
    syncPopblockScripts();
  }
  if (changes[SELHELPER_ENABLED_KEY]) {
    syncSelectionHelper();
  }
  if (changes[ADBLOCK_ADS_KEY] || changes[ADBLOCK_TRACKERS_KEY]) {
    syncAdblockRulesets();
    chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => {
      if (t?.id) updateBlockedBadge(t.id);
    });
  }
  if (changes[ADBLOCK_PARAMSTRIP_KEY]) {
    syncAdblockRulesets();
  }
  if (changes[ADBLOCK_ALLOWLIST_KEY]) {
    syncAdblockAllowlist();
  }
  if (changes[ADBLOCK_COSMETIC_KEY] || changes[USER_COSMETICS_KEY]) {
    syncCosmeticScripts();
  }
  if (changes[ADBLOCK_CONSENT_KEY]) {
    syncConsentScripts();
  }
  if (changes[ADBLOCK_SCRIPTLETS_KEY]) {
    syncScriptletScripts();
  }
  if (changes[ADBLOCK_EXTENDED_KEY]) {
    syncExtended();
  }
});

// ---------- Ad / tracker blocker (declarativeNetRequest) ----------
// Network blocking via static DNR rulesets — needs NO host permission. The rulesets are declared
// `enabled:false` in the manifest and toggled here from the user's prefs. Per-site allowlisting
// uses dynamic allowAllRequests rules in a reserved id range.
async function syncAdblockRulesets() {
  if (!chrome.declarativeNetRequest?.updateEnabledRulesets) return;
  try {
    const [st, granted] = await Promise.all([
      chrome.storage.local.get([ADBLOCK_ADS_KEY, ADBLOCK_TRACKERS_KEY, ADBLOCK_PARAMSTRIP_KEY]),
      isGlobalGranted(),
    ]);
    const desired = desiredRulesets({
      ads: !!st[ADBLOCK_ADS_KEY],
      trackers: !!st[ADBLOCK_TRACKERS_KEY],
      redirectGranted: granted,
      paramStrip: !!st[ADBLOCK_PARAMSTRIP_KEY],
    });
    const current = await chrome.declarativeNetRequest.getEnabledRulesets();
    const { enable, disable } = rulesetDiff(desired, current);
    if (enable.length || disable.length) {
      await chrome.declarativeNetRequest.updateEnabledRulesets({
        enableRulesetIds: enable,
        disableRulesetIds: disable,
      });
    }
  } catch (e) {
    console.error("[adblock] updateEnabledRulesets failed:", e);
  }
}
async function syncAdblockAllowlist() {
  if (!chrome.declarativeNetRequest?.updateDynamicRules) return;
  try {
    const st = await chrome.storage.local.get(ADBLOCK_ALLOWLIST_KEY);
    const hosts = Array.isArray(st[ADBLOCK_ALLOWLIST_KEY]) ? st[ADBLOCK_ALLOWLIST_KEY] : [];
    const addRules = buildAllowRules(hosts, ALLOW_ID_START);
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const removeRuleIds = existing
      .filter((r) => r.id >= ALLOW_ID_START && r.id < ALLOW_ID_END)
      .map((r) => r.id);
    if (addRules.length || removeRuleIds.length) {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
    }
  } catch (e) {
    console.error("[adblock] updateDynamicRules failed:", e);
  }
}
function syncAdblock() {
  syncAdblockRulesets();
  syncAdblockAllowlist();
}

// ---------- Extended blocklist (optional, downloadable, applied as DYNAMIC rules) ----------
// MV3 can't add/download static rulesets at runtime, and dynamic rules are capped at ~30k, so this
// is a curated supplement (not "every list"), fetched fresh from the repo with a bundled fallback.
const EXTENDED_URL =
  "https://raw.githubusercontent.com/alfatihart/yoshtool/refs/heads/main/rule_resources/extended-blocklist.json";
const EXTENDED_LOCAL = "rule_resources/extended-blocklist.json";

// Try the remote copy (fresh) first, fall back to the bundled copy (offline / pre-release).
async function loadExtendedRules() {
  for (const [url, source] of [
    [EXTENDED_URL, "remote"],
    [chrome.runtime.getURL(EXTENDED_LOCAL), "bundled"],
  ]) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      const data = await res.json();
      if (Array.isArray(data) && data.length) return { rules: data, source };
    } catch {
      /* try next */
    }
  }
  return { rules: [], source: null };
}
async function extendedRuleIds() {
  if (!chrome.declarativeNetRequest?.getDynamicRules) return [];
  const rules = await chrome.declarativeNetRequest.getDynamicRules();
  return rules.filter((r) => r.id >= EXTENDED_ID_START && r.id < EXTENDED_ID_END).map((r) => r.id);
}
// Download + (re)apply the extended pack. Returns meta, also stored for the popup to show.
async function updateExtended() {
  if (!chrome.declarativeNetRequest?.updateDynamicRules) return { ok: false, error: "unsupported" };
  const { rules, source } = await loadExtendedRules();
  let meta;
  if (!rules.length) {
    meta = { ok: false, error: "fetch-failed", at: Date.now() };
  } else {
    try {
      const addRules = prepareExtendedRules(rules, EXTENDED_ID_START, EXTENDED_MAX);
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: await extendedRuleIds(),
        addRules,
      });
      meta = { ok: true, count: addRules.length, source, at: Date.now() };
    } catch (e) {
      meta = { ok: false, error: String(e?.message || e), at: Date.now() };
    }
  }
  await chrome.storage.local.set({ [ADBLOCK_EXTENDED_META_KEY]: meta });
  return meta;
}
// Apply/remove to match the toggle. Re-downloads only when enabling with nothing applied yet
// (dynamic rules persist across restarts, so we don't re-apply 25k rules every startup).
async function syncExtended() {
  if (!chrome.declarativeNetRequest?.updateDynamicRules) return;
  try {
    const st = await chrome.storage.local.get(ADBLOCK_EXTENDED_KEY);
    const on = st[ADBLOCK_EXTENDED_KEY] === true;
    const present = (await extendedRuleIds()).length;
    if (on && !present) {
      await updateExtended();
    } else if (!on && present) {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: await extendedRuleIds() });
    }
  } catch (e) {
    console.error("[adblock] syncExtended failed:", e);
  }
}
// "Update now" from the popup.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.cmd === "adblock-update-extended") {
    updateExtended().then(sendResponse);
    return true; // async response
  }
});

// Serve the bundled cosmetic selectors for a host to the content script. The content script CANNOT
// fetch rule_resources/cosmetics.json itself on sites with a strict connect-src CSP (e.g. YouTube) —
// Chrome blocks the extension-resource fetch from the page's frame ("Unsafe attempt to load URL …").
// The service worker's fetch of its own resource is NOT subject to any page CSP, so we fetch+cache
// here and hand back only this host's selectors.
let cosmeticsCache = null;
async function getCosmeticsData() {
  if (!cosmeticsCache) {
    const res = await fetch(chrome.runtime.getURL("rule_resources/cosmetics.json"));
    cosmeticsCache = await res.json();
  }
  return cosmeticsCache;
}
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.cmd === "adblock-cosmetics") {
    getCosmeticsData()
      .then((data) => sendResponse(selectorsForHost(data, message.host || "")))
      .catch(() => sendResponse([]));
    return true; // async response
  }
});

// Registers adblock-cosmetic.js on all sites (document_start) only when the cosmetic toggle is on
// AND the global host permission is granted. Mirrors syncSelectionHelper. Element-hiding needs a
// content script, hence the all-sites permission (unlike network blocking, which needs none).
const COSMETIC_SCRIPT_ID = "yoshtool-adblock-cosmetic";
async function syncCosmeticScripts() {
  try {
    // On when the bundled cosmetic filter is enabled OR the user has saved element-block rules
    // (the picker) — either way the content script must run to hide elements. Needs all-sites perm.
    const on = ((await isCosmeticEnabled()) || (await hasUserCosmetics())) && (await isGlobalGranted());
    const existing = await chrome.scripting
      .getRegisteredContentScripts({ ids: [COSMETIC_SCRIPT_ID] })
      .catch(() => []);
    const isReg = existing.some((s) => s.id === COSMETIC_SCRIPT_ID);
    if (!on) {
      if (isReg) await chrome.scripting.unregisterContentScripts({ ids: [COSMETIC_SCRIPT_ID] });
      return;
    }
    const def = {
      id: COSMETIC_SCRIPT_ID,
      js: ["adblock-cosmetic.js"],
      matches: ["*://*/*"],
      runAt: "document_start",
      persistAcrossSessions: true,
      allFrames: false,
    };
    if (isReg) await chrome.scripting.updateContentScripts([def]);
    else await chrome.scripting.registerContentScripts([def]);
  } catch (err) {
    console.error("syncCosmeticScripts failed:", err);
  }
}

// Robust persistence for the element PICKER's saved rules, independent of the cosmetic content
// script: on every full page load, apply the host's saved PLAIN selectors as USER-origin CSS from the
// service worker. USER-origin !important beats the page's own author styles (even layered !important),
// and this path doesn't depend on a content-script fetch/registration succeeding — which is why Block
// now reliably survives a reload. Procedural user rules (:has-text/:upward/…) still run via
// adblock-cosmetic.js (they need JS).
function userPlainCss(uc, host) {
  const sels = selectorsForHost({ generic: uc["*"] || [], specific: uc }, host).filter((s) => !isProcedural(s));
  return sels.length ? sels.join(",\n") + "{display:none!important}" : "";
}
async function applyUserCssToTab(tabId, url) {
  try {
    if (!/^https?:/i.test(url || "")) return;
    if (!(await isGlobalGranted())) return;
    const uc = await getUserCosmetics();
    const css = userPlainCss(uc, new URL(url).hostname);
    if (!css) return;
    await chrome.scripting.insertCSS({ target: { tabId }, origin: "USER", css });
  } catch (e) { /* restricted page / tab gone */ }
}
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Fire on both so it's early (loading) AND guaranteed (complete); only full navigations set status,
  // so SPA soft-navigations don't re-inject. Identical USER sheets are harmless.
  if ((changeInfo.status === "loading" || changeInfo.status === "complete") && tab && tab.url) {
    applyUserCssToTab(tabId, tab.url);
  }
});

// Registers adblock-consent.js (document_idle, top frame) when the consent toggle is on AND the
// global permission is granted. Auto-clicks "reject all" on common cookie banners.
const CONSENT_SCRIPT_ID = "yoshtool-adblock-consent";
async function syncConsentScripts() {
  try {
    const on = (await isConsentEnabled()) && (await isGlobalGranted());
    const existing = await chrome.scripting
      .getRegisteredContentScripts({ ids: [CONSENT_SCRIPT_ID] })
      .catch(() => []);
    const isReg = existing.some((s) => s.id === CONSENT_SCRIPT_ID);
    if (!on) {
      if (isReg) await chrome.scripting.unregisterContentScripts({ ids: [CONSENT_SCRIPT_ID] });
      return;
    }
    const def = {
      id: CONSENT_SCRIPT_ID,
      js: ["adblock-consent.js"],
      matches: ["*://*/*"],
      runAt: "document_idle",
      persistAcrossSessions: true,
      allFrames: false,
    };
    if (isReg) await chrome.scripting.updateContentScripts([def]);
    else await chrome.scripting.registerContentScripts([def]);
  } catch (err) {
    console.error("syncConsentScripts failed:", err);
  }
}

// Registers adblock-scriptlets.js in the MAIN world (document_start, top frame) when the
// anti-adblock scriptlets toggle is on AND the global permission is granted. MAIN world so the
// scriptlets can define/lock page globals before the page's own anti-adblock scripts read them.
const SCRIPTLET_SCRIPT_ID = "yoshtool-adblock-scriptlets";
async function syncScriptletScripts() {
  try {
    const on = (await isScriptletsEnabled()) && (await isGlobalGranted());
    const existing = await chrome.scripting
      .getRegisteredContentScripts({ ids: [SCRIPTLET_SCRIPT_ID] })
      .catch(() => []);
    const isReg = existing.some((s) => s.id === SCRIPTLET_SCRIPT_ID);
    if (!on) {
      if (isReg) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPTLET_SCRIPT_ID] });
      return;
    }
    const def = {
      id: SCRIPTLET_SCRIPT_ID,
      js: ["adblock-scriptlets.js"],
      matches: ["*://*/*"],
      runAt: "document_start",
      world: "MAIN",
      persistAcrossSessions: true,
      allFrames: false,
    };
    if (isReg) await chrome.scripting.updateContentScripts([def]);
    else await chrome.scripting.registerContentScripts([def]);
  } catch (err) {
    console.error("syncScriptletScripts failed:", err);
  }
}

// ---------- Blocked-count badge (best-effort) ----------
// MV3 gives no per-request callback in packed builds, and getMatchedRules is rate-limited
// (~20 calls / 10 min), so the badge updates only for the ACTIVE tab and degrades silently.
const tabBadgeSince = new Map();
async function updateBlockedBadge(tabId) {
  if (!tabId || !chrome.declarativeNetRequest?.getMatchedRules) return;
  try {
    const st = await chrome.storage.local.get([ADBLOCK_ADS_KEY, ADBLOCK_TRACKERS_KEY]);
    if (!st[ADBLOCK_ADS_KEY] && !st[ADBLOCK_TRACKERS_KEY]) {
      await chrome.action.setBadgeText({ tabId, text: "" });
      return;
    }
    const minTimeStamp = tabBadgeSince.get(tabId);
    const res = await chrome.declarativeNetRequest.getMatchedRules(
      minTimeStamp ? { tabId, minTimeStamp } : { tabId },
    );
    const n = res?.rulesMatchedInfo?.length || 0;
    await chrome.action.setBadgeBackgroundColor({ color: "#64748b" });
    await chrome.action.setBadgeText({ tabId, text: n ? String(n) : "" });
  } catch {
    /* rate-limited / no feedback permission / tab gone */
  }
}
chrome.tabs?.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === "loading") {
    tabBadgeSince.set(tabId, Date.now());
    chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
  } else if (info.status === "complete" && tab?.active) {
    updateBlockedBadge(tabId);
  }
});
chrome.tabs?.onActivated.addListener(({ tabId }) => updateBlockedBadge(tabId));
chrome.tabs?.onRemoved.addListener((tabId) => tabBadgeSince.delete(tabId));

// Registers selection-helper.js on all sites (document_idle) only when the toggle is on AND the
// global host permission is granted. Mirrors syncPopblockScripts.
const SELHELPER_ID = "yoshtool-selhelper";
async function syncSelectionHelper() {
  try {
    const on = (await isSelHelperEnabled()) && (await isGlobalGranted());
    const existing = await chrome.scripting
      .getRegisteredContentScripts({ ids: [SELHELPER_ID] })
      .catch(() => []);
    const isReg = existing.some((s) => s.id === SELHELPER_ID);
    if (!on) {
      if (isReg) await chrome.scripting.unregisterContentScripts({ ids: [SELHELPER_ID] });
      return;
    }
    const def = {
      id: SELHELPER_ID,
      js: ["selection-helper.js"],
      matches: ["*://*/*"],
      runAt: "document_idle",
      persistAcrossSessions: true,
      allFrames: false,
    };
    if (isReg) await chrome.scripting.updateContentScripts([def]);
    else await chrome.scripting.registerContentScripts([def]);
  } catch (err) {
    console.error("syncSelectionHelper failed:", err);
  }
}

// Dynamically registers sensor.js ONLY for redact origins whose permission is granted, and
// only when the auto-redact master is on. Called on install/startup, on permission
// grant/revoke, and when the list/master changes. persistAcrossSessions:true keeps it
// registered after the browser restarts.
const SENSOR_SCRIPT_ID = "yoshtool-sensor";
async function syncSensorContentScripts() {
  try {
    const enabled = await isSensorEnabled();
    const matches = enabled ? await getSensorMatchPatterns() : [];
    const existing = await chrome.scripting
      .getRegisteredContentScripts({ ids: [SENSOR_SCRIPT_ID] })
      .catch(() => []);
    const isRegistered = existing.some((s) => s.id === SENSOR_SCRIPT_ID);

    if (matches.length === 0) {
      if (isRegistered) {
        await chrome.scripting.unregisterContentScripts({ ids: [SENSOR_SCRIPT_ID] });
      }
      return;
    }
    const def = {
      id: SENSOR_SCRIPT_ID,
      js: ["sensor.js"],
      matches,
      runAt: "document_idle",
      persistAcrossSessions: true,
      allFrames: false,
    };
    if (isRegistered) {
      await chrome.scripting.updateContentScripts([def]);
    } else {
      await chrome.scripting.registerContentScripts([def]);
    }
  } catch (err) {
    console.error("syncSensorContentScripts failed:", err);
  }
}

// --- Popup blocker ----------------------------------------------------------
// Registers two scripts at document_start + allFrames for ALL sites (*://*/*), ONLY when the
// pbEnabled master is on AND the global host permission is granted. MAIN replaces
// window.open; ISOLATED makes the decision and shows the bar.
const PB_MAIN_ID = "yoshtool-pb-main";
const PB_ISO_ID = "yoshtool-pb-isolated";
async function syncPopblockScripts() {
  try {
    const on = (await isPbEnabled()) && (await isGlobalGranted());
    const ids = [PB_MAIN_ID, PB_ISO_ID];
    const existing = await chrome.scripting
      .getRegisteredContentScripts({ ids })
      .catch(() => []);
    const registered = new Set(existing.map((s) => s.id));

    if (!on) {
      const toRemove = ids.filter((id) => registered.has(id));
      if (toRemove.length) {
        await chrome.scripting.unregisterContentScripts({ ids: toRemove });
      }
      return;
    }

    const common = {
      matches: ["*://*/*"],
      allFrames: true,
      matchOriginAsFallback: true,
      runAt: "document_start",
      persistAcrossSessions: true,
    };
    const defs = [
      { id: PB_ISO_ID, js: ["popblock-isolated.js"], world: "ISOLATED", ...common },
      { id: PB_MAIN_ID, js: ["popblock-main.js"], world: "MAIN", ...common },
    ];
    const toRegister = defs.filter((d) => !registered.has(d.id));
    const toUpdate = defs.filter((d) => registered.has(d.id));
    if (toRegister.length) await chrome.scripting.registerContentScripts(toRegister);
    if (toUpdate.length) await chrome.scripting.updateContentScripts(toUpdate);
  } catch (err) {
    console.error("syncPopblockScripts failed:", err);
  }
}

const isOpenableUrl = (url) =>
  typeof url === "string" && (/^https?:/i.test(url) || /^ftp:/i.test(url));

// Replays an allowed window.open INSIDE the MAIN world of its originating frame. During
// replay, ISOLATED has already set port.dataset.enabled="false" so our window.open proxy
// passes it through unchanged (no longer blocked). With no records (a blocked non-window.open),
// open it via an anchor target=_blank click.
async function runPopblockRecords(message, sender) {
  const tabId = sender.tab?.id;
  if (tabId == null) return;
  const recs = message.records;
  const hasRecs = Array.isArray(recs) && recs.length > 0;
  const url = message.url;

  // Common case: a simple window.open to a URL (download / plain popup) with NO follow-up
  // records on the window object. Open it via the privileged chrome.tabs.create, which does
  // NOT depend on user activation — unlike replaying window.open in the MAIN world, which
  // loses activation (so downloads can fail silently, especially on newer Chrome). This is
  // what makes "Allow" actually download.
  if (!hasRecs && isOpenableUrl(url)) {
    await chrome.tabs.create({ url, openerTabId: tabId, active: true }).catch(() => {});
    return;
  }

  // Records present (the page touched the opened window object) → replay in the MAIN world.
  const frameId = sender.frameId || 0;
  await chrome.scripting
    .executeScript({
      target: { tabId, frameIds: [frameId] },
      world: "MAIN",
      args: [hasRecs ? recs : null, url || "", message.args || []],
      func: (records, href, args) => {
        if (records) {
          const w = window.open(...args);
          if (w) {
            for (const record of records) {
              let c = w;
              for (const name of record.tree || []) c = c && c[name];
              if (!c) continue;
              if (record.action.method) c[record.action.method](...record.action.args);
              if (record.action.prop) c[record.action.prop] = record.action.value;
            }
          }
        } else if (href) {
          const a = document.createElement("a");
          a.target = "_blank";
          a.href = href;
          a.click();
        }
      },
    })
    .catch((e) => console.warn("pb-run-records failed:", e));
}

// Count blocked popups as a numeric badge (auto-resets on each tab navigation).
const pbBlockCount = new Map();
function bumpPopblockBadge(tabId) {
  if (tabId == null) return;
  const n = (pbBlockCount.get(tabId) || 0) + 1;
  pbBlockCount.set(tabId, n);
  try {
    chrome.action.setBadgeBackgroundColor({ color: "#b16464", tabId });
    chrome.action.setBadgeText({ text: String(n), tabId });
  } catch (e) {}
}
chrome.tabs?.onUpdated.addListener((tabId, info) => {
  if (info.status === "loading" && info.url) {
    pbBlockCount.delete(tabId);
    try {
      chrome.action.setBadgeText({ text: "", tabId });
    } catch (e) {}
  }
});
chrome.tabs?.onRemoved.addListener((tabId) => pbBlockCount.delete(tabId));

function handlePopblockMessage(message, sender, sendResponse) {
  const tab = sender.tab;
  switch (message.cmd) {
    case "pb-blocked":
      bumpPopblockBadge(tab?.id);
      return false;
    case "pb-open-tab":
      if (tab && isOpenableUrl(message.url)) {
        // `active` is set by an auto-allow (countdown) so the popup opens in front;
        // the manual "Background" button leaves it false.
        chrome.tabs.create({ url: message.url, active: !!message.active, index: tab.index + 1 });
      }
      return false;
    case "pb-redirect":
      if (tab && isOpenableUrl(message.url)) {
        chrome.tabs.update(tab.id, { url: message.url });
      }
      return false;
    case "pb-whitelist":
      addPbWhitelistHost(message.host);
      clearPbHostActions(message.host); // trusting a domain supersedes its remembered action
      return false;
    case "pb-disable":
      addPbDisabledHost(message.host);
      return false;
    case "pb-remember":
      rememberPbHostAction(message.host, message.action);
      return false;
    case "pb-forget":
      clearPbHostActions(message.host); // host omitted → clear all
      return false;
    case "pb-run-records":
      runPopblockRecords(message, sender).finally(() => {
        try {
          sendResponse(true);
        } catch (e) {}
      });
      return true; // async response
    case "pb-subframe-blocked":
      // A popup was blocked inside a sub-frame; the bar must be drawn by the TOP frame so a
      // position:fixed bar anchors to the real viewport, not the sub-frame's box. Relay to frame 0.
      if (tab?.id != null) {
        chrome.tabs
          .sendMessage(
            tab.id,
            { cmd: "pb-show-remote", href: message.href, hostname: message.hostname },
            { frameId: 0 },
          )
          .catch(() => {});
      }
      return false;
    default:
      return false;
  }
}

const MAX_CAPTURE_DIMENSION = 16384; // safe max canvas width/height in Chrome

// Tabs this service-worker instance has the debugger attached to for Device mode (responsive
// simulation). Shared with captureFullPage so a full-page screenshot taken WHILE device mode is on
// reuses that attachment instead of attaching a second time (which would fail) — and does not detach
// it (which would drop device mode). Declared here so captureFullPage can read it; the rest of the
// device-mode machinery lives at the bottom of this file.
const simAttached = new Set();

// The clipboard is written from inside the captured tab, not from an offscreen document.
// An offscreen document never has focus, so navigator.clipboard.write there is always
// rejected ("Document is not focused"), and the execCommand fallback only copies the HTML
// <img>, not the bitmap. The captured tab is the active tab, which regains focus after the
// popup closes, and Chrome allows clipboard writes from the active tab.
async function writeImageToClipboard(tabId, dataUrl) {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [dataUrl],
    func: async (url) => {
      try {
        // Decode base64 manually instead of fetch(dataUrl), to avoid the page's CSP.
        const binary = atob(url.slice(url.indexOf(",") + 1));
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: "image/png" });

        // clipboard.write requires a focused document. After a full-page capture, the
        // debugger infobar briefly steals focus, so request focus then poll
        // document.hasFocus() for up to ~3 seconds before writing.
        window.focus();
        const deadline = Date.now() + 3000;
        while (!document.hasFocus() && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: `${err.name}: ${err.message}` };
      }
    },
  });
  const result = injection?.result;
  if (!result?.ok) throw new Error(result?.error || "Failed to write to clipboard");
}

async function downloadImage(dataUrl, filename) {
  await chrome.downloads.download({ url: dataUrl, filename, saveAs: true });
}

async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function cropDataUrl(dataUrl, rect, devicePixelRatio) {
  const sourceBlob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(sourceBlob);
  const sx = Math.round(rect.x * devicePixelRatio);
  const sy = Math.round(rect.y * devicePixelRatio);
  const sw = Math.round(rect.width * devicePixelRatio);
  const sh = Math.round(rect.height * devicePixelRatio);
  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  const croppedBlob = await canvas.convertToBlob({ type: "image/png" });
  return blobToDataUrl(croppedBlob);
}

async function captureVisible(windowId) {
  return chrome.tabs.captureVisibleTab(windowId, { format: "png" });
}

// Many modern sites trigger scroll-reveal animations or lazy-loaded images via an
// IntersectionObserver that only fires when an element actually crosses the viewport from a
// real scroll. If the viewport is enlarged straight to the page's full height without ever
// scrolling, below-the-fold elements were never "seen", so their animations haven't settled
// (they can look blank, or on sites with scroll-pin/sticky sections appear repeated).
// Scrolling down gradually first triggers those animations/lazy-loads naturally before the
// capture.
async function autoScrollThroughPage(tabId) {
  const expression = `
    (function () {
      return new Promise((resolve) => {
        const scroller = document.scrollingElement || document.documentElement;
        const step = Math.max(window.innerHeight * 0.8, 200);
        function tick() {
          const before = scroller.scrollTop;
          window.scrollBy(0, step);
          const reachedBottom = scroller.scrollTop >= scroller.scrollHeight - window.innerHeight - 1;
          if (reachedBottom || scroller.scrollTop === before) {
            setTimeout(() => {
              window.scrollTo(0, 0);
              setTimeout(resolve, 150);
            }, 250);
          } else {
            setTimeout(tick, 120);
          }
        }
        tick();
      });
    })()
  `;
  await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
    expression,
    awaitPromise: true,
  });
}

// Some pages put their scrollable content inside an `overflow:auto`/`scroll` element (common in
// SPA/flex layouts) instead of the window. Then window.scrollBy can't scroll it AND the document's
// scrollHeight/cssContentSize is only the viewport — so a full-page capture gets just one screen.
// Temporarily flatten those containers into normal document flow so the whole page is captured.
const EXPAND_SCROLLERS = `(function () {
  window.__yoshtoolCapRestore = [];
  for (const el of document.querySelectorAll("*")) {
    const s = getComputedStyle(el);
    if ((s.overflowY === "auto" || s.overflowY === "scroll") &&
        el.scrollHeight > el.clientHeight + 50 && el.clientHeight > 150) {
      window.__yoshtoolCapRestore.push([el, el.getAttribute("style") || ""]);
      el.style.height = "auto";
      el.style.maxHeight = "none";
      el.style.overflow = "visible";
    }
  }
  return window.__yoshtoolCapRestore.length;
})()`;
const RESTORE_SCROLLERS = `(function () {
  (window.__yoshtoolCapRestore || []).forEach(function (p) { p[0].setAttribute("style", p[1]); });
  window.__yoshtoolCapRestore = [];
})()`;

async function captureFullPage(tabId) {
  // If Device mode already holds the debugger on this tab, reuse that session (and leave it
  // attached afterwards) so the shot captures the emulated mobile viewport without dropping device
  // mode. Otherwise attach/detach as usual.
  const ownsAttach = !simAttached.has(tabId);
  if (ownsAttach) await chrome.debugger.attach({ tabId }, "1.3");
  let expanded = false;
  try {
    // Flatten inner scroll containers first, so their content becomes part of the tall document.
    await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", { expression: EXPAND_SCROLLERS });
    expanded = true;
    await autoScrollThroughPage(tabId);
    // Measure layout AFTER scroll/lazy-load completes — newly loaded images can change the height.
    const metrics = await chrome.debugger.sendCommand({ tabId }, "Page.getLayoutMetrics");
    // cssContentSize is CSS px; contentSize is the fallback on older Chrome.
    const size = metrics.cssContentSize || metrics.contentSize;
    // Use the LARGER of cssContentSize and the live scrollHeight — some layouts under-report one.
    const sh = await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
      expression:
        "Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)",
      returnByValue: true,
    });
    const width = Math.ceil(size.width);
    const height = Math.min(
      Math.max(Math.ceil(size.height), sh.result?.value || 0),
      MAX_CAPTURE_DIMENSION,
    );

    // Settle so lazy-load / expanded content paints.
    await new Promise((resolve) => setTimeout(resolve, 350));

    // Capture beyond the viewport WITHOUT resizing it. Resizing (setDeviceMetricsOverride) breaks
    // pages that size sections in vh units — each 100vh block balloons to the full page height and
    // pushes the rest off the captured area. captureBeyondViewport is the Puppeteer/Playwright
    // approach; verified against real inner-scroll (obfusgated) and vh-based (superadblocktest) pages.
    const result = await chrome.debugger.sendCommand({ tabId }, "Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height, scale: 1 },
    });
    return "data:image/png;base64," + result.data;
  } finally {
    if (expanded) {
      await chrome.debugger
        .sendCommand({ tabId }, "Runtime.evaluate", { expression: RESTORE_SCROLLERS })
        .catch(() => {}); // put the inner scroll containers back
    }
    if (ownsAttach) {
      await chrome.debugger.detach({ tabId }).catch(() => {});
      // Pause so the "is debugging" infobar disappears and focus can return to the page —
      // important so the clipboard write that follows isn't rejected.
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
}

// Select a crop area: inject selector.js, return {rect, devicePixelRatio}. The image capture
// is done separately so (for area + redact mode) the redact overlay can run AFTER the area
// is selected.
function selectArea(tab) {
  return new Promise((resolve, reject) => {
    chrome.scripting
      .executeScript({ target: { tabId: tab.id }, files: ["selector.js"] })
      .then(() => {
        const listener = (message, sender) => {
          if (sender.tab?.id !== tab.id) return;
          if (message.type === "area-selected") {
            chrome.runtime.onMessage.removeListener(listener);
            resolve({ rect: message.rect, devicePixelRatio: message.devicePixelRatio });
          } else if (message.type === "area-cancelled") {
            chrome.runtime.onMessage.removeListener(listener);
            reject(new Error("Area selection cancelled"));
          }
        };
        chrome.runtime.onMessage.addListener(listener);
      })
      .catch(reject);
  });
}

// Phase 1 "detect then propose": inject redact-overlay.js, wait for the user to confirm (box
// turns solid) or cancel. A solid box gets captured as a permanent redaction. clipRect
// (optional, viewport coords) limits detection candidates to the crop area. Returns true to
// proceed, false if cancelled.
function runRedactOverlay(tab, clipRect) {
  const prep = clipRect
    ? chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (c) => {
          window.__yoshtoolRedactClip = c;
        },
        args: [clipRect],
      })
    : Promise.resolve();
  return new Promise((resolve, reject) => {
    prep
      .then(() => chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["redact-overlay.js"] }))
      .then(() => {
        const listener = (message, sender) => {
          if (sender.tab?.id !== tab.id) return;
          if (message.type === "redact-ready") {
            chrome.runtime.onMessage.removeListener(listener);
            resolve(true);
          } else if (message.type === "redact-cancelled") {
            chrome.runtime.onMessage.removeListener(listener);
            resolve(false);
          }
        };
        chrome.runtime.onMessage.addListener(listener);
      })
      .catch(reject);
  });
}

async function handleCapture({ mode, output, tab, redact }) {
  let dataUrl;
  let redactShown = false;
  try {
    if (mode === "area") {
      // Area: pick the crop FIRST, then redact (limited to the crop), then capture + crop.
      const area = await selectArea(tab);
      if (redact) {
        redactShown = true;
        const proceed = await runRedactOverlay(tab, area.rect);
        if (!proceed) throw new Error("Redaction cancelled");
      }
      const full = await captureVisible(tab.windowId);
      dataUrl = await cropDataUrl(full, area.rect, area.devicePixelRatio);
    } else {
      // Screen/full: redact first (whole viewport/page), then capture.
      if (redact) {
        redactShown = true;
        const proceed = await runRedactOverlay(tab);
        if (!proceed) throw new Error("Redaction cancelled");
      }
      if (mode === "screen") dataUrl = await captureVisible(tab.windowId);
      else if (mode === "full") dataUrl = await captureFullPage(tab.id);
      else throw new Error(`Unknown capture mode: ${mode}`);
    }
  } finally {
    // Clean up the redact overlay from the page after the capture (success or failure).
    if (redactShown) {
      chrome.tabs.sendMessage(tab.id, { type: "redact-cleanup" }).catch(() => {});
    }
  }

  const filename = `screenshot-${mode}-${Date.now()}.png`;
  if (output === "file") {
    await downloadImage(dataUrl, filename);
    // The toast is shown AFTER the image is taken, so it isn't captured in the shot.
    await showToastInTab(tab.id, "Screenshot saved");
  } else {
    // Refocus the target window+tab before writing the clipboard. For full page, the debugger
    // infobar briefly steals focus; without this clipboard.write is rejected "Document is not
    // focused".
    try {
      await chrome.windows.update(tab.windowId, { focused: true });
      await chrome.tabs.update(tab.id, { active: true });
    } catch {
      // ignore; the clipboard-writer script still waits for focus on its own
    }
    try {
      await writeImageToClipboard(tab.id, dataUrl);
      await showToastInTab(tab.id, "Screenshot copied to clipboard");
    } catch (err) {
      // Don't lose the capture: if the clipboard is rejected, offer to save as a file.
      await downloadImage(dataUrl, filename);
      await showToastInTab(tab.id, "Clipboard rejected — image saved as a file", true);
      throw new Error(`clipboard rejected (${err.message}), image offered for saving as a file`);
    }
  }
}

// The popup is already closed while the capture runs, so there's nowhere to show the
// result/error directly. The status is stored here and read by popup.js when reopened, so
// success/failure stays visible (no need to guess from whether a result landed on the
// clipboard).
async function reportCaptureStatus(status) {
  await chrome.storage.local.set({ captureStatus: { ...status, at: Date.now() } });
}

function runCaptureWithStatus(opts) {
  handleCapture(opts)
    .then(() => reportCaptureStatus({ ok: true, mode: opts.mode, output: opts.output }))
    .catch((err) => {
      console.error("Capture failed:", err);
      reportCaptureStatus({ ok: false, mode: opts.mode, output: opts.output, error: err.message });
    });
}

// In-page color picker: snapshot the viewport then inject eyedropper.js, so the popup can
// close and not block the selection (the ColorZilla approach). eyedropper.js itself copies to
// the clipboard and saves to the color history.
async function runEyedropper(tab) {
  if (!tab?.id) return;
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (d) => {
        window.__yoshtoolEyeImg = d;
      },
      args: [dataUrl],
    });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["eyedropper.js"] });
  } catch (err) {
    console.warn("eyedropper failed:", err);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "capture") {
    runCaptureWithStatus(message);
    return false;
  }
  if (message?.type === "eyedropper") {
    runEyedropper(message.tab);
    return false;
  }
  if (message?.cmd && String(message.cmd).startsWith("pb-")) {
    return handlePopblockMessage(message, sender, sendResponse);
  }
  if (message?.cmd === "translate") {
    handleTranslate(message).then((r) => { try { sendResponse(r); } catch (e) {} });
    return true; // async response
  }
  if (message?.cmd === "translate-batch") {
    handleTranslateBatch(message).then((r) => { try { sendResponse(r); } catch (e) {} });
    return true; // async response
  }
  if (message?.cmd === "fill-form") {
    if (sender.tab?.id) {
      chrome.scripting.executeScript({ target: { tabId: sender.tab.id }, files: ["filler.js"] }).catch(() => {});
    }
    return false;
  }
  return false;
});

// One translation request to the free Google endpoint. Throws on HTTP/parse failure.
async function translateOne(text, to) {
  const resp = await fetch(buildTranslateUrl(text, to), { credentials: "omit" });
  if (!resp.ok) throw new Error(`Endpoint ${resp.status}${resp.status === 429 ? " (rate-limited)" : ""}`);
  const data = await resp.json();
  return parseTranslateResponse(data); // { text, source }
}

// Translate text via the free Google endpoint. The SW can fetch it (host permission +
// CORS-exempt) where a content script can't. Target language comes from storage (default id).
async function handleTranslate(message) {
  const text = String(message.text || "").trim();
  if (!text) return { ok: false, error: "No text" };
  try {
    const r = await chrome.storage.local.get("translateTarget");
    const to = message.to || (r && r.translateTarget) || "id";
    const { text: translated, source } = await translateOne(text, to);
    if (!translated) return { ok: false, error: "Empty translation" };
    return { ok: true, text: translated, source };
  } catch (e) {
    return { ok: false, error: "Request failed (" + (e && e.message ? e.message : "network") + ")" };
  }
}

// Batched translation for full-page mode. The content script sends every block's text at once;
// here we de-duplicate, translate with a small concurrency pool (the free endpoint rate-limits
// under bulk, so we cap in-flight requests and back off on failure), then map results back onto the
// original (possibly repeated) input order. Best-effort: failed items come back as "" and are left
// untranslated on the page.
async function handleTranslateBatch(message) {
  const texts = Array.isArray(message.texts) ? message.texts.map((t) => String(t || "")) : [];
  if (!texts.length) return { ok: true, translations: [] };
  let to = message.to;
  if (!to) {
    const r = await chrome.storage.local.get("translateTarget");
    to = (r && r.translateTarget) || "id";
  }
  const unique = [...new Set(texts.filter((t) => t.trim()))];
  const result = new Map();
  const CONCURRENCY = 5;
  let cursor = 0;
  let failures = 0;
  async function worker() {
    while (cursor < unique.length) {
      const t = unique[cursor++];
      let out = "";
      for (let attempt = 0; attempt < 3; attempt++) {
        try { out = (await translateOne(t, to)).text || ""; break; }
        catch (e) {
          failures++;
          await new Promise((res) => setTimeout(res, 300 * (attempt + 1))); // backoff
        }
      }
      result.set(t, out);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, unique.length) }, worker));
  return { ok: true, translations: texts.map((t) => result.get(t) || ""), failures };
}

// Keyboard shortcuts (manifest "commands"). _execute_action opens the popup automatically;
// here it's only capture modes. The output/redact preference is read from storage, same as
// when triggered from the popup. activeTab is granted automatically when a command fires.
const COMMAND_MODE = {
  "capture-area": "area",
  "capture-screen": "screen",
  "capture-full": "full",
};
chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  // Fill the form with dummy data (inject filler.js; its options are read from storage by filler.js).
  if (command === "fill-dummy") {
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["filler.js"] }).catch(() => {});
    return;
  }
  // Element blocker: pick (persist per-site) or zap (one-shot). Injected like the other overlays.
  if (command === "pick-element") {
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["picker.js"] }).catch(() => {});
    return;
  }
  if (command === "zap-element") {
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["zapper.js"] }).catch(() => {});
    return;
  }
  if (command === "edit-page") {
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["editpage.js"] }).catch(() => {});
    return;
  }
  if (command === "reveal-password") {
    chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["password-reveal.js"] }).catch(() => {});
    return;
  }
  const mode = COMMAND_MODE[command];
  if (!mode) return;
  const { saveFileScreenshot, redactScreenshot } = await chrome.storage.local.get([
    "saveFileScreenshot",
    "redactScreenshot",
  ]);
  runCaptureWithStatus({
    mode,
    output: saveFileScreenshot ? "file" : "clipboard",
    tab,
    redact: !!redactScreenshot,
  });
});

// ============================================================================
// Device mode (responsive / mobile simulation) — drives Chrome's own emulation
// engine over CDP (chrome.debugger) on the REAL tab. See device-presets.js for
// why CDP rather than an <iframe> simulator. State per tab is persisted under
// storage "deviceModes" ({ [tabId]: {deviceId, custom, landscape, label} }) so
// the popup reflects it; `simAttached` (declared near the top) tracks which tabs
// this SW instance currently holds the debugger on.
// ============================================================================
const DEVICE_MODES_KEY = "deviceModes";

let CHROME_MAJOR = null;
function chromeMajor() {
  if (CHROME_MAJOR == null) CHROME_MAJOR = getLiveChromeMajor(navigator.userAgent) || 0;
  return CHROME_MAJOR;
}

async function getDeviceModes() {
  const r = await chrome.storage.local.get(DEVICE_MODES_KEY);
  return (r && r[DEVICE_MODES_KEY]) || {};
}
async function setDeviceModes(modes) {
  await chrome.storage.local.set({ [DEVICE_MODES_KEY]: modes });
}

// Turn a stored request into the device object the builders expect. A preset resolves by id; a
// custom size becomes a synthetic desktop-UA device (plain resize + touch, real UA kept).
function resolveSimDevice(state) {
  if (state && state.custom) {
    const c = state.custom;
    const w = Math.max(50, Math.min(4000, Math.round(Number(c.width) || 390)));
    const h = Math.max(50, Math.min(4000, Math.round(Number(c.height) || 844)));
    const dpr = Math.max(0.5, Math.min(4, Number(c.dpr) || 1));
    return {
      __custom: true,
      os: "custom",
      width: w,
      height: h,
      deviceScaleFactor: dpr,
      mobile: w < 768,
      maxTouchPoints: 5,
    };
  }
  return getDevice(state && state.deviceId) || null;
}

function simLabel(state, device) {
  if (device.__custom) return `Responsive ${device.width}×${device.height}`;
  return device.label;
}

async function ensureSimAttached(tabId) {
  if (simAttached.has(tabId)) return;
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
  } catch (err) {
    const msg = String((err && err.message) || err);
    // A debugger already attached by this extension (e.g. a lost-state device mode) is fine to
    // reuse. "Another debugger"/DevTools conflicts must surface to the caller.
    if (!/already attached/i.test(msg)) throw err;
  }
  simAttached.add(tabId);
}

async function applySimOverrides(tabId, device, landscape) {
  await chrome.debugger.sendCommand({ tabId }, "Emulation.setDeviceMetricsOverride", buildMetricsOverride(device, landscape));
  await chrome.debugger.sendCommand({ tabId }, "Emulation.setTouchEmulationEnabled", buildTouchOverride(device));
  if (device.__custom) {
    // Responsive (custom) keeps the real desktop UA. Set it explicitly so switching here FROM a
    // real device clears that device's mobile UA override on the reused session.
    await chrome.debugger.sendCommand({ tabId }, "Emulation.setUserAgentOverride", { userAgent: navigator.userAgent });
  } else {
    await chrome.debugger.sendCommand({ tabId }, "Emulation.setUserAgentOverride", buildUserAgentOverride(device, chromeMajor()));
  }
}

async function applyDeviceMode(tabId, state, { reload = true } = {}) {
  const device = resolveSimDevice(state);
  if (!device) throw new Error("Unknown device");
  await ensureSimAttached(tabId);
  await applySimOverrides(tabId, device, !!state.landscape);
  const modes = await getDeviceModes();
  modes[tabId] = {
    deviceId: state.deviceId || null,
    custom: state.custom || null,
    landscape: !!state.landscape,
    label: simLabel(state, device),
  };
  await setDeviceModes(modes);
  // Reload so the main document re-requests with the emulated UA and re-runs mobile detection.
  // (The override persists on the attached session, so the fresh navigation uses it.)
  if (reload) {
    try { await chrome.tabs.reload(tabId); } catch (e) {}
  }
  return modes[tabId];
}

async function stopDeviceMode(tabId, { reload = true } = {}) {
  // Clear overrides then detach (detaching alone also clears them; clearing first is belt-and-braces
  // in case detach is refused). Reset UA to the real one explicitly for the still-loaded page.
  try {
    await chrome.debugger.sendCommand({ tabId }, "Emulation.clearDeviceMetricsOverride").catch(() => {});
    await chrome.debugger.sendCommand({ tabId }, "Emulation.setTouchEmulationEnabled", { enabled: false }).catch(() => {});
    await chrome.debugger.sendCommand({ tabId }, "Emulation.setUserAgentOverride", { userAgent: navigator.userAgent }).catch(() => {});
  } catch (e) {}
  await chrome.debugger.detach({ tabId }).catch(() => {});
  simAttached.delete(tabId);
  const modes = await getDeviceModes();
  if (modes[tabId]) {
    delete modes[tabId];
    await setDeviceModes(modes);
  }
  if (reload) {
    try { await chrome.tabs.reload(tabId); } catch (e) {}
  }
}

// The debugger detached on its own: the user clicked "Cancel" on the infobar, opened DevTools on the
// tab (device mode can't coexist with DevTools), or the tab closed. Clear the stored state so the
// popup shows device mode off. (A detach caused by SW termination does not reach this listener,
// because the SW is gone; it re-establishes via tabs.onUpdated below when the tab next loads.)
chrome.debugger.onDetach.addListener(async (source, _reason) => {
  const tabId = source && source.tabId;
  if (tabId == null) return;
  simAttached.delete(tabId);
  const modes = await getDeviceModes();
  if (modes[tabId]) {
    delete modes[tabId];
    await setDeviceModes(modes);
  }
});

// Re-establish device mode after a navigation — insurance for the case where the SW was terminated
// (losing the attachment) and later woken by the tab loading. No reload here (that would loop).
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status !== "loading") return;
  const modes = await getDeviceModes();
  const state = modes[tabId];
  if (!state) return;
  const device = resolveSimDevice(state);
  if (!device) return;
  try {
    await ensureSimAttached(tabId);
    await applySimOverrides(tabId, device, !!state.landscape);
  } catch (e) {
    // Attach can fail (DevTools open, tab gone) — leave the stored state; onDetach/close will clean up.
  }
});

// Forget a tab's device-mode state when it closes.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  simAttached.delete(tabId);
  const modes = await getDeviceModes();
  if (modes[tabId]) {
    delete modes[tabId];
    await setDeviceModes(modes);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.cmd !== "string" || !message.cmd.startsWith("sim-")) return;
  if (message.cmd === "sim-apply") {
    applyDeviceMode(message.tabId, message.state || {})
      .then((state) => sendResponse({ ok: true, state }))
      .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
    return true; // async
  }
  if (message.cmd === "sim-stop") {
    stopDeviceMode(message.tabId)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
    return true; // async
  }
  if (message.cmd === "sim-status") {
    getDeviceModes()
      .then((modes) => sendResponse({ ok: true, state: modes[message.tabId] || null }))
      .catch(() => sendResponse({ ok: true, state: null }));
    return true; // async
  }
  return false;
});
