// selector.js
// Disuntik sementara ke halaman (lewat chrome.scripting.executeScript) saat tombol
// "Capture area" diklik. Menampilkan overlay untuk menggambar kotak seleksi,
// lalu mengirim koordinatnya ke background.js. Esc untuk membatalkan.
(() => {
  if (window.__yoshtoolSelectorActive) return; // cegah suntik ganda
  window.__yoshtoolSelectorActive = true;

  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(0,0,0,0.15);";

  const box = document.createElement("div");
  box.style.cssText =
    "position:fixed;border:2px dashed #2e7d32;background:rgba(46,125,50,0.15);display:none;z-index:2147483647;pointer-events:none;";

  document.documentElement.appendChild(overlay);
  document.documentElement.appendChild(box);

  let startX = 0;
  let startY = 0;
  let dragging = false;

  function cleanup() {
    overlay.remove();
    box.remove();
    document.removeEventListener("keydown", onKeyDown);
    window.__yoshtoolSelectorActive = false;
  }

  function onKeyDown(e) {
    if (e.key === "Escape") {
      cleanup();
      chrome.runtime.sendMessage({ type: "area-cancelled" });
    }
  }

  overlay.addEventListener("mousedown", (e) => {
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    box.style.left = `${startX}px`;
    box.style.top = `${startY}px`;
    box.style.width = "0px";
    box.style.height = "0px";
    box.style.display = "block";
  });

  overlay.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);
    box.style.left = `${x}px`;
    box.style.top = `${y}px`;
    box.style.width = `${w}px`;
    box.style.height = `${h}px`;
  });

  overlay.addEventListener("mouseup", (e) => {
    dragging = false;
    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    const width = Math.abs(e.clientX - startX);
    const height = Math.abs(e.clientY - startY);
    const dpr = window.devicePixelRatio || 1;
    cleanup();
    if (width < 4 || height < 4) {
      chrome.runtime.sendMessage({ type: "area-cancelled" });
      return;
    }
    // Overlay baru saja dihapus dari DOM, tapi captureVisibleTab di background bisa
    // memotret SEBELUM frame tanpa-overlay sempat dipaint, sehingga kotak seleksi
    // ikut masuk hasil. Tunggu dua kali requestAnimationFrame + jeda singkat supaya
    // frame bersih sudah terkomposisi sebelum capture diminta.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(() => {
          chrome.runtime.sendMessage({
            type: "area-selected",
            rect: { x, y, width, height },
            devicePixelRatio: dpr,
          });
        }, 50);
      });
    });
  });

  document.addEventListener("keydown", onKeyDown);
})();
