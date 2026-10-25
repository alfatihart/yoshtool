// cookies.js
// Parsing, serialisasi, dan util cookie untuk tiga format: JSON, Header String, dan Netscape.
// Fungsi di sini murni (tidak menyentuh chrome.*) kecuali setCookie/removeCookie/getCookiesForDomain,
// supaya bagian parsing/serialisasi mudah diuji lewat `node --test`.

export const FORMATS = ["json", "header", "netscape"];

function hostnameFromCookie(cookie) {
  if (!cookie.domain) return "";
  return cookie.domain.startsWith(".") ? cookie.domain.slice(1) : cookie.domain;
}

// ---------- Serialize ----------

export function serialize(cookies, format) {
  switch (format) {
    case "json":
      return JSON.stringify(cookies, null, 2);
    case "header":
      return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    case "netscape":
      return serializeNetscape(cookies);
    default:
      throw new Error(`Format tidak dikenal: ${format}`);
  }
}

function serializeNetscape(cookies) {
  const lines = ["# Netscape HTTP Cookie File"];
  for (const c of cookies) {
    const domain = c.domain || "";
    const includeSubdomains = domain.startsWith(".") ? "TRUE" : "FALSE";
    const path = c.path || "/";
    const secure = c.secure ? "TRUE" : "FALSE";
    const expiry = c.expirationDate ? Math.round(c.expirationDate) : 0;
    // Prefix #HttpOnly_ menggantikan kolom domain, sesuai konvensi file Netscape.
    const domainField = c.httpOnly ? `#HttpOnly_${domain}` : domain;
    lines.push([domainField, includeSubdomains, path, secure, expiry, c.name, c.value].join("\t"));
  }
  return lines.join("\n");
}

// ---------- Detect ----------

export function detectFormat(text) {
  const trimmed = text.trim();
  if (!trimmed) return "json";
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) return "json";
  if (trimmed.includes("\t") || trimmed.startsWith("# Netscape")) return "netscape";
  return "header";
}

// ---------- Parse ----------

export function parse(text, format = detectFormat(text)) {
  switch (format) {
    case "json":
      return parseJson(text);
    case "header":
      return parseHeader(text);
    case "netscape":
      return parseNetscape(text);
    default:
      throw new Error(`Format tidak dikenal: ${format}`);
  }
}

function parseJson(text) {
  const data = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error("JSON harus berupa array cookie");
  return data;
}

function parseHeader(text) {
  return text
    .split(";")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const idx = pair.indexOf("=");
      if (idx === -1) throw new Error(`Pasangan tidak valid: "${pair}"`);
      return {
        name: pair.slice(0, idx).trim(),
        value: pair.slice(idx + 1).trim(),
        // Header string tidak memuat domain; diisi dari tab aktif saat import.
        domain: "",
        path: "/",
      };
    });
}

function parseNetscape(text) {
  const cookies = [];
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith("# Netscape")) continue;
    if (line.startsWith("#") && !line.startsWith("#HttpOnly_")) continue; // komentar biasa
    const cols = line.split("\t");
    if (cols.length < 7) continue; // baris rusak, lewati
    const [domainField, , path, secureStr, expiryStr, name, value] = cols;
    const httpOnly = domainField.startsWith("#HttpOnly_");
    const domain = httpOnly ? domainField.slice("#HttpOnly_".length) : domainField;
    const expiry = Number(expiryStr);
    cookies.push({
      domain,
      path: path || "/",
      secure: secureStr === "TRUE",
      httpOnly,
      name,
      value,
      ...(expiry > 0 ? { expirationDate: expiry } : {}),
    });
  }
  return cookies;
}

// ---------- Validasi per entri ----------

export function validateCookie(cookie) {
  if (!cookie || typeof cookie !== "object") return "Entri bukan objek";
  if (!cookie.name) return "Nama cookie kosong";
  if (cookie.value === undefined || cookie.value === null) return "Value cookie kosong";
  return null;
}

// ---------- Helper untuk chrome.cookies ----------

export function buildCookieUrl(cookie, fallbackHostname) {
  const hostname = hostnameFromCookie(cookie) || fallbackHostname;
  if (!hostname) throw new Error("Tidak ada domain untuk membangun URL cookie");
  // Cookie berprefix __Secure-/__Host- WAJIB di-set lewat https:// (aturan Chrome).
  // Format Header String tidak membawa flag `secure`, jadi tanpa paksaan ini URL-nya
  // jadi http:// dan Chrome menolak cookie prefix tersebut ("Failed to parse or set").
  const name = cookie.name || "";
  const mustBeSecure =
    cookie.secure || name.startsWith("__Secure-") || name.startsWith("__Host-");
  const protocol = mustBeSecure ? "https://" : "http://";
  return protocol + hostname + (cookie.path || "/");
}

export function toSetDetails(cookie, url, storeId) {
  const details = {
    url,
    name: cookie.name,
    value: cookie.value,
    path: cookie.path || "/",
    secure: !!cookie.secure,
    httpOnly: !!cookie.httpOnly,
  };

  // Google Chrome punya aturan ketat untuk cookie dengan prefix tertentu.
  if (cookie.name.startsWith("__Host-")) {
    details.secure = true;
    details.path = "/";
    // Untuk __Host-, domain tidak boleh disertakan sama sekali.
  } else if (!cookie.hostOnly) {
    // Sertakan domain hanya bila cookie memang bukan host-only.
    // Perbaikan dari versi sebelumnya, yang selalu menyertakan domain
    // walau cookie-nya hostOnly, sehingga cakupannya jadi tidak sesuai.
    if (cookie.domain) details.domain = cookie.domain;
  }

  if (cookie.name.startsWith("__Secure-")) {
    details.secure = true;
  }

  if (cookie.sameSite && cookie.sameSite !== "unspecified") {
    details.sameSite = cookie.sameSite;
  }
  if (cookie.expirationDate) details.expirationDate = cookie.expirationDate;
  // storeId TARGET ditentukan eksplisit oleh pemanggil (dari tab aktif), BUKAN diambil
  // dari storeId cookie asal. Cookie hasil ekspor profil normal ber-storeId "0"; kalau
  // itu yang dipakai saat import di incognito, cookie masuk ke store normal dan sesi
  // tidak ter-clone. Dengan storeId target eksplisit, cookie dijamin masuk ke store yang
  // sama dengan tab yang akan dibuka.
  if (storeId) details.storeId = storeId;
  if (cookie.partitionKey) details.partitionKey = cookie.partitionKey;

  return details;
}

export async function setCookie(cookie, url, storeId) {
  try {
    return await chrome.cookies.set(toSetDetails(cookie, url, storeId));
  } catch (err) {
    console.error("Gagal mengatur cookie:", cookie.name, err);
    throw err; // dilempar agar pemanggil bisa menampilkan alasan gagal ke pengguna
  }
}

export async function removeCookie(cookie, url, storeId) {
  const details = { url, name: cookie.name };
  if (storeId) details.storeId = storeId;
  return await chrome.cookies.remove(details);
}

export async function getCookiesForDomain(domain, storeId) {
  const query = { domain };
  if (storeId) query.storeId = storeId;
  return await chrome.cookies.getAll(query);
}

// Menentukan ID cookie store milik sebuah tab (mis. store incognito), supaya set/remove
// cookie dijamin mengenai store yang benar alih-alih bergantung pada konteks pemanggil.
export async function getStoreIdForTab(tabId) {
  try {
    const stores = await chrome.cookies.getAllCookieStores();
    const store = stores.find((s) => Array.isArray(s.tabIds) && s.tabIds.includes(tabId));
    return store ? store.id : undefined;
  } catch {
    return undefined;
  }
}

// Menentukan domain target satu cookie, dengan fallback ke hostname tab aktif bila
// cookie tidak membawa domainnya sendiri (format Header). Dipakai saat import supaya
// domain diambil dari data cookie itu sendiri (JSON/Netscape sudah membawa domain),
// bukan wajib dari tab aktif — penting untuk import di tab baru/Incognito kosong
// yang belum dibuka ke situs targetnya.
export function resolveCookieHostname(cookie, fallbackHostname) {
  return hostnameFromCookie(cookie) || fallbackHostname || "";
}
