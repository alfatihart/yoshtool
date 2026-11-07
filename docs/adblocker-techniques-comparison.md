# How AdGuard, Brave, Ghostery & AdBlocker Ultimate block "stubborn" ads — and what YoshTool can copy

Companion to `hard-to-block-ads-research.md`. That doc explained *why* in-stream video ads, judol
redirects, etc. resist blocking. This one answers the follow-up: *how do the big blockers actually
fight them*, and — the actionable part — **which of their techniques a Chrome MV3 extension (YoshTool:
`declarativeNetRequest` + cosmetic content scripts + popup blocker + a downloadable "extended"
blocklist) can realistically replicate.**

_Compiled 2026-11-07 from four parallel research passes reading each product's own source/docs. Exact
Chrome DNR constants should be re-verified at runtime (`chrome.declarativeNetRequest.MAX_NUMBER_OF_*`);
the docs host was network-restricted during research._

---

## 0. The one principle that explains everything

**Capability is a function of WHERE the blocking code runs in the traffic path.** The further
"upstream" (closer to the raw bytes) it sits, the more it can do:

```
MOST CAPABLE
  ┌─ System app + local MITM proxy + root CA  → AdGuard apps (Win/Mac/Android/Linux)
  │     sees & rewrites plaintext request/response BODIES for EVERY app on the device
  ├─ The browser engine itself (native)        → Brave (Rust `adblock-rust` in brave-core)
  │     network stack + DNS + storage + HTML parser, no MV3 limits, out-of-band updates
  ├─ DNS resolver                              → AdGuard DNS / AdBlocker Ultimate DNS
  │     sees the full CNAME chain; but all-or-nothing per hostname, no cosmetic, no paths
  ├─ Firefox extension (blocking webRequest + filterResponseData)
  │     response-body access + DNS API → can do almost everything the app can, in-browser
  └─ Chrome MV3 extension (declarativeNetRequest + content scripts)   ← YoshTool lives HERE
        no response bodies, no DNS API, no blocking webRequest, rules the browser evaluates
LEAST CAPABLE (for "stubborn" ads)
```

**The blunt takeaway:** the products that genuinely beat the hardest ads (AdGuard's *app*, Brave) do
it precisely by **not being MV3 extensions**. Everything that runs as a Chrome MV3 extension —
AdGuard-MV3, Ghostery, AdBlocker Ultimate, uBO Lite, and YoshTool — hits the **same ceiling**. So
YoshTool's realistic peer group is "the best MV3 extension," not "uBO on Firefox" or "the AdGuard app."

---

## 1. AdGuard — capability tracks the product, not the brand

AdGuard is several products; what it can do depends entirely on which one:

- **Desktop/mobile apps (the powerful one).** A **local filtering proxy** terminates HTTPS with a
  **locally-installed root CA**, so it sees and rewrites **plaintext request/response bodies + headers
  for every app on the device.** That unlocks the real anti-"stubborn-ad" arsenal:
  - **HTML filtering (`$$`)** — strip `<script>` ad-injectors / anti-adblock bootstrap out of the HTML
    *before the browser parses it*.
  - **`$replace`** — regex search-and-replace on the response body (e.g. strip VAST/VMAP ad markup).
  - **`$hls` / `$jsonprune` / `$xmlprune`** — surgically remove ad segments from **HLS manifests** and
    ad objects from **JSON/XML** responses. **These are the actual tools against stitched/in-stream
    video ads** — and they exist **only in the app** (not even AdGuard's own Chromium MV2 extension).
  - Full **Stealth Mode** (cookie TTL/self-destruction, header stripping, IP/UA masking), `$network`
    firewall rules, filtering the **native mobile YouTube app**, DPI bypass.
- **AdGuard DNS** — blocks at resolution time; sees the **CNAME chain** so it defeats cloaked
  first-party trackers. But it's hostname-all-or-nothing: no paths, no cosmetic, no same-origin ads.
- **AdGuard MV3 browser extension** (the Chrome one since 2025) — DNR for network blocking; its own
  **ExtendedCss** + **Scriptlets** engines for cosmetic/JS (injected via content scripts / the
  `userScripts` API, **not** DNR). It candidly **loses**: response-body filtering (so no `$$`/
  `$replace`/`$hls`/`$jsonprune`), CNAME uncloaking, most of Stealth Mode, and **out-of-band updates**
  — its "Quick Fixes" dynamic-rule channel was forced to drop remote scripts after Chrome rejected it
  5× over the remote-code policy, and **YouTube fixes can't use fast-track review**, so they wait for a
  full store release while the *app* updates instantly.

**YouTube, per AdGuard itself:** the app blocks YT ads "more effectively than the extension," using
response surgery (`$hls`/`$jsonprune`/`$replace`) — but **no product fully defeats every SSAI
implementation**; it works only while ad and content segments stay distinguishable in the manifest.

**Portable to MV3 (AdGuard open-sources these):** `ExtendedCss` and `Scriptlets` (incl. redirect
resources) libraries — reusable directly.

---

## 2. Brave — it's the browser, so MV3 doesn't apply

Brave is a Chromium fork; blocking lives in the **native engine** (Rust `adblock-rust`, now also
vendored into Firefox 149), **not** an extension — so **MV3 governs none of it**. Being the browser
unlocks, on top of ordinary network + cosmetic + scriptlet blocking:

- **CNAME uncloaking** — an embedded DNS resolver checks the canonical name against the lists
  (impossible for a Chrome extension: no DNS API).
- **Debouncing** — detects server-side tracking-redirect "bounces" and jumps straight to the real
  destination (incl. base64-encoded and regex-extracted destinations, multi-hop).
- **De-AMP** — rewrites AMP links *and* detects AMP markup **during HTML parse** and swaps the
  navigation (an engine modification).
- **Query/URL parameter stripping**, first-party/ephemeral storage, Unlinkable Bouncing.
- **Procedural cosmetic filters** (`:has-text`, `:upward`, `:matches-css`; shipped Brave 1.73, 2024).
- **Component-updater** pushes lists/rules **every ~5h, out of band** from browser releases — how it
  patches YouTube/Twitch within hours.

**YouTube/Twitch:** effective against *client-side* ads via lists + scriptlets; **cannot reliably beat
true SSAI** (same wall as everyone) — it's a cat-and-mouse where component updates catch up after
YouTube changes. Brave's engine shares *ideas* (tokenized matching) with uBO and Cliqz/Ghostery, not
code.

**Portable to MV3:** network blocking (via DNR, capped), static + **procedural cosmetic**, bundled
scriptlets + `$redirect` stubs, **query-param stripping** (DNR `removeParams`). **Not portable:** CNAME
uncloak, de-AMP parse-time, ephemeral storage, full debounce, unlimited/out-of-band rule+scriptlet
updates — all need the engine.

---

## 3. Ghostery — a fast engine + anti-tracking, but MV3 clips its best trick

- **The engine** (`@ghostery/adblocker`, MPL-2.0, ex-`@cliqz/adblocker`) is a high-performance JS/TS
  filter engine: least-seen-token reverse index + typed-array serialization (near-instant load). Parses
  EasyList/uBO/AdGuard syntax (~99% compat). **It's open-source and reusable** — Ghostery itself uses it
  for cosmetic matching while delegating network blocking to DNR under MV3.
- **Anti-tracking beyond blocklists** (the Cliqz heritage): a statistical engine that **redacts
  tracking IDs from query strings and strips third-party cookies from otherwise-allowed requests**
  (surgical, not just block), plus **surrogate/stub scripts**, **Never-Consent** (reuses DuckDuckGo's
  `autoconsent` to actually *operate the site's consent CMP and opt out*, not just hide the banner),
  **GPC**, and a **TrackerDB** (WhoTracksMe) for point-and-click per-tracker/category control.
- **MV3 reality (Ghostery 10, shipped June 2024):** manifest requests `declarativeNetRequest` +
  `scripting` + `userScripts` + `offscreen` — but **NOT `webRequestBlocking`** (that's Firefox-only in
  their code). Consequences, straight from their source:
  - Network blocking = **DNR static rulesets** (six, converted server-side, ~90k rules, **shipped
    disabled until the user accepts terms**) + a **remote "fixes" hot-fix channel via dynamic rules**
    (regex validated with `isRegexSupported`) + **custom filters converted at runtime** in an
    **offscreen document** (service workers lack the DOM/WASM).
  - **The statistical anti-tracking runs OBSERVE-ONLY on Chromium** (no blocking webRequest) → it can
    detect/report but **can't live-redact URLs or strip cookies**; that degrades to coarse DNR
    block-the-whole-request. The full surgical version survives only on **Firefox**.
  - Cosmetics via `scripting.insertCSS`; **scriptlets into MAIN world via `chrome.userScripts`** (+
    `executeScript({world:"MAIN"})` fallback), guarded by a `try/catch` capability check.
  - **YouTube**: opportunistic — a content script watches for the ad/anti-adblock wall; suppression
    depends on `userScripts`-injected scriptlets + fixes; **when `userScripts` is unavailable it can't
    block and shows a notification nudge instead** (a candid admission). Video ads aren't its focus.

**Portable to MV3:** basically Ghostery's whole MV3 playbook is a blueprint — static rulesets +
`updateEnabledRulesets`, a dynamic hot-fix channel, offscreen custom-filter conversion, `insertCSS`
cosmetics, `userScripts` MAIN-world scriptlets, `$redirect` surrogates, autoconsent, GPC via
`modifyHeaders`. **Dropped on Chromium:** surgical statistical anti-tracking, response-body filtering,
blocking webRequest.

---

## 4. AdBlocker Ultimate — no special sauce (and that's the useful finding)

AdBlocker Ultimate (by AdAvoid Ltd; **no BitDefender/AdBlock-Inc lineage**) is **built on AdGuard's
open-source libraries** (`@adguard/tsurlfilter`, `tswebextension`, `scriptlets`, `agtree`,
`filters-downloader`) — essentially an AdGuard-engine blocker with its own branding. It ships **no
proprietary blocklist** (standard EasyList/AdGuard + Fanboy annoyance + NoCoin + anti-circumvention
lists), is MV3-capable (~92/100 on Adblock Tester), and has **no bespoke stubborn-ad technology** — it
inherits whatever the shared scriptlets/lists provide. Its only real differentiators are an editorial
**"no acceptable ads"** stance and **paid system-wide apps + a premium DNS** (the apps, like AdGuard's,
are where the real power is — same architecture lesson).

**Lesson for YoshTool:** a respected EasyList-class extension can be built almost entirely on AdGuard's
open-source engine pieces. There's no secret technique being withheld — the "stubborn ad" gap is
structural, not a trade secret.

---

## 5. Technique × who-can-do-it matrix

| Technique (anti-"stubborn-ad") | AdGuard app | Brave (browser) | Firefox + uBO | **Chrome MV3 ext** (Ghostery/AdGuard-MV3/**YoshTool**) |
|---|:--:|:--:|:--:|:--:|
| Network block separable ad/tracker requests | ✅ | ✅ | ✅ | ✅ (DNR, capped) |
| Static + **procedural/Extended CSS** cosmetic hiding | ✅ | ✅ | ✅ | ✅ (content script) |
| **Scriptlets** (anti-adblock defuse, player pokes) | ✅ | ✅ | ✅ | ⚠️ bundled MAIN-world (no opt-in) or `userScripts` (opt-in) |
| `$redirect` to no-op stub resources | ✅ | ✅ | ✅ | ✅ (DNR redirect → web_accessible_resources) |
| Query-param stripping | ✅ | ✅ | ✅ | ✅ (DNR `removeParams`, no regex) |
| Response-header mods (CSP/GPC) | ✅ | ✅ | ✅ | ✅ (DNR `modifyHeaders`, limited) |
| Cookie-consent **opt-out** (operate the CMP) | ✅ | ➖ | ✅ | ✅ (autoconsent in content script) |
| **Response-body rewrite** (`$replace`, HTML `$$`) | ✅ | ✅ | ✅ | ❌ |
| **In-stream video surgery** (`$hls`/`$jsonprune`/`$xmlprune`) — anti-SSAI | ✅ (app only) | ⚠️ native latitude | ⚠️ | ❌ |
| **CNAME uncloaking** | ✅ | ✅ | ✅ | ❌ (no DNS API on Chrome) |
| Surgical statistical anti-tracking (strip IDs/cookies live) | ✅ | ✅ | ✅ | ❌ (observe-only; → coarse DNR block) |
| De-AMP parse-time / ephemeral storage / debounce | ✅/engine | ✅ | partial | ❌ |
| **Out-of-band** rule **+ scriptlet** updates (no store review) | ✅ | ✅ (~5h) | ✅ | ⚠️ rules only (dynamic, as *data*); **scriptlet logic can't update remotely** |

✅ full · ⚠️ partial/with-caveats · ➖ n/a · ❌ not possible.

**Everyone, including the app and Brave, is only ⚠️ against true SSAI** — once ad bytes are stitched
into the content stream from the same origin, the only lever is response/stream surgery, and even that
works only while segments stay distinguishable. No MV3 extension can do it at all.

---

## 6. What YoshTool should copy (prioritized, mapped to what it already has)

YoshTool today: DNR ads/trackers/redirect static rulesets + a downloadable **extended blocklist**
(dynamic rules) + cosmetic hiding + cookie-consent auto-reject + an in-page popup blocker + the
per-site Sites matrix. That's already the right MV3 shape. To raise the "stubborn ad" ceiling to match
Ghostery/AdGuard-MV3, in order of ROI:

1. **Feed the extended/dynamic pipeline more lists** (also in `hard-to-block-ads-research.md`): add
   **ABPindo** (Indonesian/judol), an **annoyances + anti-adblock** list, and a disposable-domain list.
   Validate every `regexFilter` with `isRegexSupported`. Budget: static baseline big, dynamic overlay
   small (caps: ~30k dynamic / ≤5k "unsafe" / ~1k regex).
2. **Bundled MAIN-world anti-adblock scriptlets** — ship a curated `world:"MAIN"` static content-script
   set of the high-value defusers (`set-constant`, `abort-on-property-read`, `abort-current-script`,
   `json-prune`, `nowebrtc`). **Zero user opt-in**, runs before page scripts. Reuse `@ghostery/
   scriptlets` or `@adguard/scriptlets` (both open source). This is the single biggest capability jump.
3. **A procedural / Extended-CSS cosmetic engine** — YoshTool's cosmetic hiding is basic CSS; add
   text/attribute-regex/computed-style/structure matching (`:has-text`, `:matches-attr`,
   `:matches-css`, `:upward`, `:xpath` + a MutationObserver) to survive randomized class names. Reuse
   AdGuard's open-source **`ExtendedCss`** or the **`@ghostery/adblocker`** engine rather than hand-rolling.
   Gate expensive matchers behind mutation throttling + specificity checks.
4. **`$redirect` stub resources** in `web_accessible_resources` with **`use_dynamic_url: true`** (anti-
   fingerprinting) + **query-param stripping** via DNR `removeParams`. Standard, reliable.
5. **Upgrade consent auto-reject to the opt-OUT model** — YoshTool clicks "reject". Ghostery/DDG's
   `autoconsent` actually *operates the CMP* (OneTrust/Cookiebot/TrustArc…) to record a reject, which is
   more robust. Consider reusing `@duckduckgo/autoconsent` + its compact rules (content-script only,
   zero friction).
6. **Keep the extended-list as your hot-fix channel** — it already beats the "static rulesets only
   update on store review" problem (the exact pain AdGuard/Ghostery engineered around). Remote payload
   must stay a pure **rule list (data)**, never executable code (remote-code ban + review risk).
7. **Optional advanced mode: `chrome.userScripts`** for list/user-supplied scriptlets — powerful but
   gated behind the Chrome-138 "Allow user scripts" toggle, so it's opt-in; probe with `try/catch`
   (it's `undefined` when off). Don't make core blocking depend on it.

**Don't over-invest / be honest in the UI:** response-body rewriting (`$replace`/`$hls` — the anti-SSAI
tools), **CNAME uncloaking**, surgical live anti-tracking, de-AMP/ephemeral storage, and multi-hop
debounce are **impossible in a Chrome MV3 extension** — they need the AdGuard-style app, the Brave-style
native engine, or Firefox. For YouTube/Twitch in-stream ads specifically, say plainly it's out of scope
and point users to Premium / Firefox+uBO / Brave as complements.

**If YoshTool ever wants to exceed the MV3 ceiling**, the only real routes are the same ones these
products took: (a) a **companion desktop app** with a local filtering proxy (large effort, root-CA UX,
security surface), (b) a **DNS service** (catches CNAME + device-wide, but hostname-coarse), or (c)
officially recommend Firefox+uBO / Brave for the hard cases. Within MV3, matching Ghostery/AdGuard-MV3
is a realistic and respectable target.

---

## 7. Sources

**AdGuard:** KB `create-own-filters` (the cross-product capability matrix), `mv3-version`,
`what-is-https-filtering`, Stealth Mode KB; repos `ExtendedCss`, `Scriptlets`, `AdGuardExtra`,
`cname-trackers`, `tsurlfilter`, `SafariConverterLib`; blog "Manifesting change"/MV3 release/"review
issues in Chrome Web Store" (Quick Fixes removed, YouTube can't fast-track)/v5.2 userScripts.

**Brave:** `github.com/brave/adblock-rust`, brave-browser wikis (Debouncing, Brave Components, blocking
policy), privacy-updates posts (CNAME trickery #6, De-AMP #18, procedural filtering #31, ephemeral
storage #7, unlinkable bouncing #16), brave.com/ublock-origin-alternative.

**Ghostery:** `github.com/ghostery/adblocker` (+ README), `github.com/ghostery/ghostery-extension`
(read at v10.6.11 — `manifest.chromium.json`, `background/dnr.js`, `adblocker/cosmetics.js`,
`reporting/webrequest-reporter.js`, `never-consent/autoconsent.js`, `content_scripts/youtube.js`),
`@whotracksme/reporting`, WhoTracksMe "Adblockers Performance Study", "MV3: the Ghostery perspective",
"Launching Ghostery 10"; DuckDuckGo `autoconsent`.

**AdBlocker Ultimate:** `github.com/AdAvoid-Ltd/AdBlocker-Ultimate-for-Browsers` (deps show AdGuard
engine; GPL-3), adblockultimate.net (filters/compare/android/DNS), adblock-tester.com benchmark.

**MV3 portability:** `github.com/rebel6969/ublock-mv3` (uBO→DNR reference port), uBO Lite FAQ, Chrome
`userScripts` / `scripting` / `declarativeNetRequest` references, Chrome remote-code/security policy,
AdGuard `tsurlfilter` DNR-converter examples, Palant on DNR remote-rule abuse.

_Freshness caveats: MV3 rule caps and AdGuard "Quick Fixes" behavior change often — re-verify at
runtime / against live release notes. Ghostery's headline perf multipliers are from a 2019 self-authored
study of the network engine only (mechanisms verified in current source; numbers dated). AdBlocker
Ultimate vendor pages and the AdGuard KB were read via search, not direct fetch, during research._
