// allowlist.js
// Manages two SEPARATE domain lists in chrome.storage.local:
//   - allowedDomains → permission for the cookie feature (export/import).
//   - sensorDomains  → permission for the realtime auto-redact feature (privacy mode).
// The two are functionally independent: a domain present only in sensorDomains does NOT
// pass isHostnameAllowed (cookie), and vice versa. No domains are hardcoded — the lists are
// managed via buttons in the popup (Allowlist tab), and actual host access comes through
// chrome.permissions (Chrome's built-in permission dialog), not from static host_permissions
// in the manifest.
//
// Chrome DOES share host permissions (one origin = one permission), but the functional gate
// stays the separate storage lists. So when removing from one list, the host permission is
// only revoked if the domain isn't used by the other.

const COOKIE_KEY = "allowedDomains";
export const SENSOR_KEY = "sensorDomains";
export const SENSOR_ENABLED_KEY = "sensorEnabled";
const PENDING_KEY = "pendingGrant";
export const DEFAULT_PLACEHOLDER_DOMAIN = "example.com";

async function getList(key) {
  const result = await chrome.storage.local.get(key);
  const list = result[key];
  return Array.isArray(list) ? list : [];
}

async function setList(key, list) {
  await chrome.storage.local.set({ [key]: list });
}

export async function getStoredDomains() {
  return getList(COOKIE_KEY);
}

export async function getSensorDomains() {
  return getList(SENSOR_KEY);
}

export async function setSensorDomains(list) {
  await setList(SENSOR_KEY, Array.isArray(list) ? list : []);
}

// Called once on install (see background.js). Not re-run on every read, so a list the user
// intentionally emptied doesn't get repopulated.
export async function seedDefaultIfEmpty() {
  const current = await chrome.storage.local.get([COOKIE_KEY, SENSOR_ENABLED_KEY]);
  if (current[COOKIE_KEY] === undefined) {
    await setList(COOKIE_KEY, [DEFAULT_PLACEHOLDER_DOMAIN]);
  }
  // Auto-redact master defaults ON (but no redact domains exist until the user adds one).
  if (current[SENSOR_ENABLED_KEY] === undefined) {
    await chrome.storage.local.set({ [SENSOR_ENABLED_KEY]: true });
  }
}

export function normalizeHostname(hostname) {
  return String(hostname || "").trim().toLowerCase();
}

export function hostMatchesDomain(hostname, domain) {
  hostname = normalizeHostname(hostname);
  domain = normalizeHostname(domain);
  if (!hostname || !domain) return false;
  return hostname === domain || hostname.endsWith("." + domain);
}

function originsForDomain(domain) {
  return [`*://${domain}/*`, `*://*.${domain}/*`];
}

export async function isDomainGranted(domain) {
  try {
    return await chrome.permissions.contains({ origins: originsForDomain(domain) });
  } catch {
    return false;
  }
}

export async function listDomainsWithStatus() {
  const domains = await getList(COOKIE_KEY);
  return Promise.all(
    domains.map(async (domain) => ({ domain, active: await isDomainGranted(domain) })),
  );
}

export async function listSensorDomainsWithStatus() {
  const domains = await getList(SENSOR_KEY);
  return Promise.all(
    domains.map(async (domain) => ({ domain, active: await isDomainGranted(domain) })),
  );
}

// Used before cookie export/import: only domains that are LISTED in allowedDomains AND hold
// a real host permission count as allowed.
export async function isHostnameAllowed(hostname) {
  const domains = await getList(COOKIE_KEY);
  for (const domain of domains) {
    if (hostMatchesDomain(hostname, domain) && (await isDomainGranted(domain))) {
      return true;
    }
  }
  return false;
}

// Used by the auto-redact feature: domains in sensorDomains AND holding a real host permission.
export async function isHostnameSensor(hostname) {
  const domains = await getList(SENSOR_KEY);
  for (const domain of domains) {
    if (hostMatchesDomain(hostname, domain) && (await isDomainGranted(domain))) {
      return true;
    }
  }
  return false;
}

// Auto-redact master on/off. Defaults true if never set.
export async function isSensorEnabled() {
  const r = await chrome.storage.local.get(SENSOR_ENABLED_KEY);
  return r[SENSOR_ENABLED_KEY] !== false;
}

export async function setSensorEnabled(on) {
  await chrome.storage.local.set({ [SENSOR_ENABLED_KEY]: !!on });
}

// --- Grant-intent disambiguation (pending-intent) ---------------------------
// Both the "Allow" (cookie) and "Protect" (redact) buttons call chrome.permissions.request,
// which triggers the permission dialog and closes the popup. The chrome.permissions.onAdded
// listener in the background saves the domain to the correct list — but from the origin
// pattern alone it can't tell WHICH list is meant. So we record the intent first
// (fire-and-forget, no await so the user gesture isn't broken) before calling request.
function markPendingGrant(type, domain) {
  // intentionally no await: preserves the gesture for chrome.permissions.request
  chrome.storage.local.set({ [PENDING_KEY]: { type, domain, at: Date.now() } });
}

export async function readPendingGrant() {
  const r = await chrome.storage.local.get(PENDING_KEY);
  return r[PENDING_KEY] || null;
}

export async function clearPendingGrant() {
  await chrome.storage.local.remove(PENDING_KEY);
}

// Called from the "Allow this tab's domain" (cookie) button in the popup — must run in a
// direct user-gesture context (chrome.permissions.request requires it).
export async function addDomainForHostname(hostname) {
  const domain = normalizeHostname(hostname);
  if (!domain) return false;
  markPendingGrant("cookie", domain);
  const granted = await chrome.permissions.request({ origins: originsForDomain(domain) });
  if (!granted) {
    await clearPendingGrant();
    return false;
  }
  // Idempotent: normally the background onAdded does the write; this is a safety net in case
  // the popup is still open when the dialog is approved.
  await addDomainsToStore([domain]);
  return true;
}

// Called from the "Protect this tab's domain" (auto-redact) button in the popup.
export async function addSensorDomainForHostname(hostname) {
  const domain = normalizeHostname(hostname);
  if (!domain) return false;
  markPendingGrant("sensor", domain);
  const granted = await chrome.permissions.request({ origins: originsForDomain(domain) });
  if (!granted) {
    await clearPendingGrant();
    return false;
  }
  await addSensorDomainsToStore([domain]);
  return true;
}

export async function removeDomain(domain) {
  domain = normalizeHostname(domain);
  // Release the host permission only if the domain isn't used by the redact list (host permission is shared).
  const sensor = await getList(SENSOR_KEY);
  if (!sensor.includes(domain)) {
    await chrome.permissions.remove({ origins: originsForDomain(domain) });
  }
  const domains = await getList(COOKIE_KEY);
  await setList(COOKIE_KEY, domains.filter((d) => d !== domain));
}

export async function removeSensorDomain(domain) {
  domain = normalizeHostname(domain);
  // Release the host permission only if the domain isn't used by the cookie list.
  const cookie = await getList(COOKIE_KEY);
  if (!cookie.includes(domain)) {
    await chrome.permissions.remove({ origins: originsForDomain(domain) });
  }
  const domains = await getList(SENSOR_KEY);
  await setList(SENSOR_KEY, domains.filter((d) => d !== domain));
}

// Derives the domain name from the origin pattern Chrome grants/revokes,
// e.g. "*://*.fly.web.id/*" and "*://fly.web.id/*" → "fly.web.id".
export function domainsFromOrigins(origins) {
  const set = new Set();
  for (const origin of origins || []) {
    const match = String(origin).match(/^\*:\/\/(?:\*\.)?([^/]+)\/\*$/);
    if (match) set.add(normalizeHostname(match[1]));
  }
  return [...set];
}

// Used by the chrome.permissions.onAdded listener in the background: saves the domain to the
// cookie list WITHOUT depending on the popup, which is already closed when the dialog appears.
export async function addDomainsToStore(domains) {
  if (!domains || domains.length === 0) return;
  const current = await getList(COOKIE_KEY);
  const merged = [...new Set([...current, ...domains.map(normalizeHostname)])];
  await setList(COOKIE_KEY, merged);
}

export async function addSensorDomainsToStore(domains) {
  if (!domains || domains.length === 0) return;
  const current = await getList(SENSOR_KEY);
  const merged = [...new Set([...current, ...domains.map(normalizeHostname)])];
  await setList(SENSOR_KEY, merged);
}

// Used by the chrome.permissions.onRemoved listener in the background (prunes both lists).
export async function removeDomainsFromStore(domains) {
  if (!domains || domains.length === 0) return;
  const drop = new Set(domains.map(normalizeHostname));
  const current = await getList(COOKIE_KEY);
  await setList(COOKIE_KEY, current.filter((d) => !drop.has(d)));
}

export async function removeSensorDomainsFromStore(domains) {
  if (!domains || domains.length === 0) return;
  const drop = new Set(domains.map(normalizeHostname));
  const current = await getList(SENSOR_KEY);
  await setList(SENSOR_KEY, current.filter((d) => !drop.has(d)));
}

// Match patterns (for chrome.scripting.registerContentScripts) from redact domains whose
// host permission is actually granted. Used by the background.
export async function getSensorMatchPatterns() {
  const domains = await getList(SENSOR_KEY);
  const out = [];
  for (const d of domains) {
    if (await isDomainGranted(d)) out.push(...originsForDomain(d));
  }
  return out;
}

// --- Popup blocker (global) -------------------------------------------------
// Unlike the per-domain cookie/redact features, the popup blocker needs a GLOBAL host
// permission (*://*/*) because the document_start MAIN script must be injected on every
// site. State is kept separately (pbEnabled = master, pbConfig = settings + host lists).
export const PB_ENABLED_KEY = "pbEnabled";
export const PB_CONFIG_KEY = "pbConfig";
const GLOBAL_ORIGIN = "*://*/*";

// Default whitelist: common OAuth/payment hosts so login/checkout aren't disrupted by the
// default window.open block.
export const PB_DEFAULT_WHITELIST = [
  "accounts.google.com",
  "login.microsoftonline.com",
  "appleid.apple.com",
  "paypal.com",
  "checkout.stripe.com",
  "js.stripe.com",
  "github.com",
  "facebook.com",
  "x.com",
  "login.yahoo.com",
];

function defaultPbConfig() {
  return {
    strict: false, // false → only window.open is blocked; true → target=_blank clicks too
    allowSameOrigin: false,
    protocols: ["magnet:"],
    whitelistHosts: PB_DEFAULT_WHITELIST.slice(),
    disabledHosts: [],
  };
}

// Seeded on install (see background.js). Doesn't overwrite existing settings.
export async function seedPopblockDefaults() {
  const cur = await chrome.storage.local.get([PB_CONFIG_KEY]);
  if (cur[PB_CONFIG_KEY] === undefined) {
    await chrome.storage.local.set({ [PB_CONFIG_KEY]: defaultPbConfig() });
  }
}

export async function isGlobalGranted() {
  try {
    return await chrome.permissions.contains({ origins: [GLOBAL_ORIGIN] });
  } catch {
    return false;
  }
}

export async function isPbEnabled() {
  const r = await chrome.storage.local.get(PB_ENABLED_KEY);
  return r[PB_ENABLED_KEY] === true;
}

export async function setPbEnabled(on) {
  await chrome.storage.local.set({ [PB_ENABLED_KEY]: !!on });
}

export async function getPbConfig() {
  const r = await chrome.storage.local.get(PB_CONFIG_KEY);
  return { ...defaultPbConfig(), ...(r[PB_CONFIG_KEY] || {}) };
}

async function setPbConfig(cfg) {
  await chrome.storage.local.set({ [PB_CONFIG_KEY]: cfg });
}

// Toggle one boolean pbConfig flag (strict | allowSameOrigin).
export async function setPbFlag(key, value) {
  const cfg = await getPbConfig();
  cfg[key] = !!value;
  await setPbConfig(cfg);
}

async function addHostToPbList(listKey, host) {
  host = normalizeHostname(host);
  if (!host) return;
  const cfg = await getPbConfig();
  if (!cfg[listKey].includes(host)) cfg[listKey] = [...cfg[listKey], host];
  await setPbConfig(cfg);
}

async function removeHostFromPbList(listKey, host) {
  host = normalizeHostname(host);
  const cfg = await getPbConfig();
  cfg[listKey] = cfg[listKey].filter((h) => h !== host);
  await setPbConfig(cfg);
}

export const addPbWhitelistHost = (host) => addHostToPbList("whitelistHosts", host);
export const removePbWhitelistHost = (host) => removeHostFromPbList("whitelistHosts", host);
export const addPbDisabledHost = (host) => addHostToPbList("disabledHosts", host);
export const removePbDisabledHost = (host) => removeHostFromPbList("disabledHosts", host);

// Called by the "Enable popup blocker" button in the popup — MUST run in a direct user
// gesture (chrome.permissions.request requires it). pendingGrant type="popblock" so
// background.onAdded routes to setPbEnabled rather than the cookie/redact lists.
export async function enablePopblock() {
  markPendingGrant("popblock", "*");
  const granted = await chrome.permissions.request({ origins: [GLOBAL_ORIGIN] });
  if (!granted) {
    await clearPendingGrant();
    return false;
  }
  await setPbEnabled(true);
  return true;
}

// Turn off the popup blocker master. The global host permission is LEFT in place (it's
// shared; the user can revoke it manually in chrome://extensions if they want).
export async function disablePopblock() {
  await setPbEnabled(false);
}
