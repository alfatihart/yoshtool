// fontinspector.js
// Inspektor font ala WhatFont (teknik NCSA-licensed oleh Chengyin Liu, ditulis ulang
// vanilla). Disuntik on-demand (classic script) dan TOGGLE: inject ulang = mati.
// Hover → tooltip nama font; klik → kartu detail. Deteksi font ASLI via canvas
// pixel-compare (bukan sekadar baca computed style). Esc untuk keluar.
(() => {
  const GUARD = "__yoshtoolFontInspector";
  if (window[GUARD]) { window[GUARD].teardown(); return; } // toggle off

  const Z = 2147483000;
  const MARK = "data-yoshtool-font";

  // ---- Deteksi font asli via canvas ----
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
    // Jika "name, serif" == "name, sans-serif" → fallback generik tak terpakai → name ada.
    return sameData(renderData(`"${name}", serif`), renderData(`"${name}", sans-serif`));
  }
  function actualFont(stack) {
    const fonts = stack.split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    for (const f of fonts) {
      if (GENERIC.test(f)) return f; // sampai ke generik = itu yang efektif dipakai
      try { if (fontExists(f)) return f; } catch { /* ignore */ }
    }
    return fonts[0] || "?";
  }

  // ---- Deteksi layanan font di halaman ----
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
    el.style.cssText += ";box-sizing:border-box;font-family:Arial,sans-serif;line-height:1.4;";
    return el;
  }
  const tip = basic(document.createElement("div"));
  tip.style.cssText += `position:fixed;z-index:${Z + 1};background:#1e1e1e;color:#fff;padding:5px 9px;border-radius:5px;font-size:12px;pointer-events:none;box-shadow:0 2px 10px rgba(0,0,0,.4);max-width:280px;`;
  tip.style.display = "none";
  document.documentElement.appendChild(tip);

  const bar = basic(document.createElement("div"));
  bar.style.cssText += `position:fixed;top:10px;right:10px;z-index:${Z + 2};background:#0277bd;color:#fff;padding:7px 12px;border-radius:6px;font-size:13px;box-shadow:0 2px 10px rgba(0,0,0,.4);cursor:pointer;`;
  bar.textContent = "Inspeksi font — klik elemen · Esc keluar";
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
    return `<div style="margin:2px 0"><span style="color:#888">${label}:</span> <span style="color:#111">${value}</span></div>`;
  }
  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function pinCard(info, cx, cy) {
    const card = basic(document.createElement("div"));
    card.style.cssText += `position:fixed;z-index:${Z + 3};background:#fff;color:#111;padding:12px 14px;border-radius:8px;` +
      `font-size:13px;width:260px;box-shadow:0 6px 24px rgba(0,0,0,.3);border:1px solid #ddd;`;
    const svc = fontService();
    const stackHtml = info.stack.split(",").map((f) => {
      const name = f.trim().replace(/^["']|["']$/g, "");
      const used = name.toLowerCase() === info.actual.toLowerCase();
      return `<span style="${used ? "font-weight:700;color:#0277bd" : "color:#999;text-decoration:line-through"}">${escapeHtml(name)}</span>`;
    }).join(", ");
    card.innerHTML =
      `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">` +
      `<strong style="font-size:14px">${escapeHtml(info.actual)}</strong>` +
      `<span data-close style="cursor:pointer;color:#c62828;font-weight:700">✕</span></div>` +
      row("Stack", stackHtml) +
      row("Ukuran", escapeHtml(info.size)) +
      row("Weight / Style", escapeHtml(info.weight + " / " + info.style)) +
      row("Line-height", escapeHtml(info.lineHeight)) +
      `<div style="margin:2px 0"><span style="color:#888">Warna:</span> ` +
      `<span style="display:inline-block;width:11px;height:11px;border:1px solid #ccc;vertical-align:middle;background:${info.color}"></span> ` +
      `<span style="color:#111">${escapeHtml(info.color)}</span></div>` +
      (svc ? row("Layanan", escapeHtml(svc)) : "") +
      `<div style="margin:8px 0 6px;padding:8px;border:1px solid #eee;border-radius:4px;overflow:hidden;white-space:nowrap;` +
      `font-family:${info.stack};font-size:${info.size};font-weight:${info.weight};font-style:${info.style};color:${info.color}">AaBbCcDdEe 0123</div>` +
      `<button data-copycss style="width:100%;cursor:pointer;border:0;border-radius:5px;padding:7px;background:#0277bd;color:#fff;font:inherit">Salin CSS</button>`;
    document.documentElement.appendChild(card);
    const w = card.offsetWidth, h = card.offsetHeight;
    card.style.left = Math.min(cx + 12, innerWidth - w - 8) + "px";
    card.style.top = Math.min(cy + 12, innerHeight - h - 8) + "px";
    card.querySelector("[data-close]").addEventListener("click", () => card.remove());
    const cssText = `font-family: ${info.stack};\nfont-size: ${info.size};\nfont-weight: ${info.weight};\nfont-style: ${info.style};\nline-height: ${info.lineHeight};\ncolor: ${info.color};`;
    const copyBtn = card.querySelector("[data-copycss]");
    copyBtn.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(cssText); copyBtn.textContent = "Tersalin ✓"; setTimeout(() => { copyBtn.textContent = "Salin CSS"; }, 1500); } catch { /* ignore */ }
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
