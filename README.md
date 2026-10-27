# YoshTool

Ekstensi Chrome (Manifest V3) untuk kebutuhan pengembangan & pengujian: mengelola
cookie/sesi antar profil, membersihkan cache/cookie situs, dan mengambil screenshot
halaman — semuanya berjalan lokal di browser.

Antarmuka memakai sistem desain berbasis token dengan **dark mode otomatis**
(mengikuti `prefers-color-scheme` OS) dan aksen slate monokrom yang tenang.

## Fitur

- **Export / Import cookie** dalam tiga format: JSON, Header String, dan Netscape.
  - Export: **Copy** ke clipboard atau **Save file**.
  - Import: **Paste** dari clipboard atau **Open file**; format terdeteksi otomatis.
  - Import tahan lintas-tab/incognito (domain diambil dari data cookie, store ditentukan
    eksplisit dari tab aktif), dengan opsi "Hapus cookie lama sebelum import" dan
    auto-refresh/"Buka situs" ke URL saat export.
- **Allowlist domain** — export/import hanya untuk domain yang Anda izinkan sendiri
  lewat dialog izin Chrome (tombol "Izinkan domain tab ini"). Tidak ada akses host
  otomatis saat instal.
- **Sessions (multi-login)** — tab **Sessions**: simpan beberapa login bernama untuk
  situs yang sama lalu **beralih satu-klik** (tukar cookie + reload). Satu akun aktif per
  situs pada satu waktu. Di-gate allowlist (butuh izin host domainnya). _Batasan:_ hanya
  cookie yang dipindah (bukan localStorage/IndexedDB), bukan isolasi simultan, bukan
  anti-deteksi. Lihat [`docs/multi-session-research.md`](docs/multi-session-research.md).
- **Clear cache** dan **Clear cookie** untuk domain tab aktif (dengan konfirmasi;
  clear cookie wajib mengetik nama domain).
- **Screenshot**: Capture area, Capture screen area, dan Capture full page
  (`chrome.debugger`, satu halaman utuh). Output default ke clipboard, opsi simpan file.
  Toast konfirmasi muncul di halaman setelah aksi.
- **Sensor data sensitif pada screenshot** (opsional): deteksi & usulkan kotak sensor
  untuk email, telepon, kartu kredit (Luhn), API key, JWT, IBAN, alamat, serta field
  rahasia/PII — metode **Solid** (aman, irreversible) atau **Blur**. Kotak bisa
  di-toggle, ditambah manual, dan di-reset sebelum "Sensor & tangkap".
- **Auto-sensor realtime (mode privasi)**: menutup (blur) data sensitif langsung di
  halaman saat browsing, untuk proteksi screen-share. Berjalan hanya di domain yang
  Anda tambahkan ke daftar **Auto-sensor** (tab Allowlist). **Klik untuk tampil
  sementara.** Daftar ini **terpisah** dari allowlist cookie: menambah domain di sini
  tidak mengaktifkan ekspor cookie-nya.
- **Dev tools** (tab Dev):
  - **Isi form (data dummy)** — isi semua input dengan data palsu locale Indonesia
    (nama, email, No. HP, NIK, NPWP, alamat, no rekening, kartu uji); mendukung
    React/Vue (native setter), `<select>`/checkbox/radio, dan field konfirmasi.
  - **Color picker** — **eyedropper di halaman** dengan loupe/magnifier (zoom 10×,
    hex live; popup ditutup agar tak menghalangi seleksi), selektor warna + hex live,
    salin HEX/RGB/HSL, riwayat 12 warna, dan **palette halaman** (warna dominan).
  - **Font inspector** — hover untuk melihat font asli (canvas pixel-compare), klik
    untuk kartu detail + deteksi Google/Adobe Fonts.
- **Popup blocker** (tab Tools) — blokir popup/popunder `window.open` di semua situs
  (port dari "Popup Blocker (strict)"). Default memblok hanya `window.open` programatik;
  mode **Strict** juga memblok klik `target=_blank`. Tiap blok menampilkan bar
  (Izinkan / Latar / Alihkan / Percaya domain / Blokir). Host OAuth & pembayaran umum
  sudah di-whitelist default; ada tombol **Nonaktifkan di situs ini** per domain.
  Butuh izin akses semua situs — diminta lewat tombol (dialog Chrome), bukan saat instal.

## Shortcut keyboard

Default (bisa diubah di `chrome://extensions/shortcuts`):

| Aksi | Windows/Linux | Mac |
|------|---------------|-----|
| Buka popup | `Alt+Shift+Y` | `Command+Shift+Y` |
| Capture area | `Alt+Shift+1` | `Command+Shift+1` |
| Capture screen area | `Alt+Shift+2` | `Command+Shift+2` |
| Capture full page | `Alt+Shift+F` | `Command+Shift+F` |
| Isi form (data dummy) | _(atur manual)_ | _(atur manual)_ |

> Chrome hanya memberi default untuk maks. 4 shortcut. "Isi form" tidak punya default —
> atur sendiri (mis. `Alt+Shift+D`) di `chrome://extensions/shortcuts`. Tombol di tab Dev
> tetap berfungsi tanpa shortcut.

Shortcut capture memakai preferensi tersimpan (clipboard/file & sensor on/off) dari tab Tools.

Catatan: shortcut bisa bentrok. Bila satu kombinasi dipakai ekstensi lain, Chrome
membiarkannya **tidak ter-bind** (diam-diam). Hotkey **global** aplikasi lain (mis.
Lightshot `Alt+Shift+S`) selalu menang atas Chrome. Cek/ubah pemetaan di
`chrome://extensions/shortcuts`.

## Instalasi (Load unpacked)

Ekstensi ini tanpa build step — folder repo langsung dimuat sebagai ekstensi.

### Opsi A — Clone (disarankan, mudah di-update)

```bash
git clone https://github.com/alfatihart/yoshtool.git
```

1. Buka `chrome://extensions`.
2. Aktifkan **Developer mode** (toggle kanan atas).
3. Klik **Load unpacked**, lalu pilih folder `yoshtool` hasil clone.
4. (Opsional) Buka **Details** ekstensi → aktifkan **Allow in Incognito** bila ingin
   memakainya di jendela samaran.

### Opsi B — Download ZIP

1. Di halaman GitHub repo: tombol hijau **Code → Download ZIP**.
2. Ekstrak ZIP-nya ke sebuah folder.
3. Lanjutkan langkah 1–4 seperti Opsi A, pilih folder hasil ekstrak.

## Update ke versi terbaru

- **Jika meng-clone:** di folder repo jalankan `git pull`, lalu buka
  `chrome://extensions` dan klik ikon **Reload** (⟳) pada kartu YoshTool.
- **Jika pakai ZIP:** download ZIP terbaru, ekstrak menimpa folder lama, lalu klik
  **Reload** (⟳) pada kartu ekstensi.

> Setelah update, muat ulang juga halaman/tab yang sedang terbuka agar content script
> versi baru (popup blocker, auto-sensor, dsb.) ikut terpasang. Nomor versi tampil di
> pojok header popup dan di `chrome://extensions`.

## Dokumentasi tambahan

- [`docs/multi-session-research.md`](docs/multi-session-research.md) — riset fitur & arsitektur
  "multi-session tab" (login beberapa akun per situs) + batasan Chrome MV3.
- [`docs/multi-session-plan.md`](docs/multi-session-plan.md) — rencana implementasi Fase 1
  (Session Switcher berbasis swap cookie, reuse `cookies.js`/`allowlist.js`).

## Pengembangan & test

Unit test murni (parser/serializer cookie, validasi, pembangun URL) memakai test
runner bawaan Node:

```bash
node --test ./test/*.test.js
```

## Struktur file

| File | Fungsi |
|------|--------|
| `manifest.json` | Deklarasi izin & service worker |
| `popup.html` / `popup.js` | UI popup bertab: Cookies, Allowlist (Cookie + Auto-sensor), Tools |
| `cookies.js` | Parser/serializer 3 format + helper `chrome.cookies` |
| `sessions.js` | Session Switcher: registrable-domain + simpan/beralih sesi (reuse `cookies.js`, diuji Node) |
| `allowlist.js` | Baca/tulis dua daftar domain (cookie & sensor) di `chrome.storage.local` |
| `background.js` | Service worker: orkestrasi screenshot, routing izin, daftar skrip sensor |
| `redact.js` | Detektor data sensitif murni (diuji Node) — dipakai capture & auto-sensor |
| `redact-overlay.js` | Content script "deteksi & usulkan" saat screenshot (disuntik on-demand) |
| `sensor.js` | Content script auto-sensor realtime (didaftarkan dinamis per domain) |
| `faker-data.js` | Generator data dummy locale ID + pencocok field (murni, diuji Node) |
| `filler.js` | Content script "isi form" (salinan inline `faker-data.js` + DOM) |
| `color.js` | Konversi warna (HEX/RGB/HSL) untuk color picker (diuji Node) |
| `eyedropper.js` | Content script eyedropper di halaman (loupe magnifier dari snapshot) |
| `fontinspector.js` | Content script inspektor font (hover + canvas pixel-compare) |
| `popblock-core.js` | Logika keputusan popup blocker murni (diuji Node) |
| `popblock-main.js` | Content script dunia MAIN: override `window.open` + proxy klik/form |
| `popblock-isolated.js` | Content script dunia ISOLATED: keputusan + bar notifikasi (salinan inline `popblock-core.js`) |
| `selector.js` | Content script overlay pilih area (disuntik on-demand) |
| `toast.js` | Toast notifikasi di dalam halaman |
| `test/` | Unit test Node |

## Catatan izin & keamanan

- Export/import cookie dibatasi **allowlist** yang Anda kelola sendiri; ekstensi tidak
  punya akses host tetap ke situs mana pun saat instal (`optional_host_permissions`).
- Cookie adalah kunci sesi — simpan file export dengan hati-hati; siapa pun yang
  memegangnya bisa masuk ke akun terkait.
- `chrome.debugger` (full page) memunculkan infobar "sedang men-debug" dari Chrome;
  ini UI keamanan bawaan browser dan tidak bisa disembunyikan oleh ekstensi.
- **Auto-sensor terpisah dari cookie:** daftar Auto-sensor dan allowlist cookie disimpan
  dan di-gate secara independen. Izin host memang dibagi Chrome, tapi domain yang hanya
  ada di daftar sensor tidak akan lolos pemeriksaan ekspor/impor cookie.
- Sensor **Solid** membakar kotak ke piksel gambar (irreversible); **Blur** dapat
  dipulihkan — untuk data sangat sensitif pada screenshot pakai Solid. Blur realtime
  (auto-sensor) hanya proteksi tampilan layar, bukan artefak yang diekspor.
- Deteksi berbasis teks DOM & field form; konten di dalam `<canvas>`/gambar dan nama
  orang belum tercakup.
- **Popup blocker** butuh izin host **global** (`*://*/*`) agar skrip `document_start`
  MAIN bisa mengganti `window.open` di semua situs. Izin ini diminta lewat tombol
  (dialog Chrome), bukan ditulis tetap di manifest, dan terpisah dari daftar
  cookie/sensor. Karena meniru mode strict yang memblok default, **setiap** `window.open`
  memunculkan bar sampai domainnya di-"Percaya"/masuk whitelist atau situsnya
  di-nonaktifkan — whitelist default (OAuth/pembayaran) mengurangi gangguan. v1 tanpa
  countdown/aksi-otomatis, rules URL, dan proteksi iframe lanjutan milik ekstensi asli.
