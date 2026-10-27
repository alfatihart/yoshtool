# Rencana implementasi — Fase 1: Session Switcher (named sessions, model swap)

> Dasar: `docs/multi-session-research.md`. Target: beberapa sesi/login bernama per situs,
> beralih satu-klik. **Satu akun per situs aktif pada satu waktu** (bukan isolasi per-tab
> simultan — itu Fase 2). Reuse maksimal `cookies.js` + `allowlist.js`, tanpa izin baru.

## Prinsip

- **Tanpa izin baru.** Pakai `cookies` + host permission per domain (sudah dikelola
  `allowlist.js`). Switch sesi untuk domain X **hanya** bila X ada di allowlist cookie
  (`isHostnameAllowed`) — karena `chrome.cookies` butuh host permission domain itu.
- **Reuse `cookies.js` apa adanya** (sudah menyimpan atribut penuh & menangani
  `__Host-`/`__Secure-`/`sameSite`/`partitionKey`/`storeId` target):
  `getCookiesForDomain`, `setCookie`, `removeCookie`, `buildCookieUrl`, `getStoreIdForTab`.
- **Satu sumber kebenaran domain** = *registrable domain* tab aktif (editable oleh user).

## Model data (`chrome.storage.local`)

```js
sessions: {
  "<domain>": [                 // domain = registrable domain, mis. "fly.web.id"
    { id, name, createdAt, updatedAt, count, cookies: [ <objek cookie penuh> ] }
  ]
}
activeSession: { "<domain>": "<session id>" }  // sesi yang sedang termuat (best-effort)
```

`cookies` di tiap sesi = hasil `getCookiesForDomain(domain, storeId)` (array utuh dari
`chrome.cookies.getAll`) — langsung reuse serializer JSON yang ada bila perlu ekspor.

## File baru

- **`sessions.js`** (ESM, di-`import` popup) — helper murni + orkestrasi:
  - `registrableDomain(hostname)` — heuristik eTLD+1 dengan daftar *compound-TLD* ringkas
    (termasuk ID: `co.id`,`web.id`,`or.id`,`ac.id`,`go.id`,`my.id`,`sch.id`,`biz.id`,
    `desa.id`, + umum: `co.uk`,`com.au`,`co.jp`, dst.). **Diuji Node** (`test/sessions.test.js`):
    `fly.web.id`→`fly.web.id`, `www.google.com`→`google.com`, `a.b.co.uk`→`b.co.uk`.
    Hasilnya **editable** di UI (heuristik tak sempurna — lihat batasan).
  - `listSessions(domain)`, `saveSession(domain, name, cookies)`, `renameSession`,
    `deleteSession`, `getActive(domain)`, `setActive(domain,id)` — baca/tulis storage.
  - `captureCurrent(domain, storeId)` = `getCookiesForDomain(domain, storeId)`.
  - `applySession(domain, session, storeId)`:
    1. hapus semua cookie domain saat ini (loop `removeCookie` + `buildCookieUrl`, seperti
       alur "Clear cookie" di `popup.js`);
    2. set tiap cookie sesi target: `setCookie(c, buildCookieUrl(c, domain), storeId)`,
       kumpulkan yang gagal untuk dilaporkan.

## Alur UI (tab baru **"Sessions"**)

`popup.html`: tambah tab ke-5 `data-tab="sessions"` (ubah `.tabs` grid → `repeat(5,1fr)`;
label "Sessions" + ikon layers) + `#panel-sessions`. Konsisten dengan sistem desain
(card, tombol primary/danger, chip, dark mode) — ikuti pola tab yang sudah ada.

Isi panel:
- Baris domain: tampilkan `registrableDomain(tab.url)` (field teks **editable**) + status
  "di allowlist?/belum" (reuse `isHostnameAllowed`). Bila belum → tombol "Izinkan domain
  tab ini" (reuse `addDomainForHostname`).
- Tombol **"Simpan sesi saat ini"** → minta nama (modal `askConfirm` dgn input) →
  `captureCurrent` → `saveSession`. Status "N cookie disimpan sebagai '<nama>'".
- **Daftar sesi** (`domain-list` style): tiap baris = nama + jumlah cookie + badge "aktif"
  (bila `activeSession[domain]===id`) + tombol **Beralih** / **Ganti nama** / **Hapus**.
- **Beralih (switch)**:
  1. (opsi "Simpan otomatis sebelum beralih", default on) bila ada sesi aktif →
     `captureCurrent` lalu timpa cookie sesi aktif (auto-save agar tak hilang);
  2. `applySession(target)`; `setActive(domain, targetId)`;
  3. `chrome.tabs.reload(tab.id)` + `waitForTabComplete` (sudah ada) → `showToastInTab`
     "Beralih ke '<nama>'".
- Gate: semua operasi set/remove cookie butuh `isHostnameAllowed(domain)`; kalau belum,
  arahkan ke allowlist (sama seperti Clear cookie).

## Keamanan & konsistensi

- **Tidak** mencampur daftar: `sessions`/`activeSession` **terpisah** dari
  `allowedDomains`/`sensorDomains`/`pbConfig`. Allowlist cookie hanya dipakai sebagai
  **gate izin host** (reuse), bukan tempat menyimpan sesi.
- Konfirmasi **destruktif**: "Beralih" & "Hapus sesi" lewat `askConfirm` (switch menimpa
  cookie situs → efek seperti logout/login; hapus sesi permanen).
- `storeId` target dari `getStoreIdForTab(tab.id)` → aman lintas normal/incognito (pola
  yang sama dengan Import).

## Batasan (ditulis jujur di UI + README)

- Hanya **cookie** yang dipindah — **bukan** `localStorage`/`IndexedDB`/cache. Login
  SPA/token berbasis IndexedDB bisa tetap gagal.
- **Bukan** isolasi simultan: 1 akun/situs aktif per waktu (buka akun lain = beralih +
  reload). Isolasi per-tab simultan = Fase 2 (DNR, opsional).
- **Bukan** anti-deteksi (fingerprint/IP sama).
- **CHIPS/partitioned cookies** mungkin tak tertangkap `getAll({domain})` default →
  dokumentasikan; bila perlu, Fase 1.1 tambah query `partitionKey`.
- `registrableDomain` heuristik → bisa salah untuk TLD majemuk langka → field editable.

## Versi & verifikasi

- Fitur baru (alat baru) → **minor**: `1.4.4` → **`1.5.0`**. CHANGELOG + README (bagian
  fitur + batasan).
- `test/sessions.test.js` (registrableDomain + skema simpan/pilih murni); `node --test`
  tetap hijau; `node --check` semua JS; cek string legacy (larangan) kosong; semua element ID popup
  dipertahankan; manifest valid.
- Manual: situs login (mis. 2 akun) → Simpan sesi A → logout+login akun B → Simpan sesi B
  → Beralih A↔B (reload, sesi pulih); cek incognito (storeId benar); cek domain non-allowlist
  ditolak dgn arahan; `__Secure-`/`__Host-` ter-set benar.

## Langkah kerja (saat implementasi disetujui)

1. `sessions.js` + `test/sessions.test.js` (registrableDomain + helper storage).
2. `popup.html`: tab + panel Sessions (desain senada), grid 5 kolom.
3. `popup.js`: wiring (render daftar, simpan, beralih, rename, hapus; gate allowlist;
   reuse `askConfirm`/`showStatus`/`waitForTabComplete`/`showToastInTab`).
4. Reuse `cookies.js`/`allowlist.js` — **tanpa** mengubah logikanya (hanya dipanggil).
5. Bump `1.5.0`, README/CHANGELOG, verifikasi, commit di branch `feat/sessions`.
