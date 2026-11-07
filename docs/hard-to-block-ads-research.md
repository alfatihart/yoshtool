# Hard-to-block ads: video platforms, piracy streaming & "judol" — research + what YoshTool can realistically do

Defensive/educational research for YoshTool (a Chrome **Manifest V3** blocker: `declarativeNetRequest`
static+dynamic rules + cosmetic content scripts + an in-page popup blocker). Goal: understand *why*
certain ads resist blocking, and set honest expectations for what an MV3 extension can and cannot do.
Nothing here is about accessing pirated content or gambling — only about the ad mechanisms and how
blocking does (or doesn't) reach them.

_Compiled 2026-11-07 from three research passes. Exact Chrome DNR constants should be re-verified
against the live `chrome.declarativeNetRequest` reference or read at runtime — the docs host was
network-restricted during research._

---

## TL;DR

A request blocker (DNR, DNS/hosts, Pi-hole) can only kill an ad that arrives as a **separate,
identifiable request from a distinct origin**. The entire modern anti-adblock playbook is to make
that untrue:

- **Video platforms (YouTube, Twitch)** stitch the ad **into the same stream/manifest, from the same
  origin** as the content (server-side ad insertion). There is no ad request to block — blocking the
  host breaks the video. **Structurally unwinnable for any DNR extension.**
- **Pirate film/anime sites** lean on **pop-unders, tab-unders, forced redirects, fake buttons,
  push-spam and malvertising** from low-vetting ad networks on **rapidly-rotating domains**. Much is
  blockable, but gesture-riding pop-unders and brand-new domains slip through.
- **"Judol" (Indonesian online gambling)** spreads mostly by **hijacking reputable .go.id/.ac.id and
  pirate sites** (black-hat SEO + redirect injection) on aggressively rotating domains — a regional
  list (**ABPindo**) matters far more than EasyList alone.

YoshTool can match a good blocker on **conventional web ads/trackers, pop-ups/pop-unders, and
cosmetic cleanup** (~the 90% case). It **cannot** beat SSAI video ads, CNAME-cloaked trackers, or
rewrite response bodies — those primitives live in the browser, and **MV3 removed them**.

---

## 1. Why some ads resist blocking (the mechanisms)

### 1.1 First-party / same-origin serving
Blockers key on *where* a request goes. If the ad/beacon is served from the publisher's own origin
(`site.com/assets/promo.js`), there's no third-party host to match, and a path rule risks breaking the
site (false positives). This is the foundation every technique below builds on.

### 1.2 Server-side ad insertion (SSAI / DAI / "ad stitching")
A stitcher splices the ad into the media stream **before it reaches the browser**. For HLS, ad
segments are listed **inside the same `.m3u8` manifest** and delivered from the **same CDN/origin** as
the video; the ad bytes are indistinguishable from content bytes. As Yospace puts it, the ad call
happens server-side so "the ad blocker doesn't detect an ad call and is therefore unable to block the
response." The only levers are (a) brittle per-site manifest rewriting or (b) breaking playback — and
**neither is possible with DNR** (no response-body access). This is the YouTube/Twitch problem.

### 1.3 CNAME cloaking
A tracker is reached via a **first-party-looking subdomain** (`metrics.site.com`) whose DNS `CNAME`
points to the tracker. The URL hostname is first-party, so host/DNS blocklists miss it. uBO defeats
this only on **Firefox** (via `browser.dns`). **Chromium exposes no DNS API to extensions**, so
**no MV3/Chrome blocker — including uBO Lite — can uncloak CNAMEs.** Hard browser limit.

### 1.4 Rotating / DGA / CDN-hosted domains
Operators register throwaway "replica ad domains": a CMU study found ~222 DGA-generated domains, plus
subdomain rotation under one parent and creatives hidden on shared **CDN** hosts. Lists react, but
always *after* the domain appears; DGA/CDN/first-party-cloaked hosts are the permanent gaps.
Malvertising also routes through **Traffic Distribution Systems** (e.g. abused Keitaro) that show
crawlers clean content and real users the payload — so a redirect can be invisible to list-building.

### 1.5 Randomized DOM, Shadow DOM, inline creatives
- **Randomized class/id** (`.a7Fk2` per load) breaks static cosmetic rules (`##.ad-banner`). Counter:
  **procedural** cosmetic filters matching on text (`:has-text`), attributes (`:matches-attr`),
  computed style (`:matches-css`), or structure (`:has`/`:upward`) — costlier, re-run on mutation.
- **Shadow DOM**: generic cosmetic rules don't pierce shadow roots; closed roots are unreachable from
  an isolated content script. A genuine hard limit.
- **Inline `data:`/`blob:` creatives** make no network request — nothing for a network rule to match;
  must be handled cosmetically or by neutralizing the builder script.

### 1.6 Pop-unders / tab-unders / gesture-riding opens
- **Pop-under**: on any click, `window.open(adURL)` fires *riding the user gesture*, then
  `.blur()`/`.focus()` sends it behind. Chrome's built-in blocker allows it (looks user-initiated).
- **Tab-under**: the *background* tab navigates itself to an ad.
- These often make **no distinct blockable request** — the harm is the `window.open`/navigation call
  itself, so DNR can't catch them. Needs in-page `window.open`/navigation interception (YoshTool's
  popup blocker territory), plus domain blocking for the destination.

### 1.7 Anti-adblock detection
Bait elements (hidden `.ad-banner`, read `offsetHeight`), bait requests (`ads.js` `onerror`), or
bundle/global checks (`window.adsbygoogle`). uBO defuses via **network-blocking the detector** +
**MAIN-world scriptlets** (`abort-on-property-read`, `set-constant`, `json-prune`) + the one-shot
**Element Zapper**. The scriptlet path is exactly what MV3 restricts (§3).

---

## 2. Per-platform

### 2.1 YouTube
- **Client-side ads** come as a separate stream + JSON (`playerResponse.adPlacements` / `playerAds` /
  `adSlots`) from `googlevideo.com` (same host as the video). Classic blockers don't block a request —
  they **edit the JSON in-page** (`json-prune`/`set-constant` scriptlets at `document_start`) so the
  player sees no ads, and auto-dismiss the anti-adblock modal.
- **Server-side ad insertion** (reported mid-2024, first spotted by a SponsorBlock dev) stitches ads
  into the stream over the UMP protocol; metadata + media share the pipe. As of 2026 this appears to
  be **ongoing/A-B rollout, not universal** (treat "SSAI is default everywhere" as unconfirmed).
- **Enforcement timeline:** experiments May–Jun 2023 → three-option modal Aug 2023 → "ad blockers
  violate YouTube's ToS" + global rollout Oct–Nov 2023 → refreshed ToS banners Mar 2025.
- **How the fight actually works:** uBO ships **frequently-updated scriptlets/filter resources** (not
  binary updates), patching within hours of a YouTube change — a true cat-and-mouse loop. Against
  **SSAI even uBO can't cleanly remove** a stitched ad (best it can do is seek).
- **SponsorBlock** is *not* an ad blocker — it crowdsources timestamps of creator-read sponsor
  segments and auto-seeks past them (complementary; the one tool structurally able to seek past
  stitched ads *if* segments are submitted).
- **YouTube Premium** is the sanctioned, fully reliable removal (account-level, server-side).

### 2.2 Twitch
- Live ads are **SSAI stitched into the HLS `.m3u8`** from Twitch's own CDN — same structural problem
  as YouTube SSAI, applied to live HLS.
- The **"purple screen"** is usually the symptom of a *partial* block: dropping an inline ad segment
  leaves a gap the player can't reconcile.
- Workarounds don't "block" — **proxy approaches (e.g. TTV-LOL)** fetch the `.m3u8` through a
  region/edge that serves fewer ads and hand back a clean manifest; **player-worker approaches (e.g.
  Purple Adblock)** rewrite the HLS playlist inside the player's web worker. Both need code with
  response/manifest access — **not possible via DNR**. (`TwitchAdSolutions`, the hub many Twitch
  blockers derive from, was reportedly archived around early 2026 — confirm on the repo.)

### 2.3 Pirate film/anime streaming
Monetized through the most aggressive formats (legit advertisers/AdSense won't touch them). The
Digital Citizens Alliance "Unholy Triangle" report estimated pop-unders alone ~$88M of ~$121M average
operator revenue and ~12% of piracy-site ads outright malicious (dated estimate; mechanisms endure).

| Format | Blockable by |
|---|---|
| Pop-ups | network rules + popup interception |
| **Pop-unders / tab-unders** | **hard** — needs `window.open`/navigation interception + domain blocking |
| Forced/"loader" redirects | network rules on intermediary/landing domains (if listed) |
| Fake Play/Download buttons | cosmetic hiding (+ network if from a known host); often site-specific |
| Overlay / interstitial | cosmetic hiding + network blocking of the creative |
| In-player VAST/VPAID | network rules on the ad-tag/ad-server (VPAID JS can't be neutralized by DNR) |
| Push-notification spam | block the prompt script + set Notifications permission to deny |
| Malvertising / drive-by | network-blocking the ad/redirector domains (harm can occur without a click) |

**Ad networks:** low-vetting self-serve networks specializing in popunder+push — **PropellerAds /
Monetag** is the one with documented piracy findings (and a pending, denied court allegation re:
HiAnime). PopAds/Adsterra/Clickadu/RichAds are the same format family (piracy link plausible, not
proven). **Anti-adblock walls** use FuckAdBlock/BlockAdBlock — counter by blocking the detector
script by filename or keeping the bait visible (`$generichide`/`$elemhide` exceptions).

### 2.4 Judol (judi online / Indonesian online gambling)
- **Scale/regulator:** Komdigi (ex-Kominfo) runs a massive takedown program — millions of items
  (figures vary by outlet/date), with 2026 decrees requiring platforms to remove judol content within
  **4 hours**. Officials concede new sites reappear after blocking (whack-a-mole).
- **Spread is mostly via hijacking reputable sites**, not buying ads: **.go.id / .ac.id** (high Google
  authority) and pirate sites get compromised (webshell/SQLi/CMS), then **black-hat SEO + cloaking**
  inject hidden `/slot-gacor`-style pages and **redirect chains** (Sucuri documented a gambling
  redirect hidden *inside a legit WordPress redirect plugin*).
- **Relevance to a blocker:** judol shows up as (a) gambling *creatives* via the popunder/push
  networks above (blockable as ads), and (b) *injected redirects* (blockable only if the
  destination/intermediary domain is listed). Domains rotate aggressively → **a regional list
  (ABPindo) is the key lever.**

---

## 3. Manifest V3 ceiling (what the browser lets YoshTool do)

### DNR limits (Chrome; verify at runtime via `chrome.declarativeNetRequest.MAX_NUMBER_OF_*`)
| Limit | Value |
|---|---|
| Guaranteed static rules (enabled rulesets) | **30,000** |
| Global static rule pool (shared across all DNR extensions) | **~330,000** — use `getAvailableStaticRuleCount()` |
| Static rulesets declared / enabled | **100 / 50** (Chrome; Firefox is 100/10 — older "10" snippets are Firefox) |
| Dynamic rules total (Chrome 121+) | **30,000** (was 5,000) |
| — of which "unsafe" (redirect/modifyHeaders/…) | **≤ 5,000** |
| Session rules | **5,000** |
| Regex rules (per type: static; dynamic+session) | **1,000**, each pattern **< ~2 KB** or silently dropped |

For a focused ad blocker these caps are **not** the binding constraint — EasyList-class coverage fits
comfortably (YoshTool today: 3 static rulesets + a ~25k dynamic "extended" list, well within budget).

### The four binding constraints (these, not rule counts, are what hurt)
1. **No blocking `webRequest`** — only observe; blocking is enterprise-only. All blocking must be
   declarative DNR the *browser* evaluates; the extension never sees traffic to decide per-request.
2. **No response-body / stream filtering** — Chrome never exposed `filterResponseData` (Firefox-only).
   You cannot read/rewrite HTML/JS/`.m3u8`/`playerResponse`. **This is the capability that defeats
   SSAI and YouTube's JSON — and it's gone.**
3. **No default on-demand MAIN-world scriptlet injection** — `executeScript`/`registerContentScripts`
   take a function/file (not an arbitrary code string) and run isolated by default. uBO's "inject a
   parameterized scriptlet per-site from filter lists" model needs either **bundled** `world:"MAIN"`
   scripts (fixed set, store-reviewed) or the **`userScripts` API**, which requires explicit per-user
   opt-in → **not available by default**. This is the deepest gap for anti-adblock defusing.
4. **Slow refresh cadence** — DNR static rulesets refresh **only on extension update** (Web Store
   review). Against YouTube/SSAI-class adversaries that patch hourly, this is a structural lag unless
   you build a custom dynamic-rule refresh path.

uBO Lite (the MV3 reference) confirms the shape: entirely declarative; **cosmetic filtering &
scriptlets OFF by default** (need elevated per-site mode + host access); no dynamic filtering, no
`strict1p/3p`, no `redirect-rule=`, no `replace=`, **no CNAME uncloaking (unsupported in all DNR
implementations)**. Full uBO (MV2) is no longer installable on stable Chrome (MV2 sunset ~Chrome 138,
Jul 2025); Firefox keeps MV2 + full `webRequest`.

---

## 4. What YoshTool can / cannot do (honest matrix)

**CAN do well (≈ the 90% case):**
- Block third-party, separate-origin **ad/tracker requests** — display/banner/overlay creatives,
  iframe ads, VAST ad-tag URLs, push-prompt scripts, analytics, listed redirector/landing domains —
  via DNR static + dynamic rules. _(YoshTool already does this: ads/trackers rulesets + extended list.)_
- **Cosmetic hiding** of fake buttons, overlays, interstitials, anti-adblock banners, leftover
  placeholders via content scripts. _(YoshTool has cosmetic hiding.)_
- **Pop-up / pop-under / tab-under interception** by wrapping `window.open` + suppressing
  gesture-riding opens, with a payments/login allow-list. _(YoshTool's popup blocker already does this
  — an area where MV3 can equal or beat MV2.)_
- **Cookie-banner auto-reject** and annoyance removal. _(YoshTool has consent auto-reject.)_
- **Push-prompt** neutralizing (block the script; optionally auto-deny `Notification.requestPermission`).

**CANNOT do (hard limits — don't over-invest):**
- Remove **YouTube/Twitch SSAI** in-stream ads (same origin/bytes; no response access).
- **Rewrite** manifests/JSON/response bodies (`.m3u8`, `playerResponse`).
- **Uncloak CNAME** first-party trackers (no DNS API on Chromium).
- **Win the rapid cat-and-mouse** vs YouTube's JSON/locker changes on a Web-Store-review cadence.
- Reach **closed Shadow DOM** ad slots; fully stop **brand-new rotating** domains in real time.
- On-demand MAIN-world **scriptlet defusing** of JS-state anti-adblock (without opt-in `userScripts`).

---

## 5. Recommendations for YoshTool (prioritized, mapped to what exists)

1. **Add a regional Indonesian list (ABPindo) — highest ROI for your use case.** `ABPindo/
   indonesianadblockrules` targets Indonesian/Malaysian ads **and judol** that EasyList misses. You
   already have the "extended blocklist" download+compile+dynamic-rules pipeline — add ABPindo (and a
   disposable-domain list like HaGeZi) as sources there. This directly attacks the judol/pirate-site
   creatives and rotating domains the user asked about.
2. **Add an anti-adblock / annoyances list + cosmetic defusing.** Subscribe the cosmetic side to
   EasyList/Fanboy/AdGuard annoyance + anti-circumvention lists; block common detectors by filename
   (`fuckadblock.js`, `blockadblock.js`). Remove overlay/blur/scroll-lock **cosmetically** (no special
   permission). Only ship MAIN-world JS defuses as a small curated `world:"MAIN"` set, and treat the
   `userScripts` API as an explicit opt-in "advanced" mode (document it's off by default and why).
3. **Harden the popup blocker against pop-unders/tab-unders.** You already intercept `window.open`;
   also neutralize gesture-riding opens, abusive `target=_blank`, and first-interaction programmatic
   navigation (tab-under). Keep the payments/login/OAuth allow-list (you have the whitelist). This is
   where you can genuinely match MV2.
4. **Block push-notification abuse.** Block prompt scripts via DNR; optionally wrap
   `Notification.requestPermission`/the Push API to auto-deny, and surface a "revoke" hint (you can't
   silently recall an already-granted permission).
5. **Lean on your extended-list update path to beat the cadence problem.** Since static rulesets only
   refresh on extension update, keep pushing fast-moving ad/judol domains through the **downloadable
   extended list → dynamic rules** path (you already have "Update blocklist"). That's the clearest
   place engineering narrows the gap to MV2 uBO.
6. **Be honest in the UI/README about the hard limits.** Say plainly that in-stream video ads
   (YouTube/Twitch SSAI), CNAME-cloaked trackers, and response-body rewriting are **out of scope on
   Chrome MV3** — set expectations instead of burning effort on dead ends. For YouTube specifically,
   recommend Premium / a Firefox+uBO setup / SponsorBlock as complements, not something YoshTool can
   match.
7. **(Optional) A procedural cosmetic engine** (text/attribute-regex/computed-style/structure matching
   + an open-shadow-root walker) if you want to survive randomized class names — costlier, gate behind
   mutation throttling and specificity checks.

**One-line framing for the user:** YoshTool is already a solid blocker for *ordinary* web ads,
trackers, pop-ups and cookie walls; the ads it "can't" kill (YouTube/Twitch in-stream, some judol
redirects on brand-new domains) are hard because the platforms moved the ad into the content's own
origin/stream **and** Chrome MV3 removed the exact tools (response filtering, DNS access, on-demand
scriptlets) that were the only counters — not a gap in effort.

---

## 6. Sources

**Video platforms:** Gizmodo / AdGuard / TechRadar / AlternativeTo (YouTube SSAI); gHacks, TechCrunch,
Forbes (enforcement timeline); iter.ca + WebKit/adblockpluscore (json-prune scriptlet); SponsorBlock
(addons.mozilla.org); Purple Adblock (github.com/arthurbolsoni/Purple-adblock), Stands blog (Twitch
SSAI/purple screen); AdExchanger, Fora Soft, Google OTT DAI whitepaper, AWS MediaTailor (SSAI/VAST/VPAID).

**Piracy & judol:** Digital Citizens Alliance "Unholy Triangle"; TorrentFreak / Piracy Monitor /
Cybernews (Microsoft ~1M-device malvertising); CBR (HiAnime/PropellerAds allegation); CMU WWW 2022
(domain rotation/DGA); Infoblox (Keitaro TDS); PortSwigger + Brave (CNAME cloaking); CNN Indonesia /
Detik / Tempo (Komdigi takedowns, 4-hour rule); Tirto / Beritasatu / Sucuri (judol on .go.id/.ac.id,
redirect injection); ABPindo (github.com/ABPindo/indonesianadblockrules); EasyList supplementary;
AdGuard filters; HaGeZi dns-blocklists.

**Anti-adblock & MV3:** Chrome `declarativeNetRequest` reference; uBO Lite FAQ
(github.com/uBlockOrigin/uBOL-home); uBO Procedural Cosmetic Filters & Resources Library wikis;
BleepingComputer + Brave (CNAME, Firefox-only); incolumitas.com (adblock detection); EasyList
(easylist.to, github.com/easylist/easylist); supercharge­browser DNR summary.

_Verify-at-runtime flags: exact static-ruleset counts (100/50 believed), the 330k global pool, and
"YouTube SSAI is universal" — re-confirm on live Chrome docs / at runtime. PropellerAds piracy
allegation is denied and pending._
