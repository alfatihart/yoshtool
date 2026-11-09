# Research: next features & polish for YoshTool (Nov 2026)

Deep-research on candidate additions the user raised — **UI/UX polish** (their top pick), **clipboard**,
**domain checker / DA-PA**, **ping/latency**, **load-time/FCP** — plus my own picks. Everything is scoped
to YoshTool's constraints: **MV3, vanilla JS, no build step, minimal/opt-in permissions.** Each item has
an honest effort/value/permission read and a verdict.

> TL;DR ranking: **1) UI/UX polish → 2) Page performance (Web Vitals) → 3) Dev-utility quick wins
> (JWT/JSON/base64/QR) → 4) Domain checker (free core) → 5) Ping/latency (honest-limits gadget) →
> skip Clipboard.**

---

## 1. UI/UX polish — **recommended #1** (user's own top pick)

**The visual layer is already fine, not AI-slop.** There's a real design system: tokens for a teal accent
(`#157c69`) + slate neutrals, radii, shadows, and **light + dark** via `color-scheme` (from the v1.4.2
redesign). So this is **not** a repaint — it's an **information-architecture / density** problem.

**The actual problem — the Page tab is overloaded (8 stacked cards):**
`Screenshot · Device mode · Clear & reload · Page tools · Translate · Fill form · Tech profiler · Color picker`

- Too much vertical scroll; hard to scan.
- **Single-button cards waste space** (Fill form, Tech profiler = full card for one button).
- **Weak grouping** — "Page tools" bundles dark-mode/unlock/font/edit, yet Translate/Fill/Tech/Color/Device
  each get their own card though they're all "inspect/dev" tools.
- **Long inline hint prose** the user wants trimmed.

**Plan:**
1. **Compact action grid** for one-shot tools — a dense 3–4-col **icon-button grid** (icon + short label +
   `title` tooltip), collapsing ~5 cards into 1. Biggest density win.
2. **Group by intent** inside Page: *Capture* (screenshot + device mode), *Inspect* (tech profiler + font +
   edit + unlock), *Content* (translate + fill + dark mode), *Site data* (clear/reload). Optional collapsible
   sections (accordion) so only the active one is open.
3. **Hints → tooltips / info-dot** (`.hint`, `.info-dot`, `title` already exist).
4. **Consistency pass**: one primary button per card, uniform spacing/icon stroke, de-duplicated labels.
5. **Guardrail:** keep all element IDs / JS hooks intact (verify with the `comm` ID-diff + the popup-render
   harness, as in the v1.4.2 redesign) so `popup.js` needs no churn.

**Effort:** medium · **Permissions:** none · **Risk:** low · **Value:** high (user's #1; also makes room
for the new tools below). Version: patch/minor UI pass.

---

## 2. Page performance / Web Vitals (FCP/LCP…) — **recommended #2**

The user asked for "load time / FCP (Lighthouse or similar)". **Don't run Lighthouse** (Node lib, 100s of
KB–MBs, needs a forced reload, not built for an extension). Read the **Performance APIs** directly + Google's
tiny **web-vitals** library.

**Approach (MV3 vanilla):**
- Ship **`web-vitals.iife.js` locally** (~2–6 KB; the attribution build names the LCP/CLS element). **No CDN
  at runtime** (MV3 bans remote code + CSP). It exposes a `webVitals` global; `onLCP/onINP/onCLS/onFCP/onTTFB`
  callbacks already return a `rating` (good/needs-improvement/poor) — no hardcoded thresholds.
- Plus **Navigation Timing** (`navigation` entry → TTFB, DNS/TCP/TLS phases, DCL, load) and **Paint Timing**
  (FCP). Optional **resource waterfall** (`resource` entries → slowest/heaviest).
- Injection: for **full fidelity**, a `document_start` content script (needs host access → opt-in all-sites,
  like the selection-helper/adblock-cosmetic pattern). For **on-demand** (popup button, `activeTab`+`scripting`,
  no new permission), it injects *after* load — FCP/nav/past-LCP are recoverable via `buffered:true`, but final
  LCP/INP may be incomplete. Be honest in the UI ("measured from when you clicked").

**Current Core Web Vitals thresholds (verified Nov 2026):**

| Metric | Good | Needs improvement | Poor |
|---|---|---|---|
| **LCP** | ≤ 2.5 s | 2.5–4.0 s | > 4.0 s |
| **CLS** | ≤ 0.1 | 0.1–0.25 | > 0.25 |
| **INP** | ≤ 200 ms | 200–500 ms | > 500 ms |
| FCP | ≤ 1.8 s | 1.8–3.0 s | > 3.0 s |
| TTFB | ≤ 0.8 s | 0.8–1.8 s | > 1.8 s |

(Core = LCP, CLS, INP. INP replaced FID in Mar 2024; FCP/TTFB are diagnostic.)

**Effort:** medium · **Permissions:** none for on-demand (`activeTab`+`scripting`) + a web-accessible local
lib file; opt-in all-sites only if you want auto-collection at `document_start` · **Value:** high (direct ask,
pairs with device mode) · **Honest limits:** single-session RUM (not Google's field/CrUX data); on-demand
misses final LCP/INP; cross-origin resource phases are zeroed without `Timing-Allow-Origin`.
*(Optional power-mode later: a throttled "lab" trace via `chrome.debugger`/CDP — accurate cross-origin
timings + main-thread breakdown — but that's the debugger infobar again; keep it optional.)*

---

## 3. Dev-utility quick wins (my pick) — **recommended #3**

Low-effort, **no-permission**, high-fit for a dev who works with APIs/tokens (TriPay, dashboards). Each is a
small popup/panel tool:

- **JWT decoder** — paste a token → decoded header + payload (base64url → JSON), exp/iat humanized. "Decode
  only, not verify." Escape HTML before render.
- **JSON formatter / minifier** — pretty-print + validate + collapse.
- **Base64 / URL encode-decode** — both directions.
- **QR code for the current URL** — open the page on your phone (pairs with Device mode). One-file vendor
  (`qrcode-generator`, ~16 KB, SVG), popup-only.
- **Storage viewer/editor** — list/edit/delete `localStorage`/`sessionStorage` for the current origin
  (`activeTab` + `scripting`).
- *(Maybe)* **Cookie editor** — inline-edit a single cookie (extends the existing cookie export/import).

**Effort:** low each (ship 2–4 of them) · **Permissions:** none new (JWT/JSON/base64/QR are popup-only;
storage uses `activeTab`) · **Value:** high utility-per-byte; reinforces the dev-tools identity.

---

## 4. Domain checker — **recommended #4** (free core; DA/PA honestly costs money)

**DA/PA are Moz-proprietary.** There is **no free, keyless DA/PA** — every "DA checker" resells Moz. Moz Links
API needs a key + auth and its free tier (~50 rows/mo, CC required) is unusable for a live per-tab panel. **State
this plainly to the user.** The honest free stand-in for "authority": **Open PageRank** (0–10 + global rank,
free key) and **Tranco** popularity rank (no key).

**A genuinely strong domain-checker can be built with zero pay and mostly zero keys:**

| Data | Source | Free? | Key? | Notes |
|---|---|---|---|---|
| Domain age / registrar / create+expiry | **RDAP** (`rdap.org/domain/{d}`) | ✅ | ❌ | Modern WHOIS; structured JSON. **Best value/effort.** |
| DNS records (A/MX/NS/TXT…) | **DNS-over-HTTPS** (`dns.google/resolve`, `cloudflare-dns.com`) | ✅ | ❌ | JSON; very high limits. |
| Security headers (HSTS/CSP/XFO…) | your own `fetch()` of the site | ✅ | ❌ | Free "security grade". |
| IP / ASN / geo / host | **ipinfo.io** (token, HTTPS) *or* ip-api (keyless but **HTTP-only**, non-commercial) | ✅ | ipinfo: key | Prefer ipinfo for clean HTTPS. |
| "Authority"-ish score 0–10 + global rank | **Open PageRank** (`openpagerank.com`) | ✅ | free key | The realistic free DA proxy. |
| Popularity rank | **Tranco** (`tranco-list.eu/api/ranks/domain/{d}`) | ✅ | ❌ | Neutral, research-grade. |
| Real-user Web Vitals | **CrUX API** | ✅ | free Google key | Field LCP/INP/CLS (ties into #2). |
| Safety flag | **Safe Browsing** | ✅ | free Google key | "is this URL flagged". |
| TLS cert (issuer/expiry/SANs) | crt.sh / SSL Labs | ✅ | ❌ | `fetch()` **can't** read the live cert. |
| **DA / PA** | **Moz** | ❌ paid | ✅ | The one metric that **costs money**. |

**MV3 reality:** with `host_permissions` for an endpoint, the SW `fetch()`es it and reads full
responses/headers (CORS bypassed). The free sources need a **fixed small allowlist** of API hosts (not
all-sites). Embedded API keys are readable if the extension is unpacked — **fine for a personal build**,
not a published one.

**MVP = the no-key subset** (RDAP + DoH + security headers + Tranco) — already a solid "domain checker" with
zero signup. Add Open PageRank / ipinfo / CrUX / Safe Browsing (free keys) as optional "enter your key" rows.

**Effort:** medium (several fetchers + a panel) · **Permissions:** host access to a fixed API allowlist ·
**Value:** high for the SEO-curious user · **Friction:** the best metrics (authority, IP-HTTPS, CrUX, safety)
need free API keys the user signs up for once.

---

## 5. Ping / latency (`ping 8.8.8.8 -t` style) — **recommended #5** (honest-limits gadget)

**Browsers can't do ICMP, and MV3 has no raw sockets** — so there's **no true ping/traceroute**. You can only
measure **application-layer RTT** (TCP+TLS+HTTP), which reads **higher than cmd `ping`** and only works against
hosts that answer on 443. (8.8.8.8 *does* serve HTTPS as dns.google, so you can HTTP-ping it — but you're
timing TLS+HTTP, not ICMP.)

**Practical build:**
- **`fetch(url, {method:'HEAD', cache:'no-store'})` + `performance.now()`** (cache-buster; `mode:'no-cors'`
  when only timing). Fallback: **`Image()` timing** (no-cors by default, `onerror` still yields valid timing
  → universal "does 443 respond, how fast"). WebSocket echo only if you ship an echo endpoint.
- **Warm up one request (keep-alive) and discard it**, then ping on an interval → ring buffer → **live
  sparkline + min/avg/max/jitter + loss%** (the `-t` experience). Target = current tab origin or a free-text
  host.
- One-shot **`navigator.connection`** tile (effectiveType / downlink / coarse rtt) as a connection summary.

**Effort:** low–medium · **Permissions:** `activeTab` for the origin; host access only to *read* arbitrary
cross-origin (timing-only needs none) · **Value:** medium (fun, useful for relative/trend latency) ·
**Honest limits:** not real ICMP numbers; https-only; only HTTP-responsive hosts. *(Real ICMP would need a
Native Messaging host — a separately-installed native binary — out of scope for a pure extension.)*

---

## 6. Clipboard manager — **skip**

The user already flagged **Win+V** covers it at OS level. On top of that, the browser **Clipboard API can't
read the clipboard in the background** (needs focus + a permission prompt), so an in-extension history would be
clunky and redundant. **Low ROI — don't build it.**

---

## Prioritized recommendation

| # | Feature | Value | Effort | New permission? | Notes |
|---|---|---|---|---|---|
| 1 | **UI/UX polish** | ★★★ | med | none | User's top pick; low risk; makes room for the rest |
| 2 | **Page performance (Web Vitals)** | ★★★ | med | none (on-demand) | Direct ask; pairs with Device mode |
| 3 | **Dev quick wins** (JWT/JSON/base64/QR/storage) | ★★★ | low | none | Big utility-per-byte |
| 4 | **Domain checker** (free core) | ★★☆ | med | fixed API allowlist | DA/PA = paid Moz; free stand-ins exist |
| 5 | **Ping/latency** | ★★☆ | low–med | activeTab | Honest: not real ICMP |
| — | Clipboard | ✗ | — | — | Win+V already does it |

**My suggestion:** do **#1 (UI/UX polish)** first — it's your own priority, de-bloats the Page tab, and the
compact grid it introduces is exactly where the new tools (#2/#3) then slot in cleanly. Then **#2 Web Vitals**
and a couple of **#3 quick wins**. Treat **#4 domain checker** as its own bigger feature (free core first),
and **#5 ping** as an optional gadget.

---

### Sources / confidence
- MV3/CORS, RDAP, DoH, ip-api/ipinfo, Safe Browsing, crt.sh, Open PageRank/Tranco endpoints — confirmed.
  Moz free-tier digits (~50 rows/mo) and Open PageRank daily quota are from secondary sources (vendor pages
  were unreachable from the research sandbox); the **paid/keyed/proprietary** conclusions are solid.
- Core Web Vitals thresholds + web-vitals library (v6.x, IIFE/attribution builds, local-ship requirement) —
  verified; pin the exact version with `npm view web-vitals version` before shipping.
- UI/UX critique — from the actual `popup.html`/CSS in this repo.
