// sessions.js
// Phase 1 "Session Switcher" (swap model): store several named sessions/logins per site,
// then switch with one click. One active account per site at a time (not simultaneous
// per-tab isolation — that's Phase 2). Reuses cookies.js (serialization + cookie set/remove)
// and allowlist.js (host-permission gate). See docs/multi-session-plan.md.
//
// Pure parts (registrableDomain + data shapes) are tested with `node --test`; the parts
// that touch chrome.cookies call the already-tested helpers in cookies.js.

import { getCookiesForDomain, setCookie, removeCookie, buildCookieUrl } from "./cookies.js";

export const SESSIONS_KEY = "sessions";
export const ACTIVE_SESSION_KEY = "activeSession";

// Common two-level suffixes (compound eTLDs), including Indonesian domains. Used by
// `registrableDomain()` to derive the eTLD+1. NOTE: the Sessions UI defaults to the tab's
// FULL HOSTNAME (consistent with Export/Import & the allowlist), not the eTLD+1, because
// host permissions and the allowlist are granted per hostname — a broader registrable
// domain isn't necessarily allowed. `registrableDomain()` is offered as a utility (e.g. to
// suggest a wider scope), not the default. A heuristic — less complete than the Public
// Suffix List.
const TWO_LEVEL_SUFFIXES = new Set([
  // Indonesia
  "co.id", "web.id", "or.id", "ac.id", "go.id", "my.id", "sch.id", "biz.id",
  "desa.id", "net.id", "mil.id", "ponpes.id",
  // common
  "co.uk", "org.uk", "gov.uk", "ac.uk", "me.uk", "ltd.uk", "plc.uk",
  "com.au", "net.au", "org.au", "edu.au", "gov.au",
  "co.jp", "or.jp", "ne.jp", "ac.jp", "go.jp",
  "co.nz", "com.br", "com.sg", "com.my", "co.in", "com.cn", "com.tr",
  "com.mx", "co.za", "co.kr", "com.ua", "com.vn", "co.th", "com.ph", "com.hk",
]);

export function registrableDomain(hostname) {
  hostname = String(hostname || "").trim().toLowerCase().replace(/\.+$/, "");
  if (!hostname) return "";
  // IP literal (v4/v6) or a dotless host → as-is.
  if (hostname.includes(":")) return hostname; // IPv6
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return hostname; // IPv4
  const labels = hostname.split(".");
  if (labels.length <= 2) return hostname;
  const last2 = labels.slice(-2).join(".");
  if (TWO_LEVEL_SUFFIXES.has(last2)) return labels.slice(-3).join(".");
  return labels.slice(-2).join(".");
}

// Normalize the storage object: { local: {k:v}, session: {k:v} }.
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
    name: String(name || "Session"),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    count: list.length,
    cookies: list,
    // Many SPAs (e.g. Supabase Auth) store session tokens in localStorage, not cookies.
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

// Snapshot the current site's cookies (registrable domain + all subdomains, since
// chrome.cookies.getAll({domain}) matches that domain and its subdomains).
export async function captureCurrent(domain, storeId) {
  return getCookiesForDomain(domain, storeId);
}

// Apply a session: clear the current site's cookies, then write the target session's.
// Returns { set, failed } to report back to the user.
export async function applySession(domain, cookies, storeId) {
  const current = await getCookiesForDomain(domain, storeId);
  for (const c of current) {
    try {
      await removeCookie(c, buildCookieUrl(c, domain), storeId);
    } catch (e) {
      /* continue */
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
