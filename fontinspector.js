// fontinspector.js
// WhatFont-style font inspector (NCSA-licensed technique by Chengyin Liu, rewritten in
// vanilla JS). Injected on-demand (classic script) and TOGGLE: re-injecting turns it off.
// Hover → font-name tooltip; click → detail card. Detects the ACTUAL font via canvas
// pixel comparison (not just reading computed style). Esc to exit.
(() => {
  const GUARD = "__yoshtoolFontInspector";
  if (window[GUARD]) { window[GUARD].teardown(); return; } // toggle off

  const Z = 2147483000;
  const MARK = "data-yoshtool-font";

  // ---- Detect the actual font via canvas ----
  const canvas = document.createElement("canvas");
  canvas.width = 220; canvas.height = 40;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const SAMPLE = "mmmlliWWWabcABC0123";
  function renderData(family) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.textBaseline = "top";
    ctx.font = `22px ${family}`;
    ctx.fillText(SAMPLE, 0, 8);
    return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  }
  function sameData(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 4) { if (a[i + 3] !== b[i + 3] || a[i] !== b[i]) return false; }
    return true;
  }
  const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded|math|emoji|-apple-system|blinkmacsystemfont|inherit|initial)$/i;
  function fontExists(name) {
    // If "name, serif" == "name, sans-serif" → the generic fallback isn't used → name exists.
    return sameData(renderData(`"${name}", serif`), renderData(`"${name}", sans-serif`));
  }
  function actualFont(stack) {
    const fonts = stack.split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    for (const f of fonts) {
      if (GENERIC.test(f)) return f; // reached a generic = that's what's effectively used
      try { if (fontExists(f)) return f; } catch { /* ignore */ }
    }
    return fonts[0] || "?";
  }

  // ---- Detect the font service on the page ----
  function fontService() {
    let href = "";
    try { href = [...document.querySelectorAll('link[rel="stylesheet"], link[href]')].map((l) => l.href || "").join(" "); } catch { /* ignore */ }
    if (/fonts\.googleapis\.com|fonts\.gstatic\.com/i.test(href)) return "Google Fonts";
    if (/use\.typekit\.net|p\.typekit\.net|use\.typekit\.com/i.test(href)) return "Adobe Fonts (Typekit)";
    if (/fonts\.net|fast\.fonts/i.test(href)) return "Monotype";
    return "";
  }

  // ---- UI ----
  function basic(el) {
    el.setAttribute(MARK, "1");
    el.style.cssText += ";box-sizing:border-box;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;line-height:1.45;";
    return el;
  }
  const tip = basic(document.createElement("div"));
  tip.style.cssText += `position:fixed;z-index:${Z + 1};background:#1f2328;color:#e7e9ec;padding:6px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.09);font-size:12px;font-weight:600;pointer-events:none;box-shadow:0 8px 24px rgba(0,0,0,.4);max-width:280px;`;
  tip.style.display = "none";
  document.documentElement.appendChild(tip);

  const bar = basic(document.createElement("div"));
  bar.style.cssText += `position:fixed;top:12px;right:12px;z-index:${Z + 2};background:#1f2328;color:#e7e9ec;padding:8px 13px;border-radius:10px;border:1px solid rgba(255,255,255,.09);font-size:12.5px;font-weight:600;box-shadow:0 10px 30px rgba(0,0,0,.4);cursor:pointer;`;
  bar.textContent = "Inspect font — click an element · Esc to exit";
  bar.addEventListener("click", teardown);
  document.documentElement.appendChild(bar);

  function infoFor(el) {
    const cs = getComputedStyle(el);
    return {
      stack: cs.fontFamily,
      actual: actualFont(cs.fontFamily),
      size: cs.fontSize,
      weight: cs.fontWeight,
      style: cs.fontStyle,
      lineHeight: cs.lineHeight,
      color: cs.color,
    };
  }

  function onMove(e) {
    const t = e.target;
    if (!t || t.nodeType !== 1 || t.hasAttribute(MARK) || (t.closest && t.closest(`[${MARK}]`))) { tip.style.display = "none"; return; }
    let info;
    try { info = infoFor(t); } catch { tip.style.display = "none"; return; }
    tip.textContent = `${info.actual} · ${info.size} · ${info.weight}`;
    tip.style.display = "block";
    const x = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8);
    const y = Math.min(e.clientY + 16, innerHeight - tip.offsetHeight - 8);
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  }

  function onClick(e) {
    const t = e.target;
    if (!t || t.nodeType !== 1 || t.hasAttribute(MARK) || (t.closest && t.closest(`[${MARK}]`))) return;
    e.preventDefault();
    e.stopPropagation();
    let info;
    try { info = infoFor(t); } catch { return; }
    pinCard(info, e.clientX, e.clientY);
  }

  function row(label, value) {
    return `<div style="margin:3px 0"><span style="color:#9aa1ab">${label}:</span> <span style="color:#e7e9ec">${value}</span></div>`;
  }
  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function pinCard(info, cx, cy) {
    const card = basic(document.createElement("div"));
    card.style.cssText += `position:fixed;z-index:${Z + 3};background:#1f2328;color:#e7e9ec;padding:13px 14px;border-radius:12px;` +
      `font-size:13px;width:262px;box-shadow:0 12px 34px rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.09);`;
    const svc = fontService();
    const stackHtml = info.stack.split(",").map((f) => {
      const name = f.trim().replace(/^["']|["']$/g, "");
      const used = name.toLowerCase() === info.actual.toLowerCase();
      return `<span style="${used ? "font-weight:700;color:#e2e8f0" : "color:#6b7280;text-decoration:line-through"}">${escapeHtml(name)}</span>`;
    }).join(", ");
    card.innerHTML =
      `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">` +
      `<strong style="font-size:14px">${escapeHtml(info.actual)}</strong>` +
      `<span data-close style="cursor:pointer;color:#f87171;font-weight:700">✕</span></div>` +
      row("Stack", stackHtml) +
      row("Size", escapeHtml(info.size)) +
      row("Weight / Style", escapeHtml(info.weight + " / " + info.style)) +
      row("Line-height", escapeHtml(info.lineHeight)) +
      `<div style="margin:3px 0"><span style="color:#9aa1ab">Color:</span> ` +
      `<span style="display:inline-block;width:11px;height:11px;border-radius:3px;border:1px solid rgba(255,255,255,.3);vertical-align:middle;background:${info.color}"></span> ` +
      `<span style="color:#e7e9ec">${escapeHtml(info.color)}</span></div>` +
      (svc ? row("Service", escapeHtml(svc)) : "") +
      `<div style="margin:9px 0 8px;padding:9px;border:1px solid rgba(255,255,255,.14);border-radius:7px;background:rgba(255,255,255,.03);overflow:hidden;white-space:nowrap;` +
      `font-family:${info.stack};font-size:${info.size};font-weight:${info.weight};font-style:${info.style};color:${info.color}">AaBbCcDdEe 0123</div>` +
      `<button data-copycss style="width:100%;cursor:pointer;border:0;border-radius:7px;padding:8px;background:#e2e8f0;color:#0b1220;font:600 12.5px system-ui,sans-serif">Copy CSS</button>`;
    document.documentElement.appendChild(card);
    const w = card.offsetWidth, h = card.offsetHeight;
    card.style.left = Math.min(cx + 12, innerWidth - w - 8) + "px";
    card.style.top = Math.min(cy + 12, innerHeight - h - 8) + "px";
    card.querySelector("[data-close]").addEventListener("click", () => card.remove());
    const cssText = `font-family: ${info.stack};\nfont-size: ${info.size};\nfont-weight: ${info.weight};\nfont-style: ${info.style};\nline-height: ${info.lineHeight};\ncolor: ${info.color};`;
    const copyBtn = card.querySelector("[data-copycss]");
    copyBtn.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(cssText); copyBtn.textContent = "Copied ✓"; setTimeout(() => { copyBtn.textContent = "Copy CSS"; }, 1500); } catch { /* ignore */ }
    });
  }

  function onKey(e) { if (e.key === "Escape") teardown(); }

  function teardown() {
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
    document.querySelectorAll(`[${MARK}]`).forEach((n) => n.remove());
    try { delete window[GUARD]; } catch { window[GUARD] = undefined; }
  }

  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);
  window[GUARD] = { teardown };
})();
