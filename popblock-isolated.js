// popblock-isolated.js — ISOLATED world (has chrome.* access + the page DOM).
// Faithful (simplified) port of data/inject/block/isolated.js from
// "Popup Blocker (strict)" v0.9.4. Makes the block decision (via an inline copy of
// shouldBlockPopup — IDENTICAL to popblock-core.js), writes the answer back to the PORT
// synchronously, and renders the notification bar (an injected div, not a WAR iframe).
//
// v1 limits: the bar renders in the frame where the popup was blocked (usually the top
// frame); no countdown / automatic default action / rules / advanced iframe protection.
{
  // ---- inline copy of popblock-core.js (keep IDENTICAL) ---------------------
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
      if (!cfg.strict && request.userActive) {
        return { block: false, href, hostname: "", sameContext };
      }
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
  // ---- end of inline copy ----------------------------------------------------

  // PORT shared with the MAIN world (see popblock-main.js) — reuse the same element
  // so events/attributes flow between the two worlds.
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
    const records = {}; // id → [recordings], records[id].args = the original window.open args

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

    // <base target> check (needs DOM) — ported from the original blocker.hasBase.
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

    // Translate the MAIN detail → a shouldBlockPopup request, then decide.
    const decide = (detail) => {
      const type = detail.type;
      let href = detail.href || "";
      // resolve a relative href → absolute (needs DOM).
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
        userActive: detail.userActive,
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

    // Collect method/prop recordings from simulate() (MAIN).
    port.addEventListener("pb-record", (e) => {
      e.stopPropagation();
      const r = e.detail;
      if (records[r.id]) records[r.id].push(r);
    });

    // Decision channel: answer SYNCHRONOUSLY (set attributes) inside this handler.
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

    // ---- notification bar (injected div, namespaced) -------------------------
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
          "border:1px solid rgba(255,255,255,.1)!important",
          "border-radius:12px!important",
          "box-shadow:0 10px 30px rgba(0,0,0,.45)!important",
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
      title.textContent = "YoshTool — popup blocked";
      setStyle(title, "font-weight:600!important;font-size:12px!important;color:#cbd5e1!important");
      const close = mkBtn("✕", "Close all");
      setStyle(close, btnCss("rgba(255,255,255,.08)", "#cbd5e1") + ";padding:2px 8px!important");
      close.addEventListener("click", () => removeBar());
      head.append(title, close);

      const list = document.createElement("div");
      list.id = NS + "_list";

      const foot = document.createElement("div");
      setStyle(foot, "margin:6px 2px 1px!important;text-align:right!important");
      const disable = document.createElement("a");
      disable.textContent = "Disable on this site";
      disable.href = "#";
      setStyle(disable, "color:#9aa1ab!important;font-size:11px!important;text-decoration:underline!important;cursor:pointer!important");
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
        "border-radius:8px!important",
        "padding:6px 11px!important",
        "margin:0!important",
        "font:600 12.5px/1.1 system-ui,-apple-system,sans-serif!important",
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
      // Faithful allow: temporarily disable, then replay window.open (+ recordings) in
      // the MAIN world. For non-window.open blocks (no recordings), the worker clicks
      // the anchor.
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

      // Dedup: a repeated popup from the same URL → just refresh the timer.
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

      // Buttons on two rows: the primary decision (Allow / Block), then neutral options.
      const btns = document.createElement("div");
      setStyle(btns, "display:flex!important;flex-direction:column!important;gap:5px!important;margin:0!important");
      const primary = document.createElement("div");
      setStyle(primary, "display:flex!important;gap:5px!important");
      const secondary = document.createElement("div");
      setStyle(secondary, "display:flex!important;flex-wrap:wrap!important;gap:5px!important");

      const isHttp = /^https?:|^ftp:/i.test(href || "");

      const bAllow = mkBtn("Allow", "Open this popup once");
      setStyle(bAllow, btnCss("#157c69", "#ffffff") + ";flex:1!important");
      bAllow.addEventListener("click", () => {
        allow(href, id);
        removeRow(key);
      });
      const bDeny = mkBtn("Block", "Keep blocking & close");
      setStyle(bDeny, btnCss("#b23b35", "#ffecec") + ";flex:1!important");
      bDeny.addEventListener("click", () => removeRow(key));
      primary.append(bAllow, bDeny);

      const bTrust = mkBtn("Trust domain", "Always allow this domain");
      setStyle(bTrust, btnCss("rgba(255,255,255,.08)", "#cbd5e1"));
      let trustArmed = false;
      let trustTimer = null;
      bTrust.addEventListener("click", () => {
        if (!trustArmed) {
          trustArmed = true;
          bTrust.textContent = "Confirm?";
          trustTimer = setTimeout(() => {
            trustArmed = false;
            bTrust.textContent = "Trust domain";
          }, 3000);
          return;
        }
        clearTimeout(trustTimer);
        if (hostname) send({ cmd: "pb-whitelist", host: hostname });
        allow(href, id);
        removeRow(key);
      });
      secondary.append(bTrust);

      if (isHttp) {
        const bBg = mkBtn("Background", "Open in a background tab");
        setStyle(bBg, btnCss("rgba(255,255,255,.08)", "#cbd5e1"));
        bBg.addEventListener("click", () => {
          send({ cmd: "pb-open-tab", url: href });
          removeRow(key);
        });
        const bRedir = mkBtn("Redirect", "Redirect this tab there");
        setStyle(bRedir, btnCss("rgba(255,255,255,.08)", "#cbd5e1"));
        bRedir.addEventListener("click", () => {
          send({ cmd: "pb-redirect", url: href });
          removeRow(key);
        });
        secondary.append(bBg, bRedir);
      }

      btns.append(primary, secondary);
      row.append(info, btns);
      list.append(row);
      rows.set(key, { el: row, timer: setTimeout(() => removeRow(key), 20000) });
    }

    // ---- configuration from storage ------------------------------------------
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

    // Escape support: close the bar.
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Escape" && bar) removeBar();
      },
      true,
    );
  }
}
