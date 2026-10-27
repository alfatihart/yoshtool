// popblock-isolated.js — dunia ISOLATED (punya akses chrome.* + DOM halaman).
// Port setia (disederhanakan) dari data/inject/block/isolated.js milik
// "Popup Blocker (strict)" v0.9.4. Mengambil keputusan blok (lewat salinan inline
// shouldBlockPopup — IDENTIK dengan popblock-core.js), menuliskan jawabannya ke PORT
// secara sinkron, dan menampilkan bar notifikasi (div injeksi, bukan iframe WAR).
//
// Batasan v1: bar ditampilkan di frame tempat popup diblok (umumnya frame atas);
// tanpa countdown / default-action otomatis / rules / proteksi iframe lanjutan.
{
  // ---- salinan inline popblock-core.js (jaga IDENTIK) -----------------------
  const parseUrl = (href) => {
    try {
      return new URL(href);
    } catch {
      return null;
    }
  };
  const hostMatches = (hostname, entry) => {
    hostname = String(hostname || "").toLowerCase();
    entry = String(entry || "").toLowerCase();
    if (!hostname || !entry) return false;
    return (
      hostname === entry ||
      hostname.endsWith("." + entry) ||
      entry.endsWith("." + hostname)
    );
  };
  const shouldBlockPopup = (request, cfg = {}) => {
    const type = request.type || "";
    const href = request.href || "";
    let hostname = "";
    let block = true;
    let sameContext = false;

    if (type === "window.open") {
      sameContext = true;
    } else {
      if (!cfg.strict) {
        return { block: false, href, hostname: "", sameContext: false };
      }
      if (type === "element.click") {
        block = Boolean(request.hasAnchor) || Boolean(href);
      }
      block = block && request.hasBase !== false;
    }

    if (request.metaKey && request.isTrusted === false) block = true;
    if ("button" in request && request.button !== 0 && request.isTrusted === false) {
      block = true;
    }
    if (request.defaultPrevented || (request.metaKey && request.isTrusted)) block = false;
    if (request.tag === "A" && request.download) block = false;

    if (block && href) {
      const loc = parseUrl(href);
      if (loc) {
        hostname = (loc.hostname || "").toLowerCase();
        if (cfg.allowSameOrigin && cfg.topHost && hostMatches(hostname, cfg.topHost)) {
          block = false;
        }
        if (loc.protocol && (cfg.protocols || []).indexOf(loc.protocol) !== -1) {
          block = false;
        }
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
  };
  // ---- akhir salinan inline --------------------------------------------------

  // PORT dipakai bersama dunia MAIN (lihat popblock-main.js) — pakai ulang elemen
  // yang sama agar event/atribut mengalir di antara kedua dunia.
  let port;
  try {
    port = document.getElementById("__yoshtool_pb");
    if (!port) {
      port = document.createElement("span");
      port.id = "__yoshtool_pb";
      (document.documentElement || document).append(port);
    }
  } catch (e) {
    port = null;
  }

  if (port && port.dataset) {
    const NS = "__yoshtool_pb";
    let cfg = {
      strict: false,
      allowSameOrigin: false,
      protocols: ["magnet:"],
      whitelistHosts: [],
      disabledHosts: [],
    };
    let pbEnabled = true;
    const records = {}; // id → [recordings], records[id].args = argumen window.open asli

    const pageHost = () => {
      try {
        return (window.top.location.hostname || "").toLowerCase();
      } catch {
        return (location.hostname || "").toLowerCase();
      }
    };
    const isPageDisabled = () =>
      (cfg.disabledHosts || []).some((d) => hostMatches(pageHost(), d));
    const refreshEnabled = () => {
      const on = pbEnabled && !isPageDisabled();
      try {
        port.dataset.enabled = on ? "true" : "false";
      } catch (e) {}
    };

    // <base target> check (butuh DOM) — port dari blocker.hasBase asli.
    const hasBase = (targetAttr) => {
      const base = [{ target: targetAttr }, ...document.querySelectorAll("base")]
        .map((e) => (e && e.target ? e.target : ""))
        .filter((b) => b)
        .shift();
      if (!base || base.toLowerCase() === "_self" || base.toLowerCase() === "_top") {
        return false;
      }
      if (typeof window[base] === "object") return false;
      try {
        if (typeof parent[base] === "object") return false;
      } catch (e) {}
      return true;
    };

    const buildCfg = () => ({
      strict: !!cfg.strict,
      allowSameOrigin: !!cfg.allowSameOrigin,
      protocols: cfg.protocols || ["magnet:"],
      whitelist: cfg.whitelistHosts || [],
      topHost: pageHost(),
    });

    // Terjemahkan detail dari MAIN → request untuk shouldBlockPopup, lalu putuskan.
    const decide = (detail) => {
      const type = detail.type;
      let href = detail.href || "";
      // resolve href relatif → absolut (butuh DOM).
      if (href && href.indexOf(":") === -1) {
        try {
          const a = document.createElement("a");
          a.setAttribute("href", href);
          href = a.href;
        } catch (e) {}
      }
      const request = {
        type,
        href,
        target: detail.target,
        download: detail.download,
        tag: detail.tag,
        hasAnchor: type === "element.click" ? true : undefined,
        hasBase: type === "window.open" ? true : hasBase(detail.target),
        metaKey: detail.metaKey,
        isTrusted: detail.isTrusted,
        defaultPrevented: detail.defaultPrevented,
      };
      if ("button" in detail) request.button = detail.button;

      const res = shouldBlockPopup(request, buildCfg());
      const id = "pb_" + Math.random().toString(36).slice(2);
      if (res.sameContext && res.block) {
        records[id] = [];
        records[id].args = detail.args || [];
      }
      return { ...res, id };
    };

    // Kumpulkan rekaman method/prop dari simulate() (MAIN).
    port.addEventListener("pb-record", (e) => {
      e.stopPropagation();
      const r = e.detail;
      if (records[r.id]) records[r.id].push(r);
    });

    // Channel keputusan: jawab SINKRON (set atribut) dalam handler ini.
    port.addEventListener("pb-policy", (e) => {
      e.stopPropagation();
      if (e.target !== port) return;
      if (port.dataset.enabled === "false") {
        port.setAttribute("pb-block", "false");
        return;
      }
      const decision = decide(e.detail);
      port.setAttribute("pb-eid", decision.id);
      port.setAttribute("pb-block", decision.block ? "true" : "false");
      if (decision.block) {
        try {
          chrome.runtime.sendMessage({ cmd: "pb-blocked" });
        } catch (err) {}
        showBar(decision);
      }
    });

    // ---- bar notifikasi (div injeksi, namespaced) ----------------------------
    let bar = null;
    const rows = new Map(); // key (href|id) → { el, timer }

    const setStyle = (el, css) => {
      el.style.cssText = css;
    };

    const ensureBar = () => {
      if (bar && document.documentElement.contains(bar)) return bar;
      bar = document.createElement("div");
      bar.id = NS + "_bar";
      bar.setAttribute("data-yoshtool-pb", "bar");
      setStyle(
        bar,
        [
          "position:fixed!important",
          "right:12px!important",
          "bottom:12px!important",
          "z-index:2147483647!important",
          "width:320px!important",
          "max-width:90vw!important",
          "font:13px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif!important",
          "color:#e7e9ec!important",
          "background:#1f2328!important",
          "border:1px solid rgba(255,255,255,.09)!important",
          "border-radius:12px!important",
          "box-shadow:0 12px 34px rgba(0,0,0,.4)!important",
          "padding:10px!important",
          "margin:0!important",
        ].join(";"),
      );

      const head = document.createElement("div");
      setStyle(
        head,
        "display:flex!important;align-items:center!important;justify-content:space-between!important;gap:8px!important;margin:0 2px 6px!important",
      );
      const title = document.createElement("strong");
      title.textContent = "YoshTool — popup diblokir";
      setStyle(title, "font-weight:600!important;font-size:12px!important;color:#cbd5e1!important");
      const close = mkBtn("✕", "Tutup semua");
      setStyle(close, btnCss("#2a3140", "#cbd5e1") + ";padding:2px 7px!important");
      close.addEventListener("click", () => removeBar());
      head.append(title, close);

      const list = document.createElement("div");
      list.id = NS + "_list";

      const foot = document.createElement("div");
      setStyle(foot, "margin:6px 2px 1px!important;text-align:right!important");
      const disable = document.createElement("a");
      disable.textContent = "Nonaktifkan di situs ini";
      disable.href = "#";
      setStyle(disable, "color:#8aa0c6!important;font-size:11px!important;text-decoration:underline!important;cursor:pointer!important");
      disable.addEventListener("click", (ev) => {
        ev.preventDefault();
        send({ cmd: "pb-disable", host: pageHost() });
        removeBar();
      });
      foot.append(disable);

      bar.append(head, list, foot);
      (document.documentElement || document).append(bar);
      return bar;
    };

    function mkBtn(label, titleText) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      if (titleText) b.title = titleText;
      return b;
    }
    function btnCss(bg, fg) {
      return [
        "appearance:none!important",
        "border:0!important",
        "border-radius:7px!important",
        "padding:5px 10px!important",
        "margin:0!important",
        "font:600 12px/1.1 system-ui,-apple-system,sans-serif!important",
        "cursor:pointer!important",
        "letter-spacing:.1px!important",
        "background:" + bg + "!important",
        "color:" + fg + "!important",
      ].join(";");
    }

    const removeBar = () => {
      for (const { timer } of rows.values()) clearTimeout(timer);
      rows.clear();
      if (bar) {
        bar.remove();
        bar = null;
      }
    };

    function send(msg) {
      try {
        chrome.runtime.sendMessage(msg);
      } catch (e) {}
    }

    const allow = (href, id) => {
      // Izinkan setia: nonaktifkan sementara lalu putar ulang window.open (+rekaman)
      // di MAIN world. Untuk blok non-window.open (tanpa rekaman), worker klik anchor.
      port.dataset.enabled = "false";
      send2(
        {
          cmd: "pb-run-records",
          url: href,
          records: records[id] || null,
          args: (records[id] && records[id].args) || [],
        },
        () => {
          delete records[id];
          refreshEnabled();
        },
      );
    };
    function send2(msg, cb) {
      try {
        chrome.runtime.sendMessage(msg, () => {
          void chrome.runtime.lastError;
          cb && cb();
        });
      } catch (e) {
        cb && cb();
      }
    }

    function removeRow(key) {
      const row = rows.get(key);
      if (row) {
        clearTimeout(row.timer);
        row.el.remove();
        rows.delete(key);
      }
      if (rows.size === 0) removeBar();
    }

    function showBar(decision) {
      const { href, hostname, id } = decision;
      const key = href || id;
      ensureBar();
      const list = document.getElementById(NS + "_list");
      if (!list) return;

      // Dedup: popup berulang dari URL sama → cukup perbarui timer.
      if (rows.has(key)) {
        const row = rows.get(key);
        clearTimeout(row.timer);
        row.timer = setTimeout(() => removeRow(key), 20000);
        const badge = row.el.querySelector("[data-pb-badge]");
        if (badge) badge.textContent = String((Number(badge.textContent) || 1) + 1);
        return;
      }

      const row = document.createElement("div");
      setStyle(
        row,
        "border-top:1px solid rgba(255,255,255,.08)!important;padding:8px 2px!important;margin:0!important",
      );

      const info = document.createElement("div");
      setStyle(info, "display:flex!important;align-items:center!important;gap:6px!important;margin-bottom:5px!important");
      const label = document.createElement("span");
      label.textContent = hostname || href || "about:blank";
      label.title = href || "about:blank";
      setStyle(
        label,
        "flex:1!important;min-width:0!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;color:#e2e8f0!important",
      );
      const badge = document.createElement("span");
      badge.setAttribute("data-pb-badge", "1");
      badge.textContent = "1";
      setStyle(badge, "background:rgba(255,255,255,.1)!important;color:#cbd5e1!important;border-radius:999px!important;padding:1px 7px!important;font-size:11px!important;font-weight:700!important");
      info.append(label, badge);

      const btns = document.createElement("div");
      setStyle(btns, "display:flex!important;flex-wrap:wrap!important;gap:5px!important");

      const isHttp = /^https?:|^ftp:/i.test(href || "");

      const bAllow = mkBtn("Izinkan");
      setStyle(bAllow, btnCss("#1f7a45", "#eafaf0"));
      bAllow.addEventListener("click", () => {
        allow(href, id);
        removeRow(key);
      });

      const bTrust = mkBtn("Percaya", "Selalu izinkan domain ini");
      setStyle(bTrust, btnCss("#2a3140", "#cbd5e1"));
      let trustArmed = false;
      let trustTimer = null;
      bTrust.addEventListener("click", () => {
        if (!trustArmed) {
          trustArmed = true;
          bTrust.textContent = "Yakin?";
          trustTimer = setTimeout(() => {
            trustArmed = false;
            bTrust.textContent = "Percaya";
          }, 3000);
          return;
        }
        clearTimeout(trustTimer);
        if (hostname) send({ cmd: "pb-whitelist", host: hostname });
        allow(href, id);
        removeRow(key);
      });

      btns.append(bAllow, bTrust);

      if (isHttp) {
        const bBg = mkBtn("Latar", "Buka di tab latar");
        setStyle(bBg, btnCss("#2a3140", "#cbd5e1"));
        bBg.addEventListener("click", () => {
          send({ cmd: "pb-open-tab", url: href });
          removeRow(key);
        });
        const bRedir = mkBtn("Alihkan", "Alihkan tab ini ke sana");
        setStyle(bRedir, btnCss("#2a3140", "#cbd5e1"));
        bRedir.addEventListener("click", () => {
          send({ cmd: "pb-redirect", url: href });
          removeRow(key);
        });
        btns.append(bBg, bRedir);
      }

      const bDeny = mkBtn("Blokir", "Tetap blokir & tutup");
      setStyle(bDeny, btnCss("#7f2d2d", "#fde8e8"));
      bDeny.addEventListener("click", () => removeRow(key));
      btns.append(bDeny);

      row.append(info, btns);
      list.append(row);
      rows.set(key, { el: row, timer: setTimeout(() => removeRow(key), 20000) });
    }

    // ---- konfigurasi dari storage --------------------------------------------
    try {
      chrome.storage.local.get(["pbEnabled", "pbConfig"], (r) => {
        if (chrome.runtime.lastError) return;
        pbEnabled = r.pbEnabled !== false;
        if (r.pbConfig && typeof r.pbConfig === "object") cfg = { ...cfg, ...r.pbConfig };
        refreshEnabled();
      });
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local") return;
        if (changes.pbEnabled) pbEnabled = changes.pbEnabled.newValue !== false;
        if (changes.pbConfig && changes.pbConfig.newValue) {
          cfg = { ...cfg, ...changes.pbConfig.newValue };
        }
        if (changes.pbEnabled || changes.pbConfig) {
          refreshEnabled();
          if (port.dataset.enabled === "false") removeBar();
        }
      });
    } catch (e) {}

    // Dukungan Escape: tutup bar.
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Escape" && bar) removeBar();
      },
      true,
    );
  }
}
