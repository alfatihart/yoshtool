// toast.js
// Shows a toast INSIDE the tab's page (not in the popup), used for actions that pull
// the user's attention to the page: screenshot (popup closed), clear cache, clear
// cookie, and import. Injected via chrome.scripting.executeScript.

export async function showToastInTab(tabId, message, isError = false) {
  if (tabId == null) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      args: [message, isError],
      func: (msg, error) => {
        const ID = "__yoshtool_toast__";
        document.getElementById(ID)?.remove();

        const accent = error ? "#f87171" : "#4ade80";
        const el = document.createElement("div");
        el.id = ID;
        el.style.cssText = [
          "position:fixed",
          "right:16px",
          "bottom:16px",
          "z-index:2147483647",
          "max-width:340px",
          "display:flex",
          "align-items:center",
          "gap:10px",
          "padding:11px 14px",
          "border-radius:11px",
          "font:600 13px/1.4 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif",
          "color:#e7e9ec",
          "background:#1f2328",
          "border:1px solid rgba(255,255,255,.09)",
          "box-shadow:0 10px 30px rgba(0,0,0,.35)",
          "opacity:0",
          "transform:translateY(6px)",
          "transition:opacity .22s ease,transform .22s ease",
        ].join(";");

        const dot = document.createElement("span");
        dot.style.cssText =
          `flex:none;width:9px;height:9px;border-radius:50%;background:${accent};box-shadow:0 0 0 3px ${accent}33`;
        const text = document.createElement("span");
        text.textContent = msg;
        el.append(dot, text);

        document.documentElement.appendChild(el);
        requestAnimationFrame(() => {
          el.style.opacity = "1";
          el.style.transform = "translateY(0)";
        });

        setTimeout(() => {
          el.style.opacity = "0";
          el.style.transform = "translateY(6px)";
          setTimeout(() => el.remove(), 300);
        }, 3500);
      },
    });
  } catch {
    // Restricted page (chrome://, Web Store) or a tab that can't be injected — ignore.
  }
}
