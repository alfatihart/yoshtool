# YoshTool

Ekstensi Chrome (Manifest V3) untuk kebutuhan pengembangan & pengujian: mengelola
cookie/sesi antar profil, membersihkan cache/cookie situs, dan mengambil screenshot
halaman — semuanya berjalan lokal di browser.

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
- **Clear cache** dan **Clear cookie** untuk domain tab aktif (dengan konfirmasi;
  clear cookie wajib mengetik nama domain).
- **Screenshot**: Capture area, Capture screen area, dan Capture full page
  (`chrome.debugger`, satu halaman utuh). Output default ke clipboard, opsi simpan file.
  Toast konfirmasi muncul di halaman setelah aksi.

## Shortcut keyboard

Default (bisa diubah di `chrome://extensions/shortcuts`):

| Aksi | Windows/Linux | Mac |
|------|---------------|-----|
| Buka popup | `Alt+Shift+Y` | `Command+Shift+Y` |
| Capture area | `Alt+Shift+A` | `Command+Shift+A` |
| Capture screen area | `Alt+Shift+S` | `Command+Shift+S` |
| Capture full page | `Alt+Shift+F` | `Command+Shift+F` |

Shortcut capture memakai preferensi tersimpan (clipboard/file & sensor on/off) dari tab Tools.

## Instalasi (Load unpacked)

1. Buka `chrome://extensions`.
2. Aktifkan **Developer mode**.
3. Klik **Load unpacked**, pilih folder repo ini.
4. (Opsional) Aktifkan **Allow in Incognito** bila ingin memakai di jendela samaran.

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
| `popup.html` / `popup.js` | UI popup bertab: Cookies, Allowlist, Tools |
| `cookies.js` | Parser/serializer 3 format + helper `chrome.cookies` |
| `allowlist.js` | Baca/tulis daftar domain diizinkan di `chrome.storage.local` |
| `background.js` | Service worker: orkestrasi screenshot & sinkronisasi allowlist |
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
