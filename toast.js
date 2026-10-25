// toast.js
// Menampilkan toast di DALAM halaman tab (bukan di popup), dipakai untuk aksi yang
// mengarahkan perhatian pengguna ke halaman: screenshot (popup tertutup), clear cache,
// clear cookie, dan import. Disuntik lewat chrome.scripting.executeScript.

export async function showToastInTab(tabId, message, isError = false) {
  if (tabId == null) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      args: [message, isError],
      func: (msg, error) => {
        const ID = "__yoshtool_toast__";
        document.getElementById(ID)?.remove();

        const el = document.createElement("div");
        el.id = ID;
        el.textContent = msg;
        el.style.cssText = [
          "position:fixed",
          "right:20px",
          "bottom:20px",
          "z-index:2147483647",
          "max-width:320px",
          "padding:12px 16px",
          "border-radius:8px",
          "font:14px/1.4 Arial,sans-serif",
          "color:#fff",
          "box-shadow:0 4px 16px rgba(0,0,0,0.3)",
          "opacity:0",
          "transition:opacity .2s ease",
          `background:${error ? "#c62828" : "#2e7d32"}`,
        ].join(";");

        document.documentElement.appendChild(el);
        requestAnimationFrame(() => {
          el.style.opacity = "1";
        });

        setTimeout(() => {
          el.style.opacity = "0";
          setTimeout(() => el.remove(), 300);
        }, 3500);
      },
    });
  } catch {
    // Halaman restricted (chrome://, Web Store) atau tab tidak bisa disuntik — abaikan.
  }
}
