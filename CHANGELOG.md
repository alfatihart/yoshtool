# Changelog

## 1.3.0

Tab **Dev** baru dengan alat bantu pengembang.

### Isi form (data dummy / Faker)
- Isi semua input di tab aktif dengan data palsu **locale Indonesia**: nama, email,
  No. HP (prefix operator nyata), NIK (16 digit valid), NPWP, alamat
  (Jl./Kel./Kec./Kota/kode pos), no rekening (panjang per bank), kartu uji (4242…).
- Deteksi tipe field dari `name`/`id`/`<label>`/`aria-label` + atribut `type`; `setNativeValue`
  agar React/Vue mendeteksi perubahan; dukung `<select>`/checkbox/radio; field "konfirmasi"
  menyalin nilai sebelumnya; opsi **"Jangan timpa field yang sudah terisi"**.
- Shortcut `Alt+Shift+D` (mungkin perlu di-bind manual di `chrome://extensions/shortcuts`).

### Color picker
- **Eyedropper** (EyeDropper API bawaan, Chrome 95+) ambil warna piksel mana pun —
  langsung dari popup, tanpa izin host. Salin **HEX / RGB / HSL**; riwayat 12 warna.
- **Palette halaman**: ekstrak warna dominan dari halaman (klik swatch untuk salin).

### Font inspector
- Hover elemen → tooltip **font asli** (deteksi canvas pixel-compare), ukuran, weight.
- Klik → kartu detail (stack font dgn yang dipakai ditebalkan, line-height, warna,
  badge **Google Fonts/Adobe Fonts** bila terdeteksi). Esc untuk keluar.

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
