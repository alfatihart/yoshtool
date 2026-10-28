// sessions.js
// Phase 1 "Session Switcher" (swap model): store several named sessions/logins per site,
// then switch with one click. One active account per site at a time (not simultaneous
// per-tab isolation — that's Phase 2). Reuses cookies.js (serialization + cookie set/remove)
// and allowlist.js (host-permission gate). See docs/multi-session-plan.md.
//
// Pure parts (registrableDomain + data shapes) are tested with `node --test`; the parts
// that touch chrome.cookies call the already-tested helpers in cookies.js.

import { getCookiesForDomain, setCookie, removeCookie, buildCookieUrl } from "./cookies.js";
import { encryptJSON, decryptJSON, makeEncMeta, unlockKey } from "./sessioncrypto.js";

export const SESSIONS_KEY = "sessions";
export const ACTIVE_SESSION_KEY = "activeSession";
export const ENC_META_KEY = "sessionEnc";

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

// Normalize the storage object: { local, session, idb }.
// local/session are { key: value } maps; idb is an array of IndexedDB database snapshots
// (see captureIdbFromTab in popup.js) — included so SPA logins that keep their session in
// IndexedDB (e.g. Firebase Auth) are cloned too.
export function normStorage(storage) {
  const s = storage && typeof storage === "object" ? storage : {};
  return {
    local: s.local && typeof s.local === "object" ? s.local : {},
    session: s.session && typeof s.session === "object" ? s.session : {},
    idb: Array.isArray(s.idb) ? s.idb : [],
  };
}

// Count of stored items across localStorage + sessionStorage + all IndexedDB records.
// Kept in a session's clear-text metadata so the list shows it without decrypting.
export function storageItemCount(storage) {
  const s = normStorage(storage);
  let n = Object.keys(s.local).length + Object.keys(s.session).length;
  for (const db of s.idb) for (const store of db.stores || []) n += (store.records || []).length;
  return n;
}

export function makeSession(name, cookies, storage) {
  const list = Array.isArray(cookies) ? cookies : [];
  const st = normStorage(storage);
  return {
    id: "s_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: String(name || "Session"),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    count: list.length, // cookie count (clear-text metadata)
    scount: storageItemCount(st), // storage item count (clear-text metadata)
    cookies: list,
    // Many SPAs (e.g. Supabase Auth) store session tokens in localStorage/IndexedDB, not cookies.
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

// --- Encryption (opt-in) ----------------------------------------------------
// A session keeps its metadata (id/name/count/scount/dates) in clear text; only the
// sensitive payload { cookies, storage } is encrypted, into an `enc` field. The derived
// key lives only in the popup's memory after unlock — never persisted.

export async function getEncMeta() {
  const r = await chrome.storage.local.get(ENC_META_KEY);
  const m = r[ENC_META_KEY];
  return m && typeof m === "object" ? m : { enabled: false };
}
export async function isEncEnabled() {
  return (await getEncMeta()).enabled === true;
}

// Replace a session's clear { cookies, storage } with an encrypted `enc` blob.
async function packSession(sess, key) {
  const { cookies, storage, ...meta } = sess;
  const enc = await encryptJSON(key, { cookies: cookies || [], storage: normStorage(storage) });
  return { ...meta, enc };
}

// Return a session's { cookies, storage }, decrypting with `key` when the session is
// encrypted. Throws "locked" if an encrypted session is read without a key.
export async function getSessionPayload(sess, key) {
  if (sess && sess.enc) {
    if (!key) throw new Error("locked");
    return await decryptJSON(key, sess.enc);
  }
  return { cookies: (sess && sess.cookies) || [], storage: normStorage(sess && sess.storage) };
}

// Derive the key from a passphrase and verify it; returns a CryptoKey the popup caches.
export async function unlock(passphrase) {
  return unlockKey(passphrase, await getEncMeta());
}

// Turn encryption on: set a passphrase and re-encrypt every existing session.
export async function enableEncryption(passphrase) {
  const { meta, key } = await makeEncMeta(passphrase);
  const all = await getAllSessions();
  for (const dom of Object.keys(all)) {
    all[dom] = await Promise.all(all[dom].map((s) => (s.enc ? s : packSession(s, key))));
  }
  await setAllSessions(all);
  await chrome.storage.local.set({ [ENC_META_KEY]: meta });
  return key;
}

// Turn encryption off: verify the passphrase, decrypt every session back to clear text.
export async function disableEncryption(passphrase) {
  const key = await unlock(passphrase); // throws on wrong passphrase
  const all = await getAllSessions();
  for (const dom of Object.keys(all)) {
    all[dom] = await Promise.all(
      all[dom].map(async (s) => {
        if (!s.enc) return s;
        const { cookies, storage } = await decryptJSON(key, s.enc);
        const { enc, ...meta } = s;
        return { ...meta, cookies: cookies || [], storage: normStorage(storage) };
      }),
    );
  }
  await setAllSessions(all);
  await chrome.storage.local.set({ [ENC_META_KEY]: { enabled: false } });
}

// --- Save / update ----------------------------------------------------------
// `key` is required when encryption is enabled (the caller passes the cached key).

export async function saveSession(domain, name, cookies, storage, key) {
  const all = await getAllSessions();
  const list = all[domain] || [];
  let sess = makeSession(name, cookies, storage);
  if (key) sess = await packSession(sess, key);
  all[domain] = [sess, ...list];
  await setAllSessions(all);
  return sess;
}

export async function updateSessionData(domain, id, cookies, storage, key) {
  const all = await getAllSessions();
  const list = all[domain] || [];
  const idx = list.findIndex((x) => x.id === id);
  if (idx < 0) return;
  const old = list[idx];
  const st = normStorage(storage);
  const cs = Array.isArray(cookies) ? cookies : [];
  let fresh = {
    id: old.id,
    name: old.name,
    createdAt: old.createdAt,
    updatedAt: Date.now(),
    count: cs.length,
    scount: storageItemCount(st),
    cookies: cs,
    storage: st,
  };
  if (key) fresh = await packSession(fresh, key);
  list[idx] = fresh;
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
