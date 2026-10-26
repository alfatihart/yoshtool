// allowlist.js
// Mengelola dua daftar domain TERPISAH di chrome.storage.local:
//   - allowedDomains → izin fitur cookie (ekspor/impor).
//   - sensorDomains  → izin fitur auto-sensor realtime (mode privasi).
// Keduanya independen secara fungsional: domain yang hanya ada di sensorDomains
// TIDAK lolos isHostnameAllowed (cookie), dan sebaliknya. Tidak ada domain yang
// ditulis tetap di kode — daftar dikelola lewat tombol di popup (tab Allowlist),
// dan akses host sebenarnya didapat lewat chrome.permissions (dialog izin bawaan
// Chrome), bukan dari host_permissions statis di manifest.
//
// Izin host memang DIBAGI Chrome (satu origin = satu izin), tapi gerbang
// fungsional tetap daftar storage yang terpisah. Karena itu saat menghapus dari
// satu daftar, izin host hanya dicabut bila domain tidak dipakai daftar satunya.

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

// Dipanggil sekali saat instal (lihat background.js). Tidak dipanggil ulang setiap
// pembacaan, supaya daftar yang sengaja dikosongkan pengguna tidak terisi lagi.
export async function seedDefaultIfEmpty() {
  const current = await chrome.storage.local.get([COOKIE_KEY, SENSOR_ENABLED_KEY]);
  if (current[COOKIE_KEY] === undefined) {
    await setList(COOKIE_KEY, [DEFAULT_PLACEHOLDER_DOMAIN]);
  }
  // Master auto-sensor default ON (tapi tak ada domain sensor sampai pengguna menambah).
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

// Dipakai sebelum ekspor/impor cookie: hanya domain yang sudah TERDAFTAR di
// allowedDomains DAN punya izin host nyata yang dianggap diizinkan.
export async function isHostnameAllowed(hostname) {
  const domains = await getList(COOKIE_KEY);
  for (const domain of domains) {
    if (hostMatchesDomain(hostname, domain) && (await isDomainGranted(domain))) {
      return true;
    }
  }
  return false;
}

// Dipakai fitur auto-sensor: domain di sensorDomains DAN punya izin host nyata.
export async function isHostnameSensor(hostname) {
  const domains = await getList(SENSOR_KEY);
  for (const domain of domains) {
    if (hostMatchesDomain(hostname, domain) && (await isDomainGranted(domain))) {
      return true;
    }
  }
  return false;
}

// Master on/off auto-sensor. Default true bila belum pernah di-set.
export async function isSensorEnabled() {
  const r = await chrome.storage.local.get(SENSOR_ENABLED_KEY);
  return r[SENSOR_ENABLED_KEY] !== false;
}

export async function setSensorEnabled(on) {
  await chrome.storage.local.set({ [SENSOR_ENABLED_KEY]: !!on });
}

// --- Disambiguasi niat grant (pending-intent) -------------------------------
// Tombol "Izinkan" (cookie) maupun "Lindungi" (sensor) memanggil
// chrome.permissions.request yang memicu dialog izin & menutup popup. Listener
// chrome.permissions.onAdded di background yang menyimpan domain ke daftar yang
// benar — tapi dari pola origin saja ia tak tahu daftar MANA yang dimaksud.
// Karena itu kita catat niatnya lebih dulu (fire-and-forget, tanpa await agar
// user-gesture tak terputus) sebelum memanggil request.
function markPendingGrant(type, domain) {
  // sengaja tanpa await: menjaga gesture untuk chrome.permissions.request
  chrome.storage.local.set({ [PENDING_KEY]: { type, domain, at: Date.now() } });
}

export async function readPendingGrant() {
  const r = await chrome.storage.local.get(PENDING_KEY);
  return r[PENDING_KEY] || null;
}

export async function clearPendingGrant() {
  await chrome.storage.local.remove(PENDING_KEY);
}

// Dipanggil dari klik tombol "Izinkan domain tab ini" (cookie) di popup — harus
// dalam konteks user gesture langsung (chrome.permissions.request mensyaratkannya).
export async function addDomainForHostname(hostname) {
  const domain = normalizeHostname(hostname);
  if (!domain) return false;
  markPendingGrant("cookie", domain);
  const granted = await chrome.permissions.request({ origins: originsForDomain(domain) });
  if (!granted) {
    await clearPendingGrant();
    return false;
  }
  // Idempotent: biasanya background onAdded yang menulis; ini jaga-jaga bila popup
  // tetap terbuka saat dialog disetujui.
  await addDomainsToStore([domain]);
  return true;
}

// Dipanggil dari tombol "Lindungi domain tab ini" (auto-sensor) di popup.
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
  // Lepas izin host hanya bila domain tak dipakai daftar sensor (izin host dibagi).
  const sensor = await getList(SENSOR_KEY);
  if (!sensor.includes(domain)) {
    await chrome.permissions.remove({ origins: originsForDomain(domain) });
  }
  const domains = await getList(COOKIE_KEY);
  await setList(COOKIE_KEY, domains.filter((d) => d !== domain));
}

export async function removeSensorDomain(domain) {
  domain = normalizeHostname(domain);
  // Lepas izin host hanya bila domain tak dipakai daftar cookie.
  const cookie = await getList(COOKIE_KEY);
  if (!cookie.includes(domain)) {
    await chrome.permissions.remove({ origins: originsForDomain(domain) });
  }
  const domains = await getList(SENSOR_KEY);
  await setList(SENSOR_KEY, domains.filter((d) => d !== domain));
}

// Menurunkan nama domain dari pola origin yang di-grant/di-revoke Chrome,
// mis. "*://*.fly.web.id/*" dan "*://fly.web.id/*" → "fly.web.id".
export function domainsFromOrigins(origins) {
  const set = new Set();
  for (const origin of origins || []) {
    const match = String(origin).match(/^\*:\/\/(?:\*\.)?([^/]+)\/\*$/);
    if (match) set.add(normalizeHostname(match[1]));
  }
  return [...set];
}

// Dipakai listener chrome.permissions.onAdded di background: menyimpan domain ke
// daftar cookie TANPA bergantung pada popup yang sudah tertutup saat dialog muncul.
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

// Dipakai listener chrome.permissions.onRemoved di background (mem-prune keduanya).
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

// Pola match (untuk chrome.scripting.registerContentScripts) dari domain sensor
// yang izin host-nya sudah benar-benar di-grant. Dipakai background.
export async function getSensorMatchPatterns() {
  const domains = await getList(SENSOR_KEY);
  const out = [];
  for (const d of domains) {
    if (await isDomainGranted(d)) out.push(...originsForDomain(d));
  }
  return out;
}
