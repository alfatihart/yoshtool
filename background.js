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
  PB_ENABLED_KEY,
} from "./allowlist.js";
import { showToastInTab } from "./toast.js";

chrome.runtime.onInstalled.addListener(() => {
  seedDefaultIfEmpty().then(syncSensorContentScripts);
  seedPopblockDefaults().then(syncPopblockScripts);
  createContextMenus();
});
chrome.runtime.onStartup.addListener(() => {
  syncSensorContentScripts();
  syncPopblockScripts();
});

// Right-click menu: quick access to the Dev tools without opening the popup.
function createContextMenus() {
  try {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({ id: "yosh-fill", title: "Fill form with dummy data", contexts: ["page", "editable"] });
      chrome.contextMenus.create({ id: "yosh-font", title: "Inspect fonts (WhatFont)", contexts: ["page"] });
    });
  } catch { /* contextMenus unavailable */ }
}
chrome.contextMenus?.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  const file = info.menuItemId === "yosh-fill" ? "filler.js"
    : info.menuItemId === "yosh-font" ? "fontinspector.js" : null;
  if (file) chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [file] }).catch(() => {});
});

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
  const pending = await readPendingGrant();
  if (!pending) return; // intent unknown → don't guess
  // Popup blocker: GLOBAL permission (*://*/*), not per-domain — enable the master & register the scripts.
  if (pending.type === "popblock") {
    await setPbEnabled(true);
    await syncPopblockScripts();
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
  // If the global permission is revoked, the popup blocker can't run → sync (unregister).
  await syncPopblockScripts();
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
});

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
        chrome.tabs.create({ url: message.url, active: false, index: tab.index + 1 });
      }
      return false;
    case "pb-redirect":
      if (tab && isOpenableUrl(message.url)) {
        chrome.tabs.update(tab.id, { url: message.url });
      }
      return false;
    case "pb-whitelist":
      addPbWhitelistHost(message.host);
      return false;
    case "pb-disable":
      addPbDisabledHost(message.host);
      return false;
    case "pb-run-records":
      runPopblockRecords(message, sender).finally(() => {
        try {
          sendResponse(true);
        } catch (e) {}
      });
      return true; // async response
    default:
      return false;
  }
}

const MAX_CAPTURE_DIMENSION = 16384; // safe max canvas width/height in Chrome

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

async function captureFullPage(tabId) {
  await chrome.debugger.attach({ tabId }, "1.3");
  try {
    await autoScrollThroughPage(tabId);
    // Measure layout AFTER scroll/lazy-load completes — newly loaded images can change the
    // page's total height compared to before scrolling.
    const metrics = await chrome.debugger.sendCommand({ tabId }, "Page.getLayoutMetrics");
    // cssContentSize is already in CSS px; contentSize is the fallback on older Chrome.
    const size = metrics.cssContentSize || metrics.contentSize;
    const width = Math.ceil(size.width);
    const height = Math.min(Math.ceil(size.height), MAX_CAPTURE_DIMENSION);

    // Important: genuinely resize the viewport to the page's full height, NOT just request a
    // larger clip via captureBeyondViewport. Without this, position:sticky/fixed elements get
    // redrawn in every viewport-height band down the canvas, so the result looks like the
    // same viewport looped downward instead of one whole page (the same approach
    // Puppeteer/Playwright use).
    await chrome.debugger.sendCommand({ tabId }, "Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });

    // Brief pause so sticky/lazy-load elements can settle at the new size.
    await new Promise((resolve) => setTimeout(resolve, 100));

    const result = await chrome.debugger.sendCommand({ tabId }, "Page.captureScreenshot", {
      format: "png",
      clip: { x: 0, y: 0, width, height, scale: 1 },
    });
    return "data:image/png;base64," + result.data;
  } finally {
    await chrome.debugger
      .sendCommand({ tabId }, "Emulation.clearDeviceMetricsOverride")
      .catch(() => {}); // restore the tab's viewport to normal size before detaching
    await chrome.debugger.detach({ tabId }).catch(() => {});
    // Pause so the "is debugging" infobar disappears and focus can return to the page —
    // important so the clipboard write that follows isn't rejected.
    await new Promise((resolve) => setTimeout(resolve, 300));
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
  return false;
});

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
