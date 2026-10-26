// background.js
// Service worker: menyemai allowlist default saat instal, dan mengorkestrasi
// screenshot (capture area/screen/full page) karena popup akan tertutup saat
// pengguna berinteraksi dengan halaman atau saat proses capture berlangsung.

import {
  seedDefaultIfEmpty,
  domainsFromOrigins,
  addDomainsToStore,
  removeDomainsFromStore,
} from "./allowlist.js";
import { showToastInTab } from "./toast.js";

chrome.runtime.onInstalled.addListener(() => {
  seedDefaultIfEmpty();
});

// Persistensi allowlist ditangani di sini, BUKAN di popup. Saat dialog izin Chrome
// muncul, popup kehilangan fokus dan tertutup, sehingga kode setelah
// chrome.permissions.request di popup tak pernah jalan. Event onAdded/onRemoved ini
// tetap diterima service worker walau popup sudah tertutup, jadi domain masuk/keluar
// allowlist cukup dengan sekali setujui dialog.
chrome.permissions.onAdded.addListener((perms) => {
  addDomainsToStore(domainsFromOrigins(perms.origins));
});
chrome.permissions.onRemoved.addListener((perms) => {
  removeDomainsFromStore(domainsFromOrigins(perms.origins));
});

const MAX_CAPTURE_DIMENSION = 16384; // batas aman tinggi/lebar canvas di Chrome

// Clipboard ditulis dari dalam tab yang di-capture, bukan dari dokumen offscreen.
// Dokumen offscreen tidak pernah fokus, sehingga navigator.clipboard.write di sana
// selalu ditolak ("Document is not focused"), dan fallback execCommand hanya
// menyalin HTML <img>, bukan bitmap. Tab yang di-capture adalah tab aktif yang
// kembali fokus setelah popup tertutup, dan Chrome mengizinkan penulisan clipboard
// dari tab aktif.
async function writeImageToClipboard(tabId, dataUrl) {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [dataUrl],
    func: async (url) => {
      try {
        // Decode base64 manual, bukan fetch(dataUrl), supaya tidak terhalang CSP halaman.
        const binary = atob(url.slice(url.indexOf(",") + 1));
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: "image/png" });

        // clipboard.write mensyaratkan dokumen fokus. Setelah capture full page,
        // infobar debugger sempat mencuri fokus, jadi minta fokus lalu polling
        // document.hasFocus() sampai ~3 detik sebelum menulis.
        window.focus();
        const deadline = Date.now() + 3000;
        while (!document.hasFocus() && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: `${err.name}: ${err.message}` };
      }
    },
  });
  const result = injection?.result;
  if (!result?.ok) throw new Error(result?.error || "Gagal menulis clipboard");
}

async function downloadImage(dataUrl, filename) {
  await chrome.downloads.download({ url: dataUrl, filename, saveAs: true });
}

async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function cropDataUrl(dataUrl, rect, devicePixelRatio) {
  const sourceBlob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(sourceBlob);
  const sx = Math.round(rect.x * devicePixelRatio);
  const sy = Math.round(rect.y * devicePixelRatio);
  const sw = Math.round(rect.width * devicePixelRatio);
  const sh = Math.round(rect.height * devicePixelRatio);
  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  const croppedBlob = await canvas.convertToBlob({ type: "image/png" });
  return blobToDataUrl(croppedBlob);
}

async function captureVisible(windowId) {
  return chrome.tabs.captureVisibleTab(windowId, { format: "png" });
}

// Banyak situs modern memicu animasi scroll-reveal atau lazy-load gambar lewat
// IntersectionObserver yang hanya jalan saat elemen benar-benar melewati viewport
// akibat scroll sungguhan. Kalau viewport langsung diperbesar ke tinggi penuh
// halaman tanpa pernah discroll dulu, elemen di bawah fold belum pernah "terlihat",
// sehingga animasinya belum settle (bisa tampak kosong, atau pada situs dengan
// scroll-pin/sticky-section malah tampak diulang-ulang). Scroll turun bertahap dulu
// memicu animasi/lazy-load itu secara wajar sebelum capture.
async function autoScrollThroughPage(tabId) {
  const expression = `
    (function () {
      return new Promise((resolve) => {
        const scroller = document.scrollingElement || document.documentElement;
        const step = Math.max(window.innerHeight * 0.8, 200);
        function tick() {
          const before = scroller.scrollTop;
          window.scrollBy(0, step);
          const reachedBottom = scroller.scrollTop >= scroller.scrollHeight - window.innerHeight - 1;
          if (reachedBottom || scroller.scrollTop === before) {
            setTimeout(() => {
              window.scrollTo(0, 0);
              setTimeout(resolve, 150);
            }, 250);
          } else {
            setTimeout(tick, 120);
          }
        }
        tick();
      });
    })()
  `;
  await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
    expression,
    awaitPromise: true,
  });
}

async function captureFullPage(tabId) {
  await chrome.debugger.attach({ tabId }, "1.3");
  try {
    await autoScrollThroughPage(tabId);
    // Ukur layout SETELAH scroll/lazy-load selesai — gambar yang baru dimuat bisa
    // mengubah tinggi total halaman dibanding sebelum discroll.
    const metrics = await chrome.debugger.sendCommand({ tabId }, "Page.getLayoutMetrics");
    // cssContentSize sudah dalam CSS px; contentSize sebagai fallback di Chrome versi lama.
    const size = metrics.cssContentSize || metrics.contentSize;
    const width = Math.ceil(size.width);
    const height = Math.min(Math.ceil(size.height), MAX_CAPTURE_DIMENSION);

    // Penting: benar-benar mengubah ukuran viewport ke tinggi penuh halaman, BUKAN
    // sekadar meminta clip lebih besar lewat captureBeyondViewport. Tanpa ini,
    // elemen position:sticky/fixed ikut tergambar ulang di tiap pita tinggi viewport
    // sepanjang canvas, sehingga hasilnya tampak seperti viewport yang sama di-loop
    // ke bawah alih-alih satu halaman utuh (pola yang sama dipakai Puppeteer/Playwright).
    await chrome.debugger.sendCommand({ tabId }, "Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });

    // Beri jeda singkat agar elemen sticky/lazy-load sempat settle pada ukuran baru.
    await new Promise((resolve) => setTimeout(resolve, 100));

    const result = await chrome.debugger.sendCommand({ tabId }, "Page.captureScreenshot", {
      format: "png",
      clip: { x: 0, y: 0, width, height, scale: 1 },
    });
    return "data:image/png;base64," + result.data;
  } finally {
    await chrome.debugger
      .sendCommand({ tabId }, "Emulation.clearDeviceMetricsOverride")
      .catch(() => {}); // kembalikan viewport tab ke ukuran normal sebelum detach
    await chrome.debugger.detach({ tabId }).catch(() => {});
    // Beri jeda agar infobar "sedang men-debug" hilang dan fokus bisa kembali ke
    // halaman — penting agar penulisan clipboard setelah ini tidak ditolak.
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

function captureArea(tab) {
  return new Promise((resolve, reject) => {
    chrome.scripting
      .executeScript({ target: { tabId: tab.id }, files: ["selector.js"] })
      .then(() => {
        const listener = (message, sender) => {
          if (sender.tab?.id !== tab.id) return;
          if (message.type === "area-selected") {
            chrome.runtime.onMessage.removeListener(listener);
            captureVisible(tab.windowId)
              .then((dataUrl) => cropDataUrl(dataUrl, message.rect, message.devicePixelRatio))
              .then(resolve, reject);
          } else if (message.type === "area-cancelled") {
            chrome.runtime.onMessage.removeListener(listener);
            reject(new Error("Pemilihan area dibatalkan"));
          }
        };
        chrome.runtime.onMessage.addListener(listener);
      })
      .catch(reject);
  });
}

// Fase 1 "deteksi lalu usulkan": suntik redact-overlay.js, tunggu pengguna
// mengonfirmasi (kotak jadi solid) atau membatalkan. Kotak solid akan ikut ter-capture
// sebagai sensor permanen. Mengembalikan true bila lanjut, false bila dibatalkan.
function runRedactOverlay(tab) {
  return new Promise((resolve, reject) => {
    chrome.scripting
      .executeScript({ target: { tabId: tab.id }, files: ["redact-overlay.js"] })
      .then(() => {
        const listener = (message, sender) => {
          if (sender.tab?.id !== tab.id) return;
          if (message.type === "redact-ready") {
            chrome.runtime.onMessage.removeListener(listener);
            resolve(true);
          } else if (message.type === "redact-cancelled") {
            chrome.runtime.onMessage.removeListener(listener);
            resolve(false);
          }
        };
        chrome.runtime.onMessage.addListener(listener);
      })
      .catch(reject);
  });
}

async function handleCapture({ mode, output, tab, redact }) {
  // Sensor dulu (bila diminta). Dibatalkan pengguna → hentikan seluruh proses capture.
  if (redact) {
    const proceed = await runRedactOverlay(tab);
    if (!proceed) throw new Error("Sensor dibatalkan");
  }

  let dataUrl;
  try {
    if (mode === "area") dataUrl = await captureArea(tab);
    else if (mode === "screen") dataUrl = await captureVisible(tab.windowId);
    else if (mode === "full") dataUrl = await captureFullPage(tab.id);
    else throw new Error(`Mode capture tidak dikenal: ${mode}`);
  } finally {
    // Bersihkan overlay sensor dari halaman setelah capture (berhasil atau gagal).
    if (redact) {
      chrome.tabs.sendMessage(tab.id, { type: "redact-cleanup" }).catch(() => {});
    }
  }

  const filename = `screenshot-${mode}-${Date.now()}.png`;
  if (output === "file") {
    await downloadImage(dataUrl, filename);
    // Toast ditampilkan SETELAH gambar diambil, jadi tidak ikut terpotret.
    await showToastInTab(tab.id, "Screenshot disimpan");
  } else {
    // Fokuskan ulang window+tab target sebelum menulis clipboard. Untuk full page,
    // infobar debugger sempat mencuri fokus; tanpa ini clipboard.write ditolak
    // "Document is not focused".
    try {
      await chrome.windows.update(tab.windowId, { focused: true });
      await chrome.tabs.update(tab.id, { active: true });
    } catch {
      // abaikan; skrip penulis clipboard masih menunggu fokus sendiri
    }
    try {
      await writeImageToClipboard(tab.id, dataUrl);
      await showToastInTab(tab.id, "Screenshot disalin ke clipboard");
    } catch (err) {
      // Jangan sampai hasil capture hilang: bila clipboard ditolak, tawarkan simpan file.
      await downloadImage(dataUrl, filename);
      await showToastInTab(tab.id, "Clipboard ditolak — gambar disimpan sebagai file", true);
      throw new Error(`clipboard ditolak (${err.message}), gambar ditawarkan untuk disimpan sebagai file`);
    }
  }
}

// Popup sudah tertutup selama capture berlangsung, jadi tidak ada tempat untuk
// menampilkan hasil/errornya secara langsung. Status disimpan di sini dan dibaca
// popup.js saat dibuka kembali, supaya sukses/gagal tetap terlihat (tidak perlu
// menebak-nebak dari ada/tidaknya hasil di clipboard).
async function reportCaptureStatus(status) {
  await chrome.storage.local.set({ captureStatus: { ...status, at: Date.now() } });
}

function runCaptureWithStatus(opts) {
  handleCapture(opts)
    .then(() => reportCaptureStatus({ ok: true, mode: opts.mode, output: opts.output }))
    .catch((err) => {
      console.error("Capture gagal:", err);
      reportCaptureStatus({ ok: false, mode: opts.mode, output: opts.output, error: err.message });
    });
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "capture") {
    runCaptureWithStatus(message);
  }
});

// Shortcut keyboard (manifest "commands"). _execute_action membuka popup otomatis;
// di sini hanya mode capture. Preferensi output/sensor dibaca dari storage, sama
// seperti saat dipicu dari popup. activeTab ter-grant otomatis saat command dipicu.
const COMMAND_MODE = {
  "capture-area": "area",
  "capture-screen": "screen",
  "capture-full": "full",
};
chrome.commands.onCommand.addListener(async (command) => {
  const mode = COMMAND_MODE[command];
  if (!mode) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  const { saveFileScreenshot, redactScreenshot } = await chrome.storage.local.get([
    "saveFileScreenshot",
    "redactScreenshot",
  ]);
  runCaptureWithStatus({
    mode,
    output: saveFileScreenshot ? "file" : "clipboard",
    tab,
    redact: !!redactScreenshot,
  });
});
