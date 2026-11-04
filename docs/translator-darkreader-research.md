# Research: Translator tooltip + Dark mode — implementation-ready

How to build two features into **YoshTool** (personal MV3 extension, vanilla JS, no build step) so
they're genuinely worth shipping: a **hover/selection translation tooltip** (to stand in for
Chrome's built-in translate and a premium neural-MT app) and a **dark mode that doesn't break sites
that already have their own dark theme**.

> This supersedes the earlier "basics" version of this doc. It folds in a second,
> implementation-focused research pass (fan-out harness, ~100 agents). Claims marked **(verified)**
> survived 3-vote adversarial checking; **(refuted)** means a tempting claim did **not** survive, so
> don't build on it. Hard rule kept: the premium neural-MT vendor's brand string must never appear
> in the code, so providers are referenced through config, not by name.

---

## TL;DR — the decisions

- **Translator: no backend server needed.** Default to the **free Google Translate web endpoint**
  called from YoshTool's **background service worker** (it sends no CORS headers, so it works from
  the extension background but not from a page) — this is the mandatory relay. Good enough for an
  interactive hover/selection tooltip (low volume). (verified)
- **Chrome's on-device Translator API is a nice *optional* "fully-local" provider, NOT the universal
  default** — it can't run in a service worker, is Chrome 138+ desktop-only, ~38 languages, and
  needs a model download. (verified)
- **Dark mode: the hard part is not darkening already-dark sites.** Dark Reader itself solves this
  with a *detect-dark-theme* feature plus a **curated `[data-theme="dark"]`-style match list**,
  because **automatic luminance detection alone is unreliable**. YoshTool should combine a few
  signals + a small skip-list and accept it won't be perfect. (verified)
- Build order: **dark mode first** (simpler, client-side), then the translator tooltip.

---

## Part A — Translation tooltip

### A1. The bar to beat
Chrome's built-in: whole-page inline translation + right-click "translate selection" + auto-detect,
100+ languages. The premium neural-MT app: higher-quality neural output, a selection popup,
full-page, ~30+ languages, a limited free API tier. A credible YoshTool replacement needs: **hover
+ select triggers, auto source-language detection, copy result, optional TTS**, and (stretch) an
**optional full-page inline bilingual mode**.

### A2. Chrome's on-device Translator API — the "ideal local" path and its real limits
The global `Translator` API (feature-detect `'Translator' in self`;
`Translator.availability({sourceLanguage,targetLanguage})`; `Translator.create({...})` under a user
gesture with a `downloadprogress` monitor; then `translate()`/`translateStreaming()`) runs
**on-device, free, offline** once the model is downloaded. (verified) But:

- **Not available in Web Workers / service workers** — only top-level windows and same-origin
  iframes. So an MV3 extension **cannot call it from the background SW**; it must run in a document
  context → for YoshTool that means an **offscreen document** (or an extension page). (verified)
- **Chrome 138+ (Edge 148+), desktop only, no mobile**, Firefox/Safari unsupported. (verified)
- **~38 languages** (BCP-47), per-pair on-demand model packs — narrower than built-in page-translate.
  (verified)

→ **Verdict:** offer it as an **optional provider** ("On-device (offline)") that YoshTool uses when
available, falling back to the network provider otherwise. Not the sole path.

### A3. Free network backends (verified)
- **Google Translate web endpoint** (`translate.googleapis.com/translate_a/single?client=gtx…`):
  **no CORS headers → works from the extension background/SW** (which doesn't request CORS), *not*
  from a content script — confirming the **content-script → background relay** design. Gives
  auto-detect + 100+ languages and supports **batching** many strings per request. (verified)
  - **Risk:** sustained/bulk use can hit **429/503** and an "unusual traffic" reCAPTCHA. (verified)
    The stronger claims — *permanent IP-block after ~N requests*, *503 after only a few requests* —
    were **refuted** (overstated). So: **fine for interactive hover/selection** (a few short
    requests), **risky for full-page bulk** → throttle + batch there.
- **MyMemory** as a fallback provider: **5,000 chars/day anonymous** (per IP), **50,000/day** if a
  valid email is supplied via the `de` parameter. (verified) Good low-volume backup.
- Lingva / self-hosted LibreTranslate remain options (not closely examined this pass); keep them as
  config presets.

### A4. Provider abstraction (brand-string-clean)
Store providers as plain config: `{ id, label, url, method, key? }` in `chrome.storage`. Ship
presets for the free Google endpoint, MyMemory, and "On-device". A user who wants the premium
vendor's free API tier just adds a provider row with their own key — **the code never contains the
vendor's name**, satisfying the hard rule.

### A5. Full-page inline bilingual mode (verified mechanism)
Confirmed pattern from reference tools: **walk visible text nodes, insert the translated text in a
new node *beneath* the original (don't replace it)**, and make it **reversible** (toggle again →
remove all inserted nodes, page restored). Trigger via a floating button or the popup. **Batch**
the node texts into few requests to respect the endpoint's limits; skip `script`/`style`/editable
nodes. (verified) This is the stretch feature — the hover/selection tooltip is the core.

### A6. TTS
The same free Google backend has a `speak`/`translate_tts` method returning a **Base64 MP3** —
reuse it, and **play it in the offscreen document** (the SW can't play audio). (verified)

### A7. Architecture for YoshTool
```
content script (isolated, injected on demand)
  • detect text under cursor (caretRangeFromPoint / elementFromPoint / getSelection)
  • draw the namespaced tooltip (reuse the overlay/toast pattern)
  • send text → background
background service worker
  • network providers: fetch the configured endpoint (CORS-exempt here) → return translation
  • on-device provider / TTS audio: delegate to an OFFSCREEN document (Translator API + <audio>)
```
No new permission (uses `scripting` + `activeTab` + `*://*/*` optional host + offscreen).

---

## Part B — Dark mode without double-darkening

### B1. How Dark Reader avoids it (verified)
- **v4.9.47+ "Detect dark theme"**: detects sites that already have a dark theme and **leaves their
  dark colors untouched**; works in both **Dynamic and Filter** modes; it's an **opt-in toggle**.
  (verified)
- It relies on a **curated detector list** — per-site rules with a TARGET + MATCH selector such as
  `[data-theme="dark"]` — merged into Dark Reader's site-fixes and **synced to installed clients**,
  **because automatic detection is unreliable/inconsistent** on sites that signal darkness via a
  `data-theme` attribute. (verified)
- Site-side opt-outs exist but are weak signals for us: `<meta name="darkreader-lock">` (lets a site
  block Dark Reader) was only **weakly supported** in verification (1-2), and using
  `<meta name="color-scheme">` as a *detection* signal was **refuted** (0-3). → **Don't rely on
  either** to decide a page is already dark.

### B2. Detecting "already dark" — what's reliable
No single signal is trustworthy. Combine, cheaply, in this order and bail out (do nothing) if dark:
1. **Computed background luminance** of `html`/`body` (and the largest top container) < a threshold
   → likely already dark. (Primary heuristic.)
2. **Markup flags**: `documentElement`/`body` has `[data-theme="dark"]`, `.dark`, `.dark-mode`,
   `[data-bs-theme="dark"]`, or `color-scheme: dark` computed.
3. A tiny **curated skip-list** of hosts for the inevitable misses (Dark Reader-style), editable in
   the popup.

Honest limit (verified): even Dark Reader finds this unreliable, so expect occasional misfires →
make the per-site **on/off toggle** the escape hatch.

### B3. Tiered design for YoshTool
1. **Already dark (B2 says yes)** → do nothing.
2. **Has a `prefers-color-scheme: dark` theme** → *optionally* force the site's own dark theme via
   **CDP `Emulation.setEmulatedMedia({features:[{name:'prefers-color-scheme',value:'dark'}]})`**
   (YoshTool already has the `debugger` permission). **Unverified this pass** — treat as an
   experiment behind a flag; it shows the debugger infobar.
3. **Otherwise** → the cheap **`filter: invert(1) hue-rotate(180deg)`** on `html` + a counter-invert
   on `img/video/canvas/[background-image]/svg image`. Accept the known trade-offs (photo edge
   cases, brand-color flips).

### B4. FOUC
On-demand injection can't run at `document_start`, so a white→dark flash on first load is
unavoidable unless we persist an opted-in-site list and `registerContentScripts` a `document_start`
`<style>` for those sites. Pragmatic: **accept a one-frame flash**, offer the registered-injection
upgrade for pinned sites later.

---

## Implementation plan

### Phase 1 — Dark mode (ship first; low risk, client-side, no new permission)
New `darkmode.js` (classic content script, isolated world, on-demand, toggle like `copyunlock.js`):
- `isAlreadyDark()` = luminance of html/body + markup flags (B2). If dark → toast "Page already
  dark" and exit.
- Else inject a namespaced `<style>`: root `filter: invert(1) hue-rotate(180deg)` + counter-invert
  for media; a `MutationObserver` isn't needed (CSS filter cascades). Toast "Dark mode on".
- Re-inject → teardown (remove style), toast "Dark mode off".
- **Per-site memory**: store enabled hosts + a skip-list in `chrome.storage`; popup toggle + a
  "Forget" control (same shape as the popup-blocker memory).
- Popup **Dev-tab** button + right-click menu item (mirror copy-unlock wiring).
- Tests: a small pure `relativeLuminance(rgb)` / `isDarkColor()` in a Node-tested module
  (`darkmode-core.js`), inlined into `darkmode.js` (the core↔inline pattern we already use).
- Version: minor bump; CHANGELOG + README.
- *(Later, optional)* Tier-2 CDP force-dark + Tier “registered document_start” for FOUC on pinned
  sites.

### Phase 2 — Translator tooltip
- `translate.js` background module: `translateVia(provider, text, {to, from})` — provider-abstracted
  fetch (config-driven, brand-clean). Default provider = free Google endpoint; presets for MyMemory
  + On-device.
- Offscreen document for: the **on-device Translator API** provider, and **TTS audio** playback.
- `translate-overlay.js` content script: hover/selection detection → tooltip (reuse overlay/toast),
  copy button, optional TTS button; sends text to the background.
- Popup: provider dropdown + target-language; Dev-tab button + context menu ("Translate selection").
- *(Stretch)* `fullpage-translate.js`: text-node walk + batched translate + insert-beneath +
  reversible toggle.
- Versioning: the tooltip is a minor bump; the full-page mode another.

---

## Caveats / what was refuted (don't build on these)
- **Chrome Translator API as a clean, universal, offline default** → *refuted*; it's constrained
  (no SW, 138+, desktop, ~38 langs). Use it as an optional provider only.
- **Free Google endpoint permanently IP-blocks after ~N requests / 503s after a few** → *refuted
  / overstated*. Real risk is **throttling + occasional reCAPTCHA under bulk**; fine for interactive
  use with batching + backoff.
- **`<meta name="color-scheme">` as a reliable "already dark" detector** → *refuted*. **`<meta
  name="darkreader-lock">` honored** → only weakly supported. Don't gate detection on these.
- **MouseTooltipTranslator uses "only Google + Bing"** → *refuted* (it uses more engines) — so don't
  assume a fixed backend roster; the provider abstraction is the safe design.
- The **CDP force-dark (`setEmulatedMedia`)** path is **not verified** here — prototype it behind a
  flag before relying on it.

_Sources (verified where marked): Chrome `developer.chrome.com` Translator/Language-Detector API
docs, `darkreader/darkreader` (v4.9.47 detect-dark + detector-rule PRs), the free Google Translate
web-endpoint client libraries & their rate-limit issue threads, MyMemory API docs, and reference
inline/full-page translator projects. Second, implementation-focused research pass; the translator
and dark-mode basics from the first pass are folded in above._
