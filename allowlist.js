// allowlist.js
// Mengelola daftar domain yang diizinkan untuk fitur cookie, disimpan di chrome.storage.local.
// Tidak ada domain yang ditulis tetap di kode — daftar dikelola lewat tombol di popup (tab Allowlist),
// dan akses host sebenarnya didapat lewat chrome.permissions (dialog izin bawaan Chrome),
// bukan dari host_permissions statis di manifest.

const STORAGE_KEY = "allowedDomains";
export const DEFAULT_PLACEHOLDER_DOMAIN = "example.com";

export async function getStoredDomains() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const list = result[STORAGE_KEY];
  return Array.isArray(list) ? list : [];
}

async function setStoredDomains(list) {
  await chrome.storage.local.set({ [STORAGE_KEY]: list });
}

// Dipanggil sekali saat instal (lihat background.js). Tidak dipanggil ulang setiap
// pembacaan, supaya daftar yang sengaja dikosongkan pengguna tidak terisi lagi.
export async function seedDefaultIfEmpty() {
  const current = await chrome.storage.local.get(STORAGE_KEY);
  if (current[STORAGE_KEY] === undefined) {
    await setStoredDomains([DEFAULT_PLACEHOLDER_DOMAIN]);
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
  const domains = await getStoredDomains();
  return Promise.all(
    domains.map(async (domain) => ({ domain, active: await isDomainGranted(domain) })),
  );
}

// Dipakai sebelum ekspor/impor cookie: hanya domain yang sudah TERDAFTAR dan TERDAPAT
// izin host nyata (sudah di-grant lewat dialog Chrome) yang dianggap diizinkan.
export async function isHostnameAllowed(hostname) {
  const domains = await getStoredDomains();
  for (const domain of domains) {
    if (hostMatchesDomain(hostname, domain) && (await isDomainGranted(domain))) {
      return true;
    }
  }
  return false;
}

// Dipanggil dari klik tombol "Izinkan domain tab ini" di popup (harus dalam konteks
// user gesture langsung, karena chrome.permissions.request mensyaratkannya).
export async function addDomainForHostname(hostname) {
  const domain = normalizeHostname(hostname);
  if (!domain) return false;
  const granted = await chrome.permissions.request({ origins: originsForDomain(domain) });
  if (!granted) return false;
  const domains = await getStoredDomains();
  if (!domains.includes(domain)) {
    await setStoredDomains([...domains, domain]);
  }
  return true;
}

export async function removeDomain(domain) {
  domain = normalizeHostname(domain);
  await chrome.permissions.remove({ origins: originsForDomain(domain) });
  const domains = await getStoredDomains();
  await setStoredDomains(domains.filter((d) => d !== domain));
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
// allowlist TANPA bergantung pada popup yang sudah tertutup saat dialog izin muncul.
export async function addDomainsToStore(domains) {
  if (!domains || domains.length === 0) return;
  const current = await getStoredDomains();
  const merged = [...new Set([...current, ...domains.map(normalizeHostname)])];
  await setStoredDomains(merged);
}

// Dipakai listener chrome.permissions.onRemoved di background.
export async function removeDomainsFromStore(domains) {
  if (!domains || domains.length === 0) return;
  const drop = new Set(domains.map(normalizeHostname));
  const current = await getStoredDomains();
  await setStoredDomains(current.filter((d) => !drop.has(d)));
}
