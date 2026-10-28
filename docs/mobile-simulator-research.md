# Research: "Mobile Simulator — Responsive Testing Tool" & fitting it into YoshTool

Deep-dive into the Chrome extension **Mobile Simulator – Responsive Testing Tool**
(`ckejmhbmlajgoklhgbapkiccekfoccmk`, by WebMobileFirst / François Duprat), reverse-engineered
from the supplied `.rar` (v4.22.2, the actual shipped source) plus market/technical research.
Then: how a mobile-simulator feature would look if added to **YoshTool**, and whether it's worth it.

> Mechanism claims below are **confirmed from the extension's own code** (not guessed). Market
> figures (users, rating, price) come from store/third-party summaries and are flagged where
> uncertain.

---

## 1. What it is (market)

- **~1,000,000 users**, **Featured**, rating **~4.9/5** (one third-party snapshot showed 4.0 —
  likely stale). Actively maintained (monthly-ish releases; the bundle analyzed is v4.22.2).
- **Freemium** — core simulator is free (with a small in-extension ad); a **PRO** tier unlocks
  extra devices, video/GIF capture and cloud features. Exact price unverified (a directory lists
  "from ~$6/month"; the store defers to in-extension pricing). The code confirms freemium:
  `subscription`/`trial`/`license` logic, a **Supabase + AWS** backend, and **PostHog** analytics.
- **58+ device presets** (~45 phones, ~5 tablets, ~11 "special": watches, kiosks, desktops);
  some devices are PRO-only. The bundle's device DB is large (iPhone ≈209 / Galaxy ≈142 /
  Pixel ≈96 / iPad / Surface string references in `simulator.js`).

**Headline features:** device frames/skins (transparent phone bezels), rotation/orientation,
touch-scroll emulation, side-by-side multi-device, night mode, PWA mode, on-screen keyboard,
custom device sizes, **screenshots** (4 shortcut variants) and **video/GIF/MP4 screencast**,
**geolocation spoofing**, and a **cloud "real device" mode** (actual iOS/Android via Appetize.io —
the premium headline).

---

## 2. Architecture (confirmed from the v4.22.2 bundle)

It is an **iframe simulator + network-header rewriting**, NOT a DevTools/CDP tool. A Vue app
(`simulator.js` ≈1 MB, `chunk-vendors.js`) renders the UI; the page under test loads inside a
device-sized `<iframe>`.

**The four pillars:**

1. **Framed page.** The target URL is loaded in an `<iframe name="mobile-first-simulator">` sized
   to the device's CSS pixels, wrapped by a device bezel. A **MAIN-world** content script
   (`frame-element-spoofer.js`, `run_at: document_start`, `world: MAIN`) sets
   `window.frameElement = null` so the site can't detect it's framed.

2. **Header rewriting via `declarativeNetRequest` — the critical enabler.** `background.js`
   (≈640 KB) uses `declarativeNetRequest.updateSessionRules` + `modifyHeaders` to:
   - **Strip response headers** `content-security-policy` and `x-frame-options`
     (`Z = ["content-security-policy","x-frame-options"]`) so sites that normally forbid framing
     *can* be embedded. (With `allow` exceptions for Cloudflare `*challenge-platform*` / `*cdn-cgi*`
     so anti-bot challenges still work.)
   - **Set the request `user-agent`** to the device UA and **remove every `sec-ch-ua*`** Client-Hint
     header (`sec-ch-ua`, `-arch`, `-bitness`, `-full-version-list`, `-model`, `-platform-version`,
     …) — i.e. it strips Client Hints rather than forging them.

3. **In-page JS spoofing** (`spoofer.js` ≈407 KB, web-accessible, injected into the iframe):
   overrides `navigator.userAgent`, `screen.*` (≈197 refs), `devicePixelRatio`, `orientation`,
   touch, `frameElement` — so JS-level feature detection matches the device.

4. **Capture & cloud.** Screenshots; **screencast** via `tabCapture` → **offscreen document** →
   a `screencast_worker.js` → upload to **S3** (WEBM/GIF/MP4). **Geolocation spoofing** uses
   `photon.komoot.io` for place→coordinates. **Cloud real-device** runs actual devices via
   **Appetize.io** embeds (`window.name === 'mobile-first-cloud-device'`) — the paid feature.

**Permissions (broad & powerful):** `webRequest, declarativeNetRequest, scripting, tabs,
activeTab, webNavigation, storage, contextMenus, tabCapture, offscreen, commands` + host
`<all_urls>`, `*://*/*`. CSP allow-lists Supabase, AWS API Gateway/WebSocket, S3, PostHog, Photon.

---

## 3. The three ways to emulate a device (and their trade-offs)

| Approach | How | Pros | Cons |
|---|---|---|---|
| **(A) iframe sized to device** *(Mobile Simulator, Responsive Viewer)* | Load URL in a device-sized `<iframe>` in an extension page; strip `X-Frame-Options`/CSP via DNR; spoof `navigator`/`screen` in MAIN world | Persistent, no debugger banner, device **frames/skins**, **side-by-side** multi-device, works with DevTools open | Needs **`declarativeNetRequest`** + **stripping security headers** (weakens clickjacking protection); **true DPR / `pointer:coarse` / `hover:none` media can't be set**, only visually faked; many **SPAs/OAuth/service-workers/partitioned-storage break** when framed; nested child iframes can still hit `frame-ancestors` |
| **(B) CDP via `chrome.debugger`** *(= DevTools Device Mode engine)* | `Emulation.setDeviceMetricsOverride` (real w/h/**DPR**/mobile) + `setUserAgentOverride` (UA + coherent client hints) + `setTouchEmulationEnabled` on the **real tab** | **True** metrics/DPR/touch/pointer-media; no iframe → no XFO/CSP/SPA breakage; coherent UA Client Hints | Yellow **"started debugging this browser"** infobar; `debugger` permission; **per-tab**, re-apply on nav; conflicts with the user opening DevTools; **no bezel** (tab isn't wrapped) |
| **(C) window resize** *(Window Resizer)* | `chrome.windows.update` to device width/height | Trivial, lowest permission | Only flips width breakpoints — no UA/touch/DPR/frame |

**Chrome DevTools "Device Mode" already does (B) for free**: screen size, viewport, `device-width`
media, DPR, device UA, touch, plus network/CPU throttling and a Sensors (geolocation/orientation)
panel — but Chrome itself calls it "a first-order approximation," and it needs DevTools open, shows
one viewport, has no frames/skins, and resets when closed. An extension's value is therefore:
**one-click/no-DevTools, persistent, device frames, side-by-side, built-in capture, curated device
catalog.**

---

## 4. If this were added to YoshTool — design

**Reality check first.** The full Mobile Simulator is a 1 MB Vue app + cloud backend (Supabase/
AWS/Appetize) + a 58-device DB + screencast pipeline. Cloning that contradicts YoshTool's ethos
(vanilla, no build step, lightweight, per-feature, local-only). So the question isn't "clone it"
but "what's the highest-value slice that fits."

### Recommended: a lightweight **"Device / Responsive mode" via CDP (`chrome.debugger`)** — approach (B)

This is the best fit, for three concrete reasons:

1. **YoshTool already has the `debugger` permission and already calls
   `Emulation.setDeviceMetricsOverride`** (for full-page screenshots). The CDP emulation machinery
   is *already in the codebase* — adding UA + touch + a device list is a small extension of it.
2. **No new scary permission.** It avoids `declarativeNetRequest` and the security-sensitive act of
   **stripping `X-Frame-Options`/CSP** that the iframe approach requires.
3. **It emulates the real page in the real tab** → true DPR/metrics/touch, and it sidesteps the
   entire class of iframe failures (XFO/CSP, SPA routing, OAuth popups, service workers,
   partitioned storage) — which matters for exactly the SPA/Supabase apps you work on.

**MVP shape:**
- A new **"Device"** section (in the Dev tab, or a new tab). Controls: device dropdown, custom
  **W × H**, **DPR**, **Rotate** (swap W/H), **Apply**, **Reset/Stop**. A small status pill
  ("Device mode: iPhone 15 Pro").
- `devices.js` — a **curated, hand-rolled** preset list (~12–16): iPhone SE/13/14/15 Pro, Pixel
  7/8, Galaxy S23, iPad / iPad Pro, a tablet, + "Responsive (custom)". Each preset:
  `{label, width, height, deviceScaleFactor, mobile, ua, platform, maxTouchPoints}` — pure data,
  Node-testable, same pattern as `faker-data.js`/`redact.js`.
- `background.js`: attach debugger to the active tab, then
  `Emulation.setDeviceMetricsOverride {width,height,deviceScaleFactor,mobile:true}` +
  `Emulation.setUserAgentOverride {userAgent, userAgentMetadata}` +
  `Emulation.setTouchEmulationEnabled {enabled:true, maxTouchPoints}`. Keep attached while device
  mode is ON (overrides persist across same-tab navigations); **Reset** →
  `clearDeviceMetricsOverride` + detach. Reuse the existing attach/detach + infobar handling from
  full-page capture.
- **Synergy:** with device mode on, the existing Area/Full-page **screenshot already captures the
  emulated viewport** → "device screenshots" for free, no extra code.
- *Cheap later adds:* network + CPU throttling (`Network.emulateNetworkConditions`,
  `Emulation.setCPUThrottlingRate`), geolocation override (`Emulation.setGeolocationOverride` —
  pairs with your redaction/privacy theme), dark-mode media override.

**Honest caveats (state them in the UI/README):**
- The yellow **"YoshTool started debugging this browser"** infobar shows while device mode is on
  (same as current full-page capture) — the main UX cost of `debugger`.
- **No decorative phone bezel** and **no side-by-side** multi-device (the real tab isn't wrapped).
- Can't open DevTools on the same tab while active; emulation is per-tab.

**Effort:** **medium** — a device JSON + ~a dozen CDP calls in the worker + a popup panel + reset,
reusing existing debugger plumbing. New file + tests for the device data; version bump = minor
(new tool).

### Not recommended (for now): cloning approach (A), the iframe simulator

Matching Mobile Simulator's **bezels + side-by-side + works-with-DevTools** requires: a new
**`declarativeNetRequest`** permission, **stripping `X-Frame-Options`/CSP** on all sites (a real
clickjacking-protection trade-off and a scary store warning), a MAIN-world `spoofer.js`, an
extension simulator page with iframes, and accepting that **DPR/pointer media are only faked** and
**many SPAs/OAuth/SW/storage flows break in frames**. High effort, high maintenance, more fragile —
and it partly duplicates Chrome's own Device Mode. Only worth it if pixel-accurate frames or
multi-device side-by-side become must-haves.

### Verdict
A **CDP-based device mode is a reasonable, cheap, on-brand addition** that reuses YoshTool's
existing debugger + screenshot infra and needs no new permissions. The full iframe/cloud clone is
out of scope. If you want it, start with the MVP (device presets + metrics/UA/touch + rotate +
reset), and treat throttling/geo/bezels as optional follow-ups.

---

## 5. Sources & confidence
- **Mechanism / architecture / permissions / features list:** reverse-engineered directly from the
  supplied bundle `ckejmhbmlajgoklhgbapkiccekfoccmk/4.22.2_0` (manifest, `background.js`,
  `frame-element-spoofer.js`, `spoofer.js`, `appetize.js`, `simulator.js`) — **high confidence**.
- **Users / rating / pricing / device count / Chrome Device Mode / comparisons:** Chrome Web Store
  + third-party directories + developer.chrome.com (device-mode, declarativeNetRequest) + CDP
  Emulation docs, via search summaries — **medium confidence**; exact **price (~$6/mo) and rating
  are unverified** (store egress was blocked this session).
