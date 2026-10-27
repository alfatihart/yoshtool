// popblock-main.js — dunia MAIN (akses objek window/DOM halaman apa adanya).
// Port setia (disederhanakan) dari data/inject/block/main.js milik
// "Popup Blocker (strict)" v0.9.4. Mengganti window.open & memasang proxy klik/form,
// lalu bertanya ke dunia ISOLATED lewat PORT (span tersembunyi) secara SINKRON —
// sinkron wajib karena window.open harus mengembalikan nilai seketika.
//
// Proxy dipasang SEKALI dan tak pernah dilepas: tiap proxy memeriksa
// port.dataset.enabled lewat policy() sehingga saat blocker nonaktif (atau saat
// "Izinkan" sedang memutar ulang popup), policy mengembalikan {block:false} dan
// panggilan asli diteruskan apa adanya. v1 melewati proteksi iframe agresif
// (aggressive>2) & proxy document.write asli.
{
  // PORT dipakai bersama dengan dunia ISOLATED. Kita jalan di document_start (sebelum
  // skrip halaman), jadi satu-satunya cara span ini sudah ada adalah bila skrip dunia
  // lain (ISOLATED) membuatnya lebih dulu — maka kita pakai ulang elemen yang SAMA
  // agar event & atribut benar-benar mengalir di antara kedua dunia.
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

    // Kirim pertanyaan kebijakan SINKRON; ISOLATED menuliskan jawabannya ke atribut
    // port di dalam handler event yang sama, lalu kita baca balik di sini. Saat
    // blocker nonaktif, langsung lepas tanpa bertanya.
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
        href: element.action || element.href || "", // action utk form, href utk anchor
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

    // Objek mirip-window yang merekam pemanggilan method / set properti, dikembalikan
    // saat window.open diblok agar kode pemanggil (w.focus(), w.location=…, dll.) tidak
    // melempar error. Rekaman diputar ulang bila user menekan "Izinkan".
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

      document.addEventListener("click", onclick, true); // fase capture

      w.open = new Proxy(w.open, {
        apply(target, self, args) {
          // Jangan blok bila window dibuka ke dalam frame bernama yang sudah ada.
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
              // Apakah pemanggilan ini terjadi dalam jendela aktivasi gestur user?
              // Dipakai ISOLATED: di mode non-strict, window.open hasil klik user
              // (mis. download) tidak diblok — hanya popunder programatik.
              userActive: !!(w.navigator.userActivation && w.navigator.userActivation.isActive),
            },
          );
          if (block) return simulate(id, w);
          return Reflect.apply(target, self, args);
        },
      });
    } catch (e) {
      // DOM/konstruktor tak tersedia (mis. dokumen non-HTML) — lewati dengan aman.
    }
  }
}
