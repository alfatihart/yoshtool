# Research: Social-media downloader + Google Maps review-photo downloader — and fitting them into YoshTool

Deep-dive into two feature ideas: (A) a **link-paste social-media downloader** (download
video/feed from TikTok, Instagram, X/Twitter, Facebook, YouTube, Reddit, Pinterest, Threads,
Snapchat, Twitch by pasting a public post URL, with quality/resolution options, MP3 extraction,
photo-gallery/ZIP, and subtitles) and (B) a **Google Maps review-photo downloader** (grab the
full-resolution photos attached to Maps place reviews). Reverse-engineered from the two reference
implementations plus multi-source technical/legal research, then mapped onto **YoshTool**, our
personal MV3 extension (vanilla JS, no build step).

References studied:
- `socialdownloader.space` — a free web service, "Download any public video in original quality"
  across 11 platforms, Video/Audio toggle, quality options, photo galleries, quick ZIP, subtitles.
- `github.com/Vette1123/social-media-downloader` — the open-source Next.js reference app.
- `github.com/imputnet/cobalt` — the open-source media-grabber backend the above falls back to.

> Mechanism claims marked **(code-confirmed)** were verified against the projects' own source
> (not just READMEs) during the research. Legal/market notes are flagged where they rest on
> weaker sources. This was produced by a fan-out research harness (26 sources fetched, 25 claims
> adversarially verified, 21 confirmed / 4 refuted).

---

## 1. What the references are

**socialdownloader.space (market).** A free, no-signup web tool covering ~11 platforms. One URL
box, a Video/Audio toggle, size/quality options, photo-gallery handling, a "quick ZIP" for
multi-image posts, and subtitle download. Funded by donations ("Free forever. Not free to run").
The public face is simple; the interesting part is entirely in the backend.

**Vette1123/social-media-downloader (stack, code-confirmed).** Next.js 16 (App Router) / React 19
/ TypeScript / Tailwind 4, **static-exported and served on Cloudflare Workers** with a
hand-written Worker handling only `/api/*`. It deliberately dropped Axios/Cheerio/arctic in favour
of native `fetch` + regex extractors. Supports 11 platforms with HD/SD/MP3 re-picking.

**cobalt (imputnet/cobalt).** A mature open-source "media grabber" that both of the above lean on
as a fallback/relay. Architected as a **server-side proxy that never caches** ("works like a
fancy proxy"). This is the component that makes broad platform coverage realistic.

---

## 2. How a link-paste social downloader actually works

### 2.1 Resolution is server-side — and that is forced, not a choice (code-confirmed)

In the reference app the browser does **not** resolve media. It `POST`s the link to
`/api/download`; the server runs per-platform extractor chains and returns links that are then
**re-served through same-origin proxy routes** (`/api/video`, `/api/audio`, `/api/image`). Those
routes exist for one reason: they inject the correct **per-CDN `Referer`** (`lib/proxyHeaders.ts`,
`getMediaReferer()`) and permissive CORS headers. There's a dedicated `/api/image` route
specifically because **Instagram's `scontent`/`fbcdn` CDN omits CORS headers** and refuses
cross-origin browser requests.

The root cause is a hard web-platform rule: a web page **cannot set the `Referer` header** (it's a
Fetch-spec forbidden header), and cannot bypass a CDN's CORS / Cross-Origin-Resource-Policy. So a
server proxy is the only way a *web app* can satisfy CDN hotlink protection. cobalt is built the
same way for the same reason.

> This single constraint is the pivot for the whole YoshTool analysis — because an **extension is
> not a web page** and *can* set `Referer` (see §5.2).

### 2.2 The extractor chain + yt-dlp as last resort (code-confirmed)

Broad coverage relies on a **chain of third-party HTTP extractor services** plus a native
fallback. Example: TikTok = Tikwm → Snaptik → SSSTik → direct scraping (and it also races cobalt
and tries yt-dlp). A full **yt-dlp** extractor is only the *final* fallback, and it is
**automatically absent on Cloudflare Workers** (it short-circuits to null — V8 isolates can't spawn
native binaries; `youtube-dl-exec` is Node-hosts-only). On serverless hosts, **cobalt does the
heavy lifting** via an external HTTP service (`COBALT_API_URL`).

Platform resolution detail (code-confirmed): most platforms are hit via their *own* public
endpoints — Instagram embed-page `shortcode_media`, Twitch public GraphQL clip query signed with
the access token, Pinterest widget API `/v3/pidgets/pins/info/`. Instagram's *higher-fidelity*
path uses the **private** media API `/api/v1/media/<id>/info/`, which requires a session cookie
(`IG_SESSIONID`). (Remember that for §5.)

> Myth busted: the research **refuted** (0-3) the common claim that these tools are "just yt-dlp
> with 1000 sites." In practice broad coverage is a brittle patchwork of per-platform HTTP
> extractors + cobalt, with yt-dlp only as a backstop on Node hosts.

### 2.3 Quality, MP3, ZIP, galleries — who does what (code-confirmed)

- **Quality/resolution & audio format are backend parameters, not client logic.** cobalt exposes
  `videoQuality` (max/4320/2160/1440/1080/720/480/360/240/144, default 1080), `audioFormat`
  (best/mp3/ogg/wav/opus, default mp3), `audioBitrate` (≤320 kbps), and `downloadMode`
  (auto/audio/mute). The UI just presents whatever variant list the resolver returns.
- **Transcoding** is done server-side by default (cobalt "tunnel" mode muxes/transcodes), but
  cobalt can offload to the client ("local-processing" mode), and **its own web client does this
  with `libav.js`** (FFmpeg's libav* compiled to WebAssembly) across worker threads. This directly
  proves MP3/codec conversion *can* run client-side via the WASM-FFmpeg family (ffmpeg.wasm / libav.js).
- In the Vette1123 app specifically: the generic "MP3" proxy (`handleAudioProxy`) **re-serves the
  bytes as `audio/mpeg` with no transcoding**; the *real* yt-dlp MP3 path (`extractAudio` +
  `audioFormat mp3`) is gated by `nativeMediaAvailable()`, which is **false on Cloudflare** (no
  subprocess/fs). True slideshow→MP4 generation uses `fluent-ffmpeg` under `runtime = 'nodejs'` only.
- **ZIP bundling is the one step done in the browser** — `await import('jszip')` in
  `DownloaderApp.tsx`/`BatchPanel.tsx`. JSZip is pure browser JS (feasible with no build step).
- **Multi-image / slideshow** content is returned by cobalt as a **`picker` array** — each item has
  a `type` (photo/video/gif) and a `url`. That data shape is exactly what feeds gallery + ZIP features.

### 2.4 Thin "downloader libraries" are just backend proxies (code-confirmed)

A side note worth recording because it's tempting: drop-in npm libs like **`btch-downloader`**
(`igdl`, `ttdl`, `fbdown`, `twitter`, `youtube`, `pinterest`, …) look like client-side resolvers
but **every function calls the author's hosted backend** (`backend1.tioo.eu.org` via `btch-http`).
It does **no** platform-page parsing or CDN-URL resolution in-process. It *does* ship a
no-build-step browser global (`window.btch`, MIT, actively maintained), so it's a packaging
example — but **not** an independent in-browser extractor. Depending on it = depending on a random
third party's server.

---

## 3. Google Maps review-photo extraction

### 3.1 The core trick: `=s0` for full-resolution originals

Review photos are served from the `googleusercontent` CDN. The page shows a *thumbnail* via a size
parameter (e.g. `=s512`, or `=w400-h300`). Google-hosted image URLs can be forced to return the
**full original** by setting the size parameter to zero — canonically **`=s0`** (also `=w0`/`=h0`,
less reliably). So the mechanism is:

1. DOM-scrape the review gallery for `googleusercontent` thumbnail URLs.
2. Rewrite each URL's size segment to `=s0`.
3. Fetch → full-quality originals, bundle, download.

> Confidence note: the size params `s`/`w`/`h` are officially documented by Google, but the `=0`
> "no-resize / original" behaviour is **undocumented-but-widely-attested** (2011–2025) and no source
> confirmed it *specifically* for Maps **review** photos in 2024–2026. Same CDN host and format, so
> strongly plausible — treat as **medium** confidence and verify against the live UI before relying on it.

### 3.2 The obstacles a DOM scraper must handle

- Photos are **lazy-loaded on scroll** (not in the initial HTML) — the scraper must scroll the
  review/photo panel to materialise them (YoshTool already has an auto-scroll helper from the
  full-page screenshot feature).
- The full-size URL is **hidden behind the displayed thumbnail** (hence the `=s0` rewrite).
- A **heavier but more robust alternative** is intercepting Maps' internal photo API
  (`listugcposts` / `photo`) from a content script — but responses are obfuscated protobuf-ish
  arrays that need brittle index-path parsing. Not recommended for v1.

---

## 4. Legal / ToS / anti-bot (the part that constrains everything)

- **Platform ToS.** Every major platform's ToS prohibits downloading/scraping content outside the
  provided UI; YouTube has historically sent legal threats at download services. These tools operate
  in a tolerated-but-against-ToS grey zone, lean on "public content only," and push the
  copyright/"you're responsible for what you download" burden onto the user.
- **Google Maps** has an explicit **"No Scraping"** clause (Maps Platform ToS 3.2.3(a)) barring
  export/extraction/caching of Maps content. A personal, manual, per-place review-photo grab is low
  risk in practice, but it *is* against Google's terms — worth a one-line disclaimer in the tool.
- **Anti-bot** is the real engineering tax on the social side: TikTok request signatures, YouTube
  cipher/`nsig`, Twitch token signing, Instagram session-gating and rate limits. This is exactly the
  moving target that forces the reference apps onto third-party services + cobalt + yt-dlp, and why a
  self-contained extractor rots fast.

Because YoshTool is **personal** (not a public service), the service-operator legal exposure mostly
doesn't apply — but the **anti-bot maintenance burden applies in full**, and that's the deciding
factor below.

---

## 5. Fitting this into YoshTool

Recap of the binding constraints: content scripts injected via `executeScript({files})` are
**classic** scripts (no ES `import`; only the popup, `type=module`, can import). YoshTool already
holds `cookies`, `activeTab`, `storage`, `scripting`, `debugger`, `downloads`, `contextMenus`,
`clipboardRead/Write`, `browsingData`, and `optional_host_permissions: *://*/*`. It already uses
`chrome.debugger` (CDP), `chrome.downloads`, and an offscreen document. **Caveat found during
research: the manifest references offscreen in code but does not currently declare the `offscreen`
permission** — any WASM-transcode plan would need to add it.

### 5.1 Google Maps review-photo downloader — STRONG fit, build it

Purely client-side, no server, reuses existing permissions.

**Design sketch**
1. Popup button "Download review photos" → `executeScript({files:["mapsphotos.js"]})` on the active
   `google.com/maps` tab (classic content script — fine, no imports needed).
2. `mapsphotos.js`: auto-scroll the reviews/photos panel to force lazy-load, `querySelectorAll` for
   `img[src*="googleusercontent"]` (+ `[style*="googleusercontent"]` background images), collect
   URLs, **rewrite size → `=s0`**, dedup. Return the URL list.
3. Bundling + save happens where imports are allowed (popup, or the offscreen doc): a **single-file
   UMD `JSZip`** (loadable as a classic/global `<script>` — no build step), fetch each `=s0` URL,
   add to the zip, then `chrome.downloads.download` the blob. (Blob URL creation must happen in a
   DOM context — popup or offscreen — not the service worker; MV3 SWs can't call
   `URL.createObjectURL`.)
4. Optional: a "copy all URLs" / "download individually" mode that skips the zip entirely.

**Why it fits:** no `Referer`/CORS problem (googleusercontent serves images cross-origin fine for a
simple `img`/fetch of originals), no transcoding, no anti-bot arms race, no backend. It's the same
"DOM scrape + download" shape as the redaction/screenshot features already in YoshTool.

**Risk:** the `=s0` behaviour and the DOM structure are undocumented and Google can change them;
keep the selector list and the size-rewrite in one small, easily-patched function. Add a ToS
disclaimer line.

### 5.2 Social-media downloader — WEAK fit at full fidelity

An extension has **two genuine advantages over a web app** here, both real:

1. **The user's own authenticated session.** YoshTool runs in the logged-in browser and holds the
   `cookies` permission, so it can reach **cookie-gated endpoints** (e.g. Instagram's private media
   API `/api/v1/media/<id>/info/`) **without a server storing a harvested `sessionid`**. That's a
   capability a public web app can't match cleanly.
2. **It can supply the `Referer` a web page can't.** Via `declarativeNetRequest` header rewriting
   (or an extension-context `fetch` with host permission) the extension can set the per-CDN
   `Referer`, **eliminating the need for same-origin proxy routes** — the exact thing that forces the
   web apps onto a backend in §2.1.

**But** the extension **cannot** replace the parts that actually make these tools work:

- **Per-platform extraction + anti-bot** (TikTok signatures, YouTube cipher/`nsig`, Twitch token
  signing). These defeat simple public-endpoint scraping and are what drive even the reference apps
  to third-party services, cobalt, and yt-dlp. There is **no reliable pure-JS/WASM client-side
  extractor** for the hard platforms.
- **Audio transcoding.** Real MP3 needs ffmpeg. In MV3 that means **ffmpeg.wasm/libav.js in an
  offscreen document**, single-threaded without cross-origin isolation (no `SharedArrayBuffer`),
  multi-MB download, and slow. Feasible but heavy — and needs the missing `offscreen` permission.

**Client-side feasibility by platform (rough):**

| Tier | Platforms | Why |
|---|---|---|
| Plausible in-extension (public endpoint + user cookies) | Instagram (embed / private API), Pinterest (widget API), Twitch (GraphQL), Reddit (`.json`) | Simple HTTP endpoints; `Referer`/cookie advantages apply |
| Needs a backend / cobalt / yt-dlp | YouTube (cipher/nsig), robust TikTok (anti-bot), and anything that defeats tag-scraping | Signature/cipher logic + anti-bot that rot fast |
| Transcoding (any MP3) | all | ffmpeg.wasm in offscreen, or just download the already-separate audio stream without transcoding (what the reference app's generic MP3 path actually does) |

### 5.3 Recommendation for the social side

**Do not** reimplement an 11-platform extractor inside a no-build MV3 extension — it would be
brittle, high-maintenance, and partly impossible (anti-bot). Two sane options instead:

- **Thin client against a self-hosted cobalt.** Let the user run/point at a cobalt instance; YoshTool
  becomes a nice in-browser front end that passes `videoQuality`/`audioFormat`/`downloadMode` and
  saves the result — while *adding value a web client can't*: inject the per-CDN `Referer` via
  `declarativeNetRequest` and use the user's session cookies for gated media. This exploits both
  extension advantages without owning the extraction/anti-bot problem.
- **Or scope it down drastically** to a 2–3 "easy tier" platforms that resolve from public endpoints
  with the user's cookies (Reddit, Pinterest, maybe Instagram public), explicitly framed as a
  best-effort personal grab — no transcoding (download the separate audio stream as-is), ZIP via
  single-file JSZip, and a clear "breaks when the platform changes" note.

---

## 6. Bottom line

- **Build the Google Maps review-photo downloader.** Low risk, purely client-side, reuses existing
  `scripting`/`downloads`/`storage` permissions, single-file JSZip, no new permissions, no server.
  Mechanism = DOM scrape + `=s0` + download. The single caveat is verifying `=s0` against the live
  2026 Maps UI.
- **Skip the self-contained social downloader.** At full fidelity it's a poor fit for a no-build MV3
  extension. If you want it, ship a **thin client to a self-hosted cobalt** (leveraging the session-
  cookie + `Referer`-rewrite advantages) rather than an in-extension extractor. A tightly-scoped
  "easy platforms only" version is possible but will need ongoing patching.

---

## 7. Open questions / things to verify before building

- Does `declarativeNetRequest` (or session rules) reliably set a per-CDN `Referer` on outbound media
  fetches in MV3, and does that actually bypass Instagram's CORP/CORS in practice — or does the CDN
  still reject extension-origin requests? (Unverified here; it's the linchpin of the §5.2 advantage.)
- Real-world ffmpeg.wasm/libav.js MP3 performance in an MV3 offscreen doc **without** cross-origin
  isolation — fast enough to ship, or should we only ever download the separate audio stream?
- Is there any pure-JS/WASM client-side extractor for the hard platforms (YouTube/TikTok) that works
  in an extension with the user's session, or is self-hosted cobalt/yt-dlp unavoidable for those?
- Does the 2026 Google Maps review UI still expose `=s0`-upgradable `googleusercontent` URLs via DOM
  scraping, or has photo delivery moved behind the obfuscated internal `listugcposts/photo` API?

### Research caveats
- The social-downloader stack is **fast-moving** — the Vette1123 repo is Next.js 16 / React 19
  (verified 2026-10-28), and extractor chains + public cobalt relay policies change often (public
  cobalt instances now refuse Cloudflare-Worker-origin fetches, so "cobalt on serverless" assumes a
  self-hosted instance).
- The `=s0` Maps trick rests on a single blog/gist source (well-attested historically, but not
  confirmed for *review* photos specifically in 2024–2026) — **medium** confidence.
- The MV3 "hand a Blob to `chrome.downloads`" detail came from a secondary wiki (split verification);
  the underlying `createObjectURL`-needs-a-DOM-context / offscreen constraint is solidly confirmed by
  primary Chromium sources.
- The YoshTool feasibility conclusions are **reasoned synthesis over verified claims + our actual
  constraints**, not a built/benchmarked prototype.

---

_Sources (primary, code-confirmed): `github.com/Vette1123/social-media-downloader`,
`github.com/imputnet/cobalt`, `npmjs.com/package/btch-downloader`,
`github.com/gyng/save-in/wiki/Manifest-V3` (MV3 download pattern, secondary), and a
`googleusercontent` size-parameter gist (Maps `=s0`, blog-quality). 26 sources fetched, 25 claims
verified (21 confirmed / 4 refuted) by the research harness._
