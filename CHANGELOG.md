# Changelog

## 1.5.2

- Sessions kini ikut memindah **localStorage + sessionStorage**, bukan cuma cookie.
  Penting untuk login **SPA/Supabase** (token sesi disimpan di `localStorage` key
  `sb-<ref>-auth-token`, bukan cookie) — sebelumnya "0 cookie" & sesi tak ter-swap.
  Simpan/beralih kini menangkap & memulihkan storage halaman (via `chrome.scripting`),
  lalu reload. Baris sesi menampilkan jumlah `cookie · storage`. localStorage hanya
  terbaca saat tab aktif berada di domain tsb (localStorage per-origin). IndexedDB
  masih di luar cakupan.

## 1.5.1

- Fix Sessions: domain default kini **hostname penuh tab** (mis.
  `staging-app.konsultanedu.com`), bukan registrable domain (`konsultanedu.com`).
  Sebelumnya registrable yang lebih luas sering tak cocok dengan entri allowlist
  (yang per-hostname) → "Domain belum diizinkan" walau situsnya sudah di-allowlist.
  Kini konsisten dengan fitur Export/Import. Domain tetap editable.

## 1.5.0

**Session Switcher (multi-login) — Fase 1.** Tab baru **Sessions**: simpan beberapa
login bernama untuk situs yang sama, lalu beralih satu-klik.

- Model **swap**: beralih = (opsional simpan dulu sesi aktif) → hapus cookie situs →
  tulis cookie sesi target → reload tab. **Satu akun aktif per situs** pada satu waktu.
- `sessions.js` (baru, diuji Node): `registrableDomain()` (eTLD+1, termasuk TLD ID
  `co.id`/`web.id`/dst, editable di UI), simpan/ganti-nama/hapus/aktifkan sesi,
  `captureCurrent`/`applySession`. Reuse `cookies.js` (serialisasi + set/remove cookie,
  sudah menangani `__Host-`/`__Secure-`/`sameSite`/`partitionKey`/`storeId`) & `allowlist.js`
  (gate izin host). **Tanpa izin baru.**
- Konfirmasi untuk aksi destruktif (beralih = efek logout/login, hapus sesi).
- **Batasan** (ditulis di UI): hanya cookie yang dipindah (bukan localStorage/IndexedDB →
  sebagian login SPA/token bisa tak ikut); bukan isolasi per-tab simultan; bukan anti-deteksi.

## 1.4.4

- **Link GitHub** di header popup (ikon kanan atas) → buka repo di tab baru.
- **Reset riwayat warna**: tombol "Reset" muncul di atas riwayat color picker
  (hanya saat ada isinya) untuk mengosongkan daftar warna terambil.
- **Dokumentasi instalasi & update** di README: cara pasang via clone atau ZIP, dan
  cara update (git pull / download ulang + Reload di `chrome://extensions`).

## 1.4.3

- **Eyedropper diambil DI HALAMAN, bukan di popup** (pola ColorZilla). Sebelumnya
  EyeDropper dipanggil dari popup sehingga jendela popup mengambang menutupi sebagian
  halaman dan menghalangi seleksi warna. Sekarang: klik "Eyedropper" → popup ditutup →
  `captureVisibleTab` + **loupe/magnifier** (`eyedropper.js`) yang mengikuti kursor
  (zoom 10×, penanda piksel, hex live). Klik untuk ambil: warna otomatis tersalin ke
  clipboard + masuk riwayat (terlihat saat popup dibuka lagi); Esc/klik-kanan batal.
  Halaman restricted (chrome://, Web Store) tetap pakai EyeDropper native sebagai cadangan.

## 1.4.2

Redesign UI/UX popup + overlay halaman (adopsi pola dari WhatFont, Popup Blocker,
ColorZilla, Fake Filler).

- **Sistem desain berbasis token** dengan **dark mode otomatis** (`prefers-color-scheme`).
  Aksen **Slate monokrom** yang tenang; warna semantik (hijau/merah/amber) tetap.
- **popup.html** ditata ulang: header logo-mark, tab bar segmented ber-ikon, tiap fitur
  jadi **card** ber-judul-ikon, hierarki tombol primary/danger/ghost, checkbox
  `accent-color`, focus-ring aksesibel, font sistem. Logika (`popup.js`) tidak berubah —
  semua element ID & hook dipertahankan.
- **Overlay di halaman diselaraskan**: bar popup-blocker, toast, tooltip + kartu detail
  font-inspector, dan toolbar sensor screenshot kini satu bahasa desain (kartu gelap,
  nilai monospace, tombol semantik).
- Microcopy dirapikan (capture → Area / Layar / Full page, CTA lebih jelas).

## 1.4.1

- Fix: tambah `<meta charset="UTF-8">` di `popup.html`. Tanpa ini, em-dash `—`
  (mis. label **"Strict — blokir juga popup dari klik"** dan beberapa hint) tampil
  mojibake `â€"`.

## 1.4.0

**Popup blocker (global)** — port dari "Popup Blocker (strict)" v0.9.4
(schomery/popup-blocker), diadaptasi ke pola YoshTool.

- Dua content script `document_start` + `allFrames`: **MAIN** (`popblock-main.js`)
  mengganti `window.open` (Proxy; saat blok mengembalikan objek `simulate()` perekam,
  bukan `null`, agar kode pemanggil tak error) plus proxy `a.click`/`dispatchEvent` &
  `form.submit`/`dispatchEvent`; **ISOLATED** (`popblock-isolated.js`) mengambil
  keputusan dan menampilkan bar. Komunikasi antar-dunia lewat port span **sinkron**.
- Logika keputusan murni `popblock-core.js` (diuji Node, 14 test) — disalin **identik**
  inline ke ISOLATED. Default-block `window.open`; override whitelist host /
  same-registrable (opsional) / protokol (`magnet:`).
- Mode **Strict**: ikut memblok klik `target=_blank` (meniru ekstensi asli); default
  non-strict hanya memblok `window.open` programatik agar navigasi klik tak terganggu.
- **Bar notifikasi** (div injeksi namespaced, bukan iframe): Izinkan / Latar / Alihkan /
  Percaya domain (dua-klik) / Blokir, + "Nonaktifkan di situs ini". "Izinkan" setia
  memutar ulang `window.open` (+rekaman) di dunia MAIN.
- UI di **tab Tools**: aktifkan (minta izin `*://*/*` lewat tombol), master on/off,
  Strict, izinkan same-origin, daftar whitelist & situs nonaktif, badge jumlah blok.
- Whitelist default host OAuth/pembayaran (accounts.google.com, paypal.com,
  checkout.stripe.com, dll.) agar login tak rusak. State namespaced `pbEnabled`/`pbConfig`,
  **terpisah** dari daftar cookie/sensor (disambiguasi `pendingGrant.type="popblock"`).
- v1 melewati: countdown/aksi-otomatis, rules URL, proteksi iframe lanjutan, options page
  terpisah (pakai section di popup).

## 1.3.1

- Color picker: **selektor warna live** — `<input type="color">` + field hex yang bisa
  diketik, dengan **HEX/RGB/HSL update live** saat digeser/diketik. Eyedropper, palette,
  dan riwayat ikut menyetel selektor (dua arah). Warna awal tampil saat popup dibuka.

## 1.3.0

Tab **Dev** baru dengan alat bantu pengembang.

### Isi form (data dummy / Faker)
- Isi semua input di tab aktif dengan data palsu **locale Indonesia**: nama, email,
  No. HP (prefix operator nyata), NIK (16 digit valid), NPWP, alamat
  (Jl./Kel./Kec./Kota/kode pos), no rekening (panjang per bank), kartu uji (4242…).
- Deteksi tipe field dari `name`/`id`/`<label>`/`aria-label` + atribut `type`; `setNativeValue`
  agar React/Vue mendeteksi perubahan; dukung `<select>`/checkbox/radio; field "konfirmasi"
  menyalin nilai sebelumnya; opsi **"Jangan timpa field yang sudah terisi"**.
- Shortcut keyboard: atur manual di `chrome://extensions/shortcuts` (mis. `Alt+Shift+D`)
  — Chrome membatasi default maks. 4 shortcut, jadi "Isi form" tanpa default. Tombol di
  tab Dev tetap berfungsi tanpa shortcut.

### Color picker
- **Eyedropper** (EyeDropper API bawaan, Chrome 95+) ambil warna piksel mana pun —
  langsung dari popup, tanpa izin host. Salin **HEX / RGB / HSL**; riwayat 12 warna.
- **Palette halaman**: ekstrak warna dominan dari halaman (klik swatch untuk salin).

### Font inspector
- Hover elemen → tooltip **font asli** (deteksi canvas pixel-compare), ukuran, weight.
- Klik → kartu detail (stack font dgn yang dipakai ditebalkan, line-height, warna,
  badge **Google Fonts/Adobe Fonts** bila terdeteksi), **preview teks** + **Salin CSS**.
  Esc untuk keluar.

### UX
- Urutan tab: **Dev · Tools · Cookies · Allowlist**; popup **mengingat tab terakhir**.
- **Menu klik-kanan**: "Isi form dengan data dummy" & "Inspeksi font (WhatFont)" —
  akses cepat tanpa buka popup (izin `contextMenus`).
- Color picker: nilai **HEX/RGB/HSL disusun vertikal** (tidak lagi terpotong 2 baris),
  klik untuk salin. **Palette halaman jadi toggle** (klik lagi untuk tutup) + header jumlah.

## 1.2.0

Fitur privasi baru: auto-sensor realtime + perluasan deteksi data pribadi.

### Auto-sensor realtime (mode privasi)
- Menutup (blur) data sensitif langsung di halaman saat browsing — untuk proteksi
  screen-share/rekaman, di luar fitur screenshot. **Klik untuk tampil sementara**
  (field: tampil saat fokus agar bisa diedit).
- Berjalan hanya di domain yang ditambahkan ke daftar **Auto-sensor** (tab Allowlist,
  tombol "Lindungi domain tab ini"), lewat skrip konten yang didaftarkan dinamis.
- Master on/off di tab Allowlist; realtime pada halaman dinamis (MutationObserver).
- **Keamanan:** daftar auto-sensor TERPISAH dari allowlist cookie. Menambah domain ke
  auto-sensor tidak pernah mengaktifkan ekspor cookie-nya (disambiguasi lewat
  `pendingGrant`, bukan default-ke-cookie).

### Perluasan deteksi (capture & auto-sensor)
- Tambahan kategori **alamat** (heuristik Indonesia: Jl./Jalan/Gg./Blok + No./RT-RW/
  kode pos) dan **field data pribadi/sensitif** (`PII_FIELD_RE`): kontak (Email, No.
  Telepon, WhatsApp), lokasi (Provinsi, Kota/Kabupaten, Kecamatan, Kelurahan, Kode Pos),
  finansial (No. Rekening, No. Kartu, CVV, IBAN, Virtual Account), serta Callback/Webhook
  URL — berlaku untuk sensor saat screenshot maupun auto-sensor.
- Kategori lengkap: email, telepon, kartu kredit (Luhn), IBAN, API key, JWT, alamat,
  field rahasia, field PII, dan token berentropi tinggi.

### Refinement deteksi field
- Hanya field **ber-nilai** yang di-blur (field kosong seperti password/pencarian yang
  belum diisi tidak lagi ikut ter-blur).
- Input **password** & **search** dilewati (password sudah disembunyikan browser;
  kotak pencarian bukan data tampilan), termasuk kotak "Reference No / Merchant /
  Customer Phone".
- Auto-sensor: rahasia yang baru diketik ke field kosong ikut ter-blur saat fokus lepas.
- "Account Owner" (nama) sengaja tidak ikut ter-blur.
- **Field yang dimuat async** (Province/City/Subdistrict/Postal/Address/Account Number/
  Whitelist IP yang nilainya masuk belakangan) kini ikut ter-blur otomatis tanpa perlu
  klik — auto-sensor memindai ulang field beberapa kali setelah halaman dimuat.
- **No rekening & Whitelist IP di tabel** ter-blur lewat **masking berbasis kolom**
  (header "Destination Account", "Whitelist IP", dll) — kolom "Reference No"/
  "Description"/"Amount" tidak tersentuh, jadi **kode transaksi tidak lagi ikut ter-blur**.
- **Field Whitelist IP** terdeteksi dari nilai IP-nya (IPv4/IPv6), bukan hanya label.
- **Field Account Number** (mis. Withdrawal) terdeteksi dari nilainya (deret 10–19 digit
  murni) saat label-nya tak terbaca — hanya nilai field, jadi kode transaksi di teks
  tetap aman.
- Deteksi **telepon** kini dibatasi agar tidak cocok di dalam token alfanumerik panjang
  (mis. kode transaksi "T30086…XR3Z4").

## 1.1.0

Rilis besar dengan banyak fitur baru di atas basis 1.0 (ekspor/impor cookie JSON).

### Cookie / sesi
- Format ekspor/impor tambahan: **Header String** dan **Netscape** (selain JSON),
  dengan deteksi format otomatis saat impor.
- Ekspor: **Copy** ke clipboard atau **Save file**. Impor: **Paste** atau **Open file**.
- Impor tahan lintas-tab/incognito: domain diambil dari data cookie, store ditentukan
  eksplisit dari tab aktif, dengan verifikasi baca-ulang.
- Opsi **Hapus cookie lama sebelum impor**, **Auto refresh**, dan tombol **Buka situs**
  (membuka URL saat ekspor).
- Perbaikan: `__Secure-`/`__Host-` di-set via `https://`; `hostOnly` tidak memaksa domain;
  `partitionKey` diteruskan.

### Allowlist
- Ekspor/impor dibatasi **allowlist domain** yang dikelola sendiri lewat dialog izin
  Chrome ("Izinkan domain tab ini") — tanpa akses host otomatis saat instal.

### Tools
- **Clear cache** dan **Clear cookie** untuk domain tab aktif (dengan konfirmasi;
  clear cookie wajib mengetik nama domain).
- **Screenshot**: Capture area, Capture screen area, Capture full page
  (satu halaman utuh via `chrome.debugger`). Output clipboard atau simpan file.
- **Toast** konfirmasi di halaman untuk screenshot, clear cache/cookie, dan impor.

### Sensor data sensitif (redaction, Fase 1)
- Deteksi otomatis di teks DOM & field form: email, telepon, kartu kredit (Luhn),
  API key (AWS/Google/Stripe/GitHub), JWT, IBAN, serta field rahasia berbasis label
  dan token berentropi tinggi.
- Mode **deteksi lalu usulkan**: kotak kandidat bisa di-toggle, tambah kotak manual,
  dan reset manual.
- Metode sensor **Solid** (aman, default) atau **Blur**, dengan pilihan warna.
- Hanya teks DOM (canvas/OCR & nama orang = fase berikutnya).

### Shortcut keyboard
- Buka popup `Alt+Shift+Y`, Capture area `Alt+Shift+1`, screen `Alt+Shift+2`,
  full page `Alt+Shift+F` (bisa di-rebind di `chrome://extensions/shortcuts`).

### Lain-lain
- Ikon ekstensi, README, CHANGELOG, dan unit test (`node --test ./test/*.test.js`).

## 1.0

- Ekspor/impor cookie dalam format JSON lewat popup.
