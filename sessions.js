// sessions.js
// Fase 1 "Session Switcher" (model swap): simpan beberapa sesi/login bernama per situs,
// lalu beralih satu-klik. Satu akun aktif per situs pada satu waktu (bukan isolasi per-tab
// simultan — itu Fase 2). Reuse cookies.js (serialisasi + set/remove cookie) & allowlist.js
// (gate izin host). Lihat docs/multi-session-plan.md.
//
// Bagian murni (registrableDomain + bentuk data) diuji lewat `node --test`; bagian yang
// menyentuh chrome.cookies memanggil helper cookies.js yang sudah teruji.

import { getCookiesForDomain, setCookie, removeCookie, buildCookieUrl } from "./cookies.js";

export const SESSIONS_KEY = "sessions";
export const ACTIVE_SESSION_KEY = "activeSession";

// Suffix dua-level yang umum (eTLD majemuk), termasuk domain Indonesia. Dipakai
// `registrableDomain()` untuk menurunkan eTLD+1. CATATAN: UI Sessions default memakai
// HOSTNAME PENUH tab (konsisten dgn Export/Import & allowlist), bukan eTLD+1, karena izin
// host & allowlist diberikan per hostname — registrable yang lebih luas belum tentu
// diizinkan. `registrableDomain()` disediakan sebagai utilitas (mis. untuk saran scope
// lebih luas), bukan default. Heuristik — tak selengkap Public Suffix List.
const TWO_LEVEL_SUFFIXES = new Set([
  // Indonesia
  "co.id", "web.id", "or.id", "ac.id", "go.id", "my.id", "sch.id", "biz.id",
  "desa.id", "net.id", "mil.id", "ponpes.id",
  // umum
  "co.uk", "org.uk", "gov.uk", "ac.uk", "me.uk", "ltd.uk", "plc.uk",
  "com.au", "net.au", "org.au", "edu.au", "gov.au",
  "co.jp", "or.jp", "ne.jp", "ac.jp", "go.jp",
  "co.nz", "com.br", "com.sg", "com.my", "co.in", "com.cn", "com.tr",
  "com.mx", "co.za", "co.kr", "com.ua", "com.vn", "co.th", "com.ph", "com.hk",
]);

export function registrableDomain(hostname) {
  hostname = String(hostname || "").trim().toLowerCase().replace(/\.+$/, "");
  if (!hostname) return "";
  // IP literal (v4/v6) atau host tanpa titik → apa adanya.
  if (hostname.includes(":")) return hostname; // IPv6
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return hostname; // IPv4
  const labels = hostname.split(".");
  if (labels.length <= 2) return hostname;
  const last2 = labels.slice(-2).join(".");
  if (TWO_LEVEL_SUFFIXES.has(last2)) return labels.slice(-3).join(".");
  return labels.slice(-2).join(".");
}

// Normalisasi objek storage: { local: {k:v}, session: {k:v} }.
function normStorage(storage) {
  const s = storage && typeof storage === "object" ? storage : {};
  return {
    local: s.local && typeof s.local === "object" ? s.local : {},
    session: s.session && typeof s.session === "object" ? s.session : {},
  };
}

export function makeSession(name, cookies, storage) {
  const list = Array.isArray(cookies) ? cookies : [];
  const st = normStorage(storage);
  return {
    id: "s_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: String(name || "Sesi"),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    count: list.length,
    cookies: list,
    // Banyak SPA (mis. Supabase Auth) menyimpan token sesi di localStorage, bukan cookie.
    storage: st,
  };
}

// --- Storage ----------------------------------------------------------------

async function getAllSessions() {
  const r = await chrome.storage.local.get(SESSIONS_KEY);
  return (r[SESSIONS_KEY] && typeof r[SESSIONS_KEY] === "object") ? r[SESSIONS_KEY] : {};
}
async function setAllSessions(obj) {
  await chrome.storage.local.set({ [SESSIONS_KEY]: obj });
}

export async function listSessions(domain) {
  const all = await getAllSessions();
  return all[domain] || [];
}

export async function saveSession(domain, name, cookies, storage) {
  const all = await getAllSessions();
  const list = all[domain] || [];
  const sess = makeSession(name, cookies, storage);
  all[domain] = [sess, ...list];
  await setAllSessions(all);
  return sess;
}

export async function updateSessionData(domain, id, cookies, storage) {
  const all = await getAllSessions();
  const s = (all[domain] || []).find((x) => x.id === id);
  if (!s) return;
  s.cookies = Array.isArray(cookies) ? cookies : [];
  s.count = s.cookies.length;
  s.storage = normStorage(storage);
  s.updatedAt = Date.now();
  await setAllSessions(all);
}

export async function renameSession(domain, id, name) {
  const all = await getAllSessions();
  const s = (all[domain] || []).find((x) => x.id === id);
  if (!s) return;
  s.name = String(name || s.name);
  s.updatedAt = Date.now();
  await setAllSessions(all);
}

export async function deleteSession(domain, id) {
  const all = await getAllSessions();
  all[domain] = (all[domain] || []).filter((x) => x.id !== id);
  if (all[domain].length === 0) delete all[domain];
  await setAllSessions(all);
  if ((await getActiveSession(domain)) === id) await setActiveSession(domain, null);
}

export async function getActiveSession(domain) {
  const r = await chrome.storage.local.get(ACTIVE_SESSION_KEY);
  return (r[ACTIVE_SESSION_KEY] || {})[domain] || null;
}

export async function setActiveSession(domain, id) {
  const r = await chrome.storage.local.get(ACTIVE_SESSION_KEY);
  const m = r[ACTIVE_SESSION_KEY] && typeof r[ACTIVE_SESSION_KEY] === "object" ? r[ACTIVE_SESSION_KEY] : {};
  if (id) m[domain] = id;
  else delete m[domain];
  await chrome.storage.local.set({ [ACTIVE_SESSION_KEY]: m });
}

// --- chrome.cookies (reuse cookies.js) --------------------------------------

// Snapshot cookie situs saat ini (registrable domain + semua subdomain, karena
// chrome.cookies.getAll({domain}) mencocokkan domain itu & subdomainnya).
export async function captureCurrent(domain, storeId) {
  return getCookiesForDomain(domain, storeId);
}

// Terapkan sesi: hapus cookie situs saat ini, lalu tulis cookie sesi target.
// Mengembalikan { set, failed } untuk dilaporkan ke pengguna.
export async function applySession(domain, cookies, storeId) {
  const current = await getCookiesForDomain(domain, storeId);
  for (const c of current) {
    try {
      await removeCookie(c, buildCookieUrl(c, domain), storeId);
    } catch (e) {
      /* lanjut */
    }
  }
  const target = Array.isArray(cookies) ? cookies : [];
  const failed = [];
  for (const c of target) {
    try {
      await setCookie(c, buildCookieUrl(c, domain), storeId);
    } catch (e) {
      failed.push(c.name);
    }
  }
  return { set: target.length - failed.length, failed };
}
