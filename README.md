# YoshTool

A Chrome (Manifest V3) extension for development and testing: manage cookies/sessions
across profiles, clear a site's cache/cookies, and capture page screenshots — all running
locally in the browser.

The interface uses a token-based design system with **automatic dark mode** (following the
OS `prefers-color-scheme`) and a calm, monochrome slate accent.

> 🇮🇩 Versi Bahasa Indonesia: [README.id.md](README.id.md)

## Features

- **Export / Import cookies** in three formats: JSON, Header String, and Netscape.
  - Export: **Copy** to the clipboard or **Save file**.
  - Import: **Paste** from the clipboard or **Open file**; the format is auto-detected.
  - Import works across tabs/incognito (the domain is taken from the cookie data, the store
    is resolved explicitly from the active tab), with a "Clear existing cookies before import"
    option and auto-refresh / "Open site" to the URL captured at export time.
- **Domain allowlist** — export/import is limited to domains you allow yourself through
  Chrome's permission dialog (the **Cookies** chip on the **Sites** tab). No automatic host access
  at install time.
- **Sites tab — per-domain matrix** — one row per domain manages every per-site exception in one
  place: chip-toggles for **Cookies** (export/import), **No-block** (ad/tracker blocking off) and
  **Redact** (live-blur), plus a **Popups** dropdown (Default / Trusted / Off). The current tab's
  domain sits in a "This site" card; all others appear under "Saved sites" with a ✕ to clear them.
- **Sessions (multi-login)** — the **Cookies** tab (Login sessions): save several named logins for the same
  site and **switch with one click** (swap cookies + reload). One account is active per site
  at a time. Gated by the allowlist (needs host permission for the domain). Moves
  **cookies + localStorage/sessionStorage + IndexedDB** (works for SPA logins like Supabase/JWT or
  Firebase). Switching only *restores* a saved snapshot and never refreshes one, so after logging
  in press **Update** on the active session to capture the fresh login into its snapshot. Saved
  sessions can be **encrypted** with a master passphrase (opt-in, AES-256-GCM).
  _Limitations:_ IndexedDB values must be JSON-serializable (binary is skipped), storage is only
  read while a tab is on the domain, this isn't simultaneous isolation, and it isn't
  anti-detection. See [`docs/multi-session-research.md`](docs/multi-session-research.md).
- **Clear cache**, **Clear cookies**, and **Clear site data (log out)** for the active tab's domain
  (destructive ones need you to type the domain to confirm). **Clear cookies** removes only cookies;
  **Clear site data** wipes the whole origin — cookies + `localStorage` + `IndexedDB` + service
  workers + cache — via `browsingData` (no host permission needed), which reliably logs you out even
  when the app keeps its session in storage rather than cookies.
- **Screenshot**: Area, Screen, and Full page (`chrome.debugger`, one whole page). Output
  defaults to the clipboard, with an option to save a file. A confirmation toast appears on
  the page after the action.
- **Device mode (responsive / mobile simulation)** (the Page tab) — emulate a phone or tablet on
  the active tab: viewport size, device pixel ratio, touch, and user-agent. Pick from 14 presets
  (iPhone, Pixel, Galaxy, Surface Duo, iPad, Galaxy Tab) or **Responsive (custom)** with manual
  W × H × DPR, and **Rotate** to swap orientation. It drives Chrome's own emulation engine over CDP
  (`chrome.debugger` → `Emulation.*`) on the **real tab** — so logged-in pages stay logged in (real
  first-party cookies), the metrics/DPR/touch are real (not faked), and **no new permission** is
  needed (reuses the Screenshot debugger). With it on, the Screenshot tool captures the emulated
  view. Trade-offs: Chrome shows a “started debugging” bar while on, there's no decorative phone
  bezel or side-by-side, and DevTools can't be opened on the same tab. **Stop** (or opening DevTools,
  or closing the tab) turns it off.
- **Tech profiler (identify web technologies)** (the Tools tab) — **Identify technologies** scans the
  active page and lists the frameworks, libraries, CMS, analytics, CDNs and servers it's built with,
  grouped by category with versions where detectable (Wappalyzer-style). The service worker loads a
  bundled fingerprint dataset; a MAIN-world probe collects page signals — script URLs, inline scripts,
  **CSS** (same-origin stylesheets → `--tw-*`/`--radix-*` etc.), meta, cookies, **JS globals**, **DOM**
  selectors/properties — plus a short best-effort background fetch for **response headers** (Cloudflare,
  HSTS, server). **Built-in detectors** catch bundled SPA frameworks the dataset's legacy patterns miss
  on modern Vite/React-18 builds (React fiber, Next/Nuxt/Vue/Angular/Remix/Svelte), and conditional
  technologies (`requires`/`requiresCategory`, e.g. Radix UI) are resolved once their prerequisite is
  found. No new permission; scans only on click. Uses the open-source **webappanalyzer** dataset
  (**GPL-3.0**, bundled under `tech-data/` with attribution) — not Wappalyzer's proprietary data. Still
  no DNS detection (would need extra permissions).
- **Performance test (GTmetrix / Lighthouse-style)** (the Tools tab) — **Test · Mobile** / **Test · Desktop**
  run a real lab test: they attach the debugger, apply a profile, **cold-reload** the page (ignore cache)
  and measure the fresh load — **FCP, LCP, CLS**, worst interaction, **TTFB** and load timing, colour-coded
  against the current Web Vitals thresholds, with a DNS/TCP/TLS phase breakdown and the slowest + heaviest
  resources. **Mobile** = device emulation + Slow-4G + 4× CPU throttle; **Desktop** = unthrottled. Metrics
  come from the browser's Performance APIs (hand-rolled, no Lighthouse, no third-party lib). No new
  permission (reuses the `debugger` the screenshot/Device-mode use); shows Chrome's "debugging" bar and
  reloads the page (stop Device mode first). One lab run — numbers vary; not Google's field data.
- **Domain info** (the Tools tab) — **Check this domain** looks up the current site: **registrar +
  domain age + expiry** (RDAP), **DNS records** (A/MX/NS via DNS-over-HTTPS), an **HTTP security-header
  grade** (from the page's own response), and a **popularity rank** (Tranco); optional **authority
  score** with a free **Open PageRank** key. Free & keyless core, **no new permission** (third-party
  APIs via their CORS, best-effort; security headers via `activeTab`). **DA/PA are Moz-proprietary/paid**
  — not included; Tranco + Open PageRank are the free stand-ins.
- **Ping (latency)** (the Tools tab) — enter a host/URL (blank = current tab), **Start**, and watch a live
  sparkline with **min/avg/max/jitter** and **% loss** + a `navigator.connection` summary. The loop runs
  in the **service worker**, so it **keeps going after you close the popup or switch tabs** — reopen the
  popup and it picks up where it is; **Stop** ends it. State is held in `chrome.storage.session` (survives
  the worker being suspended via a 30s `alarms` heartbeat, but clears on a full browser restart — no
  zombie pinger). Honest limit: browsers can't do ICMP (no raw sockets in MV3), so it measures **HTTP
  round-trip** (a timed `no-cors` fetch) — higher than cmd `ping`, HTTPS hosts only.
- **Dev converter** (the Tools tab) — a compact one-box converter: **JWT decode** (header + payload,
  humanized times + expiry; *decode only, signature not verified*), **JSON** format/minify, **Base64**
  encode/decode (UTF-8 safe, accepts base64url), **URL** encode/decode. In-popup, live output + Copy, no
  new permission.
- **Redact sensitive data in screenshots** (optional): detect and propose redaction boxes for
  emails, phone numbers, credit cards (Luhn), API keys, JWTs, IBANs, addresses, and
  secret/PII fields — using **Solid** (safe, irreversible) or **Blur**. Boxes can be toggled,
  added manually, and reset before "Redact & capture".
- **Realtime auto-redact (privacy mode)**: blurs sensitive data directly on the page as you
  browse, for screen-sharing protection. Runs only on domains you add to the **Auto-redact**
  list (Sites tab). **Click to reveal temporarily.** This list is **separate** from the
  cookie allowlist: adding a domain here does not enable exporting its cookies.
- **Dev tools** — the inspect/fill actions below (**Fill form**, **Font inspector**, **Inspect & edit**,
  **Copy & selection unlock**) live under **Inspect & fill** on the **Tools tab**; **Color picker** and
  **Translate** stay on the **Page tab**:
  - **Fill form (dummy data)** — fill every input with realistic Indonesian-locale fake data
    (name, email, phone, NIK, NPWP, address, account number, test card); supports React/Vue
    (native setter), `<select>`/checkbox/radio, and confirmation fields.
  - **Color picker** — an **on-page eyedropper** with a loupe/magnifier (10× zoom, live hex;
    the popup closes so it doesn't block the selection), a color selector with live hex, copy
    HEX/RGB/HSL, a 12-color history, and a **page palette** (dominant colors).
  - **Font inspector** — hover to see the actual font (canvas pixel-compare), click for a
    detail card with Google/Adobe Fonts detection.
  - **Inspect & edit** — DevTools-lite: click an element to edit its text in place
    (`contenteditable=plaintext-only`), edit/add/remove its attributes, edit its inline style,
    duplicate or delete it, and copy its text / selector / outerHTML. Plus an "Edit all text" toggle
    (`document.designMode`). Changes are your **local view only and reset on reload** — to hide an
    element for good use the element blocker, to remove once use Zap. UI is Shadow-DOM isolated; Esc
    exits (or ends text editing).
  - **Copy & selection unlock** — re-enable selecting text, copy/paste and right-click on sites
    that block them (CSS `user-select` override + capture-phase event release — the browser's own
    copy/menu still runs). Click again (or the right-click menu) to restore. Also available as a
    **right-click → "Unlock copy & selection"** menu item.
  - **Translate** — two modes:
    - **Selection tooltip** — turn on translate mode, then **select text** for a translation tooltip
      (detected source language + Copy); also via **right-click → "Translate selection"**.
    - **Full page (bilingual)** — **Translate full page** (or right-click → "Translate full page")
      groups the page's visible text by block, batches it to the background in one request, and inserts
      each translation **beneath the original** (you keep both). Click again (or Esc) to undo. Caps
      work on huge pages; **best-effort** — some blocks may fail under rate limiting (the toast says how
      many).
    - Client-side: the content script collects text / shows the UI, the background service worker
      fetches the free Google Translate web endpoint (a page can't, due to CORS; the SW with host
      permission can), with a concurrency pool + backoff for the batch. Pick the **target language**
      in the popup (default Indonesian). One narrow host permission (`translate.googleapis.com`).
  - **Dark mode** — two engines, picked in the popup:
    - **Dynamic** (default, Dark Reader-style) — walks the page and **remaps each element's colours**,
      flipping *lightness* while keeping hue/saturation: white cards go dark, dark text goes light, a
      light-blue panel stays blue (just dark). **Images/video/canvas are never touched**, so nothing
      is colour-flipped. A `MutationObserver` covers content added later; `color-scheme: dark` fixes
      form controls and scrollbars.
    - **Filter** — the simple `invert(1) hue-rotate(180deg)` with media re-inverted. Kept as a
      fallback for sites where the dynamic walk misbehaves (flips photo/brand colours, but robust).
    - Both **skip sites that already have a dark theme** (luminance + dark-theme-markup check) so they
      don't double-darken. Per-tab on-demand toggle (click again, or **right-click → "Toggle dark
      mode"**, to restore — teardown restores every element). Known limits: CSS gradients /
      background-image art aren't remapped, inline `<svg>` colours are left as-is, and v1 doesn't
      persist across reloads.
  - **Selection helper** (toggle, needs all-sites) — a quick pill on any page: **Translate / Font**
    when you select text, **Fill form** when you focus a form field, and a **show/hide password eye**
    when you focus a password field (for sites with no reveal — Chrome has none natively). The eye sits
    just outside the field's top-right so it clears the label and any password-manager icon; it
    re-masks on blur and never reads/stores the value. (A keyboard-only "reveal all password fields"
    command is also available, unbound by default, at `chrome://extensions/shortcuts`.)
  - **Floating rail** (toggle, needs all-sites) — a collapsible edge sidebar (like an Android edge
    sidebar) with one-click shortcuts to the on-page tools: **Screenshot area, Translate, Fill form,
    Font, Dark mode, Unlock copy, Inspect & edit**. Fully **Shadow-DOM isolated**; drag to move,
    flip to the other edge, collapse to a slim translucent tab, or hide per-site. Position/open state
    persist; it auto-hides in fullscreen and stays out of screenshots. Each action is run by the
    service worker injecting the same script the menu/shortcuts use. No new manifest permission.
    Optional **live ping chip** ("Show live ping on the rail") shows the HTTP round-trip to the
    current site, colour-coded, refreshed every ~3s (per-site, in-page; not ICMP). **Hover the chip**
    for a **page-at-a-glance** card: passive **Speed vitals** (TTFB/FCP/LCP/CLS/Load), **page weight**
    (requests + transfer), **blocked** counts (ads+trackers / elements / popups), and **network**
    (ping + connection) — all read instantly, no reload.
- **Ad & tracker blocker** (the Protect tab) — blocks ad and tracker **network requests** with
  Chrome's `declarativeNetRequest` (two static rulesets, ~17.7k ad rules + ~14.1k tracker rules,
  toggled independently). Needs **no host permission** — nothing is asked at install; the rulesets
  ship disabled and are turned on from your prefs. **"Don't block on this site"** adds the active
  tab's host to a per-site allowlist. Rulesets are a block/allow-only subset derived from the
  open-source Ghostery extension / EasyList + EasyPrivacy (`rule_resources/NOTICE.md`). **Element
  hiding** (cosmetic) is an opt-in add-on — **Enable element hiding** runs a content script that
  hides leftover ad boxes/placeholders using EasyList cosmetic filters (needs the all-sites
  permission; respects the same per-site allowlist). **Redirect stubs** — once all-sites is granted,
  some blocked scripts (analytics, ad SDKs) are redirected to harmless stubs so pages don't break.
  **Auto-reject cookie banners** (opt-in, all-sites) auto-clicks "reject all" on common consent
  dialogs. The **toolbar badge** shows one unified per-tab count — network requests blocked + elements
  hidden (cosmetic/element blocker) + popups blocked (network slice is best-effort for the active tab).
  An optional **Extended
  blocklist** toggle downloads ~25k extra ad/tracker rules (updatable via **Update now**, no
  permission). Background and design notes:
  [`docs/adblock-tracker-research.md`](docs/adblock-tracker-research.md).
- **Element blocker** (the Protect tab) — point-and-click to hide an element the filters miss (e.g.
  a judol ad banner). **Zap once** hover-highlights any element and removes it for this view only
  (no save; unlocks page scroll if you remove a modal) — works via `activeTab`, no extra permission.
  **Block an element…** opens a picker: broaden to a parent with the slider, optionally match by its
  text, see a live match count + highlight, **Preview** (temporarily hide the matches to see the page
  without them, then restore), then Block to save a **per-site** rule that re-applies on
  every reload (needs all-sites, shared with the other on-every-page features). Generated selectors
  ignore randomized/hashed class names and ids, so a block survives reloads; refinements compile to
  the engine's `:has-text` / `:upward` grammar. Saved blocks are listed (with ×) in the card. Design
  notes: [`docs/element-picker-research.md`](docs/element-picker-research.md).
- **Popup blocker** (the Protect tab) — blocks `window.open` popups/popunders on all sites
  (ported from "Popup Blocker (strict)"). The **default** mode only blocks **programmatic**
  `window.open` (popunders with no gesture activation) — a `window.open` from your own click
  (e.g. a download button) still runs. **Strict** mode blocks every `window.open` plus
  `target=_blank` clicks. Each block shows a bar (Allow / Background / Redirect / Trust domain /
  Block); "Allow" opens the URL in a new tab. Common OAuth & payment hosts are whitelisted by
  default; there's a per-domain **Disable on this site** button. It needs all-sites access —
  requested through a button (Chrome's dialog), not at install time.
  It can also **remember your choice per popup host and auto-apply it after a countdown** (default
  5s, adjustable): the next blocked popup from the same host runs your last Allow/Block/Background/
  Redirect automatically unless you click **Keep open**. Remembered choices expire after ~10 days;
  a **Forget remembered choices** button clears them.

## Keyboard shortcuts

Defaults (changeable at `chrome://extensions/shortcuts`):

| Action | Windows/Linux | Mac |
|--------|---------------|-----|
| Open popup | `Alt+Shift+Y` | `Command+Shift+Y` |
| Capture area | `Alt+Shift+1` | `Command+Shift+1` |
| Capture screen area | `Alt+Shift+2` | `Command+Shift+2` |
| Capture full page | `Alt+Shift+F` | `Command+Shift+F` |
| Fill form (dummy data) | _(set manually)_ | _(set manually)_ |

> Chrome only assigns defaults for up to 4 shortcuts. "Fill form" has no default — set your own
> (e.g. `Alt+Shift+D`) at `chrome://extensions/shortcuts`. The button on the Page tab works
> without a shortcut.

Capture shortcuts use the saved preferences (clipboard/file & redact on/off) from the Page tab.

Note: shortcuts can clash. If a combination is already used by another extension, Chrome leaves
it **unbound** (silently). A **global** OS hotkey from another app (e.g. Lightshot's
`Alt+Shift+S`) always beats Chrome. Check or remap at `chrome://extensions/shortcuts`.

## Installation (step by step)

YoshTool is a **MV3 extension with no build step** — you load the folder straight into the browser.
It takes about 2 minutes. You do **not** need Git, Node, or any developer tools to just use it.

### Which browsers?

Any **Chromium-based** desktop browser: **Google Chrome, Microsoft Edge, Brave, Opera, Vivaldi,
Arc**, etc. The extensions page differs per browser — use the matching address:

| Browser | Extensions page |
|---|---|
| Chrome | `chrome://extensions` |
| Edge | `edge://extensions` |
| Brave | `brave://extensions` |
| Opera | `opera://extensions` |
| Vivaldi | `vivaldi://extensions` |

> **Firefox is not supported** (it uses a different extension engine and some features here rely on
> Chromium-only APIs such as `chrome.debugger`). Mobile browsers can't load unpacked extensions.

### Option A — Download ZIP (no Git needed) — easiest

1. Open the repo page: **https://github.com/alfatihart/yoshtool**
2. Click the green **`< > Code`** button → **Download ZIP**.
3. **Extract** the ZIP (right-click → Extract All / unzip). You'll get a folder named
   `yoshtool-main`.
4. **Move that folder somewhere permanent** — e.g. `Documents\yoshtool` (Windows) or
   `~/Documents/yoshtool` (macOS/Linux). **Do not leave it in Downloads or a temp folder**, and
   don't delete or move it afterwards: the browser loads the extension *from this folder every time*,
   so if the folder disappears, the extension breaks.
   - Inside the folder you should see **`manifest.json`** directly (next to `popup.html`,
     `background.js`, …). That's the folder you'll point the browser at — not a parent folder.
5. Open your browser's extensions page (see the table above), e.g. `chrome://extensions`.
6. Turn on **Developer mode** (toggle, usually top-right). Only then does "Load unpacked" appear.
7. Click **Load unpacked**, then select the folder from step 4 (the one containing `manifest.json`).
8. YoshTool appears in the list and its **Y** icon shows in the toolbar. Done.

### Option B — Git clone (easier to update later)

```bash
# clone into a permanent location (not a temp folder)
cd ~/Documents            # or wherever you keep projects
git clone https://github.com/alfatihart/yoshtool.git
```

Then do **steps 5–8** of Option A, picking the cloned `yoshtool` folder.

### After installing — make every feature work

- **Pin it:** click the puzzle-piece (Extensions) icon in the toolbar → pin **YoshTool** so the
  **Y** icon stays visible. Click it (or press `Alt+Shift+Y`) to open the popup.
- **Features that ask for permission the first time** (a Chrome dialog pops up — click **Allow**):
  the **popup blocker**, **floating rail**, **on-page helper pill**, **auto-redact**, and the
  **element blocker** need the "all sites" permission. They're enabled with a button in the popup;
  approve the dialog once.
- **Cookie export/import and "Clear cookies"** need per-site permission: open the **Sites** tab,
  find the site's row, and click its **Cookies** chip to grant it (Chrome shows its own dialog).
- **Ad / tracker blocker** ships **off** — turn it on in the **Protect** tab.
- **Incognito:** on the extensions page, open YoshTool's **Details** → enable **Allow in Incognito**
  (needed for cookie import into incognito windows).
- **Keyboard shortcuts:** the capture shortcuts have defaults; others (fill form, element blocker,
  reveal passwords, …) are unbound — set them at `chrome://extensions/shortcuts`.
- After enabling anything that runs **on pages**, **reload the open tabs** once so the content
  scripts inject.

### Updating to the latest version

- **If you cloned (Option B):** run `git pull` in the folder, then open the extensions page and
  click the **Reload** (⟳) icon on the YoshTool card.
- **If you used the ZIP (Option A):** download the new ZIP, extract it, and **replace the old
  folder's contents** with the new ones (keep the same folder path), then click **Reload** (⟳) on
  the card. (Or just load the new folder and remove the old entry.)

> After updating, **reload any open tabs** so the new content scripts are reinjected. The version
> number is shown in the popup header's corner and at the extensions page.

### Troubleshooting

- **"Manifest file is missing or unreadable"** → you selected the wrong folder. Pick the one that
  contains `manifest.json` directly (for a ZIP that's usually `yoshtool-main`, not its parent).
- **The card is greyed out / "This extension may have been corrupted"** → the folder was moved,
  renamed, or deleted. Put it back (same path) and click **Reload**, or Load unpacked again.
- **A feature does nothing on a page** → reload that tab after enabling it; and check the feature
  isn't one that first needs the "all sites" permission (approve the dialog).
- **"Clear cookies" didn't log me out** → use **Clear site data (log out)** instead — many apps keep
  the session in `localStorage`/`IndexedDB`, which cookie-clearing doesn't touch.

## Further documentation

- [`docs/multi-session-research.md`](docs/multi-session-research.md) — research on the
  "multi-session tab" feature (multiple accounts per site) + Chrome MV3 constraints
  _(in Indonesian)_.
- [`docs/multi-session-plan.md`](docs/multi-session-plan.md) — the Phase 1 implementation plan
  (cookie-swap Session Switcher, reusing `cookies.js`/`allowlist.js`) _(in Indonesian)_.
- [`docs/mobile-simulator-research.md`](docs/mobile-simulator-research.md) — reverse-engineering
  of the "Mobile Simulator — Responsive Testing Tool" extension and how a mobile/device-mode
  feature could fit YoshTool.
- [`docs/clipboard-filetray-research.md`](docs/clipboard-filetray-research.md) — why a clipboard
  manager + "drag a copied file onto a page to upload" can't be done in a pure MV3 extension, and the
  plan to port it to a desktop companion (native-messaging host → Tauri app) that can reach OS APIs.
- [`docs/performance-overlay-research.md`](docs/performance-overlay-research.md) — how to bring a
  DevTools-Performance-style profiler (record & reload, filmstrip, CPU/Network throttling) into
  YoshTool as an on-page **overlay** (no docked panel that resizes the page), extending the existing
  CDP perf lab test — and what's out of scope (full flame chart / Lighthouse audits).
- [`docs/userscripts-userstyles-research.md`](docs/userscripts-userstyles-research.md) — persistent
  per-site **custom CSS** (userstyles) and **custom JS** (userscripts, via the MV3 `chrome.userScripts`
  API) — à la Stylus / Tampermonkey — the MV3 constraints, a minimal `GM_*` subset, and a phased plan.

## Development & tests

Pure unit tests (cookie parser/serializer, validation, URL builder) run on Node's built-in
test runner:

```bash
node --test ./test/*.test.js
```

## File layout

| File | Purpose |
|------|---------|
| `manifest.json` | Permission & service-worker declaration |
| `popup.html` / `popup.js` | Tabbed popup UI: Page, Protect, Cookies, Sites |
| `cookies.js` | 3-format parser/serializer + `chrome.cookies` helpers |
| `sessions.js` | Session Switcher: registrable domain + save/switch sessions, IndexedDB & encryption layer (reuses `cookies.js`, Node-tested) |
| `sessioncrypto.js` | AES-256-GCM + PBKDF2 passphrase encryption for saved sessions (pure Web Crypto, Node-tested) |
| `allowlist.js` | Reads/writes two domain lists (cookie & redact) in `chrome.storage.local` |
| `background.js` | Service worker: screenshot orchestration, permission routing, redact-script registration |
| `redact.js` | Pure sensitive-data detectors (Node-tested) — used by capture & auto-redact |
| `redact-overlay.js` | "Detect & propose" content script for screenshots (injected on demand) |
| `sensor.js` | Realtime auto-redact content script (registered dynamically per domain) |
| `faker-data.js` | ID-locale dummy-data generators + field matcher (pure, Node-tested) |
| `filler.js` | "Fill form" content script (inline copy of `faker-data.js` + DOM glue) |
| `color.js` | Color conversion (HEX/RGB/HSL) for the color picker (Node-tested) |
| `device-presets.js` | Device mode: curated device catalogue + CDP override builders (pure, Node-tested; imported by popup & background) |
| `tech-core.js` | Tech profiler matching engine — pattern/version/implies logic (pure, Node-tested) |
| `perf-core.js` | Performance: thresholds/rating, CLS session-window, nav/resource summarizers (pure, Node-tested) |
| `perf.js` | Performance collector content script (Performance APIs; inline copy of `perf-core.js` helpers) |
| `devtools-core.js` | Dev converter — JWT/JSON/Base64/URL converters (pure, Node-tested; popup-only) |
| `domain-core.js` | Domain info — RDAP / DoH / security-header / rank parsers (pure, Node-tested) |
| `tech-data/` | Bundled **webappanalyzer** fingerprint dataset (GPL-3.0; `categories.json` + `technologies/*.json` + `LICENSE` + `NOTICE.md`) |
| `eyedropper.js` | On-page eyedropper content script (loupe magnifier from a snapshot) |
| `fontinspector.js` | Font inspector content script (hover + canvas pixel-compare) |
| `copyunlock.js` | Copy/selection unlock content script (CSS override + capture-phase event release) |
| `darkmode-core.js` | Pure color/luminance helpers for "is the page already dark?" (Node-tested) |
| `darkmode.js` | Dark-mode content script (invert + already-dark skip; inline copy of `darkmode-core.js`) |
| `translate-core.js` | Translate URL builder + response parser + target languages (Node-tested) |
| `translate-overlay.js` | Selection-translate tooltip content script (background does the fetch) |
| `fullpage-translate.js` | Full-page bilingual translate content script (batches blocks via background; reversible) |
| `selection-helper.js` | On-page helper pill: Translate/Font on text select, Fill form on field focus (all-sites, opt-in) |
| `rail.js` | Floating edge sidebar (Shadow DOM): collapsible launcher for the on-page tools (all-sites, opt-in) |
| `popblock-core.js` | Pure popup-blocker decision logic (Node-tested) |
| `popblock-main.js` | MAIN-world content script: overrides `window.open` + proxies clicks/forms |
| `popblock-isolated.js` | ISOLATED-world content script: decision + notification bar (inline copy of `popblock-core.js`) |
| `selector.js` | Area-selection overlay content script (injected on demand) |
| `toast.js` | In-page notification toast |
| `test/` | Node unit tests |

## Permissions & security notes

- Cookie export/import is limited to an **allowlist** you manage yourself; the extension has
  no fixed host access to any site at install time (`optional_host_permissions`).
- Cookies are session keys — handle exported files carefully; anyone who holds one can sign in
  to the related account.
- `chrome.debugger` (full-page screenshot and Device mode) shows Chrome's "is being debugged"
  infobar; that's a built-in browser security UI and can't be hidden by the extension. Device mode
  keeps it attached for as long as it's on, and releases it on Stop / opening DevTools / closing the
  tab. It needs no new permission beyond the `debugger` the screenshot already uses.
- `alarms` is used only as the **Ping** background keep-alive heartbeat (so the latency loop survives
  the service worker being suspended while the popup is closed). It grants no host or data access.
- **Tech profiler data is GPL-3.0:** the fingerprint dataset under `tech-data/` is the open-source
  **webappanalyzer** data, bundled verbatim under its own GPL-3.0 LICENSE with attribution
  (`tech-data/NOTICE.md`). It's read-only reference data; the matching engine (`tech-core.js`) is an
  independent reimplementation. (Same pattern as the bundled ad/tracker filter lists.)
- **Auto-redact is separate from cookies:** the Auto-redact list and the cookie allowlist are
  stored and gated independently. Host permissions are shared by Chrome, but a domain that
  only exists on the redact list won't pass the cookie export/import check.
- **Solid** redaction burns the box into the image pixels (irreversible); **Blur** can be
  reversed — use Solid for highly sensitive data in screenshots. Realtime blur (auto-redact)
  only protects the on-screen display, not an exported artifact.
- Detection is based on DOM text & form fields; content inside `<canvas>`/images and people's
  names aren't covered yet.
- The **popup blocker** needs **global** host permission (`*://*/*`) so the MAIN
  `document_start` script can replace `window.open` on every site. This permission is requested
  through a button (Chrome's dialog), not written permanently into the manifest, and is
  separate from the cookie/redact lists. The **default** mode only blocks programmatic
  `window.open` (popunders) — anything triggered by a user click (download/popup) passes;
  **Strict** mode blocks everything (and each block shows a bar until the domain is "Trusted"/
  whitelisted or the site is disabled). The default whitelist (OAuth/payment) reduces friction.
  v1 omits the original extension's countdown/auto-action, URL rules, and advanced iframe
  protection.
