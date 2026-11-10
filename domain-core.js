// domain-core.js
// Pure parsers/formatters for the Domain checker — RDAP (registrar + dates), DNS-over-HTTPS answers,
// HTTP security-header grade, and a popularity rank. No chrome.*/DOM → Node-tested, imported by the
// background service worker (which does the fetches). Live network isn't needed to test these: they
// take the documented JSON/header shapes and reduce them to what the popup shows.
//
// Honest scope: DA/PA are Moz-proprietary and paid — not here. The free stand-ins are a popularity
// rank (Tranco) and, with a user-supplied key, Open PageRank (0–10). RDAP/DNS/headers are free & keyless.

// ---- RDAP (domain registration) --------------------------------------------
function findRegistrar(entities) {
  for (const e of entities || []) {
    const roles = (e && e.roles) || [];
    if (roles.includes("registrar")) {
      const vcard = e.vcardArray && e.vcardArray[1];
      if (Array.isArray(vcard)) {
        const fn = vcard.find((r) => Array.isArray(r) && r[0] === "fn");
        if (fn && fn[3]) return String(fn[3]);
      }
      if (e.handle) return String(e.handle);
    }
    if (e && Array.isArray(e.entities)) {
      const r = findRegistrar(e.entities);
      if (r) return r;
    }
  }
  return "";
}
export function parseRdap(json) {
  if (!json || typeof json !== "object") return null;
  const events = Array.isArray(json.events) ? json.events : [];
  const ev = (action) => {
    const e = events.find((x) => x && String(x.eventAction).toLowerCase() === action);
    return e ? e.eventDate : null;
  };
  return {
    domain: json.ldhName || json.unicodeName || "",
    registrar: findRegistrar(json.entities),
    created: ev("registration"),
    expires: ev("expiration"),
    updated: ev("last changed"),
    status: Array.isArray(json.status) ? json.status : [],
    nameservers: (Array.isArray(json.nameservers) ? json.nameservers : [])
      .map((n) => n && (n.ldhName || n.unicodeName))
      .filter(Boolean),
  };
}

// ---- DNS-over-HTTPS (dns.google / cloudflare-dns.com JSON) ------------------
const DNS_TYPES = { 1: "A", 2: "NS", 5: "CNAME", 6: "SOA", 15: "MX", 16: "TXT", 28: "AAAA", 33: "SRV", 257: "CAA" };
export function parseDohAnswers(json) {
  const ans = json && Array.isArray(json.Answer) ? json.Answer : [];
  return ans.map((a) => ({ type: DNS_TYPES[a.type] || String(a.type), data: String(a.data || "").replace(/^"|"$/g, ""), ttl: a.TTL }));
}

// ---- HTTP security headers → graded checklist ------------------------------
const SEC_HEADERS = [
  ["strict-transport-security", "HSTS"],
  ["content-security-policy", "Content-Security-Policy"],
  ["x-frame-options", "X-Frame-Options"],
  ["x-content-type-options", "X-Content-Type-Options"],
  ["referrer-policy", "Referrer-Policy"],
  ["permissions-policy", "Permissions-Policy"],
];
export function summarizeSecurityHeaders(headers) {
  const h = headers || {};
  const get = (k) => (Array.isArray(h[k]) ? h[k][0] : h[k]) || "";
  const items = SEC_HEADERS.map(([k, label]) => ({ key: k, label, present: !!get(k), value: get(k) }));
  const present = items.filter((i) => i.present).length;
  const grade = ["F", "E", "D", "C", "B", "A", "A+"][present] || "F";
  return { items, present, total: SEC_HEADERS.length, grade };
}

// ---- popularity rank -------------------------------------------------------
export function parseTranco(json) {
  if (!json) return null;
  if (typeof json.rank === "number") return json.rank;
  if (Array.isArray(json.ranks) && json.ranks.length) {
    const last = json.ranks[json.ranks.length - 1];
    return last && typeof last.rank === "number" ? last.rank : null;
  }
  return null;
}
// Open PageRank: data[0].page_rank_integer (0–10) + rank (global). Needs a free key at fetch time.
export function parseOpenPageRank(json) {
  const d = json && Array.isArray(json.response) ? json.response[0] : null;
  if (!d || d.status_code !== 200) return null;
  return { score: typeof d.page_rank_integer === "number" ? d.page_rank_integer : null, rank: d.rank ? parseInt(d.rank, 10) : null };
}

// ---- formatters ------------------------------------------------------------
export function fmtDate(iso) {
  if (!iso) return "—";
  const t = Date.parse(iso);
  return Number.isNaN(t) ? String(iso) : new Date(t).toISOString().slice(0, 10);
}
function daysToStr(days) {
  const y = Math.floor(days / 365);
  const mo = Math.floor((days % 365) / 30);
  if (y > 0) return y + "y" + (mo > 0 ? " " + mo + "mo" : "");
  if (mo > 0) return mo + "mo";
  return days + "d";
}
export function ageString(iso, now = Date.now()) {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const days = Math.floor((now - t) / 86400000);
  return days < 0 ? "in " + daysToStr(-days) : daysToStr(days) + " ago";
}
