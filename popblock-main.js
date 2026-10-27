// popblock-main.js — MAIN world (direct access to the page's real window/DOM objects).
// Faithful (simplified) port of data/inject/block/main.js from
// "Popup Blocker (strict)" v0.9.4. Replaces window.open & installs click/form proxies,
// then asks the ISOLATED world over the PORT (a hidden span) SYNCHRONOUSLY —
// synchronous is mandatory because window.open must return a value immediately.
//
// Proxies are installed ONCE and never removed: each one checks port.dataset.enabled
// via policy(), so when the blocker is off (or while "Allow" is replaying a popup)
// policy returns {block:false} and the original call passes through untouched. v1 skips
// the original's aggressive iframe protection (aggressive>2) & document.write proxy.
{
  // PORT shared with the ISOLATED world. We run at document_start (before any page
  // script), so the only way this span already exists is if the other world's script
  // (ISOLATED) created it first — so we reuse the SAME element so that events &
  // attributes actually flow between the two worlds.
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
    const post = (name, detail) =>
      port.dispatchEvent(new CustomEvent(name, { detail }));

    // Ask the policy question SYNCHRONOUSLY; ISOLATED writes its answer to the port's
    // attributes inside the same event handler, then we read it back here. When the
    // blocker is off, pass through immediately without asking.
    const policy = (type, element, event, extra = {}) => {
      if (port.dataset.enabled === "false") return { block: false };
      if (event) {
        extra.defaultPrevented = event.defaultPrevented;
        extra.metaKey = event.metaKey || event.ctrlKey;
        extra.button = event.button || 0;
        extra.isTrusted = event.isTrusted;
      }
      post("pb-policy", {
        type,
        href: element.action || element.href || "", // action for forms, href for anchors
        target: element.target,
        download: element.download,
        tag: element.tagName,
        ...extra,
      });
      return {
        id: port.getAttribute("pb-eid"),
        block: port.getAttribute("pb-block") === "true",
      };
    };

    // A window-like object that records method calls / property sets, returned when
    // window.open is blocked so caller code (w.focus(), w.location=…, etc.) doesn't
    // throw. The recordings are replayed if the user hits "Allow".
    const simulate = (id, root = {}, tree = []) =>
      new Proxy(root, {
        get(obj, key) {
          const v = root[key];
          if (typeof v === "function") {
            return function (...args) {
              post("pb-record", { id, tree, action: { method: key, args } });
            };
          } else if (v && typeof v === "object") {
            return simulate(id, v, [...tree, key]);
          }
          return obj[key];
        },
        set(obj, key, value) {
          if (value) post("pb-record", { id, tree, action: { prop: key, value } });
          return true;
        },
      });

    const onclick = (e) => {
      const t = e.target;
      const a = (t.closest && (t.closest("[target]") || t.closest("a"))) || null;
      if (a && policy("element.click", a, e).block) {
        MouseEvent.prototype.preventDefault.apply(e);
        return true;
      }
    };

    try {
      const w = window;
      const { HTMLAnchorElement, HTMLFormElement } = w;

      HTMLAnchorElement.prototype.click = new Proxy(HTMLAnchorElement.prototype.click, {
        apply(target, self, args) {
          const { block } = policy("dynamic.a.click", self);
          return block ? undefined : Reflect.apply(target, self, args);
        },
      });
      HTMLAnchorElement.prototype.dispatchEvent = new Proxy(
        HTMLAnchorElement.prototype.dispatchEvent,
        {
          apply(target, self, args) {
            const ev = args[0];
            if (ev && ["click", "auxclick", "dblclick", "keydown"].includes(ev.type) === false) {
              return Reflect.apply(target, self, args);
            }
            const { block } = policy("dynamic.a.dispatch", self, ev);
            return block ? false : Reflect.apply(target, self, args);
          },
        },
      );
      HTMLFormElement.prototype.submit = new Proxy(HTMLFormElement.prototype.submit, {
        apply(target, self, args) {
          const { block } = policy("dynamic.form.submit", self);
          return block ? false : Reflect.apply(target, self, args);
        },
      });
      HTMLFormElement.prototype.dispatchEvent = new Proxy(
        HTMLFormElement.prototype.dispatchEvent,
        {
          apply(target, self, args) {
            const { block } = policy("dynamic.form.dispatch", self);
            return block ? false : Reflect.apply(target, self, args);
          },
        },
      );

      document.addEventListener("click", onclick, true); // capture phase

      w.open = new Proxy(w.open, {
        apply(target, self, args) {
          // Don't block when opening into an existing named frame.
          const name = args[1];
          try {
            if (name && typeof name === "string" && w.frames[name]) {
              return Reflect.apply(target, self, args);
            }
          } catch (e) {}
          const { id, block } = policy(
            "window.open",
            { href: args.length ? args[0] : "" },
            null,
            {
              args: [...args],
              // Did this call happen inside a user-gesture activation window?
              // Used by ISOLATED: in non-strict mode, a window.open from a user click
              // (e.g. a download) isn't blocked — only programmatic popunders.
              userActive: !!(w.navigator.userActivation && w.navigator.userActivation.isActive),
            },
          );
          if (block) return simulate(id, w);
          return Reflect.apply(target, self, args);
        },
      });
    } catch (e) {
      // DOM/constructors unavailable (e.g. a non-HTML document) — skip safely.
    }
  }
}
