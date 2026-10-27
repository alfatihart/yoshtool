# Changelog

## 1.6.1

- Sessions: new **Update** action on the active session — it overwrites that session's saved
  snapshot with the state that's live right now (cookies + localStorage). This fixes the case
  where a session saved while logged out stayed "logged out" after you logged in: switching is
  non-destructive and only *restores* a snapshot, so a login made after saving must be captured
  with **Update** before you switch away, otherwise switching back returns the old logged-out
  snapshot. The action row now wraps to fit Re-apply · Update · Rename · Delete, and the Sessions
  hint explains the restore-vs-update model.

## 1.6.0

**Full English UI + documentation.** Every user-facing string — buttons, labels,
descriptions, menus, status/toast messages, and the popup-blocker, redaction, and
font-inspector overlays — is now in English, and all internal code comments were translated
to English as well. README.md is English by default, with an Indonesian version in
[`README.id.md`](README.id.md). No behavior changes: element IDs, logic, storage keys, and
detection rules are untouched, so all tests stay green.

- The in-page "Auto-sensor" feature is now called **Auto-redact** throughout the UI and docs.
- Polished the microcopy for clarity and consistency (verb-first CTAs, clearer empty states).

## 1.5.3

- Fix Sessions: **dropped the auto-save-before-switch** that was actually corrupting sessions.
  After logout, the auto-save captured the logged-out state and overwrote the active session's
  snapshot → switching back became "logged out". Switching is now **non-destructive** (it only
  applies the target snapshot, never overwriting another). To update a snapshot, use "Save
  current session".
- The **active** session can now be **"Re-applied"** (the button is no longer disabled) —
  restoring a login from the snapshot after logout, including the single-saved-account case.

## 1.5.2

- Sessions now also move **localStorage + sessionStorage**, not just cookies. Important for
  **SPA/Supabase** logins (the session token lives in the `localStorage` key
  `sb-<ref>-auth-token`, not a cookie) — previously "0 cookies" & the session wasn't swapped.
  Saving/switching now captures & restores the page's storage (via `chrome.scripting`), then
  reloads. Session rows show a `cookies · storage` count. localStorage is only read while the
  active tab is on that domain (localStorage is per-origin). IndexedDB is still out of scope.

## 1.5.1

- Fix Sessions: the default domain is now the **tab's full hostname** (e.g.
  `staging-app.konsultanedu.com`), not the registrable domain (`konsultanedu.com`). The broader
  registrable form often didn't match the (per-hostname) allowlist entry → "Domain not allowed"
  even when the site was already allowlisted. Now consistent with Export/Import. The domain
  stays editable.

## 1.5.0

**Session Switcher (multi-login) — Phase 1.** New **Sessions** tab: save several named logins
for the same site, then switch with one click.

- The **swap** model: switching = (optionally save the active session first) → delete the
  site's cookies → write the target session's cookies → reload the tab. **One account active
  per site** at a time.
- `sessions.js` (new, Node-tested): `registrableDomain()` (eTLD+1, including ID TLDs like
  `co.id`/`web.id`/etc., editable in the UI), save/rename/delete/activate a session,
  `captureCurrent`/`applySession`. Reuses `cookies.js` (serialization + set/remove cookies,
  already handling `__Host-`/`__Secure-`/`sameSite`/`partitionKey`/`storeId`) & `allowlist.js`
  (host-permission gate). **No new permissions.**
- Confirmation for destructive actions (switching = logout/login effect, deleting a session).
- **Limitations** (stated in the UI): only cookies are moved (not localStorage/IndexedDB → some
  SPA/token logins may not come along); not simultaneous per-tab isolation; not anti-detection.

## 1.4.5

- **Fix the popup blocker blocking user-clicked downloads/popups.** Previously **every**
  `window.open` was blocked (including the aaPanel Download button, which uses
  `window.open(url)`), and "Allow" often failed to finish the download because the replay in the
  MAIN world lost user activation (more noticeable on Chrome/Windows 11). Fixes:
  - The **default** mode now only blocks **programmatic** `window.open` (popunders with no user
    gesture); a `window.open` triggered by your own click (download, a deliberately clicked
    popup) is **not blocked**. **Strict** mode still blocks everything. Turning Strict off now
    genuinely lets downloads through (it used to have no effect on `window.open`).
  - The **Allow** button opens the URL via `chrome.tabs.create` (privileged, no activation
    needed) instead of the fragile replay — so it actually downloads/opens.

## 1.4.4

- **GitHub link** in the popup header (top-right icon) → opens the repo in a new tab.
- **Reset color history**: a "Reset" button appears above the color-picker history (only when
  it has entries) to clear the list of picked colors.
- **Install & update documentation** in the README: how to install via clone or ZIP, and how to
  update (git pull / re-download + Reload at `chrome://extensions`).

## 1.4.3

- **The eyedropper now picks ON THE PAGE, not in the popup** (ColorZilla pattern). Previously
  EyeDropper was called from the popup, so the popup window floated over part of the page and
  blocked the color selection. Now: click "Eyedropper" → the popup closes →
  `captureVisibleTab` + a **loupe/magnifier** (`eyedropper.js`) that follows the cursor (10×
  zoom, pixel marker, live hex). Click to pick: the color is auto-copied to the clipboard &
  added to history (visible when the popup reopens); Esc/right-click cancels. Restricted pages
  (chrome://, Web Store) still use the native EyeDropper as a fallback.

## 1.4.2

Popup + in-page overlay UI/UX redesign (adopting patterns from WhatFont, Popup Blocker,
ColorZilla, Fake Filler).

- **Token-based design system** with **automatic dark mode** (`prefers-color-scheme`). A calm
  **monochrome slate** accent; semantic colors (green/red/amber) retained.
- **popup.html** reorganized: a logo-mark header, a segmented icon tab bar, each feature as an
  icon-titled **card**, a primary/danger/ghost button hierarchy, `accent-color` checkboxes, an
  accessible focus ring, and system fonts. The logic (`popup.js`) is unchanged — all element
  IDs & hooks are preserved.
- **In-page overlays aligned**: the popup-blocker bar, toast, font-inspector tooltip + detail
  card, and the screenshot redaction toolbar now share one design language (dark card,
  monospace values, semantic buttons).
- Microcopy tidied (capture → Area / Screen / Full page, clearer CTAs).

## 1.4.1

- Fix: add `<meta charset="UTF-8">` to `popup.html`. Without it, the em-dash `—` (e.g. the
  label **"Strict — also block popups from clicks"** and a few hints) rendered as the mojibake
  `â€"`.

## 1.4.0

**Popup blocker (global)** — ported from "Popup Blocker (strict)" v0.9.4
(schomery/popup-blocker), adapted to YoshTool's patterns.

- Two `document_start` + `allFrames` content scripts: **MAIN** (`popblock-main.js`) replaces
  `window.open` (a Proxy; when blocking it returns a recording `simulate()` object, not `null`,
  so calling code doesn't throw) plus proxies for `a.click`/`dispatchEvent` &
  `form.submit`/`dispatchEvent`; **ISOLATED** (`popblock-isolated.js`) makes the decision and
  shows the bar. Cross-world communication goes through a **synchronous** span port.
- Pure decision logic in `popblock-core.js` (Node-tested, 14 tests) — copied **identically**
  inline into ISOLATED. Default-block `window.open`; overrides for host whitelist /
  same-registrable (optional) / protocol (`magnet:`).
- **Strict** mode: also blocks `target=_blank` clicks (mirroring the original extension); the
  default non-strict mode only blocks programmatic `window.open` so click navigation isn't
  disturbed.
- **Notification bar** (a namespaced injected div, not an iframe): Allow / Background / Redirect
  / Trust domain (two-click) / Block, + "Disable on this site". "Allow" faithfully replays
  `window.open` (+ its recording) in the MAIN world.
- UI in the **Tools tab**: enable (request `*://*/*` permission via a button), master on/off,
  Strict, allow same-origin, whitelist & disabled-site lists, a block-count badge.
- Default whitelist of OAuth/payment hosts (accounts.google.com, paypal.com,
  checkout.stripe.com, etc.) so logins aren't broken. Namespaced `pbEnabled`/`pbConfig` state,
  **separate** from the cookie/redact lists (disambiguated by `pendingGrant.type="popblock"`).
- v1 omits: countdown/auto-action, URL rules, advanced iframe protection, a separate options
  page (uses a section in the popup).

## 1.3.1

- Color picker: a **live color selector** — `<input type="color">` + a typable hex field, with
  **HEX/RGB/HSL updating live** as you drag/type. The eyedropper, palette, and history all set
  the selector too (both ways). The initial color shows when the popup opens.

## 1.3.0

New **Dev** tab with developer helpers.

### Fill form (dummy data / Faker)
- Fill every input on the active tab with **Indonesian-locale** fake data: name, email, phone
  (real operator prefixes), NIK (valid 16 digits), NPWP, address (Jl./Kel./Kec./city/postal
  code), account number (per-bank length), test card (4242…).
- Detects the field type from `name`/`id`/`<label>`/`aria-label` + the `type` attribute;
  `setNativeValue` so React/Vue notice the change; supports `<select>`/checkbox/radio;
  "confirm" fields copy the previous value; a **"Don't overwrite fields that already have a
  value"** option.
- Keyboard shortcut: set it manually at `chrome://extensions/shortcuts` (e.g. `Alt+Shift+D`) —
  Chrome caps default shortcuts at 4, so "Fill form" has no default. The Dev-tab button works
  without a shortcut.

### Color picker
- **Eyedropper** (the built-in EyeDropper API, Chrome 95+) picks any pixel's color — straight
  from the popup, no host permission. Copy **HEX / RGB / HSL**; a 12-color history.
- **Page palette**: extract the page's dominant colors (click a swatch to copy).

### Font inspector
- Hover an element → a tooltip with the **actual font** (canvas pixel-compare), size, weight.
- Click → a detail card (the font stack with the one in use bolded, line height, color, a
  **Google Fonts/Adobe Fonts** badge when detected), a **text preview** + **Copy CSS**. Esc to
  exit.

### UX
- Tab order: **Dev · Tools · Cookies · Allowlist**; the popup **remembers the last tab**.
- **Right-click menu**: "Fill form with dummy data" & "Inspect fonts (WhatFont)" — quick access
  without opening the popup (the `contextMenus` permission).
- Color picker: the **HEX/RGB/HSL values stack vertically** (no longer cut off on 2 lines),
  click to copy. The **page palette is now a toggle** (click again to close) + a count header.

## 1.2.0

New privacy feature: realtime auto-redact + expanded personal-data detection.

### Realtime auto-redact (privacy mode)
- Blurs sensitive data directly on the page as you browse — for screen-share/recording
  protection, separate from the screenshot feature. **Click to reveal temporarily** (a field
  reveals on focus so it can be edited).
- Runs only on domains added to the **Auto-redact** list (Allowlist tab, the "Protect this
  tab's domain" button), via a dynamically registered content script.
- Master on/off on the Allowlist tab; realtime on dynamic pages (MutationObserver).
- **Security:** the auto-redact list is SEPARATE from the cookie allowlist. Adding a domain to
  auto-redact never enables exporting its cookies (disambiguated via `pendingGrant`, not
  default-to-cookie).

### Expanded detection (capture & auto-redact)
- Added an **address** category (Indonesian heuristics: Jl./Jalan/Gg./Blok + No./RT-RW/postal
  code) and **personal/sensitive field** detection (`PII_FIELD_RE`): contact (Email, Phone,
  WhatsApp), location (Province, City/Regency, Subdistrict, Village, Postal Code), financial
  (Account Number, Card Number, CVV, IBAN, Virtual Account), and Callback/Webhook URL — applies
  to both screenshot redaction and auto-redact.
- Full category set: email, phone, credit card (Luhn), IBAN, API key, JWT, address, secret
  fields, PII fields, and high-entropy tokens.

### Field-detection refinements
- Only fields **with a value** are blurred (empty fields like an unfilled password/search are no
  longer blurred).
- **password** & **search** inputs are skipped (password is already hidden by the browser; a
  search box isn't displayed data), including the "Reference No / Merchant / Customer Phone" box.
- Auto-redact: a secret freshly typed into an empty field is blurred when focus leaves.
- "Account Owner" (a name) is intentionally not blurred.
- **Async-loaded fields** (Province/City/Subdistrict/Postal/Address/Account Number/Whitelist IP
  whose value arrives later) are now blurred automatically without a click — auto-redact
  re-scans fields a few times after the page loads.
- **Account numbers & Whitelist IPs in tables** are blurred via **column-based masking** (a
  "Destination Account", "Whitelist IP", etc. header) — "Reference No"/"Description"/"Amount"
  columns are untouched, so **transaction codes are no longer blurred**.
- A **Whitelist IP field** is detected from its IP value (IPv4/IPv6), not just the label.
- An **Account Number field** (e.g. Withdrawal) is detected from its value (a run of 10–19 pure
  digits) when the label isn't readable — field values only, so transaction codes in text stay
  safe.
- **Phone** detection is now constrained so it doesn't match inside long alphanumeric tokens
  (e.g. the transaction code "T30086…XR3Z4").

## 1.1.0

A big release with many new features on top of 1.0 (JSON cookie export/import).

### Cookies / sessions
- Extra export/import formats: **Header String** and **Netscape** (besides JSON), with
  automatic format detection on import.
- Export: **Copy** to the clipboard or **Save file**. Import: **Paste** or **Open file**.
- Import works across tabs/incognito: the domain is taken from the cookie data, the store is
  resolved explicitly from the active tab, with a read-back verification.
- Options for **Clear existing cookies before import**, **Auto refresh**, and an **Open site**
  button (opens the URL captured at export).
- Fixes: `__Secure-`/`__Host-` set via `https://`; `hostOnly` doesn't force a domain;
  `partitionKey` is passed through.

### Allowlist
- Export/import is limited to a self-managed **domain allowlist** via Chrome's permission
  dialog ("Allow this tab's domain") — no automatic host access at install time.

### Tools
- **Clear cache** and **Clear cookies** for the active tab's domain (with confirmation;
  clearing cookies requires typing the domain name).
- **Screenshot**: Area, Screen, Full page (one whole page via `chrome.debugger`). Output to the
  clipboard or save a file.
- **Toast** confirmations on the page for screenshots, clear cache/cookies, and import.

### Redact sensitive data (Phase 1)
- Automatic detection in DOM text & form fields: email, phone, credit card (Luhn), API keys
  (AWS/Google/Stripe/GitHub), JWT, IBAN, plus label-based secret fields and high-entropy tokens.
- A **detect-then-propose** mode: candidate boxes can be toggled, with add-manual-box and
  reset-manual.
- **Solid** (safe, default) or **Blur** redaction, with a color choice.
- DOM text only (canvas/OCR & people's names = a later phase).

### Keyboard shortcuts
- Open popup `Alt+Shift+Y`, Capture area `Alt+Shift+1`, screen `Alt+Shift+2`, full page
  `Alt+Shift+F` (rebindable at `chrome://extensions/shortcuts`).

### Miscellaneous
- Extension icon, README, CHANGELOG, and unit tests (`node --test ./test/*.test.js`).

## 1.0

- Cookie export/import in JSON format via the popup.
