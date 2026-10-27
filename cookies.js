// cookies.js
// Cookie parsing, serialization, and utilities for three formats: JSON, Header String, and Netscape.
// Functions here are pure (no chrome.* calls) except setCookie/removeCookie/getCookiesForDomain,
// so the parsing/serialization logic is easy to test with `node --test`.

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
      throw new Error(`Unknown format: ${format}`);
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
    // The #HttpOnly_ prefix replaces the domain column, per the Netscape file convention.
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
      throw new Error(`Unknown format: ${format}`);
  }
}

function parseJson(text) {
  const data = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error("JSON must be an array of cookies");
  return data;
}

function parseHeader(text) {
  return text
    .split(";")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const idx = pair.indexOf("=");
      if (idx === -1) throw new Error(`Invalid pair: "${pair}"`);
      return {
        name: pair.slice(0, idx).trim(),
        value: pair.slice(idx + 1).trim(),
        // Header strings carry no domain; it's filled from the active tab on import.
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
    if (line.startsWith("#") && !line.startsWith("#HttpOnly_")) continue; // ordinary comment
    const cols = line.split("\t");
    if (cols.length < 7) continue; // malformed line, skip
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

// ---------- Per-entry validation ----------

export function validateCookie(cookie) {
  if (!cookie || typeof cookie !== "object") return "Entry is not an object";
  if (!cookie.name) return "Cookie name is empty";
  if (cookie.value === undefined || cookie.value === null) return "Cookie value is empty";
  return null;
}

// ---------- chrome.cookies helpers ----------

export function buildCookieUrl(cookie, fallbackHostname) {
  const hostname = hostnameFromCookie(cookie) || fallbackHostname;
  if (!hostname) throw new Error("No domain available to build the cookie URL");
  // __Secure-/__Host- prefixed cookies MUST be set over https:// (Chrome rule).
  // Header String format carries no `secure` flag, so without forcing it here the URL
  // would be http:// and Chrome rejects those prefixed cookies ("Failed to parse or set").
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

  // Chrome enforces strict rules for cookies with certain prefixes.
  if (cookie.name.startsWith("__Host-")) {
    details.secure = true;
    details.path = "/";
    // For __Host-, the domain must not be included at all.
  } else if (!cookie.hostOnly) {
    // Include the domain only when the cookie is genuinely not host-only.
    // Fixes an earlier version that always included the domain even for
    // host-only cookies, giving them the wrong scope.
    if (cookie.domain) details.domain = cookie.domain;
  }

  if (cookie.name.startsWith("__Secure-")) {
    details.secure = true;
  }

  if (cookie.sameSite && cookie.sameSite !== "unspecified") {
    details.sameSite = cookie.sameSite;
  }
  if (cookie.expirationDate) details.expirationDate = cookie.expirationDate;
  // The TARGET storeId is set explicitly by the caller (from the active tab), NOT taken
  // from the source cookie's storeId. Cookies exported from a normal profile carry storeId
  // "0"; using that when importing in incognito lands them in the normal store and the
  // session isn't cloned. An explicit target storeId guarantees the cookies go into the
  // same store as the tab about to open.
  if (storeId) details.storeId = storeId;
  if (cookie.partitionKey) details.partitionKey = cookie.partitionKey;

  return details;
}

export async function setCookie(cookie, url, storeId) {
  try {
    return await chrome.cookies.set(toSetDetails(cookie, url, storeId));
  } catch (err) {
    console.error("Failed to set cookie:", cookie.name, err);
    throw err; // re-thrown so the caller can surface the failure reason to the user
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

// Resolves a tab's cookie store ID (e.g. the incognito store) so cookie set/remove targets
// the correct store instead of relying on the caller's context.
export async function getStoreIdForTab(tabId) {
  try {
    const stores = await chrome.cookies.getAllCookieStores();
    const store = stores.find((s) => Array.isArray(s.tabIds) && s.tabIds.includes(tabId));
    return store ? store.id : undefined;
  } catch {
    return undefined;
  }
}

// Resolves a cookie's target domain, falling back to the active tab's hostname when the
// cookie carries no domain of its own (Header format). Used on import so the domain comes
// from the cookie data itself (JSON/Netscape already carry it) rather than always from the
// active tab — important when importing into a fresh tab or empty Incognito window not yet
// navigated to its target site.
export function resolveCookieHostname(cookie, fallbackHostname) {
  return hostnameFromCookie(cookie) || fallbackHostname || "";
}
