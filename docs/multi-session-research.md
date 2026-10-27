# Riset: fitur "multi-session tab" untuk YoshTool

> Hasil deep-research (104 agen, 5 sudut, 22 sumber → 37 klaim → 25 diverifikasi:
> 16 terkonfirmasi, 9 terefut). Tujuan: memahami fitur & arsitektur ekstensi
> multi-session tab (login beberapa akun pada situs yang sama) sebelum menambahkannya
> ke YoshTool. Referensi yang diminta: SessionVault & TabSession (keduanya kategori
> SessionBox).

## TL;DR

"Multi-session tab" punya **dua model arsitektur**, dan keduanya harus mengakali dua
kenyataan Chrome MV3: **hanya ada satu cookie jar per profil**, dan **tidak ada API
`contextualIdentities`/Containers seperti Firefox**.

Untuk YoshTool (vanilla JS, tanpa build step, sudah punya `cookies.js` + `allowlist.js`),
jalur paling realistis & andal adalah **model "named session / swap"**. Isolasi per-tab
simultan (gaya SessionBox) layak secara teknis tetapi rapuh → jadikan **mode lanjutan
opsional** dengan batasan yang dijelaskan jujur.

## 1. Dua model fitur

| | **A. Isolasi per-tab SIMULTAN** | **B. Named session / SWAP** |
|---|---|---|
| Contoh | SessionBox, SessionVault, TabSession, Session Switcher | SwitchSession, multi-account-hub |
| Perilaku | Login banyak akun di situs yang sama **sekaligus**; tiap tab seolah punya cookie jar sendiri | Simpan sesi bernama; **beralih** satu-klik; **hanya 1 akun/situs aktif** pada satu waktu |
| Mekanisme | State dikelola di level ekstensi + tulis-ulang header `Cookie` per-request (DNR) | Simpan cookie lama → hapus cookie situs → tulis cookie target → reload tab |
| Keandalan | Rapuh (lihat §3) | Lebih andal — bekerja *di dalam* cookie jar tunggal |

Dua referensi yang diminta (SessionVault/TabSession) = kategori **A**.
SessionBox: *"use one browser with multiple active sessions per site and log into
multiple accounts on the same site simultaneously."*

## 2. Kendala inti Chrome MV3

- **Satu cookie jar per profil.** `chrome.cookies.storeId` **hanya** membedakan store
  *default* vs *incognito* — bukan container per-tab. Tidak ada `contextualIdentities`
  (Firefox-only). Jadi isolasi harus "disimulasikan".
- **Primitif yang tersedia:** DNR `modifyHeaders` (`set`/`append`/`remove`) bisa menulis
  ulang header request/response, dan header **`cookie` ada di allowlist operasi
  `append`** → manipulasi `Cookie` per-request bisa **tanpa** `webRequest`.

## 3. Kenapa model A (per-tab simultan) rapuh

- Pencocokan per-tab (kondisi **`tabIds`**) **HANYA** didukung **session-scoped rules** →
  **ephemeral** (hilang saat browser restart / update ekstensi) → **wajib rebuild di
  `chrome.runtime.onStartup`**.
- Batas DNR: **5000 session rules** (Chrome 120+); `modifyHeaders` tergolong "unsafe".
- **Service worker MV3 ephemeral** → state sesi mudah hilang bila tak dipersist.
- ⚠️ **Hasil verifikasi penting:** klaim bahwa ekstensi tertentu ("Multi-Login",
  "Header Override") benar-benar mengisolasi httpOnly + localStorage + IndexedDB penuh,
  atau menulis ulang `Set-Cookie` via DNR, **TEREFUT (vote 0-3)**. Jadi **jangan
  mengasumsikan isolasi storage penuh itu mudah/terbukti.**

## 4. Batasan yang WAJIB dijelaskan ke pengguna

1. **Cookie saja tidak cukup.** Ekstensi swap umumnya hanya menangani cookie (kadang
   `localStorage`), **tidak `IndexedDB`/cache**. Login SPA/token (mis. Firebase Auth,
   banyak JWT) yang menyimpan sesi di IndexedDB **tak akan terpisah/terestorasi bersih**.
   (multi-account-hub: *"Only cookies are managed… won't be fully switched."*)
2. **Bukan anti-deteksi.** Isolasi ini mengubah *apa yang disimpan halaman*, **bukan
   fingerprint / IP / canvas / font / TLS**. Platform tetap bisa mengaitkan akun. Ini
   **separasi kenyamanan, bukan sandbox keamanan** — itulah alasan kategori antidetect
   (Multilogin/GoLogin/AdsPower) ada.
3. **Reload saat switch** dapat mengganggu state halaman.
4. **CHIPS / partitioned cookies**: `chrome.cookies.getAll({domain})` default hanya
   mengembalikan cookie tak-berpartisi; cookie CHIPS perlu query `partitionKey` eksplisit.

## 5. Kelayakan & izin (MV3)

- **Model B (swap):** izin **`cookies`** + host permissions per domain (sudah dikelola
  `allowlist.js`). **Tanpa** `webRequest`/DNR. Paling sederhana & andal.
- **Model A (per-tab):** tambah **`declarativeNetRequestWithHostAccess`**; session rules
  dengan kondisi `tabIds`, rebuild di `onStartup`, dalam batas 5000 rule, hanya header
  `Cookie`. Tandai eksperimental.

## 6. Rekomendasi untuk YoshTool

**Fase 1 — "Session Switcher" (model swap).** Reuse `cookies.js` (serialisasi penuh +
`setCookie`/`removeCookie`/`getCookiesForDomain`/`getStoreIdForTab`/`buildCookieUrl` yang
sudah menangani `__Host-`/`__Secure-`/`sameSite`/`partitionKey`) dan `allowlist.js`
(gate izin host per domain). Detail di `docs/multi-session-plan.md`.

**Fase 2 — (opsional) isolasi per-tab simultan via DNR.** Hanya bila ada kebutuhan nyata;
dengan batasan yang dijelaskan jujur.

## Pertanyaan terbuka

- Isolasi `localStorage`/`IndexedDB` per-tab yang andal di MV3 **belum jelas** (klaim soal
  ini justru terefut di riset) → login SPA/token berbasis IndexedDB sulit dipisah.
- Penanganan **CHIPS/partitioned cookies** pada capture/restore.
- Mekanisme PASTI SessionBox/SessionVault/TabSession tak terkonfirmasi (tak ada teardown
  kode publik).

## Catatan verifikasi

Banyak halaman primer (Chrome Web Store, Codeberg, developer.chrome.com) tak dapat
di-fetch langsung di lingkungan riset (proxy 403/DNS) → sebagian konfirmasi berasal dari
ringkasan WebSearch sumber yang sama, konsisten lintas mirror (MDN, Chromium IDL). Angka
batas DNR berlaku Chrome 120+. `multi-account-hub` diarsipkan 2026-07-17. Rekomendasi
arsitektur adalah sintesis editorial — divalidasi lewat kode YoshTool aktual + prototipe.

## Sumber utama

- SessionBox (model A, simultan): <https://chrome.google.com/webstore/detail/sessionbox-multi-login-to/megbklhjamjbcafknkgmokldgolkdfig>
- multi-account-hub (model B, open source): <https://codeberg.org/kernvoid/multi-account-hub>
- SwitchSession (model B, save/restore): <https://chromewebstore.google.com/detail/ngdjhemjkglohbmdigmmhllabfajcafa>
- DNR `modifyHeaders`, `tabIds`, batas rule: <https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest>
- Kondisi rule DNR (MDN): <https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/API/declarativeNetRequest/RuleCondition>

### Klaim yang TEREFUT (jangan dijadikan asumsi)

- "Multi-Login memberi tiap tab cookie jar + storage namespace sendiri (httpOnly +
  localStorage + IndexedDB)" — **0-3**.
- "Header Override menulis ulang request `Cookie` **dan** response `Set-Cookie` via DNR" —
  **0-3** (penulisan ulang `Set-Cookie` via DNR tidak terbukti).
- "Isolasi juga mencakup localStorage/sessionStorage/IndexedDB penuh" — **1-2**.
