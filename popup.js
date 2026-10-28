import {
  serialize,
  parse,
  detectFormat,
  validateCookie,
  buildCookieUrl,
  resolveCookieHostname,
  setCookie,
  removeCookie,
  getCookiesForDomain,
  getStoreIdForTab,
} from "./cookies.js";
import {
  isHostnameAllowed,
  hostMatchesDomain,
  addDomainForHostname,
  removeDomain,
  listDomainsWithStatus,
  addSensorDomainForHostname,
  removeSensorDomain,
  listSensorDomainsWithStatus,
  isSensorEnabled,
  setSensorEnabled,
  isGlobalGranted,
  isPbEnabled,
  setPbEnabled,
  enablePopblock,
  getPbConfig,
  setPbFlag,
  addPbDisabledHost,
  removePbWhitelistHost,
  removePbDisabledHost,
} from "./allowlist.js";
import { showToastInTab } from "./toast.js";
import { normalizeColor } from "./color.js";
import {
  listSessions,
  saveSession,
  updateSessionData,
  renameSession,
  deleteSession,
  getActiveSession,
  setActiveSession,
  captureCurrent,
  applySession,
  storageItemCount as storageCount,
  getSessionPayload,
  isEncEnabled,
  enableEncryption,
  disableEncryption,
  unlock,
} from "./sessions.js";

// Grab UI elements
const outputEl = document.getElementById("output");
const formatSelect = document.getElementById("format-select");
const btnCopy = document.getElementById("btn-copy");
const btnSaveFile = document.getElementById("btn-save-file");
const btnImport = document.getElementById("btn-import");
const fileInput = document.getElementById("file-input");
const chkRemoveOld = document.getElementById("chk-remove-old");
const chkAutoRefresh = document.getElementById("chk-auto-refresh");
const chkSaveFile = document.getElementById("chk-save-file");
const chkRedact = document.getElementById("chk-redact");
const redactMethodEl = document.getElementById("redact-method");
const redactColorEl = document.getElementById("redact-color");
const redactWarnEl = document.getElementById("redact-warn");
const btnOpenSite = document.getElementById("btn-open-site");

// In-app status notification that replaces the default alert().
// persist=true keeps the message on screen (used for import results the user
// needs to read, e.g. details of failed cookies / verification output).
let statusTimeoutId;
function showStatus(message, isError = false, persist = false) {
  const el = document.getElementById("status");
  el.textContent = message;
  el.className = isError ? "error" : "success";
  if (statusTimeoutId) clearTimeout(statusTimeoutId);
  if (!persist) {
    statusTimeoutId = setTimeout(() => {
      el.textContent = "";
      el.className = "";
    }, 4000);
  }
}

// In-popup confirmation modal (the native alert/confirm is unreliable in an extension popup).
// requireText: when set, OK only enables once the user types that exact text
// (used for risky actions like clearing cookies — the user must type the domain).
function askConfirm({ message, requireText = null, danger = false }) {
  const backdrop = document.getElementById("confirm-backdrop");
  const messageEl = document.getElementById("confirm-message");
  const input = document.getElementById("confirm-input");
  const okBtn = document.getElementById("confirm-ok");
  const cancelBtn = document.getElementById("confirm-cancel");

  return new Promise((resolve) => {
    messageEl.textContent = message;
    okBtn.classList.toggle("danger", danger);

    if (requireText) {
      input.hidden = false;
      input.value = "";
      input.placeholder = requireText;
      okBtn.disabled = true;
      input.oninput = () => {
        okBtn.disabled = input.value.trim() !== requireText;
      };
    } else {
      input.hidden = true;
      okBtn.disabled = false;
      input.oninput = null;
    }

    backdrop.hidden = false;
    if (requireText) input.focus();

    function cleanup(result) {
      backdrop.hidden = true;
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      input.oninput = null;
      input.hidden = true;
      okBtn.classList.remove("danger");
      resolve(result);
    }
    okBtn.onclick = () => {
      if (okBtn.disabled) return;
      cleanup(true);
    };
    cancelBtn.onclick = () => cleanup(false);
  });
}

// Free-text input in the popup (reuses the confirm modal). Returns the string
// (possibly empty) on OK, or null on Cancel.
function askInput({ message, placeholder = "", value = "", password = false }) {
  const backdrop = document.getElementById("confirm-backdrop");
  const messageEl = document.getElementById("confirm-message");
  const input = document.getElementById("confirm-input");
  const okBtn = document.getElementById("confirm-ok");
  const cancelBtn = document.getElementById("confirm-cancel");

  return new Promise((resolve) => {
    messageEl.textContent = message;
    okBtn.classList.remove("danger");
    input.hidden = false;
    input.type = password ? "password" : "text";
    input.value = value;
    input.placeholder = placeholder;
    okBtn.disabled = false;
    input.oninput = null;
    backdrop.hidden = false;
    input.focus();
    input.select();

    function cleanup(result) {
      backdrop.hidden = true;
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      input.onkeydown = null;
      input.hidden = true;
      input.type = "text";
      input.value = "";
      resolve(result);
    }
    okBtn.onclick = () => cleanup(input.value.trim());
    cancelBtn.onclick = () => cleanup(null);
    input.onkeydown = (e) => {
      if (e.key === "Enter") okBtn.click();
    };
  });
}

// Tab switching + remember the last tab (reopen to the tab last used).
function activateTab(tabId) {
  const btn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
  const panel = document.getElementById(`panel-${tabId}`);
  if (!btn || !panel) return;
  for (const b of document.querySelectorAll(".tab-btn")) b.classList.remove("active");
  for (const p of document.querySelectorAll(".tab-panel")) p.classList.remove("active");
  btn.classList.add("active");
  panel.classList.add("active");
}
for (const btn of document.querySelectorAll(".tab-btn")) {
  btn.addEventListener("click", () => {
    activateTab(btn.dataset.tab);
    chrome.storage.local.set({ lastTab: btn.dataset.tab });
  });
}
chrome.storage.local.get("lastTab").then((v) => {
  if (v.lastTab) activateTab(v.lastTab);
});

// Get the active tab.
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

// Wait until a tab finishes loading, so a toast is shown AFTER the reload completes
// (if shown before, the toast is wiped the moment the page reloads).
function waitForTabComplete(tabId, timeout = 8000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const listener = (id, info) => {
      if (id === tabId && info.status === "complete") finish();
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(finish, timeout);
  });
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

// Enable/disable the Copy, Save file & Import buttons based on textarea content.
function updateButtons() {
  const hasText = outputEl.value.trim().length > 0;
  btnCopy.disabled = !hasText;
  btnSaveFile.disabled = !hasText;
  btnImport.disabled = !hasText;
}
outputEl.addEventListener("input", updateButtons);

// Saved preferences (auto refresh & screenshot output).
async function loadPrefs() {
  const { autoRefresh, saveFileScreenshot, redactScreenshot, redactMethod, redactColor } =
    await chrome.storage.local.get([
      "autoRefresh",
      "saveFileScreenshot",
      "redactScreenshot",
      "redactMethod",
      "redactColor",
    ]);
  chkAutoRefresh.checked = autoRefresh !== false; // default: on
  chkSaveFile.checked = !!saveFileScreenshot;
  chkRedact.checked = !!redactScreenshot; // default: off
  redactMethodEl.value = redactMethod === "blur" ? "blur" : "solid"; // default: solid
  redactColorEl.value = redactColor || "#000000";
  updateRedactUi();
}
// Color is only relevant for Solid; the warning only for Blur.
function updateRedactUi() {
  const isBlur = redactMethodEl.value === "blur";
  redactColorEl.style.display = isBlur ? "none" : "";
  redactWarnEl.style.display = isBlur ? "" : "none";
}
chkAutoRefresh.addEventListener("change", () => {
  chrome.storage.local.set({ autoRefresh: chkAutoRefresh.checked });
});
chkSaveFile.addEventListener("change", () => {
  chrome.storage.local.set({ saveFileScreenshot: chkSaveFile.checked });
});
chkRedact.addEventListener("change", () => {
  chrome.storage.local.set({ redactScreenshot: chkRedact.checked });
});
redactMethodEl.addEventListener("change", () => {
  chrome.storage.local.set({ redactMethod: redactMethodEl.value });
  updateRedactUi();
});
redactColorEl.addEventListener("change", () => {
  chrome.storage.local.set({ redactColor: redactColorEl.value });
});

// ---------- Export ----------
document.getElementById("btn-export").onclick = async () => {
  const tab = await getActiveTab();
  if (!tab?.url) {
    showStatus("Couldn't read the active tab's URL.", true);
    return;
  }

  const hostname = hostnameOf(tab.url);
  if (!hostname || !(await isHostnameAllowed(hostname))) {
    showStatus(`Domain "${hostname}" isn't on the allowlist yet. Open the Allowlist tab.`, true);
    return;
  }

  const cookies = await getCookiesForDomain(hostname);
  outputEl.value = serialize(cookies, formatSelect.value);
  updateButtons();
  // Remember the exact URL at export time, so the "Open site" button after import opens
  // this page (e.g. the fly.web.id/dashboard frontend) rather than the cookie domain
  // (e.g. api.fly.web.id). Shared with the incognito context via chrome.storage.local.
  await chrome.storage.local.set({ lastExport: { url: tab.url, host: hostname, at: Date.now() } });
  showStatus(`Exported ${cookies.length} cookies (${formatSelect.value}).`);
};

// ---------- Copy ----------
btnCopy.onclick = async () => {
  const output = outputEl.value;
  if (!output) {
    showStatus("Nothing to copy.", true);
    return;
  }
  try {
    await navigator.clipboard.writeText(output);
    showStatus("Cookies copied to the clipboard.");
  } catch (err) {
    showStatus("Couldn't copy: " + err.message, true);
  }
};

// ---------- Save file ----------
btnSaveFile.onclick = () => {
  if (!outputEl.value) {
    showStatus("Nothing to save.", true);
    return;
  }
  const format = formatSelect.value;
  const ext = format === "json" ? "json" : "txt";
  const blob = new Blob([outputEl.value], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `cookies-${format}.${ext}`;
  a.click();
  URL.revokeObjectURL(url);
  showStatus("Cookie file saved.");
};

// ---------- Paste ----------
document.getElementById("btn-paste").onclick = async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) throw new Error("Clipboard is empty");
    outputEl.value = text;
    formatSelect.value = detectFormat(text);
    updateButtons();
    showStatus("Pasted from the clipboard.");
  } catch (err) {
    showStatus("Couldn't paste (allow clipboard access): " + err.message, true);
  }
};

// ---------- Open file ----------
document.getElementById("btn-open-file").onclick = () => fileInput.click();
fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  if (!file) return;
  const text = await file.text();
  outputEl.value = text;
  formatSelect.value = detectFormat(text);
  updateButtons();
  showStatus(`Loaded "${file.name}".`);
  fileInput.value = "";
});

// ---------- Clear ----------
document.getElementById("btn-clear").onclick = () => {
  outputEl.value = "";
  updateButtons();
  btnOpenSite.style.display = "none";
  showStatus("Cleared.");
};

// ---------- Import ----------
// Each cookie's domain is taken from the cookie itself (JSON/Netscape carry it),
// not required from the active tab — so import still works in a fresh/Incognito tab
// that hasn't been opened to the target site. The Header format carries no domain at
// all, so cookies from that format fall back to the active tab's hostname.
// Every domain that appears is checked against the allowlist ONE BY ONE (not once for
// the whole batch), so data laced with cookies for another domain can't be set
// silently just because the active tab happens to be on an allowed domain.
btnImport.onclick = async () => {
  const text = outputEl.value;
  if (!text.trim()) {
    showStatus("Paste cookie data first.", true);
    return;
  }

  let cookies;
  try {
    cookies = parse(text); // format is auto-detected from the content
    if (!Array.isArray(cookies)) throw new Error("Data must be a list of cookies");
  } catch (err) {
    showStatus("Couldn't read the data: " + err.message, true);
    return;
  }

  const tab = await getActiveTab();
  const activeHostname = hostnameOf(tab?.url || "");
  // The target store (e.g. the incognito store) is taken explicitly from the active tab,
  // so cookies are guaranteed to land in the same store as the tab that will open — no
  // longer relying on the "incognito popup context → incognito store" assumption.
  const targetStoreId = tab?.id != null ? await getStoreIdForTab(tab.id) : undefined;

  const resolved = cookies.map((cookie) => ({
    cookie,
    hostname: resolveCookieHostname(cookie, activeHostname),
  }));

  const uniqueHostnames = [...new Set(resolved.map((r) => r.hostname).filter(Boolean))];
  if (uniqueHostnames.length === 0) {
    showStatus(
      "The Header String format carries no domain, so the active tab must already be on the target site. " +
        "Open the target site first and then import, or use the JSON/Netscape format which carries the domain.",
      true,
      true,
    );
    return;
  }

  const allowedHostnames = [];
  for (const hostname of uniqueHostnames) {
    if (await isHostnameAllowed(hostname)) allowedHostnames.push(hostname);
  }
  if (allowedHostnames.length === 0) {
    showStatus(`Domain "${uniqueHostnames[0]}" isn't on the allowlist yet. Open the Allowlist tab.`, true);
    return;
  }

  if (chkRemoveOld.checked) {
    for (const hostname of allowedHostnames) {
      const existing = await getCookiesForDomain(hostname, targetStoreId);
      for (const c of existing) {
        await removeCookie(c, buildCookieUrl(c, hostname), targetStoreId);
      }
    }
  }

  let successCount = 0;
  const failed = [];
  const successCountByHostname = new Map();
  for (const { cookie: rawCookie, hostname } of resolved) {
    if (!hostname || !allowedHostnames.includes(hostname)) {
      failed.push(`${rawCookie?.name || "(no name)"}: domain "${hostname || "?"}" isn't on the allowlist`);
      continue;
    }
    const error = validateCookie(rawCookie);
    if (error) {
      failed.push(`${rawCookie?.name || "(no name)"}: ${error}`);
      continue;
    }
    try {
      const url = buildCookieUrl(rawCookie, hostname);
      const res = await setCookie(rawCookie, url, targetStoreId);
      if (res) {
        successCount++;
        successCountByHostname.set(hostname, (successCountByHostname.get(hostname) || 0) + 1);
      } else {
        failed.push(`${rawCookie.name}: rejected by Chrome (null, check the secure/domain attributes)`);
      }
    } catch (err) {
      failed.push(`${rawCookie.name}: ${err.message}`);
    }
  }

  // The domain that received the most cookies becomes the target for auto-refresh / opening a tab.
  let targetDomain = "";
  let targetCount = 0;
  for (const [hostname, count] of successCountByHostname) {
    if (count > targetCount) {
      targetDomain = hostname;
      targetCount = count;
    }
  }

  // Verify: re-read the cookies that actually EXIST in the target store after import,
  // so we catch a "successful" set whose cookie wasn't stored (e.g. wrong store).
  let verifyNote = "";
  if (targetDomain) {
    const present = await getCookiesForDomain(targetDomain, targetStoreId);
    verifyNote = ` | check: ${present.length} cookies present on ${targetDomain} (store ${targetStoreId ?? "default"})`;
  }

  if (failed.length === 0) {
    // Full success: short message, auto-dismisses.
    showStatus(`Imported ${successCount} cookies — session active on ${targetDomain}.`);
  } else {
    // Some failed: show details + verification persistently for diagnosis.
    showStatus(
      `Imported ${successCount}/${cookies.length}. Failed: ${failed.join(", ")}${verifyNote}`,
      successCount === 0,
      true,
    );
  }

  if (targetDomain) {
    const openUrl = await resolveOpenUrl(targetDomain);
    showOpenSiteButton(openUrl);
    const toastMsg =
      failed.length === 0
        ? `${successCount} cookies imported — session active`
        : `Imported ${successCount}/${cookies.length} cookies`;
    if (chkAutoRefresh.checked) {
      // windowId matters: the new tab must be born in the same window (e.g. incognito),
      // so its cookie store matches where the cookies were just set — otherwise the tab
      // can open in a normal window and appear logged out.
      let targetTabId;
      if (tab?.id && activeHostname && hostMatchesDomain(activeHostname, targetDomain)) {
        await chrome.tabs.update(tab.id, { url: openUrl });
        targetTabId = tab.id;
      } else if (tab?.windowId != null) {
        const created = await chrome.tabs.create({ url: openUrl, windowId: tab.windowId });
        targetTabId = created?.id;
      } else {
        const created = await chrome.tabs.create({ url: openUrl });
        targetTabId = created?.id;
      }
      // Toast shown after the target tab finishes loading.
      if (targetTabId != null) {
        await waitForTabComplete(targetTabId);
        await showToastInTab(targetTabId, toastMsg, failed.length > 0);
      }
    }
  }
};

// URL to open after import: prefer the exact URL from export time (e.g. the
// fly.web.id/dashboard frontend) when its host is related to the imported cookie
// domain; otherwise fall back to https://<target domain>/.
async function resolveOpenUrl(targetDomain) {
  const { lastExport } = await chrome.storage.local.get("lastExport");
  if (lastExport?.url && lastExport.host && hostsRelated(lastExport.host, targetDomain)) {
    return lastExport.url;
  }
  return `https://${targetDomain}/`;
}

function hostsRelated(a, b) {
  a = a.toLowerCase();
  b = b.toLowerCase();
  return a === b || a.endsWith("." + b) || b.endsWith("." + a);
}

// The "Open site" button stays visible after a successful import regardless of the
// Auto refresh setting, so the user can open/reload the session manually at any time.
function showOpenSiteButton(url) {
  let label = url;
  try {
    label = new URL(url).host;
  } catch {}
  btnOpenSite.textContent = `Open site (${label})`;
  btnOpenSite.style.display = "block";
  btnOpenSite.onclick = async () => {
    const tab = await getActiveTab();
    if (tab?.windowId != null) chrome.tabs.create({ url, windowId: tab.windowId });
    else chrome.tabs.create({ url });
  };
}

// ---------- Allowlist (Cookie + Auto-redact) ----------
// Generic renderer used by two SEPARATE lists: cookie and redact.
function renderDomainList(ul, items, onRemove, emptyText) {
  ul.innerHTML = "";
  if (items.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = emptyText;
    ul.appendChild(li);
    return;
  }
  for (const { domain, active } of items) {
    const li = document.createElement("li");

    const label = document.createElement("span");
    label.textContent = domain;
    const badge = document.createElement("span");
    badge.className = `badge ${active ? "active" : "inactive"}`;
    badge.textContent = active ? "active" : "inactive";
    label.appendChild(badge);

    const btnRemove = document.createElement("button");
    btnRemove.textContent = "Remove";
    btnRemove.style.flex = "none";
    btnRemove.onclick = () => onRemove(domain);

    li.appendChild(label);
    li.appendChild(btnRemove);
    ul.appendChild(li);
  }
}

async function renderAllowlist() {
  const ul = document.getElementById("allowlist-items");
  const items = await listDomainsWithStatus();
  renderDomainList(ul, items, async (domain) => {
    await removeDomain(domain);
    await renderAllowlist();
    showStatus(`Removed "${domain}" from the cookie list.`);
  }, "No domains yet.");
}

async function renderSensorList() {
  const ul = document.getElementById("sensor-items");
  const items = await listSensorDomainsWithStatus();
  renderDomainList(ul, items, async (domain) => {
    await removeSensorDomain(domain);
    await renderSensorList();
    showStatus(`Removed "${domain}" from the auto-redact list.`);
  }, "No redact domains yet.");
}

document.getElementById("btn-allow-current").onclick = async () => {
  const tab = await getActiveTab();
  const hostname = hostnameOf(tab?.url || "");
  if (!hostname) {
    showStatus("Couldn't read the active tab's domain.", true);
    return;
  }
  try {
    const granted = await addDomainForHostname(hostname);
    if (granted) {
      showStatus(`Domain "${hostname}" allowed for cookies.`);
      await renderAllowlist();
    } else {
      showStatus("Permission denied.", true);
    }
  } catch (err) {
    showStatus("Couldn't request permission: " + err.message, true);
  }
};

document.getElementById("btn-sensor-current").onclick = async () => {
  const tab = await getActiveTab();
  const hostname = hostnameOf(tab?.url || "");
  if (!hostname) {
    showStatus("Couldn't read the active tab's domain.", true);
    return;
  }
  try {
    const granted = await addSensorDomainForHostname(hostname);
    if (granted) {
      showStatus(`Auto-redact enabled for "${hostname}". Reload the page for it to take effect.`);
      await renderSensorList();
    } else {
      showStatus("Permission denied.", true);
    }
  } catch (err) {
    showStatus("Couldn't request permission: " + err.message, true);
  }
};

// Master on/off for realtime auto-redact.
const chkSensorEnabled = document.getElementById("chk-sensor-enabled");
isSensorEnabled().then((on) => {
  chkSensorEnabled.checked = on;
});
chkSensorEnabled.onchange = async () => {
  await setSensorEnabled(chkSensorEnabled.checked);
  showStatus(chkSensorEnabled.checked ? "Auto-redact enabled." : "Auto-redact disabled.");
};

// ---------- Popup blocker (Tools tab) ----------
// Simple host (string) lists for the popup blocker's whitelist & disabled sites.
function renderHostChips(ul, hosts, onRemove, emptyText) {
  ul.innerHTML = "";
  if (!hosts || hosts.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = emptyText;
    ul.appendChild(li);
    return;
  }
  for (const host of hosts) {
    const li = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = host;
    const btn = document.createElement("button");
    btn.textContent = "Remove";
    btn.style.flex = "none";
    btn.onclick = () => onRemove(host);
    li.appendChild(label);
    li.appendChild(btn);
    ul.appendChild(li);
  }
}

async function renderPopblock() {
  const enableWrap = document.getElementById("pb-enable-wrap");
  const activeWrap = document.getElementById("pb-active-wrap");
  const granted = await isGlobalGranted();
  enableWrap.style.display = granted ? "none" : "";
  activeWrap.style.display = granted ? "" : "none";
  if (!granted) return;

  const [enabled, cfg] = await Promise.all([isPbEnabled(), getPbConfig()]);
  document.getElementById("chk-pb-enabled").checked = enabled;
  document.getElementById("chk-pb-strict").checked = !!cfg.strict;
  document.getElementById("chk-pb-sameorigin").checked = !!cfg.allowSameOrigin;

  renderHostChips(
    document.getElementById("pb-whitelist-items"),
    cfg.whitelistHosts,
    async (host) => {
      await removePbWhitelistHost(host);
      await renderPopblock();
      showStatus(`Removed "${host}" from the whitelist.`);
    },
    "No trusted domains yet.",
  );
  renderHostChips(
    document.getElementById("pb-disabled-items"),
    cfg.disabledHosts,
    async (host) => {
      await removePbDisabledHost(host);
      await renderPopblock();
      showStatus(`Popup blocker re-enabled on "${host}".`);
    },
    "None.",
  );

  const tab = await getActiveTab();
  const host = hostnameOf(tab?.url || "");
  const btnSite = document.getElementById("btn-pb-toggle-site");
  const isDisabled = !!host && cfg.disabledHosts.some((d) => hostMatchesDomain(host, d));
  btnSite.textContent = isDisabled
    ? `Re-enable on ${host}`
    : "Disable on this site";
  btnSite.dataset.host = host;
  btnSite.dataset.disabled = isDisabled ? "1" : "0";
  btnSite.disabled = !host;
}

document.getElementById("btn-pb-enable").onclick = async () => {
  try {
    const ok = await enablePopblock();
    if (ok) {
      showStatus("Popup blocker enabled. Reload the page for it to take effect.");
      await renderPopblock();
    } else {
      showStatus("Permission denied.", true);
    }
  } catch (err) {
    showStatus("Couldn't request permission: " + err.message, true);
  }
};
document.getElementById("chk-pb-enabled").onchange = async (e) => {
  await setPbEnabled(e.target.checked);
  showStatus(e.target.checked ? "Popup blocker enabled." : "Popup blocker disabled.");
};
document.getElementById("chk-pb-strict").onchange = async (e) => {
  await setPbFlag("strict", e.target.checked);
  showStatus("Settings saved. Reload the page for them to take effect.");
};
document.getElementById("chk-pb-sameorigin").onchange = async (e) => {
  await setPbFlag("allowSameOrigin", e.target.checked);
  showStatus("Settings saved.");
};
document.getElementById("btn-pb-toggle-site").onclick = async (e) => {
  const host = e.target.dataset.host;
  if (!host) return;
  if (e.target.dataset.disabled === "1") {
    await removePbDisabledHost(host);
    showStatus(`Popup blocker re-enabled on ${host}.`);
  } else {
    await addPbDisabledHost(host);
    showStatus(`Popup blocker disabled on ${host}.`);
  }
  await renderPopblock();
};

// ---------- Clear cache ----------
document.getElementById("btn-clear-cache").onclick = async () => {
  const tab = await getActiveTab();
  if (!tab?.url) {
    showStatus("Couldn't read the active tab's URL.", true);
    return;
  }
  const origin = new URL(tab.url).origin;
  const host = hostnameOf(tab.url);
  // Clearing the cache doesn't log you out, so a plain OK/Cancel confirm is enough.
  const ok = await askConfirm({ message: `Clear the page cache for ${host}?` });
  if (!ok) return;
  try {
    await chrome.browsingData.remove({ origins: [origin] }, { cache: true, cacheStorage: true });
    showStatus("Page cache cleared.");
    // Toast shown after the reload completes so it isn't wiped too.
    if (chkAutoRefresh.checked) {
      await chrome.tabs.reload(tab.id);
      await waitForTabComplete(tab.id);
    }
    await showToastInTab(tab.id, `${host} cache cleared`);
  } catch (err) {
    showStatus("Couldn't clear the cache: " + err.message, true);
  }
};

// ---------- Clear cookies ----------
// Deletes the REAL cookies for the active tab's domain (not just clearing the textarea).
// Destructive (logs you out), so the confirm requires typing the domain name.
// Gated by the allowlist because chrome.cookies.remove needs host permission for the domain.
document.getElementById("btn-clear-cookies").onclick = async () => {
  const tab = await getActiveTab();
  const hostname = hostnameOf(tab?.url || "");
  if (!hostname) {
    showStatus("Couldn't read the active tab's domain.", true);
    return;
  }
  if (!(await isHostnameAllowed(hostname))) {
    showStatus(`Domain "${hostname}" isn't on the allowlist yet. Open the Allowlist tab.`, true);
    return;
  }

  const ok = await askConfirm({
    message: `Delete all cookies for ${hostname}? This will log you out. Type "${hostname}" to confirm.`,
    requireText: hostname,
    danger: true,
  });
  if (!ok) return;

  const storeId = tab?.id != null ? await getStoreIdForTab(tab.id) : undefined;
  const cookies = await getCookiesForDomain(hostname, storeId);
  let removed = 0;
  for (const c of cookies) {
    try {
      const res = await removeCookie(c, buildCookieUrl(c, hostname), storeId);
      if (res) removed++;
    } catch {
      // keep going to the next cookie
    }
  }
  showStatus(`Deleted ${removed} cookies from ${hostname}.`);
  if (chkAutoRefresh.checked && tab?.id) {
    await chrome.tabs.reload(tab.id);
    await waitForTabComplete(tab.id);
  }
  await showToastInTab(tab?.id, `${removed} ${hostname} cookies deleted`);
};

// ---------- Screenshot ----------
// The popup closes after sending the capture command, because background.js carries
// the process on (including when the user needs to interact with the page).
async function triggerCapture(mode) {
  const tab = await getActiveTab();
  if (!tab?.id) {
    showStatus("Couldn't get the active tab.", true);
    return;
  }
  const output = chkSaveFile.checked ? "file" : "clipboard";
  const redact = chkRedact.checked;
  chrome.runtime.sendMessage({ type: "capture", mode, output, tab, redact });
  window.close();
}

document.getElementById("btn-capture-area").onclick = () => triggerCapture("area");
document.getElementById("btn-capture-screen").onclick = () => triggerCapture("screen");
document.getElementById("btn-capture-full").onclick = () => triggerCapture("full");

// ---------- Capture status from a previous run ----------
// Capture (screenshot) runs in background.js because this popup is closed during it.
// When the popup reopens, show the last capture result (if it happened within the last
// 30 seconds) so success/failure never has to be guessed.
const CAPTURE_STATUS_MAX_AGE_MS = 30_000;
async function showPendingCaptureStatus() {
  const { captureStatus } = await chrome.storage.local.get("captureStatus");
  if (!captureStatus) return;
  await chrome.storage.local.remove("captureStatus");
  if (Date.now() - captureStatus.at > CAPTURE_STATUS_MAX_AGE_MS) return;

  const outputLabel = captureStatus.output === "file" ? "saved as a file" : "copied to the clipboard";
  if (captureStatus.ok) {
    showStatus(`Screenshot (${captureStatus.mode}) ${outputLabel}.`);
  } else {
    showStatus(`Screenshot (${captureStatus.mode}) failed: ${captureStatus.error}`, true);
  }
}

// ---------- Init ----------
updateButtons();
loadPrefs();
renderAllowlist();
renderSensorList();
renderPopblock();
showPendingCaptureStatus();

// ---------- Dev tools ----------
// Faker form-fill: inject filler.js into the active tab.
const chkFakerSkip = document.getElementById("chk-faker-skip");
chrome.storage.local.get("fakerSkipFilled").then((v) => {
  chkFakerSkip.checked = v.fakerSkipFilled === true;
});
chkFakerSkip.addEventListener("change", () => {
  chrome.storage.local.set({ fakerSkipFilled: chkFakerSkip.checked });
});
document.getElementById("btn-fill-form").onclick = async () => {
  const tab = await getActiveTab();
  if (!tab?.id) { showStatus("No active tab.", true); return; }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["filler.js"] });
    showStatus("Form filled with dummy data.");
  } catch (err) {
    showStatus("Couldn't fill the form: " + err.message, true);
  }
};

// Font inspector: inject fontinspector.js (toggle).
document.getElementById("btn-font-inspect").onclick = async () => {
  const tab = await getActiveTab();
  if (!tab?.id) { showStatus("No active tab.", true); return; }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["fontinspector.js"] });
    window.close();
  } catch (err) {
    showStatus("Failed: " + err.message, true);
  }
};

// Color picker (EyeDropper) + history.
const COLOR_HISTORY_KEY = "colorHistory";
const colorResult = document.getElementById("color-result");

function setCval(id, val) {
  const el = document.getElementById(id);
  el.querySelector(".v").textContent = val;
  el.dataset.val = val;
  el.title = val + " — click to copy";
}
const colorInputEl = document.getElementById("color-input");
const colorHexInputEl = document.getElementById("color-hex-input");
function renderColor(hex) {
  const c = normalizeColor(hex);
  if (!c) return;
  document.getElementById("color-swatch").style.background = c.hex;
  setCval("color-hex", c.hex);
  setCval("color-rgb", c.rgb);
  setCval("color-hsl", c.hsl);
  colorInputEl.value = c.hex; // native selector follows (live hex)
  colorResult.style.display = "block";
}
// Used by EXTERNAL sources (eyedropper/palette/history): set selector + text field + render.
function setPicker(hex) {
  const c = normalizeColor(hex);
  if (!c) return;
  colorHexInputEl.value = c.hex;
  renderColor(c.hex);
}
// Drag the color selector → live update.
colorInputEl.addEventListener("input", () => {
  colorHexInputEl.value = colorInputEl.value;
  renderColor(colorInputEl.value);
});
// Type hex manually → live (without writing back to the field so typing isn't disrupted).
colorHexInputEl.addEventListener("input", () => {
  const c = normalizeColor(colorHexInputEl.value.trim());
  if (c) renderColor(c.hex);
});
for (const btn of colorResult.querySelectorAll(".cval")) {
  btn.addEventListener("click", async () => {
    const v = btn.dataset.val || "";
    if (!v) return;
    try { await navigator.clipboard.writeText(v); showStatus("Copied: " + v); } catch { /* ignore */ }
  });
}

async function addColorHistory(hex) {
  const { [COLOR_HISTORY_KEY]: hist = [] } = await chrome.storage.local.get(COLOR_HISTORY_KEY);
  const next = [hex, ...hist.filter((h) => h !== hex)].slice(0, 12);
  await chrome.storage.local.set({ [COLOR_HISTORY_KEY]: next });
  renderHistory(next);
}
function renderHistory(hist) {
  const box = document.getElementById("color-history");
  const head = document.getElementById("color-history-head");
  head.style.display = hist.length ? "flex" : "none";
  box.innerHTML = "";
  for (const hex of hist) {
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.style.background = hex;
    chip.title = hex + " — click to copy";
    chip.onclick = async () => {
      setPicker(hex);
      try { await navigator.clipboard.writeText(hex); showStatus("Copied: " + hex); } catch { /* ignore */ }
    };
    box.appendChild(chip);
  }
}
chrome.storage.local.get(COLOR_HISTORY_KEY).then((v) => {
  const hist = v[COLOR_HISTORY_KEY] || [];
  renderHistory(hist);
  setPicker(hist[0] || colorInputEl.value); // show the initial color + live hex
});

// Reset color history.
document.getElementById("btn-color-reset").onclick = async () => {
  await chrome.storage.local.set({ [COLOR_HISTORY_KEY]: [] });
  renderHistory([]);
  showStatus("Color history cleared.");
};

document.getElementById("btn-eyedropper").onclick = async () => {
  const tab = await getActiveTab();
  const url = tab?.url || "";
  const injectable = /^(https?|file|ftp):/i.test(url);
  // Normal page: pick the color ON THE PAGE (popup closes → doesn't block the selection).
  // The chosen color is auto-copied & added to history; visible when the popup reopens.
  if (tab?.id && injectable) {
    chrome.runtime.sendMessage({ type: "eyedropper", tab });
    window.close();
    return;
  }
  // A restricted page (chrome://, Web Store, etc.) can't be injected → fall back to the
  // native EyeDropper in the popup.
  if (!("EyeDropper" in window)) {
    showStatus("This page's colors can't be picked.", true);
    return;
  }
  try {
    const { sRGBHex } = await new window.EyeDropper().open();
    setPicker(sRGBHex);
    await addColorHistory(sRGBHex);
  } catch {
    // cancelled (Esc) — ignore
  }
};

// Extract the page's color palette. Toggle: click again while shown → hide.
document.getElementById("btn-palette").onclick = async () => {
  const wrap = document.getElementById("palette-wrap");
  const box = document.getElementById("palette-result");
  if (wrap.style.display !== "none") { wrap.style.display = "none"; box.innerHTML = ""; return; }
  const tab = await getActiveTab();
  if (!tab?.id) { showStatus("No active tab.", true); return; }
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const counts = new Map();
        for (const el of document.querySelectorAll("*")) {
          const cs = getComputedStyle(el);
          for (const prop of ["color", "background-color", "border-top-color"]) {
            const v = cs.getPropertyValue(prop);
            if (!v || v === "transparent" || /rgba\(0, 0, 0, 0\)/.test(v)) continue;
            counts.set(v, (counts.get(v) || 0) + 1);
          }
        }
        return [...counts.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]).slice(0, 40);
      },
    });
    box.innerHTML = "";
    const seen = new Set();
    for (const raw of result || []) {
      const c = normalizeColor(raw);
      if (!c || seen.has(c.hex)) continue;
      seen.add(c.hex);
      const chip = document.createElement("div");
      chip.className = "chip";
      chip.style.background = c.hex;
      chip.title = c.hex + " — click to copy";
      chip.onclick = async () => { setPicker(c.hex); try { await navigator.clipboard.writeText(c.hex); showStatus("Copied: " + c.hex); } catch { /* ignore */ } };
      box.appendChild(chip);
    }
    document.getElementById("palette-head").textContent = `Page palette — ${box.children.length} colors (click to copy)`;
    wrap.style.display = box.children.length ? "block" : "none";
    if (!box.children.length) showStatus("No colors detected.", true);
  } catch (err) {
    showStatus("Couldn't extract the palette: " + err.message, true);
  }
};

// ---------- Sessions (Session Switcher, Phase 1) ----------
const sessionDomainEl = document.getElementById("session-domain");

function sessionDomain() {
  return (sessionDomainEl.value || "").trim().toLowerCase();
}

// ---------- Session encryption (opt-in) ----------
// The key derived from the master passphrase is cached for the popup's lifetime after unlock
// and never persisted. Listing works while locked (metadata is clear text); saving, switching
// and updating need the key.
let sessionKey = null; // CryptoKey when unlocked, else null

// Returns null when encryption is OFF (no key needed), the CryptoKey when unlocked, or false
// when the user cancelled / mistyped the passphrase (the caller should then abort).
async function ensureSessionKey() {
  if (!(await isEncEnabled())) return null;
  if (sessionKey) return sessionKey;
  const pass = await askInput({ message: "Enter your session passphrase to unlock:", placeholder: "passphrase", password: true });
  if (pass === null) return false;
  try {
    sessionKey = await unlock(pass);
    renderEncUi();
    return sessionKey;
  } catch {
    showStatus("Wrong passphrase.", true);
    return false;
  }
}

async function renderEncUi() {
  const statusEl = document.getElementById("session-enc-status");
  const bEnc = document.getElementById("btn-session-enc");
  const bOff = document.getElementById("btn-session-enc-off");
  if (!statusEl || !bEnc || !bOff) return;
  const on = await isEncEnabled();
  if (!on) {
    statusEl.textContent = "Saved sessions are stored unencrypted.";
    bEnc.textContent = "🔒 Encrypt";
    bEnc.style.display = "";
    bOff.style.display = "none";
  } else {
    statusEl.textContent = sessionKey ? "🔒 Encrypted — unlocked." : "🔒 Encrypted — locked.";
    bEnc.textContent = "Unlock";
    bEnc.style.display = sessionKey ? "none" : "";
    bOff.style.display = "";
  }
}

document.getElementById("btn-session-enc").onclick = async () => {
  if (await isEncEnabled()) {
    const key = await ensureSessionKey(); // locked → prompt to unlock
    if (key && key !== false) showStatus("Sessions unlocked.");
    return;
  }
  const p1 = await askInput({
    message: "Set a passphrase to encrypt saved sessions. If you forget it, saved sessions can't be recovered.",
    placeholder: "new passphrase",
    password: true,
  });
  if (p1 === null) return;
  if (p1.length < 4) {
    showStatus("Passphrase must be at least 4 characters.", true);
    return;
  }
  const p2 = await askInput({ message: "Confirm passphrase:", placeholder: "repeat passphrase", password: true });
  if (p2 === null) return;
  if (p1 !== p2) {
    showStatus("Passphrases don't match.", true);
    return;
  }
  try {
    sessionKey = await enableEncryption(p1);
    showStatus("Encryption enabled — saved sessions are now encrypted.");
    renderEncUi();
    await renderSessions();
  } catch (err) {
    showStatus("Couldn't enable encryption: " + err.message, true);
  }
};

document.getElementById("btn-session-enc-off").onclick = async () => {
  const ok = await askConfirm({ message: "Disable encryption and store saved sessions as plain text again?" });
  if (!ok) return;
  const pass = await askInput({ message: "Enter your passphrase to disable encryption:", placeholder: "passphrase", password: true });
  if (pass === null) return;
  try {
    await disableEncryption(pass);
    sessionKey = null;
    showStatus("Encryption disabled.");
    renderEncUi();
    await renderSessions();
  } catch {
    showStatus("Wrong passphrase.", true);
  }
};

// Many SPAs (e.g. Supabase Auth → key `sb-<ref>-auth-token`) store the session in
// localStorage, not cookies. localStorage is per-ORIGIN and can only be read from a tab
// currently on that origin — so capture/apply only happens when the active tab is
// actually on the session's domain (guarded by the caller).
async function captureStorageFromTab(tabId) {
  const EMPTY = { local: {}, session: {}, idb: [] };
  if (tabId == null) return EMPTY;
  try {
    const [inj] = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        const dump = (s) => {
          const o = {};
          try {
            for (let i = 0; i < s.length; i++) {
              const k = s.key(i);
              o[k] = s.getItem(k);
            }
          } catch (e) {}
          return o;
        };
        // IndexedDB: enumerate databases → object stores (+ schema) → records. Each record is
        // JSON.stringify-checked so non-serializable values (Blobs, etc.) are skipped rather
        // than breaking the whole capture. Covers SPAs that keep auth state in IndexedDB.
        const idb = [];
        try {
          const list = indexedDB.databases ? (await indexedDB.databases()) || [] : [];
          for (const info of list) {
            const dbName = info && info.name;
            if (!dbName) continue;
            try {
              const db = await new Promise((res, rej) => {
                const r = indexedDB.open(dbName);
                r.onsuccess = () => res(r.result);
                r.onerror = () => rej(r.error);
                r.onblocked = () => rej(new Error("blocked"));
              });
              const stores = [];
              for (const sn of Array.from(db.objectStoreNames)) {
                try {
                  const os = db.transaction(sn, "readonly").objectStore(sn);
                  const indexes = Array.from(os.indexNames).map((n) => {
                    const ix = os.index(n);
                    return { name: n, keyPath: ix.keyPath, unique: ix.unique, multiEntry: ix.multiEntry };
                  });
                  const getAll = (req) =>
                    new Promise((res, rej) => {
                      req.onsuccess = () => res(req.result);
                      req.onerror = () => rej(req.error);
                    });
                  const values = await getAll(os.getAll());
                  const outOfLine = os.keyPath == null;
                  const keys = outOfLine ? await getAll(os.getAllKeys()) : null;
                  const records = [];
                  for (let i = 0; i < values.length; i++) {
                    try {
                      const rec = outOfLine ? { key: keys[i], value: values[i] } : { value: values[i] };
                      JSON.stringify(rec); // skip non-serializable records
                      records.push(rec);
                    } catch (e) {}
                  }
                  stores.push({ name: sn, keyPath: os.keyPath, autoIncrement: os.autoIncrement, indexes, records });
                } catch (e) {}
              }
              idb.push({ name: dbName, version: db.version, stores });
              db.close();
            } catch (e) {}
          }
        } catch (e) {}
        return { local: dump(localStorage), session: dump(sessionStorage), idb };
      },
    });
    return inj?.result || EMPTY;
  } catch {
    return EMPTY;
  }
}

async function applyStorageToTab(tabId, storage) {
  if (tabId == null || !storage) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      args: [storage],
      func: async (st) => {
        const restore = (s, obj) => {
          try {
            s.clear();
            for (const k in obj) s.setItem(k, obj[k]);
          } catch (e) {}
        };
        restore(localStorage, (st && st.local) || {});
        restore(sessionStorage, (st && st.session) || {});
        // IndexedDB: recreate each captured database (schema + records). Delete the existing
        // DB first so the restored snapshot fully replaces it.
        for (const dbdef of (st && st.idb) || []) {
          if (!dbdef || !dbdef.name) continue;
          try {
            await new Promise((res) => {
              const r = indexedDB.deleteDatabase(dbdef.name);
              r.onsuccess = r.onerror = r.onblocked = () => res();
            });
            const db = await new Promise((res, rej) => {
              const open = indexedDB.open(dbdef.name, dbdef.version || 1);
              open.onupgradeneeded = () => {
                const d = open.result;
                for (const stt of dbdef.stores || []) {
                  try {
                    const os = d.createObjectStore(stt.name, {
                      keyPath: stt.keyPath == null ? undefined : stt.keyPath,
                      autoIncrement: !!stt.autoIncrement,
                    });
                    for (const ix of stt.indexes || []) {
                      try {
                        os.createIndex(ix.name, ix.keyPath, { unique: !!ix.unique, multiEntry: !!ix.multiEntry });
                      } catch (e) {}
                    }
                  } catch (e) {}
                }
              };
              open.onsuccess = () => res(open.result);
              open.onerror = () => rej(open.error);
              open.onblocked = () => rej(new Error("blocked"));
            });
            for (const stt of dbdef.stores || []) {
              try {
                const os = db.transaction(stt.name, "readwrite").objectStore(stt.name);
                for (const rec of stt.records || []) {
                  try {
                    if (rec && "key" in rec) os.put(rec.value, rec.key);
                    else os.put(rec.value);
                  } catch (e) {}
                }
              } catch (e) {}
            }
            db.close();
          } catch (e) {}
        }
      },
    });
  } catch {
    /* restricted page / tab not on that origin — ignore */
  }
}

async function renderSessions() {
  const ul = document.getElementById("session-items");
  const gate = document.getElementById("session-gate");
  const domain = sessionDomain();
  ul.innerHTML = "";
  if (!domain) {
    gate.style.display = "none";
    return;
  }
  const allowed = await isHostnameAllowed(domain);
  gate.style.display = allowed ? "none" : "block";
  gate.innerHTML = allowed
    ? ""
    : 'Domain not allowed yet — open the <strong>Allowlist</strong> tab and "Allow this tab\'s domain". Saving/switching sessions needs cookie permission for this domain.';

  const [sessions, activeId] = await Promise.all([listSessions(domain), getActiveSession(domain)]);
  if (!sessions.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No saved sessions yet.";
    ul.appendChild(li);
    return;
  }
  for (const s of sessions) {
    const li = document.createElement("li");
    const top = document.createElement("div");
    top.className = "sess-top";
    const name = document.createElement("span");
    name.className = "sess-name";
    name.textContent = s.name;
    if (s.id === activeId) {
      const b = document.createElement("span");
      b.className = "badge active";
      b.textContent = "active";
      name.appendChild(b);
    }
    const count = document.createElement("span");
    count.className = "sess-count";
    const sc = s.scount || 0;
    count.textContent = `${s.count} cookies${sc ? ` · ${sc} storage` : ""}`;
    top.append(name, count);

    const acts = document.createElement("div");
    acts.className = "sess-actions";
    const isActive = s.id === activeId;
    const bSwitch = document.createElement("button");
    // The active session can still be "Re-applied" — important for restoring the snapshot
    // after logout (when the live state no longer reflects the saved session).
    bSwitch.textContent = isActive ? "Re-apply" : "Switch";
    if (!isActive) bSwitch.className = "btn-primary";
    bSwitch.disabled = !allowed;
    bSwitch.style.flex = "1";
    bSwitch.onclick = () => switchToSession(domain, s);
    // "Update" (active session only): overwrite this session's snapshot with the state that
    // is live right now. Switching is non-destructive and never refreshes a snapshot, so a
    // login made after the session was saved is only remembered once you Update it here.
    let bUpdate = null;
    if (isActive) {
      bUpdate = document.createElement("button");
      bUpdate.textContent = "Update";
      bUpdate.className = "btn-primary";
      bUpdate.disabled = !allowed;
      bUpdate.style.flex = "1";
      bUpdate.title = "Overwrite this session's saved snapshot with the current browser state (e.g. to capture a fresh login)";
      bUpdate.onclick = () => updateSessionSnapshot(domain, s);
    }
    const bRename = document.createElement("button");
    bRename.textContent = "Rename";
    bRename.style.flex = "none";
    bRename.onclick = async () => {
      const nm = await askInput({ message: `Rename session "${s.name}":`, value: s.name });
      if (nm === null || nm === "") return;
      await renameSession(domain, s.id, nm);
      await renderSessions();
      showStatus("Session renamed.");
    };
    const bDel = document.createElement("button");
    bDel.textContent = "Delete";
    bDel.className = "btn-danger";
    bDel.style.flex = "none";
    bDel.onclick = async () => {
      const ok = await askConfirm({ message: `Delete session "${s.name}"? This can't be undone.`, danger: true });
      if (!ok) return;
      await deleteSession(domain, s.id);
      await renderSessions();
      showStatus("Session deleted.");
    };
    if (bUpdate) acts.append(bSwitch, bUpdate, bRename, bDel);
    else acts.append(bSwitch, bRename, bDel);
    li.append(top, acts);
    ul.appendChild(li);
  }
}

// Capture the state that is live right now (cookies, plus localStorage when the active tab
// is on this domain) and overwrite the session's saved snapshot with it. This is how a login
// made AFTER a session was saved gets remembered — switching alone never refreshes a snapshot.
async function updateSessionSnapshot(domain, target) {
  if (!(await isHostnameAllowed(domain))) {
    showStatus("Domain not allowed yet (Allowlist tab).", true);
    return;
  }
  const tab = await getActiveTab();
  const onDomain = !!(tab?.url && hostMatchesDomain(hostnameOf(tab.url), domain));
  const ok = await askConfirm({
    message: onDomain
      ? `Update "${target.name}" with the current state for ${domain}? This overwrites its saved snapshot with the cookies + localStorage that are live right now (e.g. to capture a fresh login).`
      : `Update "${target.name}" with the current cookies for ${domain}? The active tab isn't on this domain, so localStorage keeps its saved value — open the site's tab to refresh that too.`,
    danger: true,
  });
  if (!ok) return;
  const key = await ensureSessionKey();
  if (key === false) return;
  try {
    const storeId = tab?.id != null ? await getStoreIdForTab(tab.id) : undefined;
    const cookies = await captureCurrent(domain, storeId);
    // When not on the domain we can't read live storage, so keep the session's saved storage
    // (decrypting it first if encrypted).
    const storage = onDomain
      ? await captureStorageFromTab(tab.id)
      : (await getSessionPayload(target, key || null)).storage;
    await updateSessionData(domain, target.id, cookies, storage, key || undefined);
    await setActiveSession(domain, target.id);
    const scN = storageCount(storage);
    showStatus(`Updated "${target.name}" — ${cookies.length} cookies${scN ? ` + ${scN} storage` : ""} saved from the current state.`);
    await renderSessions();
  } catch (err) {
    showStatus("Couldn't update the session: " + err.message, true);
  }
}

async function switchToSession(domain, target) {
  const tab = await getActiveTab();
  if (!(await isHostnameAllowed(domain))) {
    showStatus("Domain not allowed yet (Allowlist tab).", true);
    return;
  }
  const activeId = await getActiveSession(domain);
  const isReapply = target.id === activeId;
  const ok = await askConfirm({
    message: isReapply
      ? `Re-apply session "${target.name}" for ${domain}? The site's cookies & localStorage will be restored from the saved snapshot (e.g. bringing back a login after logout).`
      : `Switch to session "${target.name}" for ${domain}? The site's current cookies will be replaced (same effect as logout/login).`,
  });
  if (!ok) return;
  const storeId = tab?.id != null ? await getStoreIdForTab(tab.id) : undefined;
  // localStorage/sessionStorage can only be written when the active tab is on this domain.
  const onDomain = !!(tab?.url && hostMatchesDomain(hostnameOf(tab.url), domain));
  const key = await ensureSessionKey();
  if (key === false) return;
  try {
    // Switching is NON-DESTRUCTIVE: it only applies the target snapshot, never overwriting
    // another one. (There used to be an auto-save of the active session before switching,
    // but that overwrote the snapshot with the logged-out state if you'd logged out →
    // dropped. To update a snapshot, use "Save current session".)
    const payload = await getSessionPayload(target, key || null);
    const res = await applySession(domain, payload.cookies, storeId);
    if (onDomain) await applyStorageToTab(tab.id, payload.storage);
    await setActiveSession(domain, target.id);
    const bad = res.failed.length > 0;
    const scN = storageCount(payload.storage);
    const verb = isReapply ? "Re-applied" : "Switched to";
    showStatus(
      `${verb} "${target.name}" — ${res.set} cookies${scN ? ` + ${scN} storage` : ""} applied${bad ? `, ${res.failed.length} cookies failed` : ""}.`,
      bad,
      bad,
    );
    await renderSessions();
    if (tab?.id && onDomain) {
      await chrome.tabs.reload(tab.id);
      await waitForTabComplete(tab.id);
      await showToastInTab(tab.id, `${verb} session "${target.name}"`);
    } else {
      showStatus(
        `Session "${target.name}" applied for ${domain}. Open/refresh the site in a tab on that domain (localStorage needs a tab on that origin).`,
      );
    }
  } catch (err) {
    showStatus("Couldn't switch session: " + err.message, true);
  }
}

document.getElementById("btn-session-save").onclick = async () => {
  const domain = sessionDomain();
  if (!domain) {
    showStatus("Enter the site domain first.", true);
    return;
  }
  if (!(await isHostnameAllowed(domain))) {
    showStatus("Domain not allowed yet — open the Allowlist tab.", true);
    return;
  }
  const tab = await getActiveTab();
  const storeId = tab?.id != null ? await getStoreIdForTab(tab.id) : undefined;
  const onDomain = !!(tab?.url && hostMatchesDomain(hostnameOf(tab.url), domain));
  const cookies = await captureCurrent(domain, storeId);
  // Grab localStorage/sessionStorage from the tab (important for SPA/Supabase logins that
  // store the token in localStorage, not cookies). Only when the active tab is on that domain.
  const storage = onDomain ? await captureStorageFromTab(tab.id) : { local: {}, session: {} };
  const scN = storageCount(storage);
  if (!cookies.length && scN === 0) {
    const extra = onDomain
      ? ""
      : " Note: the active tab isn't on this domain, so localStorage can't be read.";
    const ok = await askConfirm({
      message: `No cookies or localStorage data for ${domain} right now. Save an empty session anyway?${extra}`,
    });
    if (!ok) return;
  }
  const name = await askInput({ message: `Save the ${domain} session as:`, placeholder: "e.g. Main account" });
  if (name === null) return;
  const key = await ensureSessionKey();
  if (key === false) return;
  const s = await saveSession(domain, name || `Session ${new Date().toLocaleString()}`, cookies, storage, key || undefined);
  await setActiveSession(domain, s.id);
  showStatus(`Session "${s.name}" saved (${cookies.length} cookies${scN ? ` + ${scN} storage` : ""}).`);
  await renderSessions();
};

sessionDomainEl.addEventListener("input", () => renderSessions());

// Fill the domain from the active tab's FULL HOSTNAME (editable), consistent with Export/Import
// and the allowlist which also use the tab hostname — e.g. "staging-app.konsultanedu.com", not
// the broader registrable "konsultanedu.com" which you may not have allowed.
(async () => {
  const tab = await getActiveTab();
  const guess = hostnameOf(tab?.url || "");
  if (guess && !sessionDomainEl.value) sessionDomainEl.value = guess;
  await renderSessions();
})();
renderEncUi();
