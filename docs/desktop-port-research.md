# Porting YoshTool to a desktop app — research, feature fit & architecture

Should YoshTool become a desktop application (like AdGuard / AdBlocker Ultimate, which ship desktop +
mobile apps), which features fit, and what would the architecture look like? Built on two
primary-source research passes (desktop system-wide network filtering; desktop shell + native feature
reuse), grounded in YoshTool's actual code.

_Compiled 2026-11-08. Some vendor hosts (`adguard.com`, `developer.chrome.com`, `tauri.app`,
`electronjs.org`) were network-blocked during research and corroborated via search; canonical URLs are
cited for verification._

---

## TL;DR — my recommendation

- **Don't rebuild YoshTool as a full AdGuard-style desktop suite.** For a solo/personal project the
  full system-wide HTTPS-filtering model (local MITM proxy + a root CA you install in the user's trust
  store) is where *all* the cost, risk and liability live — and most of YoshTool's value (the picker,
  inspect & edit, selection helper, auto-redact, cookie manager) is **browser-DOM-bound and literally
  cannot leave the browser**.
- **The extension stays the core product.** A desktop app can't reach the DOM of pages the user
  browses in their own Chrome/Firefox — that's an OS boundary. Every in-page tool must remain a
  content script.
- **A desktop app IS worth it for two things:** (1) **native-only "superpowers"** a browser extension
  can't match — system-wide screenshots, a screen-wide color picker, clipboard/standalone translate,
  cross-browser cookie *export*, global hotkeys, tray, autostart; and (2) **system-wide ad/tracker
  blocking** — best delivered first as **DNS-level filtering** (no CA, no MITM, low risk), with a full
  local proxy only as an optional power-user tier.
- **Recommended shell: Tauri 2** (small, least-privilege, reuses the vanilla UI; Electron is the
  fallback if you'd rather write native glue in JS/Node than Rust).
- **Pragmatic shape:** a **companion desktop app** for the native superpowers + DNS blocker, running
  **alongside the existing MV3 extension** for all the in-page tools. Wire the two together with native
  messaging **only if/when** a feature actually needs it — that bridge is the single biggest long-term
  maintenance liability.

In one line: **keep the extension; add a desktop companion for the things a browser tab can't do —
not a desktop clone of the whole extension.**

---

## 1. Why "desktop" is an architecture decision, not a repackage

A browser extension is a **guest inside one Chromium process**. A desktop app is a **host on the OS**.
The entire desktop advantage of AdGuard/ABU comes from one move: **terminate the user's TLS locally**
(a background service that MITMs HTTPS with a self-generated root CA the OS trusts). Once you own the
decrypted stream the MV3 ceiling disappears:

| MV3 extension limit (YoshTool today) | Desktop local-proxy capability |
|---|---|
| No response-body rewriting | Rewrite any text/HTML response (`$replace`) |
| DNR caps (~30k static / 5k dynamic / 1k regex) | No caps — load full EasyList etc. in a real engine |
| No CNAME uncloaking | Uncloak at the proxy |
| Affects only the one browser it's installed in | Filters **every** browser + non-browser app |
| Cosmetic hiding needs an injected content script | Proxy can inject CSS/JS into HTML for any browser |
| DNS not addressable | DNS-level blocking before a connection is made |

AdBlocker Ultimate confirms there's no secret sauce: its Windows app is "system-level… network
filtering, DNS protection, HTTPS inspection, content filtering" and its Mac app "runs as a macOS
Network Extension and filters traffic system-wide." The desktop advantage *is* the local proxy + CA.

**But** that advantage only applies to the **network layer**. It does nothing for YoshTool's in-page
tooling — and that tooling is most of the product.

---

## 2. The hard boundary: a desktop app can't touch other browsers' DOM

The OS gives a normal desktop process **no handle into another app's rendered web content**. So every
feature that reads or mutates the live page the user is browsing can only run two ways:

1. **Keep a (thin) browser extension**, driven by the desktop app over **native messaging** (the
   AdGuard "Browser Assistant" pattern), or
2. **Embed a WebView inside the desktop app** — but that only affects pages the *app itself* loads
   (you'd be shipping your own mini-browser), not the user's real tabs.

Native messaging is real but fragile: per-browser/per-profile host manifests, Firefox's different
schema, a 1 MB host→extension message cap, MV3 service-worker lifecycle, and OS regressions (macOS 27+
now requires explicit permission for the app to drop the manifest into a browser profile folder, which
silently breaks the link). **You still ship and version an MV3 extension** — so you'd maintain *two*
codebases. This is the biggest reason not to "port" the DOM features.

**Exception — the injection trick:** a MITM proxy *can* splice `<style>`/`<script>` into HTML
responses it decrypts, achieving cosmetic hiding + scriptlet/consent/popup-shim injection in *any*
browser with no extension. It works on decryptable HTML (not pinned sites, not QUIC you didn't force
to TCP), is strong for initial-DOM hiding, weaker for SPA content, and **can't** do the interactive
picker (that needs a UI the user drives inside the page).

---

## 3. Feature-portability matrix

How each YoshTool feature classifies for desktop:
**N** = better as native desktop · **X** = must stay a browser extension (optionally driven via native
messaging) · **P** = doable in a desktop network proxy (MITM) · **D** = DNS-level · **W** = only in an
embedded in-app WebView · **—** = little desktop value.

| Feature | Class | Notes |
|---|---|---|
| Ad / tracker **network** blocking | **D** then **P** | DNS kills most third-party domains with no CA; full lists/path/query need the MITM proxy. System-wide, uncapped. |
| Tracking-param strip (`utm_*`, `fbclid`…) | **P** | Proxy rewrites the request URL. Needs MITM. |
| Redirect-to-stub resources | **P** | Serve the stub from the proxy. |
| Response-body rewrite / scriptlets (`$replace`) | **P** | New capability vs MV3; MITM only, text ≤~10 MB. |
| Cosmetic ad hiding | **X** / **P(inject)** | In-page normally; a MITM proxy can inject the `display:none` CSS into HTML for any browser. |
| **Element picker / zapper** | **X** | Interactive in-page hit-testing + overlay — can't leave the browser. |
| Anti-adblock scriptlets | **X** / **P(inject)** | Page MAIN world; or injected by the proxy. |
| Cookie-consent auto-reject | **X** / **P(inject)** | Must click page buttons. |
| Popup blocker | **X** / **P(inject)** | Hooks `window.open` in page JS. |
| Selection helper (translate/font/fill + password eye) | **X** | Needs page selection + form fields. |
| Inspect & edit (DevTools-lite) | **X** | Mutates live DOM. |
| Auto-redact (realtime on-page blur) | **X** | Blurs live DOM as you browse. |
| Fill-form (fake data) | **X** | Data *generation* could be native; injection is extension-only. |
| Font inspector / copy-unlock / force dark / in-page translate | **X** | All read/write the live page. |
| **Screenshots** (area/screen/full/window) | **N** | Clear upgrade over the `chrome.debugger` full-page hack — any window/monitor, no debug banner. |
| Redact in screenshots | **N** | Post-process the captured bitmap in the app. |
| **Color picker / eyedropper** | **N** | Screen-wide pick (PowerToys / Digital Color Meter class), beyond the current canvas-of-tab hack. |
| **Translate** (standalone / clipboard) | **N** | Clipboard-watch + global hotkey + existing endpoint → translate text in *any* app. |
| Cookie **export / read** (cross-browser) | **N** (caveats) | Native read of each browser's SQLite `Cookies` + OS key — but blocked by DB lock + Chrome 127 app-bound encryption. Best-effort export. |
| Cookie **import** / multi-login session swap | **X** | Writing cookies into a *running* browser is reliable only via `chrome.cookies`; keep in the extension. |
| Clear cache / cookies | **X** | `chrome.browsingData` works on the live browser; native disk-delete needs the browser closed. |
| Keyboard shortcuts | **N** | Become true OS-global hotkeys (work outside the browser). |
| Tray / autostart / background daemon | **N** | Not possible in an extension; natural fit for the shell. |

**Pattern:** the whole DOM group is **X** (stuck in the browser). The utility group splits — capture /
color / screenshot-redact / standalone-translate / cross-browser cookie export / global-hotkeys / tray
become genuinely better **N**; cookie write / session-swap / clear stay **X**. Network blocking is the
one area where a desktop app adds system-wide reach (**D**/**P**).

---

## 4. The desktop shell

**Tauri 2 (Rust core + system WebView) vs Electron (bundled Chromium + Node) vs Wails (Go):** Tauri
bundles are several × smaller (~3–15 MB vs ~50–250 MB) and lighter at idle (no Chromium, no Node), with
a least-privilege security model (frontend untrusted; Rust commands gated by capabilities) — a good fit
for a tool that touches cookies and the filesystem. All three load YoshTool's vanilla `popup.html` +
`popup.js` + inline CSS with ~zero rewrite; the real work is replacing `chrome.*` calls with native
equivalents (identical magnitude in any shell). WebView shells render in WebView2/WKWebView/WebKitGTK
(not Chromium), so there can be minor CSS/JS quirks — low risk for a simple vanilla UI.

- **Recommend Tauri 2** for footprint + security + free UI reuse + a future mobile escape hatch.
- **Choose Electron if** you'd rather write all native glue in **JS/Node** (no Rust) or need
  pixel-identical Chromium rendering; `electron-builder` also has the most turnkey signing/notarize.

---

## 5. Network filtering: DNS-first, MITM only as a power tier

### Phase 1 — DNS-level filtering (ship first)
A bundled local DNS resolver/sinkhole (AdGuard Home / Pi-hole style) that loads the domain-granular
part of YoshTool's existing lists. **System-wide, no CA, no MITM, no kernel driver, low maintenance**,
and immune to the Superfish-class CA liability. Catches the bulk of third-party ad/tracker domains
YoshTool already blocks by domain. Blind spots: first-party/same-domain ads (YouTube etc.), anything
path/query/cosmetic, and clients using DoH/DoT/ECH can bypass a local resolver unless you redirect it.
This alone is a credible "YoshTool for the whole machine" and realistic solo.

### Phase 2 — opt-in local HTTPS-filtering proxy (advanced)
For what DNS can't do (param-strip, redirect-stub, response rewrite, cross-browser CSS/JS injection):
an **opt-in** MITM proxy. Reuse an existing engine — **`@ghostery/adblocker`** (TS, MPL-2.0, supports
`$replace`, and YoshTool's lists already derive from Ghostery) or **`@adguard/tsurlfilter`**, or
**Brave `adblock-rust`** via its Node binding for native throughput. Interception: macOS
`NETransparentProxyProvider` (system extension, notarized), Windows WFP connect-redirect (WinDivert to
avoid hand-writing a kernel driver) or system-proxy as a first cut, Linux nftables REDIRECT. Must-haves:
per-machine-generated CA key in the OS keystore (never a baked-in shared key), QUIC (UDP/443) blocking
to force TLS, a cert-pinning/EV bypass list, and honest UX about "YoshTool decrypts your HTTPS."

### The hard parts (why Phase 2 is optional, not default)
Installing a user-trusted root CA = the power to forge any site's cert for that user (a leaked/shared
key is catastrophic). **QUIC/HTTP-3** rides encrypted UDP a TCP proxy can't read (must block to force
fallback). **ECH** encrypts SNI, degrading any DNS/SNI-only filtering (a full MITM is immune since it
decrypts). **Cert pinning** breaks some apps (banking) → bypass lists to maintain. Plus performance,
AV false-positives (MITM looks like malware), Windows driver signing, macOS system-extension
notarization, and OS-API churn. For a solo project this is a lot of recurring liability.

---

## 6. Native superpowers worth building (the real reason to go desktop)

- **System-wide screenshots** — full screen / region / window / multi-monitor of anything, no debug
  banner (Rust `xcap`, or Electron `desktopCapturer`). Straight upgrade; pairs with screenshot
  redaction (post-process the bitmap).
- **Screen-wide color picker** — pick a pixel anywhere on screen (PowerToys / macOS Digital Color
  Meter class), beyond the current canvas-of-tab eyedropper and beyond the browser EyeDropper API.
- **Clipboard / standalone translate** — clipboard watch + global hotkey + the existing
  `translate.googleapis.com` call → translate selected text in *any* app.
- **Cross-browser cookie export** — read each browser's SQLite `Cookies` DB and per-OS key (Windows
  DPAPI / macOS Keychain / Linux libsecret). Caveats: the DB is locked while the browser runs (copy
  first), writing back is impractical, and **Chrome 127+ app-bound encryption** (Windows) makes native
  decryption of current cookies look malware-like to EDR — treat as best-effort *export*, keep
  write/swap in the extension.
- **Global hotkeys, tray, autostart, background daemon** — impossible in an extension; natural for the
  shell.

---

## 7. Packaging / distribution (the non-code tax)

Per-OS bundles (NSIS/MSI, DMG, AppImage/deb). **Windows code signing** (~$200–400/yr OV/EV or Azure
Trusted Signing) to avoid SmartScreen warnings; reputation builds over downloads. **macOS**: $99/yr
Apple Developer + Developer-ID + Hardened Runtime + notarization + stapling (and a system-extension
entitlement if you do the NE proxy). Linux AppImage/deb/Flatpak (Flatpak's sandbox fights
cookie-reading + native messaging). Realistic recurring: **~$99/yr Apple + ~$200–400/yr Windows**, plus
per-OS CI. This signing/notarization work is the single biggest non-code burden.

---

## 8. Recommended plan (phased, honest effort)

1. **Keep the MV3 extension as the core** — all DOM tools live here; it's already shipped and tested.
2. **Tauri 2 companion app — native superpowers first** (low risk, high, unique value): system-wide
   screenshots + redaction, screen color picker, clipboard translate, global hotkeys/tray/autostart,
   cross-browser cookie *export*. Reuses the vanilla UI. **This is the MVP that justifies "desktop."**
3. **DNS-level ad/tracker blocking** in the same app (system-wide, no CA) — the realistic
   system-wide blocker.
4. **(Optional, power-user tier) local MITM proxy** for param-strip / response-rewrite / cross-browser
   cosmetic injection, reusing `@ghostery/adblocker`. Treat as advanced + opt-in; it carries the CA
   liability and the signing/QUIC/ECH/pinning maintenance.
5. **Native messaging bridge — only if** a specific flow needs the app to drive the extension; it's the
   biggest long-term maintenance cost, so defer until justified.

**Effort:** UI reuse = low. `chrome.*` → native glue = moderate. Native superpowers = moderate (and
genuinely worth it). DNS blocker = low–moderate. Full MITM proxy = high across effort/risk/maintenance.
Native-messaging bridge = moderate–high and the main source of ongoing breakage.

**Verdict:** a desktop YoshTool makes sense as a **companion that does what a browser tab can't** —
system-wide capture/color/translate utilities and a system-wide (DNS-first) blocker — **not** as a
desktop reimplementation of the in-page toolset. The extension remains the heart; the desktop app is
the muscle for the few things that genuinely need the OS.

### Mobile (brief)
iOS allows only a declarative **Safari Content Blocker** (static rules, no JS/DOM) — almost none of
YoshTool's interactive tools port. Android has no in-browser extensions; the real option is a
**local-VPN** filter (AdGuard-style, no root) — network-layer only. Tauri 2 can reuse the *UI* on
mobile, but the feature set doesn't translate. **Treat mobile as out of scope** beyond maybe an iOS
content blocker generated from the existing lists.

---

## Sources (selected)

- AdGuard HTTPS filtering / CA / `$replace` / CoreLibs: `adguard.com/en/blog/everything-about-https-filtering.html`,
  `.../adguard-for-mac-version-1-2-0.html`, `.../introducing-corelibs.html`; Windows network drivers:
  `kb.adguard.com/kb/adguard-for-windows/features/network`.
- AdBlocker Ultimate desktop (system-level, NE on Mac): `support.adblockultimate.net/en/articles/3542731`,
  `adblockultimate.net/mac`.
- Apple Network Extension (content filter = no TLS decrypt; `NETransparentProxyProvider` = MITM path):
  `developer.apple.com/documentation/networkextension/...` (TN3134, TN3120).
- Windows WFP redirection: `learn.microsoft.com/windows-hardware/drivers/network/using-bind-or-connect-redirection`;
  mitmproxy local capture: `mitmproxy.org/posts/local-capture/windows/`.
- QUIC vs MITM: NDSS madweb2026-24; ECH: petsymposium FOCI 2025-0016; Firefox enterprise roots:
  `wiki.mozilla.org/CA/AddRootToFirefox`.
- DNS filtering: `github.com/AdguardTeam/AdGuardHome`, `github.com/pi-hole/pi-hole`.
- Engines: Brave `github.com/brave/adblock-rust` (MPL-2.0), `github.com/AdguardTeam/tsurlfilter` (GPL-3.0),
  `github.com/ghostery/adblocker` (MPL-2.0, `$replace`).
- Shells: Tauri (`tauri.app`), Electron (`electronjs.org`); native messaging
  (`developer.chrome.com/docs/extensions/nativeMessaging`); AdGuard Browser Assistant on macOS 27
  (`adguard.com/kb/adguard-for-mac/solving-problems/browser-assistant-macos-27/`).
- Cookie stores / app-bound encryption: CyberArk browser-cookies writeup; Google Security Blog Jul 2024.
- Native capture/color: `lib.rs/crates/xcap`; PowerToys Color Picker; macOS Digital Color Meter.
- YoshTool code/provenance: `manifest.json`, `background.js`, `eyedropper.js`, `cookies.js`,
  `sessions.js`, `rule_resources/NOTICE.md` (unmodified).
