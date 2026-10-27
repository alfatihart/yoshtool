// eyedropper.js — color picker DI HALAMAN (bukan di popup), supaya jendela popup
// tidak menghalangi seleksi warna. Pola adopsi ColorZilla: background mengambil
// snapshot viewport (chrome.tabs.captureVisibleTab) lalu menyuntik skrip ini; di sini
// kita tampilkan loupe/magnifier yang mengikuti kursor (zoom + penanda piksel + hex),
// dan saat klik: salin hex ke clipboard + simpan ke riwayat warna.
//
// Disuntik via chrome.scripting.executeScript (classic). Snapshot diterima lewat
// window.__yoshtoolEyeImg (data URL) yang di-set background sebelum injeksi.
(() => {
  const GUARD = "__yoshtoolEyedropperActive";
  // Toggle: injeksi ulang saat aktif → batalkan.
  if (window[GUARD]) {
    try {
      window[GUARD].teardown();
    } catch (e) {}
    return;
  }

  const dataUrl = window.__yoshtoolEyeImg;
  if (!dataUrl) return;
  delete window.__yoshtoolEyeImg;

  const Z = 2147483647;
  const LOUPE = 150; // diameter loupe (css px)
  const S = 15; // jumlah piksel sumber yang ditampilkan (ganjil → ada piksel tengah)
  const ZOOM = LOUPE / S; // 10×
  const HALF = (S - 1) / 2;
  const dpr = window.devicePixelRatio || 1;

  const toHex = (n) => n.toString(16).padStart(2, "0");
  const rgbToHex = (r, g, b) => "#" + toHex(r) + toHex(g) + toHex(b);

  // Snapshot → canvas natural-size untuk baca piksel.
  const snap = document.createElement("canvas");
  const sctx = snap.getContext("2d", { willReadFrequently: true });

  // Overlay penangkap pointer.
  const overlay = document.createElement("div");
  overlay.setAttribute("data-yoshtool-eyedropper", "1");
  overlay.style.cssText =
    `position:fixed;inset:0;z-index:${Z};margin:0;padding:0;cursor:crosshair;` +
    `background:transparent;`;

  // Loupe (lingkaran) + label hex.
  const wrap = document.createElement("div");
  wrap.setAttribute("data-yoshtool-eyedropper", "1");
  wrap.style.cssText =
    `position:fixed;z-index:${Z};pointer-events:none;display:none;` +
    `flex-direction:column;align-items:center;gap:6px;`;

  const loupe = document.createElement("canvas");
  loupe.width = LOUPE;
  loupe.height = LOUPE;
  loupe.style.cssText =
    `width:${LOUPE}px;height:${LOUPE}px;border-radius:50%;` +
    `border:3px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.4),0 10px 30px rgba(0,0,0,.45);` +
    `image-rendering:pixelated;`;
  const lctx = loupe.getContext("2d");
  lctx.imageSmoothingEnabled = false;

  const label = document.createElement("div");
  label.style.cssText =
    `display:flex;align-items:center;gap:7px;padding:5px 9px;border-radius:999px;` +
    `background:#1f2328;color:#e7e9ec;border:1px solid rgba(255,255,255,.1);` +
    `font:700 12px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;` +
    `box-shadow:0 6px 18px rgba(0,0,0,.4);`;
  const dot = document.createElement("span");
  dot.style.cssText = "width:12px;height:12px;border-radius:3px;border:1px solid rgba(255,255,255,.3);flex:none";
  const hexText = document.createElement("span");
  hexText.textContent = "#------";
  label.append(dot, hexText);

  wrap.append(loupe, label);

  let curHex = "#000000";
  let lastX = 0;
  let lastY = 0;

  function draw(clientX, clientY) {
    lastX = clientX;
    lastY = clientY;
    const cx = Math.round(clientX * dpr);
    const cy = Math.round(clientY * dpr);

    // Crop S×S sumber berpusat di kursor, skala ke LOUPE (piksel tajam).
    lctx.clearRect(0, 0, LOUPE, LOUPE);
    lctx.imageSmoothingEnabled = false;
    try {
      lctx.drawImage(snap, cx - HALF, cy - HALF, S, S, 0, 0, LOUPE, LOUPE);
    } catch (e) {}

    // Penanda piksel tengah.
    const m = HALF * ZOOM;
    lctx.strokeStyle = "rgba(0,0,0,.75)";
    lctx.lineWidth = 1;
    lctx.strokeRect(m + 0.5, m + 0.5, ZOOM - 1, ZOOM - 1);
    lctx.strokeStyle = "rgba(255,255,255,.95)";
    lctx.strokeRect(m - 0.5, m - 0.5, ZOOM + 1, ZOOM + 1);

    // Warna piksel tengah.
    const px = Math.min(Math.max(cx, 0), snap.width - 1);
    const py = Math.min(Math.max(cy, 0), snap.height - 1);
    let r = 0, g = 0, b = 0;
    try {
      const d = sctx.getImageData(px, py, 1, 1).data;
      r = d[0]; g = d[1]; b = d[2];
    } catch (e) {}
    curHex = rgbToHex(r, g, b);
    hexText.textContent = curHex.toUpperCase();
    dot.style.background = curHex;

    // Posisi loupe dekat kursor, hindari keluar viewport.
    const OFF = 20;
    const w = LOUPE + 8;
    const h = LOUPE + 34;
    let x = clientX + OFF;
    let y = clientY + OFF;
    if (x + w > innerWidth) x = clientX - OFF - w;
    if (y + h > innerHeight) y = clientY - OFF - h;
    wrap.style.left = Math.max(4, x) + "px";
    wrap.style.top = Math.max(4, y) + "px";
    wrap.style.display = "flex";
  }

  function onMove(e) {
    draw(e.clientX, e.clientY);
  }

  async function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    const hex = curHex;
    teardown();
    // Salin ke clipboard (tab aktif → fokus ada).
    try {
      await navigator.clipboard.writeText(hex);
    } catch (err) {}
    // Simpan ke riwayat warna (dedup, maks 12) — dibaca popup saat dibuka lagi.
    try {
      const KEY = "colorHistory";
      const got = await chrome.storage.local.get(KEY);
      const hist = Array.isArray(got[KEY]) ? got[KEY] : [];
      const next = [hex, ...hist.filter((h) => h !== hex)].slice(0, 12);
      await chrome.storage.local.set({ [KEY]: next });
    } catch (err) {}
    showPickToast(hex);
  }

  function onKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      teardown();
    }
  }
  function onContext(e) {
    e.preventDefault();
    teardown();
  }
  function onScroll() {
    // Snapshot statis → batalkan bila halaman discroll agar tak salah ambil.
    teardown();
  }

  function teardown() {
    window[GUARD] = null;
    try {
      overlay.removeEventListener("mousemove", onMove, true);
      overlay.removeEventListener("click", onClick, true);
      overlay.removeEventListener("contextmenu", onContext, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("wheel", onWheel, { capture: true });
    } catch (e) {}
    overlay.remove();
    wrap.remove();
    document.documentElement.style.overflow = prevOverflow;
  }

  function onWheel(e) {
    e.preventDefault();
  }

  // Toast konfirmasi (gaya senada toast.js).
  function showPickToast(hex) {
    const ID = "__yoshtool_toast__";
    document.getElementById(ID)?.remove();
    const el = document.createElement("div");
    el.id = ID;
    el.style.cssText =
      "position:fixed;right:16px;bottom:16px;z-index:2147483647;display:flex;align-items:center;gap:10px;" +
      "padding:11px 14px;border-radius:11px;font:600 13px/1.4 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;" +
      "color:#e7e9ec;background:#1f2328;border:1px solid rgba(255,255,255,.09);box-shadow:0 10px 30px rgba(0,0,0,.35);" +
      "opacity:0;transform:translateY(6px);transition:opacity .22s ease,transform .22s ease;";
    const sw = document.createElement("span");
    sw.style.cssText = `flex:none;width:12px;height:12px;border-radius:3px;border:1px solid rgba(255,255,255,.3);background:${hex}`;
    const tx = document.createElement("span");
    tx.innerHTML = `Warna <span style="font-family:ui-monospace,Menlo,monospace">${hex.toUpperCase()}</span> disalin`;
    el.append(sw, tx);
    document.documentElement.appendChild(el);
    requestAnimationFrame(() => {
      el.style.opacity = "1";
      el.style.transform = "translateY(0)";
    });
    setTimeout(() => {
      el.style.opacity = "0";
      el.style.transform = "translateY(6px)";
      setTimeout(() => el.remove(), 300);
    }, 2600);
  }

  const prevOverflow = document.documentElement.style.overflow;

  const img = new Image();
  img.onload = () => {
    snap.width = img.naturalWidth;
    snap.height = img.naturalHeight;
    sctx.drawImage(img, 0, 0);
    document.documentElement.style.overflow = "hidden";
    document.documentElement.appendChild(overlay);
    document.documentElement.appendChild(wrap);
    overlay.addEventListener("mousemove", onMove, true);
    overlay.addEventListener("click", onClick, true);
    overlay.addEventListener("contextmenu", onContext, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("wheel", onWheel, { capture: true, passive: false });
    window[GUARD] = { teardown };
  };
  img.onerror = () => {};
  img.src = dataUrl;
})();
