# Changelog

## 1.20.2

- **Selection helper — "Fill form" pill moved inside the field.** The form-field Fill pill now sits
  at the right edge *inside* the focused input (like a password-manager icon) instead of floating
  above it, so it no longer covers the field's label. Vertically centered in short inputs, near the
  top on tall textareas. (The selection Translate/Font pill is unchanged.)

## 1.20.1

- **Cookie-banner auto-reject — wider coverage.** Added more per-CMP "reject all" selectors
  (Sourcepoint, Iubenda, Klaro, tarteaucitron, Termly, TrustArc, Google Funding Choices
  "Do not consent", generic `aria-label="Decline"`) and more reject labels (`do not consent`,
  `do not sell`, `no thanks`, Indonesian `menolak`). The feature already clicks the banner's real
  reject button (operating the CMP to opt out, not just hiding it); this just reaches more banners.

## 1.20.0

- **Tracking-parameter stripping (new).** New **"Strip tracking parameters"** toggle in Protect →
  all-sites features removes tracking query params (`utm_*`, `fbclid`, `gclid`, `msclkid`, `igshid`,
  `mc_eid`, and ~40 more) from top-frame navigations via a `declarativeNetRequest` `removeParams`
  rule. Only on `main_frame` (never touches API/subresource requests), gated behind the all-sites
  permission (DNR redirect needs host access), and allowlisted sites are exempt. Static ruleset
  `rule_resources/dnr-paramstrip.json`.

## 1.19.2

- **Element hiding — ABPindo (Indonesian/judol) coverage.** Merged the cosmetic rules from the
  **ABPindo** regional filter list into `cosmetics.json` (+4,376 generic, +2,306 domain-specific
  selectors, incl. procedural ones), adding element-hiding coverage for Indonesian sites and the
  pirate-stream/anime/judol ad placements EasyList misses. Every added plain selector is validated
  in a headless browser so an invalid one can't break hiding; unsupported extended/scriptlet rules
  are dropped. Reproducible via `scripts/build-cosmetics.mjs`.
- **Cosmetic engine now honors `domain.*` keys** (a rule applies on any TLD) — useful for the
  rotating-TLD pirate/anime sites ABPindo targets. Added `test/adblock-cosmetic.test.js`.

## 1.19.1

- **Element hiding — procedural (Extended-CSS) selectors.** The cosmetic filter now understands
  uBO/AdGuard "#?#"-style procedural selectors that plain CSS can't express, so it can hide ad
  containers that use randomized/obfuscated class names. Supported: `:has-text`, `:min-text-length`,
  `:matches-css`, `:matches-attr`, `:upward` (native `:has()` stays a plain CSS rule). Plain
  selectors are still one fast `<style>`; procedural ones are evaluated in JS and re-applied on DOM
  mutations. No new toggle — it rides the existing "Hide ad elements" feature. Pure parser
  (`adblock-procedural-core.js`) is Node-tested; the content script keeps a byte-identical inline copy.
  (Prepares the cosmetic pipeline to absorb procedural rules from regional lists like ABPindo.)

## 1.19.0

- **Ad blocker — anti-adblock scriptlets (new).** Adds a MAIN-world scriptlet engine that runs small
  "surgical" fixes at `document_start` to defuse JS-state anti-adblock detectors (FuckAdBlock /
  BlockAdBlock family) before the page's own scripts run — the one counter to script-based anti-adblock
  that MV3 still allows. New **"Anti-adblock scriptlets"** toggle in Protect → all-sites features
  (needs the all-sites permission, like element hiding / auto-reject). Ships a safe generic defuser set;
  the scriptlet code is bundled (updatable only via release, per MV3's remote-code ban), with a growable
  per-host rule table. Supported scriptlets: `set-constant`, `abort-on-property-read`, `json-prune`,
  `nowebrtc`. Pure matching logic (`adblock-scriptlets-core.js`) is Node-tested; the content script
  keeps a byte-identical inline copy.

## 1.18.5

- **Popup blocker — the notification bar is no longer misplaced for popups blocked inside an
  iframe.** The blocker runs in every frame, and a `position:fixed` bar drawn inside a sub-frame
  anchors to that frame's box, not the page — so a popup blocked in e.g. Gmail's Google-apps iframe
  made the bar appear stuck under that card instead of the bottom-right corner. The bar is now drawn
  **only in the top frame**: a sub-frame relays the block through the background
  (`pb-subframe-blocked` → `pb-show-remote`) and the top frame shows the bar in the real viewport
  corner. Allow/Trust for a relayed popup open the URL in a tab (no in-page replay across frames);
  Block/Background/Redirect/Disable work as before.

## 1.18.4

- **Selection helper — the pill auto-hides and is smaller.** The Translate/Font pill now fades out
  after ~3s if you don't use it, so text selected just to copy, document or screenshot it isn't left
  with a toolbar sitting over it (and it won't sneak into a screenshot taken a moment later).
  Hovering the pill keeps it up; it hides shortly after the cursor leaves; opening Translate/Font
  cancels the timer. The pill itself is a touch smaller. The form-field "Fill" pill is unchanged
  (it stays while the field is focused).

## 1.18.3

- **Selection helper — the pill no longer covers a site's own selection toolbar.** It now anchors
  to the **end of the selection** (where the drag finished) and sits **just below** it, instead of
  fixed above-left. Native selection toolbars (ChatGPT's "Ask ChatGPT", Claude's "Reply", etc.)
  appear centered *above* the text, so the pill stays clear of them; it flips above only when
  there's no room below, and keeps following the selection on scroll. The form-field "Fill" pill
  keeps its above-the-field placement.

## 1.18.2

- **Sites tab — "?" help tooltip.** Added a small `?` info dot next to the Sites intro that explains
  what each option does: **Cookies**, **No-block**, **Redact** and the **Popups** modes
  (Default / Trusted / Off).

## 1.18.1

- **Sites tab — per-domain matrix (phase 2 of the redesign).** The four separate exception lists
  are now one table: **one row per domain** with chip-toggles for **Cookies**, **No-block** and
  **Redact**, plus a **Popups** dropdown (Default / Trusted / Off). The current tab's domain sits
  in a **This site** card at the top — toggle a chip to apply it; every other domain with a setting
  appears under **Saved sites**, each with a **×** to clear all of its settings at once.
- Rows are built from the union of the cookie-allowed, ad-block-excluded, auto-redact and popup
  trusted/disabled lists, so one place now manages every per-site exception. Cookie/Redact chips
  still request that domain's host permission on toggle (the click is the user gesture); a chip
  shown as listed-but-not-granted means the permission was revoked. Removed the now-dead per-list
  renderers. No new permissions.

## 1.18.0

- **Popup redesign — 5 tabs → 4, less clutter (phase 1 of 2).** Reworked the layout so similar
  features sit together and long descriptions move into hover tooltips:
  - **Page** — everything that acts on the current tab: Screenshot, Clear & reload, Page tools
    (dark mode, unlock copy, inspect font, selection helper), Translate, Fill form, Color picker.
  - **Protect** — Ad & tracker blocker, the all-sites features, and the Auto-redact master toggle.
  - **Cookies** — Export, Import, and **Login sessions** (merged in from the old Sessions tab).
  - **Sites** — one home for every per-domain exception: cookie-allowed domains, ad-block
    exclusions, auto-redact domains, and popup trusted/disabled lists.
- **One all-sites permission unlocks everything.** Replaced the three separate “Enable… (needs
  all-sites)” buttons (element hiding, cookie-banner auto-reject, popup blocker) with a single
  **Unlock all-sites features** button; once granted, each feature is a plain checkbox.
- **Collapsible “Advanced” sections** keep the extended blocklist and popup-blocker options tucked
  away until needed, and most explanatory sentences are now tooltips on the card titles/controls.
- No new permissions; all element IDs and behaviour preserved. (Phase 2 will fold the four Sites
  lists into a single per-domain matrix.)

## 1.17.4

- **Full-page screenshot fix — refined after validating on the real sites (via an MCP-driven
  browser).** Dropped the viewport resize (`setDeviceMetricsOverride`) introduced in v1.17.3: it
  balloons `vh`-sized sections (e.g. superadblocktest.com's `100vh` hero) so only the top is
  captured. The capture now relies on flattening inner scroll containers + `captureBeyondViewport`
  alone (the Puppeteer/Playwright approach). Verified on the actual pages — obfusgated (content in an
  inner-scroll `<main>`): 885px → **5857px full**; superadblocktest (vh sections): **full 5337px**. (#23)

## 1.17.3

- **Fix: full-page screenshot captured only the first screen on some sites.** On pages whose
  scrollable content lives in an inner `overflow:auto`/`scroll` container (common in SPA/flex
  layouts — e.g. the ad-block test sites), `window.scrollBy` couldn't scroll it and
  `scrollHeight`/`cssContentSize` reported only the viewport, so the capture got one screen. The
  full-page path now temporarily **flattens inner scroll containers** into normal document flow
  before measuring, takes the **larger of `cssContentSize` and live `scrollHeight`**, waits longer
  for lazy content to paint, and adds **`captureBeyondViewport`**, then restores the page. Root
  cause reproduced and the fix verified via CDP (inner-scroll test page: before = one viewport,
  after = full page). (#23)

## 1.17.2

- **Ad blocker — second batch of curated tracker blocks (+61).** Covers the remaining reachable
  pure-tracker endpoints from the test lists: Yahoo, Yandex, Unity Ads, Amazon ad buckets, Apple ad
  services, Microsoft/MSN telemetry, Roku, product-analytics SaaS (PostHog, Datadog RUM, Rudderstack,
  Snowplow), fingerprint/attribution (FingerprintJS, Branch, UID2), and more OEM telemetry. Same
  safety rule — functional/widget/video-player/SDK/consent hosts stay reachable on purpose. Curated
  additions now ~108 total (`rule_resources/extra-tracker-domains.txt`).

## 1.17.1

- **Ad blocker — cover well-known social / OEM / video trackers.** Added 47 broad block rules (in the
  base tracker list) for pure tracking endpoints the source lists missed or matched only narrowly:
  Facebook pixels (`tr`/`pixel`/`an.facebook.com`), X/Twitter, Reddit, TikTok, Quora, Pinterest, VK,
  Mail.ru, Snapchat trackers, mobile-OEM telemetry (Realme/Oppo/Huawei/Xiaomi/Samsung/LG/Vivo), and a
  few video ad trackers. **Deliberately left reachable** (blocking breaks sites): the Facebook-login
  SDK (`connect.facebook.net`/`graph.facebook.com`), Instagram API, video-player SDKs (IMA/DAI), and
  consent CMPs (handled by auto-reject instead). Curated list: `rule_resources/extra-tracker-domains.txt`.

## 1.17.0

- **Ad & tracker blocker — Extended blocklist (optional, downloadable & updatable).** A new toggle in
  the blocker card applies a curated **~25,000-rule** supplementary pack (ad/tracker domains the lean
  base misses — mobile telemetry, analytics SaaS, more ad networks) on top of the static base. Since
  MV3 can't add static rulesets at runtime and caps dynamic rules at ~30k, it's applied as **dynamic
  rules** and can be refreshed with **Update now** — fetched fresh from the repo with a **bundled
  fallback** (works offline / before the branch lands on `main`). No new permission (dynamic block
  rules need none). New pure helper `prepareExtendedRules` (+ tests). Data in
  `rule_resources/extended-blocklist.json`; attribution in `rule_resources/NOTICE.md`.

## 1.16.1

- **Ad blocker — more effective blocking (optimization of the bundled list).** Removed ~303
  "global" allow-exceptions (no site scope, not first-party) carried over from the source filter
  list. These had very high priority and were **un-blocking** third-party ad/tracker requests
  everywhere (e.g. `doubleclick.net` video-ad paths), so known ad domains leaked through *despite*
  having block rules. Site-specific and first-party exceptions are kept (targeted anti-breakage).
  Same lean list (~6 MB), but it now blocks noticeably more; use the per-site allowlist if a site
  misbehaves.

## 1.16.0

- **Ad & tracker blocker — cookie-banner auto-reject + blocked-count badge (Fase 4).**
  - **Auto-reject cookie banners** (opt-in, needs all-sites) — a content script that auto-clicks
    "reject all" on common consent CMPs (OneTrust, Cookiebot, Didomi, Usercentrics, Osano,
    Complianz, CookieYes, Cookie-Script, …) plus a conservative generic fallback (a reject-labelled
    button inside a cookie/consent/GDPR container). Watches for late-loading banners and respects
    the per-site allowlist. New pure helper `adblock-consent-core.js` (`isRejectText`) + a
    byte-identical inline copy in the content script `adblock-consent.js` + tests.
  - **Blocked-count badge** — the toolbar icon shows a rough count of blocked/matched requests for
    the active tab (via `declarativeNetRequest.getMatchedRules`, `declarativeNetRequestFeedback`
    permission). Best-effort: MV3 rate-limits this, so it updates only for the active tab and
    degrades silently.

## 1.15.0

- **Ad & tracker blocker — redirect stubs (Fase 3)** — once the all-sites permission is granted
  (via element hiding), the blocker **redirects** certain blocked scripts (analytics, ad SDKs such
  as google-ima, etc.) to **neutered stubs** instead of blocking them outright, so pages that call
  into those scripts don't throw errors / break layout. Ships 48 stub resources
  (`rule_resources/redirects/`) + a 916-rule `dnr-redirect` ruleset derived from the Ghostery
  extension. Enabled automatically alongside the network blocker when all-sites access exists (DNR
  `redirect` needs host permission, unlike `block`), so there's no extra toggle. Revoking the
  permission turns it back off.

## 1.14.0

- **Ad & tracker blocker — element hiding (cosmetic, Fase 2)** — on top of the network blocker,
  an opt-in **"Hide ad elements"** mode that removes leftover ad boxes/placeholders the network
  layer can't (a first-party container, an empty slot) by injecting a `display:none` stylesheet.
  Uses **EasyList** cosmetic filters (generic ~13.6k selectors + per-domain ~14.6k across ~6.9k
  domains), every selector **validated in real Chromium** at build time so one bad selector can't
  break the rest. Element hiding runs a content script on every page, so it needs the **all-sites
  permission** — asked via a button (**Enable element hiding**), not at install. It respects the
  same per-site allowlist as the network blocker (**Don't block on this site** also stops hiding).
  New pure module `adblock-cosmetic-core.js` (+ byte-identical inline copy in `adblock-cosmetic.js`,
  + tests). Data in `rule_resources/cosmetics.json` (`rule_resources/NOTICE.md` for attribution).

## 1.13.0

- **Ad & tracker blocker (new — Tools tab)** — blocks ad and tracker **network requests** using
  Chrome's `declarativeNetRequest` with two static rulesets (ads ~17.7k rules, trackers ~14.1k
  rules), toggled independently with **Block ads** / **Block trackers**. **No host permission
  needed** — nothing is asked at install; the base blocker works with only the
  `declarativeNetRequest` permission (rulesets ship disabled and are enabled at runtime from your
  prefs). Per-site exception: **"Don't block on this site"** adds the active tab's host to an
  allowlist (a dynamic `allowAllRequests` rule). The rulesets are a block/allow-only subset derived
  from the open-source Ghostery extension / EasyList + EasyPrivacy — see
  `rule_resources/NOTICE.md`. Element-hiding (cosmetic) blocking, redirect stubs, and consent
  auto-reject are a separate opt-in phase — see `docs/adblock-tracker-research.md`.

## 1.12.0

- **Selection helper** — when you **select text** on a page, a small pill appears next to it with
  quick **🌐 Translate** and **🔤 Font** actions, so you don't need the right-click menu. Translate
  shows the selection's translation (uses your chosen target language + Copy); Font shows the
  selected text's actual font, size and weight. Opt-in via a checkbox in the Dev tab ("Selection
  helper"); enabling registers an all-sites content script and asks for the all-sites permission on
  first enable (shared with the popup blocker — no prompt if already granted). Turn it off and open
  tabs stop showing it; new tabs stop immediately. The pill **follows the selection while you
  scroll** and hides only once the selection is scrolled out of view. Focusing a **form field**
  (input/textarea in a real form) shows a **Fill form** icon in the same pill — one click fills
  the form with dummy data without opening the popup.
- **Popup-blocker bar:** removed a stray focus outline (showed as a box in the system accent color)
  on the "Disable on this site" link and the bar buttons.

## 1.11.1

- **Fix: right-click → YoshTool menu items no longer disappear.** The five tools (Fill form, Inspect
  fonts, Unlock copy & selection, Toggle dark mode, Translate selection) were declared for different
  contexts, so e.g. selecting text hid the page-only ones. They now all show in every context.
- **Popup UI — more compact & less wordy.** Dropped the long description paragraphs under each tool
  (they read as filler); the detail now lives in a hover **tooltip** on the control. The Dev tab's
  three single-button tools (font inspector, copy-unlock, dark mode) are merged into one **"Page
  tools"** card, and labels are shorter. Same for the Tools/Cookies/Allowlist/Sessions blurbs. No
  behavior change — every control and its ID is unchanged.

## 1.11.0

- **Translate** (new Dev-tab tool + right-click menu) — turn on translate mode, then **select text**
  on any page to get a translation tooltip (with the detected source language and a **Copy**
  button). Also works as **right-click → "Translate selection"**. Fully client-side, no server: the
  content script detects the selection and renders the tooltip, while the **background service
  worker** fetches the free, auth-free Google Translate web endpoint (a page can't — the endpoint
  sends no CORS headers — but the SW with host permission can). The **target language** is set from
  a dropdown in the popup (default Indonesian; ~15 languages), with automatic source detection.
  Adds one narrow host permission (`https://translate.googleapis.com/*`); no other new permission.
  The URL builder + response parser are Node-tested (`translate-core.js`), and providers are
  config-shaped so more can be added later. Note: the free endpoint is undocumented and can
  rate-limit (HTTP 429) under heavy use — fine for interactive selection, best-effort not
  guaranteed. On-device/offline translation, TTS and full-page inline mode are planned follow-ups.

## 1.10.0

- **Dark mode** (new Dev-tab tool + right-click menu) — a quick dark look via a page invert
  (`filter: invert(1) hue-rotate(180deg)`), **re-inverting images/video/canvas** so photos keep
  their colors. Before applying it **skips pages that are already dark** — background-color
  luminance plus dark-theme markup flags (`[data-theme="dark"]`, `.dark`, `color-scheme: dark`, …)
  — to avoid double-darkening. Toggle: click again (or the right-click "Toggle dark mode" item) to
  restore; the popup button **shows the current on/off state per tab**. No new permission. This is
  the cheap, punchy invert (chosen over a per-element color remap, which looked washed-out): as a
  trade-off it flips the page's light/dark order and lightens already-dark elements, and a `filter`
  on the page can shift some fixed layouts; v1 is per-tab and doesn't persist across reloads. The
  luminance/`isDarkColor` core for the already-dark check is Node-tested (`darkmode-core.js`).

## 1.9.0

- **Copy & selection unlock** (new Dev-tab tool + right-click menu) — re-enable text selection,
  copy/cut/paste, right-click and drag on pages that block them. It injects a `user-select` CSS
  override and releases the page's event cancelers in the capture phase with
  `stopImmediatePropagation` (never `preventDefault`), so the page's blocking handler doesn't run
  while the browser's own copy/context-menu/selection still works. Keyboard shortcuts are only
  released for clipboard/select combos (Ctrl/⌘+C/X/V/A) so the page's other keys are untouched.
  Toggle: click again (popup button or the right-click "Unlock copy & selection" item) to restore.
  Isolated-world core (covers the common case); a site that registers capture-phase handlers at
  `document_start` may still win — a MAIN-world "force mode" can be added later. No new permission.

## 1.8.0

- **Popup blocker — remember a choice & auto-apply after a countdown.** When a popup is blocked,
  your Allow / Block / Background / Redirect choice is remembered per popup host. The next time the
  same host is blocked, the bar shows a short **countdown** (default 5s) on that remembered action
  and runs it automatically — so repeated popups from the same URL stop asking every time. A
  **Keep open** button on the bar cancels the countdown so you can decide manually, and any button
  click updates the remembered choice. Auto-"Allow" opens the popup in a foreground tab (a
  countdown has no user gesture, so it can't replay `window.open`). Remembered choices expire after
  ~10 days. New controls in the Tools tab: a **"Remember my choice… after N s"** toggle (with an
  adjustable countdown) and a **"Forget remembered choices"** button. Trusting a domain clears its
  remembered choice (it supersedes it). The block decision itself is unchanged.

## 1.7.0

- Sessions now also capture & restore **IndexedDB**, alongside cookies and
  localStorage/sessionStorage — so SPA logins that keep auth state in IndexedDB (e.g. Firebase
  Auth) clone fully. IndexedDB values must be JSON-serializable (covers typical auth tokens);
  binary values (Blobs/ArrayBuffers) are skipped. Session rows count IndexedDB records in their
  storage total.
- **Encrypt saved sessions** (opt-in): set a master passphrase and saved sessions are encrypted
  at rest with AES-256-GCM (key derived from the passphrase via PBKDF2/SHA-256). Session names and
  counts stay readable so the list renders without unlocking; the cookie + storage payload is
  encrypted. Unlock once per popup session — the passphrase is never stored, so forgetting it means
  the encrypted sessions can't be recovered. Toggle it from the Sessions tab.

## 1.6.3

- In-page overlays now share one consistent dark design with the tosca accent: the popup-blocker
  bar, toast, screenshot redaction toolbar, font-inspector tooltip/card, area selector, and color
  loupe all use the same card, buttons, and spacing. The popup-blocker bar is reorganized so the
  primary decision (Allow / Block) sits on its own row with Trust domain / Background / Redirect
  beneath. All overlay text is English. No functional change.

## 1.6.2

- Branding: adopt the YoshTool logo. The 16/48 px icons and the popup-header mark use the "Y"
  glyph cut from the vector logo so they stay sharp at toolbar size; the 128 px icon is the full
  "YOSH TOOL" wordmark. The UI accent color changes from slate to the logo's **tosca/teal**
  (buttons, tabs, checkboxes, focus ring), tuned for contrast in both light and dark mode. No
  functional change.

## 1.6.1

- Sessions: new **Update** action on the active session — it overwrites that session's saved
  snapshot with the state that's live right now (cookies + localStorage). This fixes the case
  where a session saved while logged out stayed "logged out" after you logged in: switching is
  non-destructive and only *restores* a snapshot, so a login made after saving must be captured
  with **Update** before you switch away, otherwise switching back returns the old logged-out
  snapshot. The active session's action row fits Re-apply · Update · Rename · Delete on one line,
  and the Sessions hint explains the restore-vs-update model.

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
