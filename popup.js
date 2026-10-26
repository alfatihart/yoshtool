import {
  serialize,
  parse,
  detectFormat,
  validateCookie,
  buildCookieUrl,
  resolveCookieHostname,
  setCookie,
  removeCookie,
  getCookiesForDomain,
  getStoreIdForTab,
} from "./cookies.js";
import {
  isHostnameAllowed,
  hostMatchesDomain,
  addDomainForHostname,
  removeDomain,
  listDomainsWithStatus,
} from "./allowlist.js";
import { showToastInTab } from "./toast.js";

// Ambil elemen UI
const outputEl = document.getElementById("output");
const formatSelect = document.getElementById("format-select");
const btnCopy = document.getElementById("btn-copy");
const btnSaveFile = document.getElementById("btn-save-file");
const btnImport = document.getElementById("btn-import");
const fileInput = document.getElementById("file-input");
const chkRemoveOld = document.getElementById("chk-remove-old");
const chkAutoRefresh = document.getElementById("chk-auto-refresh");
const chkSaveFile = document.getElementById("chk-save-file");
const chkRedact = document.getElementById("chk-redact");
const redactMethodEl = document.getElementById("redact-method");
const redactColorEl = document.getElementById("redact-color");
const redactWarnEl = document.getElementById("redact-warn");
const btnOpenSite = document.getElementById("btn-open-site");

// Helper function untuk menggantikan alert default dengan notifikasi in-app.
// persist=true membuat status tidak hilang otomatis (dipakai untuk hasil import
// yang perlu dibaca pengguna, mis. detail cookie yang gagal / hasil verifikasi).
let statusTimeoutId;
function showStatus(message, isError = false, persist = false) {
  const el = document.getElementById("status");
  el.textContent = message;
  el.className = isError ? "error" : "success";
  if (statusTimeoutId) clearTimeout(statusTimeoutId);
  if (!persist) {
    statusTimeoutId = setTimeout(() => {
      el.textContent = "";
      el.className = "";
    }, 4000);
  }
}

// Modal konfirmasi di dalam popup (alert/confirm bawaan tidak andal di popup ekstensi).
// requireText: bila diisi, OK baru aktif setelah pengguna mengetik teks itu persis
// (dipakai untuk aksi berisiko seperti hapus cookie — pengguna wajib mengetik domainnya).
function askConfirm({ message, requireText = null, danger = false }) {
  const backdrop = document.getElementById("confirm-backdrop");
  const messageEl = document.getElementById("confirm-message");
  const input = document.getElementById("confirm-input");
  const okBtn = document.getElementById("confirm-ok");
  const cancelBtn = document.getElementById("confirm-cancel");

  return new Promise((resolve) => {
    messageEl.textContent = message;
    okBtn.classList.toggle("danger", danger);

    if (requireText) {
      input.hidden = false;
      input.value = "";
      input.placeholder = requireText;
      okBtn.disabled = true;
      input.oninput = () => {
        okBtn.disabled = input.value.trim() !== requireText;
      };
    } else {
      input.hidden = true;
      okBtn.disabled = false;
      input.oninput = null;
    }

    backdrop.hidden = false;
    if (requireText) input.focus();

    function cleanup(result) {
      backdrop.hidden = true;
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      input.oninput = null;
      input.hidden = true;
      okBtn.classList.remove("danger");
      resolve(result);
    }
    okBtn.onclick = () => {
      if (okBtn.disabled) return;
      cleanup(true);
    };
    cancelBtn.onclick = () => cleanup(false);
  });
}

// Tab switching
for (const btn of document.querySelectorAll(".tab-btn")) {
  btn.addEventListener("click", () => {
    for (const b of document.querySelectorAll(".tab-btn")) b.classList.remove("active");
    for (const p of document.querySelectorAll(".tab-panel")) p.classList.remove("active");
    btn.classList.add("active");
    document.getElementById(`panel-${btn.dataset.tab}`).classList.add("active");
  });
}

// Fungsi untuk mendapatkan tab aktif
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

// Menunggu sebuah tab selesai memuat, dipakai agar toast dimunculkan SETELAH reload
// selesai (kalau sebelum reload, toast langsung terhapus saat halaman dimuat ulang).
function waitForTabComplete(tabId, timeout = 8000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const listener = (id, info) => {
      if (id === tabId && info.status === "complete") finish();
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(finish, timeout);
  });
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

// Helper function: Atur status tombol Copy, Save file & Import
function updateButtons() {
  const hasText = outputEl.value.trim().length > 0;
  btnCopy.disabled = !hasText;
  btnSaveFile.disabled = !hasText;
  btnImport.disabled = !hasText;
}
outputEl.addEventListener("input", updateButtons);

// Preferensi tersimpan (auto refresh & output screenshot)
async function loadPrefs() {
  const { autoRefresh, saveFileScreenshot, redactScreenshot, redactMethod, redactColor } =
    await chrome.storage.local.get([
      "autoRefresh",
      "saveFileScreenshot",
      "redactScreenshot",
      "redactMethod",
      "redactColor",
    ]);
  chkAutoRefresh.checked = autoRefresh !== false; // default: aktif
  chkSaveFile.checked = !!saveFileScreenshot;
  chkRedact.checked = !!redactScreenshot; // default: nonaktif
  redactMethodEl.value = redactMethod === "blur" ? "blur" : "solid"; // default: solid
  redactColorEl.value = redactColor || "#000000";
  updateRedactUi();
}
// Warna hanya relevan untuk Solid; peringatan hanya untuk Blur.
function updateRedactUi() {
  const isBlur = redactMethodEl.value === "blur";
  redactColorEl.style.display = isBlur ? "none" : "";
  redactWarnEl.style.display = isBlur ? "" : "none";
}
chkAutoRefresh.addEventListener("change", () => {
  chrome.storage.local.set({ autoRefresh: chkAutoRefresh.checked });
});
chkSaveFile.addEventListener("change", () => {
  chrome.storage.local.set({ saveFileScreenshot: chkSaveFile.checked });
});
chkRedact.addEventListener("change", () => {
  chrome.storage.local.set({ redactScreenshot: chkRedact.checked });
});
redactMethodEl.addEventListener("change", () => {
  chrome.storage.local.set({ redactMethod: redactMethodEl.value });
  updateRedactUi();
});
redactColorEl.addEventListener("change", () => {
  chrome.storage.local.set({ redactColor: redactColorEl.value });
});

// ---------- Export ----------
document.getElementById("btn-export").onclick = async () => {
  const tab = await getActiveTab();
  if (!tab?.url) {
    showStatus("Gagal mendapatkan URL dari tab aktif.", true);
    return;
  }

  const hostname = hostnameOf(tab.url);
  if (!hostname || !(await isHostnameAllowed(hostname))) {
    showStatus(`Domain "${hostname}" belum ada di allowlist. Buka tab Allowlist.`, true);
    return;
  }

  const cookies = await getCookiesForDomain(hostname);
  outputEl.value = serialize(cookies, formatSelect.value);
  updateButtons();
  // Ingat URL persis saat export, supaya tombol "Buka situs" setelah import membuka
  // halaman ini (mis. frontend fly.web.id/dashboard) dan bukan domain cookie
  // (mis. api.fly.web.id). Dibagi ke konteks incognito lewat chrome.storage.local.
  await chrome.storage.local.set({ lastExport: { url: tab.url, host: hostname, at: Date.now() } });
  showStatus(`Berhasil mengekspor ${cookies.length} cookie (${formatSelect.value}).`);
};

// ---------- Copy ----------
btnCopy.onclick = async () => {
  const output = outputEl.value;
  if (!output) {
    showStatus("Tidak ada data untuk disalin.", true);
    return;
  }
  try {
    await navigator.clipboard.writeText(output);
    showStatus("Data cookie berhasil disalin ke clipboard!");
  } catch (err) {
    showStatus("Gagal menyalin: " + err.message, true);
  }
};

// ---------- Save file ----------
btnSaveFile.onclick = () => {
  if (!outputEl.value) {
    showStatus("Tidak ada data untuk disimpan.", true);
    return;
  }
  const format = formatSelect.value;
  const ext = format === "json" ? "json" : "txt";
  const blob = new Blob([outputEl.value], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `cookies-${format}.${ext}`;
  a.click();
  URL.revokeObjectURL(url);
  showStatus("Berkas cookie disimpan.");
};

// ---------- Paste ----------
document.getElementById("btn-paste").onclick = async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) throw new Error("Clipboard kosong");
    outputEl.value = text;
    formatSelect.value = detectFormat(text);
    updateButtons();
    showStatus("Data di-paste dari clipboard!");
  } catch (err) {
    showStatus("Gagal paste (izinkan akses clipboard!): " + err.message, true);
  }
};

// ---------- Open file ----------
document.getElementById("btn-open-file").onclick = () => fileInput.click();
fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  if (!file) return;
  const text = await file.text();
  outputEl.value = text;
  formatSelect.value = detectFormat(text);
  updateButtons();
  showStatus(`Berkas "${file.name}" dimuat.`);
  fileInput.value = "";
});

// ---------- Clear ----------
document.getElementById("btn-clear").onclick = () => {
  outputEl.value = "";
  updateButtons();
  btnOpenSite.style.display = "none";
  showStatus("Tampilan dibersihkan.");
};

// ---------- Import ----------
// Domain diambil dari masing-masing cookie (format JSON/Netscape sudah membawanya),
// bukan wajib dari tab aktif — supaya import tetap bisa dipakai di tab baru/Incognito
// kosong yang belum dibuka ke situs targetnya. Format Header tidak membawa domain
// sama sekali, jadi untuk cookie dari format itu tetap dipakai hostname tab aktif.
// Setiap domain yang muncul dicek ke allowlist SATU PER SATU (bukan sekali untuk
// seluruh batch), supaya data yang diselipi cookie domain lain tidak ikut ter-set
// diam-diam hanya karena tab aktif kebetulan ada di domain yang diizinkan.
btnImport.onclick = async () => {
  const text = outputEl.value;
  if (!text.trim()) {
    showStatus("Tempel data cookie terlebih dahulu!", true);
    return;
  }

  let cookies;
  try {
    cookies = parse(text); // format dideteksi otomatis dari isinya
    if (!Array.isArray(cookies)) throw new Error("Data harus berupa daftar cookie");
  } catch (err) {
    showStatus("Gagal membaca data: " + err.message, true);
    return;
  }

  const tab = await getActiveTab();
  const activeHostname = hostnameOf(tab?.url || "");
  // Store target (mis. store incognito) ditentukan eksplisit dari tab aktif, supaya
  // cookie dijamin masuk ke store yang sama dengan tab yang akan dibuka — tidak lagi
  // bergantung pada asumsi "konteks popup incognito → store incognito".
  const targetStoreId = tab?.id != null ? await getStoreIdForTab(tab.id) : undefined;

  const resolved = cookies.map((cookie) => ({
    cookie,
    hostname: resolveCookieHostname(cookie, activeHostname),
  }));

  const uniqueHostnames = [...new Set(resolved.map((r) => r.hostname).filter(Boolean))];
  if (uniqueHostnames.length === 0) {
    showStatus(
      "Format Header String tidak menyertakan domain, jadi tab aktif harus sudah berada di situs tujuan. " +
        "Buka situs tujuannya dulu lalu import, atau gunakan format JSON/Netscape yang membawa domain.",
      true,
      true,
    );
    return;
  }

  const allowedHostnames = [];
  for (const hostname of uniqueHostnames) {
    if (await isHostnameAllowed(hostname)) allowedHostnames.push(hostname);
  }
  if (allowedHostnames.length === 0) {
    showStatus(`Domain "${uniqueHostnames[0]}" belum ada di allowlist. Buka tab Allowlist.`, true);
    return;
  }

  if (chkRemoveOld.checked) {
    for (const hostname of allowedHostnames) {
      const existing = await getCookiesForDomain(hostname, targetStoreId);
      for (const c of existing) {
        await removeCookie(c, buildCookieUrl(c, hostname), targetStoreId);
      }
    }
  }

  let successCount = 0;
  const failed = [];
  const successCountByHostname = new Map();
  for (const { cookie: rawCookie, hostname } of resolved) {
    if (!hostname || !allowedHostnames.includes(hostname)) {
      failed.push(`${rawCookie?.name || "(tanpa nama)"}: domain "${hostname || "?"}" tidak ada di allowlist`);
      continue;
    }
    const error = validateCookie(rawCookie);
    if (error) {
      failed.push(`${rawCookie?.name || "(tanpa nama)"}: ${error}`);
      continue;
    }
    try {
      const url = buildCookieUrl(rawCookie, hostname);
      const res = await setCookie(rawCookie, url, targetStoreId);
      if (res) {
        successCount++;
        successCountByHostname.set(hostname, (successCountByHostname.get(hostname) || 0) + 1);
      } else {
        failed.push(`${rawCookie.name}: ditolak Chrome (null, cek atribut secure/domain)`);
      }
    } catch (err) {
      failed.push(`${rawCookie.name}: ${err.message}`);
    }
  }

  // Domain yang menerima cookie terbanyak dijadikan domain tujuan untuk auto-refresh/buka tab.
  let targetDomain = "";
  let targetCount = 0;
  for (const [hostname, count] of successCountByHostname) {
    if (count > targetCount) {
      targetDomain = hostname;
      targetCount = count;
    }
  }

  // Verifikasi: baca ulang cookie yang benar-benar ADA di store target setelah import,
  // supaya ketahuan bila set "berhasil" tapi cookie tak tersimpan (mis. salah store).
  let verifyNote = "";
  if (targetDomain) {
    const present = await getCookiesForDomain(targetDomain, targetStoreId);
    verifyNote = ` | cek: ${present.length} cookie ada di ${targetDomain} (store ${targetStoreId ?? "default"})`;
  }

  if (failed.length === 0) {
    // Sukses penuh: pesan ringkas, hilang otomatis.
    showStatus(`Berhasil mengimpor ${successCount} cookie — sesi aktif di ${targetDomain}.`);
  } else {
    // Ada yang gagal: tampilkan detail + hasil verifikasi secara persisten untuk diagnosis.
    showStatus(
      `Impor ${successCount}/${cookies.length} berhasil. Gagal: ${failed.join(", ")}${verifyNote}`,
      successCount === 0,
      true,
    );
  }

  if (targetDomain) {
    const openUrl = await resolveOpenUrl(targetDomain);
    showOpenSiteButton(openUrl);
    const toastMsg =
      failed.length === 0
        ? `${successCount} cookie diimpor — sesi aktif`
        : `Impor ${successCount}/${cookies.length} cookie`;
    if (chkAutoRefresh.checked) {
      // windowId penting: tab baru harus lahir di window yang sama (mis. incognito),
      // supaya store cookie-nya cocok dengan tempat cookie tadi di-set — kalau tidak,
      // tab bisa terbuka di window normal dan tampak tidak login.
      let targetTabId;
      if (tab?.id && activeHostname && hostMatchesDomain(activeHostname, targetDomain)) {
        await chrome.tabs.update(tab.id, { url: openUrl });
        targetTabId = tab.id;
      } else if (tab?.windowId != null) {
        const created = await chrome.tabs.create({ url: openUrl, windowId: tab.windowId });
        targetTabId = created?.id;
      } else {
        const created = await chrome.tabs.create({ url: openUrl });
        targetTabId = created?.id;
      }
      // Toast dimunculkan setelah tab tujuan selesai memuat.
      if (targetTabId != null) {
        await waitForTabComplete(targetTabId);
        await showToastInTab(targetTabId, toastMsg, failed.length > 0);
      }
    }
  }
};

// URL yang dibuka setelah import: utamakan URL persis saat export (mis. frontend
// fly.web.id/dashboard) bila host-nya terkait dengan domain cookie yang diimpor;
// selain itu fallback ke https://<domain tujuan>/.
async function resolveOpenUrl(targetDomain) {
  const { lastExport } = await chrome.storage.local.get("lastExport");
  if (lastExport?.url && lastExport.host && hostsRelated(lastExport.host, targetDomain)) {
    return lastExport.url;
  }
  return `https://${targetDomain}/`;
}

function hostsRelated(a, b) {
  a = a.toLowerCase();
  b = b.toLowerCase();
  return a === b || a.endsWith("." + b) || b.endsWith("." + a);
}

// Tombol "Buka situs" tetap ditampilkan setelah import berhasil terlepas dari status
// Auto refresh, supaya pengguna bisa membuka/reload sesi secara manual kapan pun.
function showOpenSiteButton(url) {
  let label = url;
  try {
    label = new URL(url).host;
  } catch {}
  btnOpenSite.textContent = `Buka situs (${label})`;
  btnOpenSite.style.display = "block";
  btnOpenSite.onclick = async () => {
    const tab = await getActiveTab();
    if (tab?.windowId != null) chrome.tabs.create({ url, windowId: tab.windowId });
    else chrome.tabs.create({ url });
  };
}

// ---------- Allowlist ----------
async function renderAllowlist() {
  const ul = document.getElementById("allowlist-items");
  ul.innerHTML = "";
  const items = await listDomainsWithStatus();

  if (items.length === 0) {
    const li = document.createElement("li");
    li.textContent = "Belum ada domain.";
    ul.appendChild(li);
    return;
  }

  for (const { domain, active } of items) {
    const li = document.createElement("li");

    const label = document.createElement("span");
    label.textContent = domain;
    const badge = document.createElement("span");
    badge.className = `badge ${active ? "active" : "inactive"}`;
    badge.textContent = active ? "aktif" : "belum aktif";
    label.appendChild(badge);

    const btnRemove = document.createElement("button");
    btnRemove.textContent = "Hapus";
    btnRemove.style.flex = "none";
    btnRemove.onclick = async () => {
      await removeDomain(domain);
      await renderAllowlist();
      showStatus(`Domain "${domain}" dihapus dari allowlist.`);
    };

    li.appendChild(label);
    li.appendChild(btnRemove);
    ul.appendChild(li);
  }
}

document.getElementById("btn-allow-current").onclick = async () => {
  const tab = await getActiveTab();
  const hostname = hostnameOf(tab?.url || "");
  if (!hostname) {
    showStatus("Tidak bisa membaca domain tab aktif.", true);
    return;
  }
  try {
    const granted = await addDomainForHostname(hostname);
    if (granted) {
      showStatus(`Domain "${hostname}" diizinkan.`);
      await renderAllowlist();
    } else {
      showStatus("Izin ditolak.", true);
    }
  } catch (err) {
    showStatus("Gagal meminta izin: " + err.message, true);
  }
};

// ---------- Clear cache ----------
document.getElementById("btn-clear-cache").onclick = async () => {
  const tab = await getActiveTab();
  if (!tab?.url) {
    showStatus("Gagal mendapatkan URL dari tab aktif.", true);
    return;
  }
  const origin = new URL(tab.url).origin;
  const host = hostnameOf(tab.url);
  // Cache tidak membuat logout, jadi cukup konfirmasi OK/Batal.
  const ok = await askConfirm({ message: `Bersihkan cache halaman untuk ${host}?` });
  if (!ok) return;
  try {
    await chrome.browsingData.remove({ origins: [origin] }, { cache: true, cacheStorage: true });
    showStatus("Cache halaman dibersihkan.");
    // Toast dimunculkan setelah reload selesai supaya tidak ikut terhapus.
    if (chkAutoRefresh.checked) {
      await chrome.tabs.reload(tab.id);
      await waitForTabComplete(tab.id);
    }
    await showToastInTab(tab.id, `Cache ${host} dibersihkan`);
  } catch (err) {
    showStatus("Gagal membersihkan cache: " + err.message, true);
  }
};

// ---------- Clear cookie ----------
// Menghapus cookie ASLI milik domain tab aktif (bukan sekadar membersihkan textarea).
// Destruktif (membuat logout), jadi konfirmasi mewajibkan mengetik nama domainnya.
// Di-gate allowlist karena chrome.cookies.remove butuh izin host untuk domain tersebut.
document.getElementById("btn-clear-cookies").onclick = async () => {
  const tab = await getActiveTab();
  const hostname = hostnameOf(tab?.url || "");
  if (!hostname) {
    showStatus("Tidak bisa membaca domain tab aktif.", true);
    return;
  }
  if (!(await isHostnameAllowed(hostname))) {
    showStatus(`Domain "${hostname}" belum ada di allowlist. Buka tab Allowlist.`, true);
    return;
  }

  const ok = await askConfirm({
    message: `Hapus semua cookie ${hostname}? Ini akan membuat Anda logout. Ketik "${hostname}" untuk konfirmasi.`,
    requireText: hostname,
    danger: true,
  });
  if (!ok) return;

  const storeId = tab?.id != null ? await getStoreIdForTab(tab.id) : undefined;
  const cookies = await getCookiesForDomain(hostname, storeId);
  let removed = 0;
  for (const c of cookies) {
    try {
      const res = await removeCookie(c, buildCookieUrl(c, hostname), storeId);
      if (res) removed++;
    } catch {
      // lanjut ke cookie berikutnya
    }
  }
  showStatus(`Menghapus ${removed} cookie dari ${hostname}.`);
  if (chkAutoRefresh.checked && tab?.id) {
    await chrome.tabs.reload(tab.id);
    await waitForTabComplete(tab.id);
  }
  await showToastInTab(tab?.id, `${removed} cookie ${hostname} dihapus`);
};

// ---------- Screenshot ----------
// Popup ditutup setelah mengirim perintah capture, karena background.js yang
// melanjutkan proses (termasuk saat pengguna perlu berinteraksi dengan halaman).
async function triggerCapture(mode) {
  const tab = await getActiveTab();
  if (!tab?.id) {
    showStatus("Gagal mendapatkan tab aktif.", true);
    return;
  }
  const output = chkSaveFile.checked ? "file" : "clipboard";
  const redact = chkRedact.checked;
  chrome.runtime.sendMessage({ type: "capture", mode, output, tab, redact });
  window.close();
}

document.getElementById("btn-capture-area").onclick = () => triggerCapture("area");
document.getElementById("btn-capture-screen").onclick = () => triggerCapture("screen");
document.getElementById("btn-capture-full").onclick = () => triggerCapture("full");

// ---------- Status capture dari sesi sebelumnya ----------
// Capture (screenshot) berjalan di background.js karena popup ini tertutup selama
// prosesnya. Saat popup dibuka lagi, tampilkan hasil capture terakhir (bila baru
// terjadi dalam 30 detik terakhir) supaya sukses/gagal tidak perlu ditebak-tebak.
const CAPTURE_STATUS_MAX_AGE_MS = 30_000;
async function showPendingCaptureStatus() {
  const { captureStatus } = await chrome.storage.local.get("captureStatus");
  if (!captureStatus) return;
  await chrome.storage.local.remove("captureStatus");
  if (Date.now() - captureStatus.at > CAPTURE_STATUS_MAX_AGE_MS) return;

  const outputLabel = captureStatus.output === "file" ? "disimpan sebagai file" : "disalin ke clipboard";
  if (captureStatus.ok) {
    showStatus(`Screenshot (${captureStatus.mode}) berhasil ${outputLabel}.`);
  } else {
    showStatus(`Screenshot (${captureStatus.mode}) gagal: ${captureStatus.error}`, true);
  }
}

// ---------- Inisialisasi ----------
updateButtons();
loadPrefs();
renderAllowlist();
showPendingCaptureStatus();
