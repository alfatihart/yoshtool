// popblock-core.js
// Logika keputusan popup blocker — MURNI (tanpa DOM / chrome.*), supaya bisa diuji
// di Node dan dipakai ulang sebagai salinan inline di popblock-isolated.js.
//
// Port setia dari `blocker.policy` milik "Popup Blocker (strict)" v0.9.4
// (schomery/popup-blocker, MPL-2.0), dengan satu penyesuaian sadar untuk YoshTool:
// jalur KLIK/submit (target=_blank dsb.) hanya diblok saat `cfg.strict` aktif.
// Ekstensi asli selalu memblok semua target=_blank (karena itu disebut "strict");
// default YoshTool lebih lunak — hanya window.open programatik yang diblok, agar
// navigasi klik-pengguna biasa tidak terganggu. Aktifkan "Strict" untuk meniru asli.
//
// request = {
//   type,            // "window.open" | "element.click" | "dynamic.a.click" | ...
//   href,            // untuk window.open: arg URL; sudah di-resolve ke absolut oleh pemanggil
//   target, download, tag,
//   hasAnchor,       // element.click: apakah ada <a>/[target] terkait
//   hasBase,         // element.click/dynamic: hasil cek <base target> (default true)
//   metaKey, button, isTrusted, defaultPrevented
// }
// cfg = { strict, allowSameOrigin, protocols:[], whitelist:[], topHost }

export function parseUrl(href) {
  try {
    return new URL(href);
  } catch {
    return null;
  }
}

export function hostnameOf(href) {
  const u = parseUrl(href);
  return u ? (u.hostname || "").toLowerCase() : "";
}

// Cocokkan host terhadap satu entri (sama atau subdomain, DUA arah) — persis seperti
// pengecekan whitelist & same-domain di ekstensi asli.
export function hostMatches(hostname, entry) {
  hostname = String(hostname || "").toLowerCase();
  entry = String(entry || "").toLowerCase();
  if (!hostname || !entry) return false;
  return (
    hostname === entry ||
    hostname.endsWith("." + entry) ||
    entry.endsWith("." + hostname)
  );
}

export function shouldBlockPopup(request, cfg = {}) {
  const type = request.type || "";
  const href = request.href || "";
  let hostname = "";
  let block = true;
  let sameContext = false;

  if (type === "window.open") {
    // window.open selalu kandidat blok (nilai inti blocker).
    sameContext = true;
  } else {
    // Jalur klik / submit / dispatch: hanya diblok pada mode strict.
    if (!cfg.strict) {
      return { block: false, href, hostname: "", sameContext: false };
    }
    if (type === "element.click") {
      block = Boolean(request.hasAnchor) || Boolean(href);
    }
    block = block && request.hasBase !== false;
  }

  // Paksa blok trik klik sintetis (ctrl/middle-click yang bukan dari user asli).
  if (request.metaKey && request.isTrusted === false) block = true;
  if ("button" in request && request.button !== 0 && request.isTrusted === false) {
    block = true;
  }
  // Jangan blok: user membatalkan, ctrl/cmd-klik ASLI, atau A[download].
  if (request.defaultPrevented || (request.metaKey && request.isTrusted)) block = false;
  if (request.tag === "A" && request.download) block = false;

  // Override izin saat masih block & punya href.
  if (block && href) {
    const loc = parseUrl(href);
    if (loc) {
      hostname = (loc.hostname || "").toLowerCase();
      // Izinkan popup ke domain yang sama (same-registrable) bila diopsikan.
      if (cfg.allowSameOrigin && cfg.topHost && hostMatches(hostname, cfg.topHost)) {
        block = false;
      }
      // Protokol yang diterima (mis. magnet:).
      if (loc.protocol && (cfg.protocols || []).indexOf(loc.protocol) !== -1) {
        block = false;
      }
      // Whitelist host (OAuth/pembayaran dll.).
      if (hostname && block) {
        for (const h of cfg.whitelist || []) {
          if (hostMatches(hostname, h)) {
            block = false;
            break;
          }
        }
      }
    }
  }

  return { block, href, hostname, sameContext };
}
