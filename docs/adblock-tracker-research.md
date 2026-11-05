# Research: Ad blocker + Tracker blocker — reverse-engineering Ghostery & AdBlocker Ultimate

Tujuan: menambah **fitur ad blocker + tracker blocker** ke **YoshTool** (ekstensi MV3 pribadi,
vanilla JS, **tanpa build step**). Dokumen ini membedah **source resmi** dua ekstensi referensi yang
dikirim (Ghostery `10.6.11` dan AdBlocker Ultimate `4.4.5`), lalu memetakan strategi implementasi yang
realistis untuk YoshTool dengan batasan-batasannya.

> Metode: reverse-engineering langsung dari kedua paket ekstensi (manifest, ruleset DNR, content
> script, service worker) + riset mekanika Manifest V3 terbaru. Istilah teknis dibiarkan dalam bahasa
> Inggris; penjelasan dalam bahasa Indonesia.

---

## TL;DR — keputusan

- **Model wajib di MV3 = `declarativeNetRequest` (DNR).** Pemblokiran network gaya lama
  (`webRequest` yang membatalkan request) **sudah mati di MV3**. Kedua ekstensi referensi
  memblokir iklan/tracker lewat **static DNR rulesets** — yaitu filter list (EasyList/EasyPrivacy
  dsb.) yang **sudah dikompilasi jadi JSON rule DNR**.
- **Keduanya memakai arsitektur yang nyaris identik** (pola "AdGuard/Ghostery MV3"): DNR untuk
  network blocking + **content script** untuk cosmetic filtering (menyembunyikan elemen) +
  **`userScripts`** untuk scriptlet + **redirect stubs** (web-accessible resources) + **autoconsent**
  untuk auto-reject cookie banner.
- **Titik bentur dengan YoshTool: konversi filter list → DNR JSON adalah LANGKAH BUILD.** Ghostery
  memakai tool `@ghostery/urlfilter2dnr`; AdBlocker Ultimate memakai converter AdGuard. YoshTool
  melarang build step. **Solusinya: perlakukan ruleset DNR sebagai _data_, bukan build kode** —
  di-generate/diunduh sekali (atau berkala) lalu **di-commit sebagai file statis**, persis seperti
  kedua ekstensi ini yang mengirim JSON hasil kompilasi, bukan mengkompilasi di browser. Jalur paling
  ringan: **pakai ruleset DNR siap-pakai dari `@adguard/dnr-rulesets`** (tak perlu jalankan converter).
- **Insight kunci yang menguntungkan model izin YoshTool:** **DNR network blocking TIDAK butuh host
  permission.** Rule `block` statik berjalan tanpa akses `*://*/*`. Jadi **ad/tracker blocker dasar
  bisa 100% sejalan dengan filosofi opt-in YoshTool** (cukup izin `declarativeNetRequest`).
  **Cosmetic filtering** (menyembunyikan container iklan yang sudah terlanjur ter-render) **baru**
  butuh `*://*/*` → jadikan itu **upgrade opt-in** lewat pola `pendingGrant` yang sudah ada.
- **Build order yang disarankan:** Fase 1 network-only (DNR, tanpa host permission) → Fase 2 cosmetic
  (opt-in `*://*/*`) → Fase 3 scriptlet + redirect stubs → Fase 4 (opsional) consent auto-reject + stats.

---

## 1. Apa yang sebenarnya dikirim (hasil bedah source)

### 1.1 Ghostery 10.6.11 (`mlomiejdfkolichcflejclcbmpeaniij`)

Layout paket (yang relevan):

```
manifest.json
background/            service worker (module) — dnr.js, adblocker/{cosmetics,network,content-scripts,engines}.js, redirect-protection.js
content_scripts/       adblocker/index.js (cosmetic), autoconsent.js, whotracksme.js, youtube.js, notifications.js
rule_resources/        17 MB — dnr-ads.json, dnr-tracking.json, dnr-annoyances.json, dnr-fixes.json,
                       dnr-redirect-protection.json, dnr-serp.json, dnr-lang-<xx>.json (27 bahasa),
                       redirects/ (neutered stub: noop.js, googlesyndication_adsbygoogle.js, dll.)
npm/                   12 MB — dependency yang di-bundle (lihat di bawah)
offscreen/ pages/ ui/ store/ utils/
```

**manifest (inti):**

- `background`: service worker **`type: module`** (ES modules — Ghostery mem-bundle semua dep ke
  folder `npm/` dan meng-`import`-nya).
- `declarative_net_request.rule_resources`: **33 ruleset**, kategori `ads`, `tracking`, `annoyances`,
  `fixes`, `redirect-protection`, `serp`, plus 27 `lang-<xx>` (regional). **Semua `"enabled": false`**
  di manifest — dinyalakan **saat runtime** sesuai setelan user.
- `permissions`: `declarativeNetRequest`, `declarativeNetRequestFeedback`, `webRequest` (read-only di
  MV3 — hanya untuk observasi/stat), `scripting`, `userScripts`, `webNavigation`, `offscreen`,
  `cookies`, `tabs`, `activeTab`, `alarms`, `contextMenus`, `storage`. `optional_permissions`:
  `browsingData`.
- `host_permissions`: `http://*/*`, `https://*/*`, `ws://*/*`, `wss://*/*` (statik — dibutuhkan untuk
  content script cosmetic yang jalan di semua frame).
- `content_scripts` (semua `run_at: document_start`, `all_frames: true`):
  `adblocker/index.js` (cosmetic engine), `autoconsent.js` (auto-reject consent),
  `whotracksme.js` (stat tracker), `youtube.js`.
- `web_accessible_resources`: `rule_resources/redirects/*` (stub pengganti script tracker),
  `pages/element-picker/*`, `pages/trackers-preview/*`.
- `minimum_chrome_version: 122`.

**Bentuk rule DNR** (dari `dnr-ads.json`) — standar DNR, memakai sintaks anchor uBO/ABP `||…^`:

```json
{"id":8,"action":{"type":"block"},
 "condition":{"urlFilter":"||analytics.yahoo.com^","domainType":"thirdParty"},"priority":2}
{"id":13,"action":{"type":"block"},
 "condition":{"urlFilter":"||templates.stroeerdigital.de/[prod]_mobileexpandablestickyfooter.min.js"},"priority":1}
```

**Jumlah rule per ruleset (dihitung dari source):**

| ruleset                     | rules   |
|-----------------------------|---------|
| `dnr-ads`                   | 18.472  |
| `dnr-tracking`              | 14.341  |
| `dnr-redirect-protection`   | 4.942   |
| `dnr-annoyances`            | 2.194   |
| `dnr-fixes`                 | 2.035   |
| `dnr-lang-id` (contoh regional) | 3.659 |
| `dnr-serp`                  | 1 (sisanya via dynamic) |

→ Inti **ads + tracking ≈ 32.800 rule**. Muat nyaman di budget DNR (lihat §2.2).

**`npm/@ghostery/` — toolchain yang di-bundle (ini peta jalan teknisnya):**

- `@ghostery/adblocker` — **engine inti** (parse filter list, match network + cosmetic).
- `@ghostery/adblocker-content` — injeksi cosmetic di content script (= isi `content_scripts/adblocker/index.js`).
- `@ghostery/adblocker-webextension` — integrasi webextension.
- `@ghostery/adblocker-extended-selectors` — selector cosmetic prosedural (`:has`, dll.).
- `@ghostery/scriptlets` — resource scriptlet / stub.
- **`@ghostery/urlfilter2dnr`** — **converter filter list → DNR JSON** (inilah "build step"-nya).
- `@duckduckgo/autoconsent` — auto-reject cookie consent ("Never-Consent").
- `tldts` — parsing domain; `@whotracksme/*` — database/stat tracker.

**Runtime toggling (`background/dnr.js`, 139 baris — template langsung untuk YoshTool):**
hitung ruleset yang diinginkan dari setelan user → diff vs `getEnabledRulesets()` →
`chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds, disableRulesetIds })`.
Plus: "fixes" dinamis di-fetch dari server lalu dipasang via `updateDynamicRules` (dengan cek
`isRegexSupported` tiap regex), regional `lang-*` dinyalakan sesuai region, dan ada **global pause**.

### 1.2 AdBlocker Ultimate 4.4.5 (`ohahllgiabjaoigichmmfljhkcfikeof`)

Dibangun di atas **engine MV3 AdGuard** (`@adguard/tswebextension` / `tsurlfilter`). Layout:

```
manifest.json
pages/            background.js (service worker), document-start.js (content script), popup/options
filters/          88 MB — declarative/ruleset_<N>/ruleset_<N>.json  +  local_script_rules.js
web-accessible-resources/redirects/   noopmp4.mp4, prebid-ads.js, dll.
vendors/ _metadata/ assets/
```

**manifest (inti):**

- `background`: service worker **classic** (bukan module).
- `declarative_net_request`: **44 ruleset** (`ruleset_0`..`ruleset_43` + `ruleset_900`). **Hanya
  `ruleset_1` yang `"enabled": true`** di manifest (basis EasyList+ABU default); sisanya opt-in.
- `ruleset_1.json` = **19,5 MB, 77.497 rule** (`regexpRulesCount: 150`, `unsafeRulesCount: 716`).
  Rule pertama menyelipkan `metadata` (konvensi AdGuard: `ruleSetHashMapRaw` untuk memetakan balik
  "rule mana yang memblokir" demi fitur debugging).
- `permissions`: `declarativeNetRequest`, `webRequest`, `scripting`, `userScripts`, `webNavigation`,
  **`unlimitedStorage`** (menyimpan teks filter penuh untuk engine), `cookies`, `tabs`,
  `contextMenus`, `storage`.
- `host_permissions`: `<all_urls>`.
- `content_scripts`: `pages/document-start.js` (`document_start`, `all_frames`, `match_about_blank`)
  — content script cosmetic + scriptlet AdGuard.
- `filters/local_script_rules.js` — **set scriptlet yang sudah di-vet & di-bundle** (`localScriptRules`).
  Komentarnya menjelaskan skema `JS_RULES_EXECUTION`: scriptlet **tidak boleh** berupa string arbitrer
  di MV3; harus **pre-bundled & pre-approved**, lalu ruleset menentukan **kapan/di mana** dijalankan
  (rule `example.org#%#scripttext`). ABU memanggil `updateEnabledRulesets` untuk toggle.

### 1.3 Komparasi arsitektur

| Aspek | Ghostery 10.6.11 | AdBlocker Ultimate 4.4.5 |
|---|---|---|
| Engine | `@ghostery/adblocker` (eks-Cliqz) | AdGuard `tswebextension`/`tsurlfilter` |
| Network blocking | DNR static, **semua ruleset off → nyalakan per setelan** | DNR static, **`ruleset_1` on default** + sisanya opt-in |
| Jumlah rule inti | ads 18k + tracking 14k ≈ **33k** | `ruleset_1` ≈ **77k** (gabungan besar) |
| Cosmetic filtering | content script `@ghostery/adblocker-content` | content script `document-start.js` (AdGuard) |
| Scriptlet | `@ghostery/scriptlets` via `userScripts.register` | `local_script_rules.js` (pre-vetted) via `userScripts` |
| Redirect stub | `rule_resources/redirects/*` (WAR) | `web-accessible-resources/redirects/*` (WAR) |
| Consent auto-reject | **ya** — `@duckduckgo/autoconsent` | tidak (fokus ad/tracker + annoyances) |
| Dynamic "fixes" | ya — `updateDynamicRules` dari server | sebagian (`ruleset_900`) |
| SW type | ES module (bundle `npm/`) | classic script |
| host_permissions | `http/https/ws/wss ://*/*` | `<all_urls>` |
| Converter (build) | `@ghostery/urlfilter2dnr` | AdGuard DeclarativeConverter |

**Kesimpulan §1:** keduanya memvalidasi satu pola tunggal. Tidak ada jalan "pintar" yang menghindari
DNR — di MV3 itu **satu-satunya** cara memblokir request. Yang membedakan hanyalah ukuran list,
kategori, dan fitur pelengkap (consent, stats, redirect-protection).

---

## 2. Mekanika Manifest V3 yang menentukan desain

### 2.1 `declarativeNetRequest` — satu-satunya network blocking di MV3

- Ekstensi **mendeklarasikan rule** (JSON), browser yang mengevaluasi & memblokir/redirect. Kode
  ekstensi **tidak pernah melihat** tiap request (beda dari `webRequest` MV2 yang bisa membatalkan).
- Tiga jenis rule: **static** (dibundel di paket, dideklarasikan di manifest, bisa di-toggle
  per-ruleset / per-rule), **dynamic** (persisten lintas sesi, diubah via API), **session**
  (hilang saat browser tutup).
- **Tidak butuh host permission untuk mem-block/redirect** request — ini kunci untuk model opt-in
  YoshTool. (Host permission baru perlu untuk aksi yang membaca/menulis konten, mis. `modifyHeaders`
  pada response lintas-origin, dan untuk content script cosmetic.)

### 2.2 Batas DNR (angka yang menentukan budget)

Angka terkini (Chrome, akhir 2025 / 2026):

- **Static rulesets:** maksimal **100** ruleset boleh dideklarasikan (`MAX_NUMBER_OF_STATIC_RULESETS`),
  maksimal **50** aktif bersamaan (`MAX_NUMBER_OF_ENABLED_STATIC_RULESETS`). (Nilai lama 50/10 di doc
  lama & Firefox.)
- **Budget rule static:** **30.000 rule dijamin** per-ekstensi (`GUARANTEED_MINIMUM_STATIC_RULES`),
  plus akses ke **pool global 300.000 rule** yang dibagi semua ekstensi terinstal (first-come).
  Jangan hardcode pool — panggil **`getAvailableStaticRuleCount()`** saat runtime. → Inti ads+tracking
  Ghostery (~33k) sedikit **melewati** jaminan 30k (ambil dari pool); ruleset ABU 77k jauh bergantung
  pool. **Untuk YoshTool: targetkan ≤ 30.000 rule aktif** agar aman tanpa bergantung pool bersama
  (EasyList+EasyPrivacy inti muat; lihat §3).
- **Dynamic rules:** `MAX_NUMBER_OF_DYNAMIC_RULES = 30.000` (sejak Chrome 121; konstanta lama
  `MAX_NUMBER_OF_DYNAMIC_AND_SESSION_RULES = 5.000` sudah **deprecated**). **Session rules** = **5.000**.
  Rule "unsafe" (`redirect`/`modifyHeaders`) dibatasi **5.000** terpisah; aksi "safe"
  (`block`/`allow`/`allowAllRequests`/`upgradeScheme`) tidak kena batas unsafe. → Allowlist per-site
  via dynamic `allowAllRequests` muat ribuan host.
- **Regex rules:** `MAX_NUMBER_OF_REGEX_RULES = 1.000` (dihitung terpisah untuk set static & dynamic).
  Sintaks RE2 (tanpa backreference/lookaround), ~2 KB memori per regex; yang kebesaran di-skip dengan
  warning, bukan hard-fail.
- **Host permission per aksi (PENTING untuk model izin YoshTool):** `block`, `allow`,
  `allowAllRequests`, `upgradeScheme` = **tidak butuh host permission**. `redirect` & `modifyHeaders`
  = **butuh host permission** (atau `declarativeNetRequestWithHostAccess` + akses host). Inilah dasar
  kenapa Fase 1 (block murni) bisa nol-izin, sedangkan redirect-stub masuk tier opt-in.

### 2.3 Cosmetic filtering (menyembunyikan elemen) — WAJIB content script

- DNR **hanya** network (block/redirect/modify-header/upgrade). **DNR tidak bisa menyembunyikan
  elemen**. Container iklan yang di-serve dari first-party, placeholder kosong, overlay — itu
  disembunyikan dengan **inject CSS** `selector { display:none !important }` dari **content script**.
- Inilah kenapa kedua ekstensi punya content script `document_start`. Alurnya: content script tahu
  hostname → ambil daftar selector cosmetic untuk host itu (dari engine, bisa di-bundle di content
  script atau diminta ke background) → suntik satu `<style>`.
- Selector "prosedural" (`:has()`, `:matches-css`, dll. dari sintaks uBO/AdGuard) tidak semua didukung
  CSS native → butuh evaluator JS (`@ghostery/adblocker-extended-selectors`). Untuk v1 YoshTool,
  **cukup selector CSS biasa** (mayoritas EasyList cosmetic adalah selector sederhana).
- **Butuh `*://*/*`.** Maka cosmetic = fitur opt-in terpisah di YoshTool.

### 2.4 Scriptlets via `userScripts` (opsional, lanjutan)

- "Scriptlet" = patch kecil di **page world** (mis. menetralkan anti-adblock, stub `window.open`).
  Di MV3 **tidak boleh** inject string arbitrer; harus lewat **`userScripts` API** dengan script yang
  **sudah di-bundle & di-vet** (lihat `local_script_rules.js` ABU dan `@ghostery/scriptlets`).
- `userScripts` historisnya menuntut user menyalakan **Developer Mode** / toggle khusus. Status
  terbaru: tersedia sejak **Chrome 120**; sejak **Chrome 138 (pertengahan 2025)** syaratnya dilonggarkan
  dari "Developer Mode global" menjadi **toggle "Allow user scripts" per-ekstensi** di halaman detail
  ekstensi. Feature-detect: `chrome.userScripts` bernilai `undefined` bila belum diizinkan (Chrome ≥138)
  atau throw (Chrome <138).
- Untuk YoshTool ini **Fase lanjutan** (ROI menengah, kompleksitas tinggi) — bukan untuk v1.

### 2.5 Redirect resources (neutered stubs)

- Rule DNR `redirect` bisa mengarahkan request script tracker ke **stub kosong** yang di-ship sebagai
  `web_accessible_resources` (mis. `noop.js`, versi palsu `google-analytics_ga.js` yang tidak melakukan
  apa-apa). Ini mencegah **page rusak** karena script yang di-block padahal dipakai layout.
- Kedua ekstensi mengirim folder `redirects/`. Ini **statis** — tinggal di-copy, tidak perlu build.
  Stub siap pakai juga ada di paket **`@adguard/scriptlets`** (`dist/redirect-files/` — 43 file:
  `noopjs.js`, stub `google-analytics.js`, dll. + `redirects.json`).
- **Catatan izin:** aksi DNR `redirect` **butuh host permission** (beda dari `block`). Jadi redirect-stub
  baru bisa dipakai di tier yang sudah punya grant `*://*/*` (Fase 2+), bukan di Fase 1 nol-izin.

### 2.6 Consent auto-reject (`@duckduckgo/autoconsent`) — fitur Ghostery

- Library open-source DuckDuckGo: content script + dataset rule per-CMP (Cookiebot, OneTrust, dll.)
  yang **otomatis klik "reject all"** di cookie banner. Self-contained, tidak butuh server.
- Opsional untuk YoshTool; bagus sebagai pelengkap "annoyances" tapi bukan inti ad/tracker.

### 2.7 Menghitung yang diblok (stats)

- `declarativeNetRequestFeedback` + `getMatchedRules()` / `onRuleMatchedDebug` → untuk badge angka &
  panel "X diblokir". `onRuleMatchedDebug` **hanya jalan di ekstensi _unpacked_** (API debug — mati di build terpasang/Web
  Store), jadi untuk badge produksi pakai `getMatchedRules()` (dibatasi ~20 panggilan / 10 menit) atau
  hitung sendiri. `webRequest` (read-only) juga
  dipakai kedua ekstensi untuk observasi.

---

## 3. Masalah inti YoshTool: "no build step" vs konversi filter → DNR

Fakta keras: **EasyList/EasyPrivacy ditulis dalam sintaks ABP/uBO, bukan DNR JSON.** Harus dikonversi.
Konversi ini **tidak bisa** jalan di dalam ekstensi saat install (butuh toolchain Node + waktu).
Jadi pilihannya adalah **dari mana YoshTool mendapat ruleset DNR yang sudah jadi**:

**Opsi A (REKOMENDASI) — pakai ruleset DNR yang sudah jadi dari `@adguard/dnr-rulesets`.** Paket npm
ini berisi **ruleset Chrome MV3 yang sudah dikonversi** (`.../chromium-mv3/declarative/ruleset_<id>/ruleset_<id>.json`):

- `ruleset_2` = AdGuard Base (menyerap EasyList ≈ **iklan**).
- `ruleset_3` = AdGuard Tracking Protection (≈ EasyPrivacy ≈ **tracker**).
- `ruleset_17` = URL Tracking; `ruleset_4` = Social; `ruleset_0` = metadata; dll. (51 ruleset total.)

Tinggal **copy file ruleset yang dibutuhkan** (paket penuh ~373 MB tapi itu _devDependency_ — yang
di-ship cuma beberapa JSON) atau **fetch dari CDN mirror** (`cdn.jsdelivr.net/npm/@adguard/dnr-rulesets@<ver>/...`).
**Tanpa menjalankan converter sama sekali.** Ini padanan persis "kirim JSON jadi" seperti kedua ekstensi
referensi. Refresh = bump versi paket (versinya timestamp) lalu copy ulang.

**Opsi B — konversi sendiri** (hanya bila butuh list kustom): `@adguard/tsurlfilter` punya
`DeclarativeConverter`, atau `@ghostery/urlfilter2dnr` (yang dipakai Ghostery). Ini **jelas sebuah build
step** (butuh Node), dijalankan **sekali/berkala sebagai task data**, hasilnya di-commit. Boleh, tapi
Opsi A jauh lebih ringan.

**Opsi C — referensi, bukan dependency:** uBO Lite (`uBlockOrigin/uBOL-home`) juga mengirim ruleset DNR
jadi (EasyList+EasyPrivacy+list uBO), tapi sebagai artefak build di repo GPLv3 — bagus untuk **belajar**,
bukan untuk `npm install`.

**Catatan penting:** EasyList sendiri **tidak** menerbitkan versi DNR JSON (hanya `.txt`).
`@ghostery/adblocker` (engine runtime) **juga bukan** sumber DNR — ia engine matching/cosmetic, dan
jalur `enableBlockingInBrowser`-nya memakai blocking `webRequest` (jalur MV2/Firefox, **mati di MV3**).
Jadi **sumber DNR praktis untuk MV3 = `@adguard/dnr-rulesets`**, dan `@ghostery/adblocker` dipakai
**hanya untuk lapisan cosmetic** (§4 Fase 2).

**Prinsip yang menyelamatkan aturan "no build step":** di kedua ekstensi referensi, ruleset DNR adalah
**artefak data yang dikirim di paket**, bukan sesuatu yang dikompilasi dari kode sumber ekstensi saat
`npm run build`. YoshTool boleh melakukan hal yang sama: **commit file `rule_resources/*.json` sebagai
data**, di-refresh lewat **task terpisah** (skrip manual yang dijalankan sesekali, di luar loop dev
"load unpacked") — sama kelasnya dengan meng-update sebuah aset statis, bukan build pipeline untuk
menjalankan ekstensi. Ini konsisten dengan CONTRIBUTING: kode ekstensi tetap jalan apa adanya tanpa
build; yang di-generate hanyalah data filter.

---

## 4. Strategi implementasi untuk YoshTool (bertahap)

### Fase 1 — Network ad/tracker blocker (DNR, **tanpa host permission**) ⬅ mulai di sini

- **Tambahkan di `manifest.json`:**
  - `permissions`: `declarativeNetRequest` (dan `declarativeNetRequestFeedback` bila mau badge angka).
  - `declarative_net_request.rule_resources`: minimal dua ruleset statis —
    `{"id":"ads","path":"rule_resources/dnr-ads.json","enabled":false}` dan
    `{"id":"trackers","path":"rule_resources/dnr-trackers.json","enabled":false}`.
    (Mulai `enabled:false`, nyalakan via UI — sejalan dengan filosofi opt-in YoshTool.)
  - **Tidak perlu** `host_permissions` untuk fase ini.
- **File data:** `rule_resources/dnr-ads.json` + `dnr-trackers.json` = ambil **`ruleset_2` (Base/iklan)**
  dan **`ruleset_3` (Tracking Protection/tracker)** dari `@adguard/dnr-rulesets` (§3 Opsi A), copy apa
  adanya dan commit sebagai data. Budget: gabungan bisa **melewati 30k** rule → bergantung pool bersama
  300k; cek `getAvailableStaticRuleCount()` saat enable, dan boleh pangkas (mis. buang rule regex /
  list bahasa) bila perlu ramping.
- **Toggle runtime (`background.js`)** — tiru pola `background/dnr.js` Ghostery:
  ```js
  async function syncAdblockRulesets() {
    const { adblockAds = false, adblockTrackers = false } = await chrome.storage.local.get(
      ["adblockAds", "adblockTrackers"]);
    const want = [];
    if (adblockAds) want.push("ads");
    if (adblockTrackers) want.push("trackers");
    const cur = await chrome.declarativeNetRequest.getEnabledRulesets();
    const enableRulesetIds  = want.filter(id => !cur.includes(id));
    const disableRulesetIds = cur.filter(id => !want.includes(id));
    if (enableRulesetIds.length || disableRulesetIds.length)
      await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds, disableRulesetIds });
  }
  ```
  Panggil saat install, `onStartup`, dan `storage.onChanged` pada key tsb.
- **Allowlist per-site** (jangan blokir di situs tertentu): pakai **dynamic rule** ber-`action:
  "allowAllRequests"` dengan `priority` tinggi untuk host yang di-allow (atau session rule). Ini
  butuh `updateDynamicRules` — tetap tanpa host permission.
- **UI (popup):** satu card "Ad & tracker blocker" di tab Tools dengan dua checkbox (Blokir iklan /
  Blokir tracker) + tombol "Jangan blokir di situs ini" untuk tab aktif. Badge angka opsional.

**Hasil Fase 1:** pemblokir network yang nyata, nol host permission, nol build step di sisi kode.
Ini sudah memenuhi goal "fitur ad blocker dan tracker" untuk mayoritas kasus (network-level).

### Fase 2 — Cosmetic filtering (opt-in `*://*/*`)

- Butuh grant `*://*/*` → pakai pola **`pendingGrant` + `registerContentScripts`** yang sudah dipakai
  popup-blocker/sensor/selection-helper. Tombol "Aktifkan penyembunyian elemen (butuh izin semua
  situs)".
- Setelah grant: `chrome.scripting.registerContentScripts` mendaftarkan `adblock-cosmetic.js`
  (`document_start`, `all_frames`) yang: baca hostname → ambil daftar selector cosmetic untuk host →
  suntik `<style>` `display:none!important`.
- **Sumber selector cosmetic — jalur paling bersih:** drop **`@ghostery/adblocker` UMD (~130 KB, satu
  file, tanpa bundler)** di content script dan panggil `engine.getCosmeticsFilters({url, hostname, domain})`
  → `{ styles, scripts }`, lalu suntik `styles`. Engine bisa di-`deserialize()` dari blob prebuilt
  (`FiltersEngine.fromPrebuiltAdsAndTracking`) agar tak parse list tiap load.
- **Alternatif ringan (tanpa engine):** bundle sendiri subset cosmetic EasyList (baris `##selector`) —
  **selector generik + per-domain sederhana** saja (lewati prosedural `:has()` dulu) — sebagai satu JSON
  `{ "generic": [...], "domains": { "host": [...] } }` (data, bukan build).
- Catatan: inilah bagian yang "merusak layout" bila agresif → default konservatif + tombol pause.

### Fase 3 — Scriptlets + redirect stubs (lanjutan)

- **Redirect stubs** (butuh host permission `*://*/*` karena aksi `redirect` — jadi masuk tier opt-in
  bareng Fase 2): copy `dist/redirect-files/*` dari `@adguard/scriptlets` (`noopjs.js`, stub GA, dll.)
  sebagai `web_accessible_resources`; rule ber-`action:"redirect"` → `extensionPath` ke stub itu.
  Mencegah page rusak akibat script yang di-block.
- **Scriptlets** (`userScripts`): hanya bila perlu lawan anti-adblock. Kompleks + butuh toggle
  Developer-Mode user (lihat §2.4). Tunda.

### Fase 4 (opsional) — Consent auto-reject + stats

- Port `@duckduckgo/autoconsent` sebagai content script opt-in (butuh `*://*/*`, satu paket dengan
  Fase 2). Bagus untuk "annoyances". Self-contained: bundle ESM `dist/autoconsent.esm.js` (~180 KB) +
  `rules/compact-rules.json` (~515 KB, ~1.478 CMP); instansiasi `new AutoConsent(...)` di content script
  isolated-world, tanpa server.
- Stats: `getMatchedRules` → badge + panel "diblokir hari ini".

### Model izin & UI (ringkas)

| Fitur | Izin | Opt-in? |
|---|---|---|
| Network block (ads/trackers) | `declarativeNetRequest` | toggle di popup (tanpa dialog izin) |
| Badge angka | `declarativeNetRequestFeedback` | — |
| Allowlist per-site | (dynamic rule) | tombol per-tab |
| Cosmetic hiding | `*://*/*` via `pendingGrant` | dialog izin Chrome |
| Redirect stub (anti page-rusak) | `*://*/*` (redirect butuh host perm) | bareng cosmetic |
| Scriptlets | `userScripts` + toggle "Allow user scripts" (Chrome 138+) | lanjutan |
| Consent auto-reject | `*://*/*` | bareng cosmetic |

### Update ruleset (refresh data)

- Ruleset di-commit sebagai file. Refresh berkala = **task terpisah** (skrip Node yang
  meng-convert/mengunduh ulang list, dijalankan manual sesekali, hasilnya di-commit). Tidak menyentuh
  runtime ekstensi.
- Opsi lanjutan (seperti Ghostery "fixes"): fetch sejumlah kecil rule dinamis dari URL tepercaya saat
  runtime via `updateDynamicRules` — tapi ini menambah permukaan jaringan & kompleksitas; **lewati untuk v1**.

---

## 5. Pros / cons & limitasi

**Kelebihan pendekatan ini**
- Memenuhi goal (ad + tracker blocking) dengan **Fase 1 saja**, **tanpa host permission** dan
  **tanpa build step kode** — sangat cocok dengan prinsip YoshTool.
- Arsitektur sudah terbukti (dua ekstensi referensi + jutaan pengguna).
- Bertahap: tiap fase berdiri sendiri, bisa di-PR terpisah.

**Kekurangan / limitasi (jujur)**
- **DNR tidak sekuat uBO MV2.** Tidak ada pembatalan request dinamis per-request, logika kondisi
  terbatas, budget rule terbatas (§2.2), dan beberapa filter advanced (CSP injection, scriptlet
  kompleks) sulit/tidak bisa dipetakan ke DNR.
- **Cosmetic butuh `*://*/*`** — tak terhindarkan; itu sebabnya dijadikan opt-in.
- **Konversi filter = proses di luar ekstensi.** Mesti disiapkan sekali; ruleset bisa basi bila tak
  di-refresh. (Trade-off yang sama ditanggung semua adblocker MV3.)
- **Potensi "page rusak"** bila block terlalu agresif → wajib ada allowlist per-site + redirect stubs.
- **Maintenance filter list** adalah pekerjaan nyata (EasyList update harian). Untuk ekstensi pribadi,
  refresh berkala sudah cukup.

---

## 6. Rekomendasi akhir + build order

1. **Fase 1 — Network ad/tracker blocker via DNR static rulesets, tanpa host permission.** Ini
   deliverable utama dan paling selaras dengan YoshTool. Satu PR: manifest + `rule_resources/dnr-ads.json`
   + `dnr-trackers.json` (data) + `background.js` toggle + card popup + allowlist per-site.
2. **Fase 2 — Cosmetic hiding (opt-in `*://*/*`).** PR terpisah; pakai `pendingGrant`.
3. **Fase 3 — Redirect stubs** (ikut Fase 2 — `redirect` butuh host permission; sumber:
   `@adguard/scriptlets`) **lalu scriptlets** (tunda).
4. **Fase 4 (opsional) — Consent auto-reject + stats.**

> Catatan versi (per CONTRIBUTING): dokumen ini docs-only → **tidak** bump versi. Implementasi Fase 1
> nanti = **minor bump** (fitur baru), tiap fix sesudahnya = patch.
