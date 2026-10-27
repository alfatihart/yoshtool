// selector.js
// Injected temporarily into the page (via chrome.scripting.executeScript) when the
// "Capture area" button is clicked. Shows an overlay for drawing a selection box, then
// sends its coordinates to background.js. Press Esc to cancel.
(() => {
  if (window.__yoshtoolSelectorActive) return; // prevent double injection
  window.__yoshtoolSelectorActive = true;

  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(0,0,0,0.15);";

  const box = document.createElement("div");
  box.style.cssText =
    "position:fixed;border:2px dashed #2bbda3;background:rgba(43,189,163,0.15);display:none;z-index:2147483647;pointer-events:none;";

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
    // The overlay was just removed from the DOM, but captureVisibleTab in the background can
    // shoot BEFORE the overlay-free frame is painted, pulling the selection box into the
    // result. Wait two requestAnimationFrame ticks plus a short delay so the clean frame is
    // composited before the capture is requested.
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
