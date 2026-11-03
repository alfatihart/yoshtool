# Research: Mouse Tooltip Translator + Dark Reader — and fitting them into YoshTool

Deep-dive into two popular Chrome extensions and whether their ideas fit **YoshTool** (our
personal MV3 extension — vanilla JS, no build step, local-first, on-demand injected overlays):

- **Mouse Tooltip Translator — PDF & Netflix/YouTube dual subs** (`hmigninkgibhdckiaphhmbgcghochdjc`,
  open-source: `ttop32/MouseTooltipTranslator`). Hover/select-to-translate tooltip, OCR, TTS, and
  dual subtitles on streaming sites.
- **Dark Reader** (`eimadpbcbfnmbkopoojfekhnkhdbieeh`, open-source MIT: `darkreader/darkreader`).
  Per-site dynamic dark mode for any website.

> Mechanism claims marked **(code-confirmed)** were verified against the projects' own source
> during the research (fan-out harness, 103 agents; 21 claims confirmed, 5 refuted). Rankings and
> the FOUC analysis are reasoned synthesis over the verified facts, flagged as such.

---

## 1. Mouse Tooltip Translator

### 1.1 Features

Hover **or** select text → a translation tooltip appears. Modifier keys extend it (defaults,
code-confirmed): **Right Alt** = translate the text you're typing in an input box / highlighted
text; **Left Ctrl** = play pronunciation via Google TTS; **Left Shift + hover on an image** = OCR
(e.g. manga). Plus PDF/ebook text, and **dual subtitles** on YouTube and Netflix.

### 1.2 Architecture (code-confirmed)

MV3, built with **Vue/webpack**. A background **service worker** + a **single declarative content
script** (`contentScript.js`) registered `run_at: document_start`, `all_frames: true`,
`match_about_blank: true`, `matches: <all_urls>`, `host_permissions: [<all_urls>]`. Feature code
lives in `src/` modules (`translator`, `subtitle`, `ocr`, `tts`, `speech`, `pdf`, `ebook`). The
`document_start` + `all_frames` registration is what lets it catch hover text and subtitle DOM
early and inside player iframes.

> **Gap vs YoshTool:** MTT is a *build* (Vue/webpack) with *always-on declared* injection;
> YoshTool is *no-build* with *on-demand classic* injection. So YoshTool can't reuse MTT's bundle —
> it reproduces the behaviour by hand-rolling the content-script logic. The ethos still holds (see
> §3): two independent **no-build, vanilla, MV3** repos prove this feature class works unpacked.

### 1.3 Translation backend — the key fact

**No backend needed.** Translation is obtained by calling the public, **auth-free Google Translate
web endpoint** `translate.googleapis.com/translate_a/single?client=gtx` directly from the
extension. Multiple no-build MV3 projects do exactly this. (code-confirmed across MTT +
`mrWD/double-subtitles`)

The **CORS detail that dictates YoshTool's design** (code-confirmed): an MV3 **service worker is
CORS-exempt** for origins in its host permissions, but a **content script is not** (it inherits the
page origin). So the flow must be:

```
content script (detect text, render tooltip)
   → message → background SW (holds host permission for translate.googleapis.com)
      → fetch() → translation → reply
```

This is exactly the background-relay pattern YoshTool already needs, and `optional_host_permissions:
*://*/*` is the runtime-granted version of MTT's install-time `<all_urls>`.

> **The real cost is reliability/ToS, not architecture.** That endpoint is **undocumented** and the
> reference repo flags it as *"the most fragile part… no auth and can change without notice."* It
> carries **rate-limit / IP-block** risk and **Google ToS** exposure (unofficial use of a non-public
> API). Treat it as best-effort, not a stable dependency.
>
> **Refuted (0-3):** the specific claim that MTT uses named libraries (`google-translate-api`/
> `bing-translate-api`) or a fixed Google+Bing backend roster did **not** survive verification —
> only the free-Google-endpoint fact is reliable. (Convenient for us: it means the design needs
> **none** of the paid-API names, so the codebase stays clean of the two banned strings.)

### 1.4 OCR / PDF / TTS (code-confirmed)

All client-side: **tesseract.js** (^5.0.3, WASM) + a vendored **opencv.js** for segmentation +
`jpn_vert` traineddata for vertical Japanese, run in dedicated iframes; PDF via a vendored
**PDF.js**. Notably, opencv.js and PDF.js are **vendored single-file globals** — exactly the
UMD/IIFE shape a no-build extension can drop in. But it's **multi-MB of WASM**, heavy for a personal
tool; only justified if image/manga OCR is actually wanted. **TTS** uses Google's `translate_tts`
endpoint, which returns audio — a module service worker **can't play audio**, so playback needs an
offscreen document or an `<audio>` element in the injected overlay.

### 1.5 Dual subtitles (the hardest piece) (code-confirmed)

Capturing the **raw subtitle network response** (Netflix TTML, YouTube `timedtext`/JSON3, WebVTT)
**cannot be done from an isolated-world content script** — reassigning `window.fetch` there only
affects the content script's own V8 realm, not the page's requests. It requires a **MAIN-world
script at `document_start` that wraps `fetch`/`XMLHttpRequest`**; the isolated content script just
consumes the captured cues. The reference `titipakorn-th/Chrome_Subtitle` does exactly this
(`world: MAIN` wrappers + isolated consumers) and is itself **MV3 with no build step**.

> **Refuted (1-2):** the *simplest* approach — read the already-rendered caption DOM and append a
> translated line — is **not confirmed to work uniformly** across sites. Network/MAIN-world
> interception is the safer-but-harder path. Also noted: one reference's Netflix translation used an
> external **paid** API key (not local-first).

---

## 2. Dark Reader

### 2.1 Four modes (code-confirmed)

- **Dynamic** — per-element color analysis (the flagship).
- **Filter** — invert the whole page with CSS filters, then revert images/video.
- **Filter+** — same but with an **SVG color-matrix** filter for better color.
- **Static** — a quick, simple stylesheet.

The cheap `filter: invert(1) hue-rotate(180deg)` trick everyone knows is **literally Dark Reader's
Filter mode** — a first-class mode, not a hack.

### 2.2 The Dynamic engine — what makes it different (code-confirmed)

`src/inject/dynamic-theme/modify-colors.ts` doesn't invert; it **analyzes each color**, converts
**RGB→HSL and remaps lightness**: backgrounds darkened toward a max lightness
(`MAX_BG_LIGHTNESS = 0.4`), foreground text raised to a minimum (`MIN_FG_LIGHTNESS = 0.55`), with
brightness/contrast/sepia applied via a per-color filter matrix. It **leaves photographic images
untouched**, reads and rewrites stylesheets + inline styles, builds CSS variable overrides, fetches
cross-origin stylesheets it can't read via the background, and keeps up with new DOM through a
MutationObserver.

**What the cheap `filter: invert` version loses:** photos get inverted to negatives (need a
counter-rule on `img/video/canvas/[background-image]` — which then *wrongly* re-inverts images that
were already dark); no hue/saturation correction; brand colors flip; and sites that already ship a
dark theme get **double-darkened**.

> **Refuted (0-3):** the claim that Dark Reader's build *hard-depends* on Malevic/Rollup such that
> the engine "can't be dropped into a no-build extension" could **not be confirmed from source**
> in-session. The "don't port the Dynamic engine" conclusion therefore rests on **engine size/
> complexity reasoning**, not a verified build-stack claim. Dark Reader is MIT-licensed, so its
> approach (and even code, preserving the notice) is legal to reuse — algorithms aren't
> copyrightable regardless.

### 2.3 FOUC — the one genuinely hard problem for YoshTool

Dark Reader/MTT inject at **declared `document_start` with install-time host permissions**, so the
override lands **before first paint**. YoshTool grants host permissions **at runtime** and injects
**on demand** via `executeScript` — which runs *after* the user acts, i.e. **too late to prevent a
white flash** on load. (medium confidence — this is inference from the verified `document_start`
mechanics, not a directly measured YoshTool result.)

Mitigation sketch: persist an opted-in-sites list and use
`chrome.scripting.registerContentScripts` to register a `document_start` `<style>` injector for
those sites — but a flash still occurs on the **very first** visit before the registration/grant
exists. A truly FOUC-free dark mode conflicts with YoshTool's on-demand/local-first model, so the
pragmatic call is to **accept a one-frame flash on first load per site**.

---

## 3. Fitting into YoshTool

Recap of constraints: injected content scripts are **classic** (no ES `import`; a no-build
global/UMD file is the only way to ship a library in-page); YoshTool already has
`cookies`/`activeTab`/`storage`/`scripting`/`debugger`/`downloads`/`contextMenus`/
`clipboardRead·Write`/`browsingData` + `optional_host_permissions: *://*/*`, an offscreen document,
and a shared namespaced-overlay + MutationObserver pattern (redaction, font inspector, popup-blocker
bar, toast). Hard rule: the two scrubbed legacy brand strings (the translation vendor and the
old workspace name) **must never appear** in the codebase — the free-Google-endpoint design needs
neither, so the rule is satisfied automatically.

### 3.1 Hover-translate tooltip — ★ STRONG fit, best of the three

Fully client-side, no server, reuses patterns YoshTool already has.

**Design sketch**
1. Popup toggle "Hover translate" (+ target-language dropdown) → `executeScript({files:["translate-overlay.js"]})`
   on the active tab, or a `registerContentScripts` path for persistence. Classic script, no imports.
2. `translate-overlay.js`: on hover (debounced) / selection, get the text under the cursor via
   `caretRangeFromPoint` / `elementFromPoint` / `window.getSelection`, expand to the word/sentence,
   and draw the **namespaced tooltip** (reuse the existing overlay/toast CSS pattern). Optional
   modifier keys like MTT (select vs hover vs key).
3. Send the text to the **background service worker**, which `fetch`es
   `translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=<lang>&dt=t&q=…` under the
   granted `*://*/*` host permission, and returns the translation. (SW is CORS-exempt; the content
   script is not — this relay is mandatory.)
4. Optional TTS: SW fetches `translate_tts`; play the audio in the **offscreen document** (YoshTool
   already uses one) or an `<audio>` element in the overlay.

**Why it fits:** it's the existing overlay + background-fetch model with a new payload. No build, no
server, no new permission. **Cost:** the free endpoint is fragile/undocumented (rate-limit/ToS) —
ship it as best-effort with a one-line disclaimer, and keep the endpoint in one small, swappable
function. Keep all identifiers generic ("translate", "tooltip") — never the banned strings.

### 3.2 Dark mode — ★ cheap Filter toggle STRONG; Dynamic engine NOT worth it

**Build the cheap one.** ~30 lines of injected CSS:
```css
html { filter: invert(1) hue-rotate(180deg) !important; background: #111 !important; }
img, video, canvas, picture, [style*="background-image"], svg image { filter: invert(1) hue-rotate(180deg) !important; }
```
+ a per-site enable flag in `chrome.storage`, toggled from the popup. Ranks **HIGH** on the
vanilla/no-build/local-first scale.

**Do NOT port the Dynamic engine.** Per-element RGB→HSL lightness remapping is what separates Dark
Reader from blanket inversion, and it's a large engine; reimplementing it in a no-build vanilla
extension isn't worth it. Accept the Filter-mode tradeoffs (photo re-inversion edge cases, no
hue/saturation correction, double-dark on already-dark sites).

**Honest limitations to surface in the UI:** (a) **FOUC** — a white flash on first load per site
(§2.3); mitigate with a registered `document_start` injector for opted-in sites. (b) Sites with
their own dark theme look wrong → the per-site toggle is the escape hatch. (c) Optional later:
a tiny curated **per-site fixes list** (Dark Reader-style) to reach acceptable quality without the
engine.

### 3.3 Dual subtitles — ◐ stretch feature, defer unless wanted

Feasible without a build step (two no-build repos prove it), but it's the **hardest and most
fragile** piece: capturing subtitle responses needs a **MAIN-world `fetch`/XHR wrapper** at
`document_start` (via `executeScript world:'MAIN'`, a DOM `<script>` injection, or YoshTool's
existing **debugger/CDP** permission via `Network.getResponseBody` — which avoids patching page JS
but shows the "debugging this browser" banner), plus per-site DOM upkeep and translating each cue.
Worth it **only** if streaming-study is specifically wanted; otherwise defer.

---

## 4. Recommendation (ranked against YoshTool's ethos)

| Feature | Worth it | Effort | New permission? | Why |
|---|---|---|---|---|
| **Hover-translate tooltip** | ★ HIGH | Low–medium | No | Pure client-side; reuses overlay + background-fetch; only cost is endpoint fragility |
| **Dark mode (Filter toggle)** | ★ HIGH | Low (~30 lines CSS) | No | Legit Dark Reader mode; accept FOUC + photo edge cases |
| **Dual subtitles** | ◐ MEDIUM/LOW | High, high-maintenance | No (uses MAIN world or existing debugger) | Proven but fragile; needs MAIN-world/CDP + per-site upkeep |
| **Dark Reader Dynamic engine** | ✗ skip | Very high | — | Large engine; contradicts no-build ethos |
| **OCR (tesseract.js)** | ◐ optional | Medium (multi-MB WASM) | No | Only if image/manga OCR genuinely wanted |

**Suggested order:** (1) hover-translate tooltip — flagship, fully local, on-brand; (2) dark-mode
Filter toggle — tiny effort, high utility; (3) dual subs / OCR only on explicit demand.

All three avoid a build step and a server. The translation design deliberately uses **no** paid-API
identifiers, so it stays clear of the banned strings.

---

## 5. Open questions / caveats

- **Translate endpoint limits.** Real-world rate-limit/IP-block thresholds for an interactive
  hover tool are unknown; a second free provider reachable the same CORS-exempt way may be worth
  wiring as a fallback. The endpoint is undocumented and can break without notice.
- **CDP for subtitles.** Can YoshTool's existing `debugger` permission capture Netflix/YouTube
  subtitle responses via CDP (`Network.getResponseBody`) **without** MAIN-world injection — and is
  the debugger banner acceptable UX? (Open.)
- **FOUC elimination.** Does `registerContentScripts` at `document_start` (seeded from a stored
  opted-in list) actually remove the flash on repeat visits, and what's the minimal persistent
  footprint? (Unverified end-to-end.)
- **Filter-mode quality.** How badly does cheap invert degrade on heavy web apps (fixed headers,
  canvas/WebGL, iframes, already-dark sites), and is a small curated inversion-fixes list worth
  maintaining? (Open.)

### Research caveats
- The `translate.googleapis.com` dependency is the fragile core — author-flagged as able to "change
  without notice," with rate-limit/IP-block and ToS exposure. Best-effort, not stable.
- **Refuted/weak:** MTT's exact backend library roster (0-3) and the "Dark Reader can't be ported
  without a build" framing (0-3) did not survive verification; the DOM-read dual-sub shortcut (1-2)
  is not confirmed reliable. Two translation claims cited forks (corroborated by canonical repos);
  `darkreader.org` pages didn't resolve in-session (verified via the code instead).
- None of the reference extensions is a drop-in for YoshTool's injection model (they use declared
  `document_start` + install-time host permissions; YoshTool uses on-demand classic injection under
  runtime-granted optional host permissions). They validate the **ethos** (no build, vanilla,
  unpacked), not the exact wiring. Rankings + FOUC analysis are reasoned synthesis (medium
  confidence).

---

_Sources (primary): `github.com/ttop32/MouseTooltipTranslator` (+ wiki, manifest, package.json),
`github.com/titipakorn-th/Chrome_Subtitle`, `github.com/mrWD/double-subtitles`,
`github.com/darkreader/darkreader` (+ `modify-colors.ts`, LICENSE, CONTRIBUTING),
`darkreader.org/blog/dynamic-theme`, Chrome MV3 network-request & scripting docs._
