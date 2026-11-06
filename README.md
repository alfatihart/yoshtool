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
- **Clear cache** and **Clear cookies** for the active tab's domain (with confirmation;
  clearing cookies requires typing the domain name).
- **Screenshot**: Area, Screen, and Full page (`chrome.debugger`, one whole page). Output
  defaults to the clipboard, with an option to save a file. A confirmation toast appears on
  the page after the action.
- **Redact sensitive data in screenshots** (optional): detect and propose redaction boxes for
  emails, phone numbers, credit cards (Luhn), API keys, JWTs, IBANs, addresses, and
  secret/PII fields — using **Solid** (safe, irreversible) or **Blur**. Boxes can be toggled,
  added manually, and reset before "Redact & capture".
- **Realtime auto-redact (privacy mode)**: blurs sensitive data directly on the page as you
  browse, for screen-sharing protection. Runs only on domains you add to the **Auto-redact**
  list (Sites tab). **Click to reveal temporarily.** This list is **separate** from the
  cookie allowlist: adding a domain here does not enable exporting its cookies.
- **Dev tools** (the Page tab):
  - **Fill form (dummy data)** — fill every input with realistic Indonesian-locale fake data
    (name, email, phone, NIK, NPWP, address, account number, test card); supports React/Vue
    (native setter), `<select>`/checkbox/radio, and confirmation fields.
  - **Color picker** — an **on-page eyedropper** with a loupe/magnifier (10× zoom, live hex;
    the popup closes so it doesn't block the selection), a color selector with live hex, copy
    HEX/RGB/HSL, a 12-color history, and a **page palette** (dominant colors).
  - **Font inspector** — hover to see the actual font (canvas pixel-compare), click for a
    detail card with Google/Adobe Fonts detection.
  - **Copy & selection unlock** — re-enable selecting text, copy/paste and right-click on sites
    that block them (CSS `user-select` override + capture-phase event release — the browser's own
    copy/menu still runs). Click again (or the right-click menu) to restore. Also available as a
    **right-click → "Unlock copy & selection"** menu item.
  - **Translate** — turn on translate mode, then **select text** to get a translation tooltip
    (detected source language + a Copy button); also via **right-click → "Translate selection"**.
    Client-side: the content script shows the tooltip, the background service worker fetches the free
    Google Translate web endpoint (a page can't, due to CORS; the SW with host permission can). Pick
    the **target language** in the popup (default Indonesian). Uses one narrow host permission
    (`translate.googleapis.com`). The free endpoint can rate-limit under heavy use (best-effort).
  - **Dark mode** — a quick dark look by inverting the page (`invert(1) hue-rotate(180deg)`) and
    **re-inverting images/video** so photos keep their colors. It **skips sites that already have a
    dark theme** (background-luminance + dark-theme markup check) so it doesn't double-darken.
    Toggle off by clicking again or via the **right-click → "Toggle dark mode"** menu; the popup
    shows the on/off state. (Simple invert — punchy but it flips the light/dark order and lightens
    already-dark bits; v1 is per-tab and doesn't persist across reloads.)
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
  dialogs. The toolbar badge shows a rough blocked count for the active tab. An optional **Extended
  blocklist** toggle downloads ~25k extra ad/tracker rules (updatable via **Update now**, no
  permission). Background and design notes:
  [`docs/adblock-tracker-research.md`](docs/adblock-tracker-research.md).
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

## Installation (Load unpacked)

There's no build step — the repo folder loads directly as an extension.

### Option A — Clone (recommended, easy to update)

```bash
git clone https://github.com/alfatihart/yoshtool.git
```

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked** and pick the cloned `yoshtool` folder.
4. (Optional) Open the extension's **Details** → enable **Allow in Incognito** if you want to
   use it in incognito windows.

### Option B — Download ZIP

1. On the repo's GitHub page: the green **Code → Download ZIP** button.
2. Extract the ZIP into a folder.
3. Follow steps 1–4 as in Option A, choosing the extracted folder.

## Updating to the latest version

- **If you cloned:** run `git pull` in the repo folder, then open `chrome://extensions` and
  click the **Reload** (⟳) icon on the YoshTool card.
- **If you use the ZIP:** download the latest ZIP, extract it over the old folder, then click
  **Reload** (⟳) on the extension card.

> After updating, also reload any open page/tab so the new content scripts (popup blocker,
> auto-redact, etc.) are reinjected. The version number is shown in the popup header's corner
> and at `chrome://extensions`.

## Further documentation

- [`docs/multi-session-research.md`](docs/multi-session-research.md) — research on the
  "multi-session tab" feature (multiple accounts per site) + Chrome MV3 constraints
  _(in Indonesian)_.
- [`docs/multi-session-plan.md`](docs/multi-session-plan.md) — the Phase 1 implementation plan
  (cookie-swap Session Switcher, reusing `cookies.js`/`allowlist.js`) _(in Indonesian)_.
- [`docs/mobile-simulator-research.md`](docs/mobile-simulator-research.md) — reverse-engineering
  of the "Mobile Simulator — Responsive Testing Tool" extension and how a mobile/device-mode
  feature could fit YoshTool.

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
| `eyedropper.js` | On-page eyedropper content script (loupe magnifier from a snapshot) |
| `fontinspector.js` | Font inspector content script (hover + canvas pixel-compare) |
| `copyunlock.js` | Copy/selection unlock content script (CSS override + capture-phase event release) |
| `darkmode-core.js` | Pure color/luminance helpers for "is the page already dark?" (Node-tested) |
| `darkmode.js` | Dark-mode content script (invert + already-dark skip; inline copy of `darkmode-core.js`) |
| `translate-core.js` | Translate URL builder + response parser + target languages (Node-tested) |
| `translate-overlay.js` | Selection-translate tooltip content script (background does the fetch) |
| `selection-helper.js` | On-page helper pill: Translate/Font on text select, Fill form on field focus (all-sites, opt-in) |
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
- `chrome.debugger` (full page) shows Chrome's "is being debugged" infobar; that's a built-in
  browser security UI and can't be hidden by the extension.
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
