# Element picker / zapper: point-and-click "select → preview → block" for YoshTool

Research + concrete MV3 implementation plan for a **"adblock ultimate"-style element blocker** — the
user points at a page element (e.g. a *judol* ad banner YoshTool's current filters miss), **previews**
the match set, and **blocks** it permanently (per-domain) or **zaps** it once. Built on a reading of
the actual source of uBlock Origin, uBO Lite, AdGuard Assistant, AdBlocker Ultimate, `@medv/finder`,
`@adguard/extended-css`, and Chrome DevTools' `cssPath`.

_Compiled 2026-11-07 from three primary-source research passes (uBO picker/zapper; AdGuard Assistant;
selector-generation + MV3 picker patterns). Chrome API constants should be re-verified against the
live `chrome.scripting` / `chrome.declarativeNetRequest` references._

---

## TL;DR

- **It is fully feasible in MV3, and YoshTool is already 70% there.** The whole picker UI (hover
  highlight, ancestor slider, live preview, selector generator, zapper) lives in **one on-demand
  content script**. The hard part — *applying* the saved rule early and surviving randomized class
  names — is already solved by YoshTool's existing `adblock-cosmetic.js` engine (plain `<style>` +
  procedural `:has-text`/`:matches-attr`/`:matches-css`/`:upward`/`:min-text-length`).
- **The reference tools confirm the architecture.** uBO's picker, uBO Lite (MV3!), and AdGuard
  Assistant all do the same five things; they differ mainly in selector-quality heuristics. uBO Lite
  proves a picker/zapper ships in MV3 today.
- **What we add:** a `picker.js` content script, a small **per-domain user-rule store**
  (`userCosmetics` in `chrome.storage.local`), and a one-line hook so the existing cosmetic engine
  merges user rules with the bundled list. Plus a **zapper** (one-shot `element.remove()`, no storage)
  as the smallest first slice.
- **No new permissions.** YoshTool already has `scripting`, `activeTab`, `storage`, and
  `optional_host_permissions: ["*://*/*"]`. The cosmetic engine already registers at `document_start`
  on all sites when the all-sites grant + cosmetic toggle are on.
- **Honest limits:** a brief *flash* before late-registered user CSS kills an element on first load
  (the MV3 `storage.get` async race); native page `!important` can only be beaten reliably with
  **USER-origin CSS** (`scripting.insertCSS {origin:"USER"}` from the SW) — an in-page `<style>` is
  enough for *preview* but may lose a specificity fight on some sites; and **block-by-URL** (network)
  rules are a separate DNR path, not cosmetic.

---

## 1. What the reference tools actually do

All three reference pickers implement the **same five-stage loop**. The differences are in licensing
(all GPL — reimplement, don't copy) and in how good their generated selectors are.

| Stage | uBlock Origin (`epicker.js`, GPLv3) | AdGuard Assistant (`AdguardAssistant`, GPL-3.0) | uBO **Lite** (MV3) |
|---|---|---|---|
| **1. Overlay + hit-test** | Full-viewport `<iframe>` z-index max; `clickblind` attr → `pointer-events:none` right before `elementFromPoint`, then removed | UI in an **injected iframe** (page CSS can't break it); capturing `click/mouseover` on `body *`; rejects `!e.isTrusted` | Same family; ships picker **+ zapper + unpicker** in MV3 |
| **2. Highlight** | SVG **"ocean + islands"**: one dimming path + one transparent `getBoundingClientRect` hole per target (even-odd fill). No scroll math (fixed overlay) | **4 absolutely-positioned border divs** (top/bottom/left/right) + a tag-path label on the bottom border | (content-script, same approach) |
| **3. Climb / breadth** | Slider/arrows walk the **ancestor chain**, broadening; re-previews the match set each step | Discrete **slider** mapping to ancestors (up = broader) **and descendants** (down = narrower); `value=parents+1`, `min=1`, `max=parents+children+1` | — |
| **4. Preview** | Input shows **live match count**; highlighter re-renders the full matched set | Rule text in an **editable box** (`#filter-rule`) the user can hand-edit; reversible preview via injected `display:none!important` | — |
| **5. Commit** | `hostname##selector` → user rules; cosmetic engine re-applies on reload. **Zapper** = `elem.remove()` one-shot, no persist, + scroll-unlock heuristic | `addRule(ruleString)` callback → host appends to **User rules**; applied by tsurlfilter/tswebextension + extended-css | SW persists `site.<hostname>`; USER-origin CSS applied via `scripting.insertCSS/removeCSS {origin:"USER"}` |

**Key takeaways for YoshTool:**

1. **uBO Lite settles the MV3 question** — a picker + zapper + unpicker ship in MV3 production. The SW
   only (a) injects the picker on the active tab and (b) persists the selector; the content engine
   re-applies. That is exactly YoshTool's shape.
2. **The clickblind `pointer-events` toggle** (uBO) is the clean way to hover the page *through* your
   own overlay. YoshTool's overlays (`redact-overlay.js`, `fontinspector.js`, `selection-helper.js`)
   already use the same namespaced-overlay + guard pattern, so this drops in.
3. **AdGuard's selector builder does NOT prune hashed/auto-generated class names** — it only
   `CSS.escape`s them, and pushes stability onto the human (the slider + STRICT/SIMILAR toggles). This
   is the concrete thing to **improve on**: generate robust selectors by construction (see §3).
4. **AdBlocker Ultimate** literally bundles `@adguard/assistant` — the "adblock ultimate" experience
   the user referenced *is* the AdGuard Assistant picker.

---

## 2. What YoshTool already has (the "apply" half is done)

The expensive, fiddly half of an element blocker is applying the rule **early, every reload, surviving
randomized classes**. YoshTool already ships this:

- **`adblock-cosmetic.js`** — a classic content script registered by `background.js` on `*://*/*` at
  **`document_start`** (id `yoshtool-adblock-cosmetic`), gated on the cosmetic toggle + all-sites
  grant. It fetches `rule_resources/cosmetics.json`, injects plain selectors as one
  `{display:none!important}` `<style>`, and runs a MutationObserver-driven JS evaluator for procedural
  selectors.
- **`adblock-cosmetic-core.js`** — `selectorsForHost(data, host)` merges `data.generic` with
  `data.specific[domain]` for every parent domain of the host (and ABP `domain.*` rotating-TLD keys).
  **This is the exact join point** a user-rule store plugs into.
- **`adblock-procedural-core.js`** — `PROCEDURAL_OPS = ["has-text","min-text-length","matches-css",
  "matches-attr","upward"]`, with `parseProcedural` (quote/paren-aware) and `parseValueArg`
  (`/regex/flags` vs literal). **This is our selector grammar** — the picker must emit exactly this.
- **Overlay toolkit** — `redact-overlay.js`/`sensor.js`/`fontinspector.js`/`selection-helper.js` give
  us battle-tested namespaced overlays, guard flags, idempotent teardown, click-reveal, and
  `chrome.scripting.executeScript({files})` injection from the popup.
- **Permissions + wiring** — `scripting`, `activeTab`, `storage`, `optional_host_permissions`, the
  `pendingGrant` disambiguation in `background.js` `onAdded`, and `storage.onChanged`-driven
  re-sync are all in place.

So the only genuinely new code is the **picker UI + selector generator + a user-rule store + one merge
hook**. Everything downstream already works.

---

## 3. Robust selector generation (the one place to beat the references)

The user's pain point — *"judol ads YoshTool's filters miss"* — is usually a **randomized class name**
(`.css-1a2b3c`, `.sc-bdVaJa`, `.ad_7f3kd`). A naive picker that emits `.ad_7f3kd` produces a rule
that dies on the next page load. Three complementary strategies, best first:

### 3a. `@medv/finder` for the plain selector (MIT — vendorable)

`@medv/finder` (v4.0.2, **MIT**, one ~1.5 KB file) produces the *shortest unique + stable* selector,
with an anti-hash heuristic built in. Its penalty scoring: `#id`=0, `.class`=1, `[attr="v"]`=2,
`tag`=5, `:nth-of-type`=10, `:nth-child`=50 — so it reaches for positional pseudo-classes only as a
last resort, and prefers `:nth-of-type` (less volatile) over `:nth-child`. Its `wordLike()` predicate
**rejects any token containing a digit** (`^[a-z\-]{3,}$`) and consonant-hash tokens — i.e. it drops
`css-1a2b3c`/`sc-bdVaJa` automatically, no regex authoring.

- **No-build vendoring:** the npm package is compiled ESM; a classic content script can't use
  top-level `export`. Strip the ~6 `export` keywords from `finder.js` → it defines `finder()` in the
  content script's isolated world. One-time manual edit, genuinely no build step.
- **`CSS.escape` is native** in all Chrome content scripts (Chrome 46+) — no polyfill needed.
- Config it to our bias: `finder(el, { className: n => /* reject digits */, attr: whitelist })`.

### 3b. Procedural refinements → YoshTool's existing grammar

When structure is brittle, offer the user (via picker toggles) refinements that compile to the ops the
engine already evaluates:

- **"Contains text"** → `subject:has-text("Sponsored")` or `:has-text(/sponsor/i)` — the single most
  robust way to catch text-labeled ad blocks regardless of class churn.
- **"Match hashed class by shape"** → `:matches-attr(class="/[a-z]{2}-[0-9a-f]{6}/")` — targets the
  *pattern* of a randomized class instead of its (changing) value. (uBO's own trick.)
- **"Go up N / to ancestor"** → `:upward(2)` or `:upward(".ad-wrap")` — blocks the container, not just
  the leaf. This is the picker's "climb" slider, serialized.
- **"By computed style"** → `:matches-css(position: fixed)` — useful for sticky overlays.

Because these are exactly `PROCEDURAL_OPS`, the picker's **preview reuses the engine's own matcher**
(§4) — we never write a second evaluator.

### 3c. Domain scoping

Store rules keyed by **registrable domain** (reuse `domainsOf`), so a rule applies to subdomains too,
and support an "all sites" option (generic). Matches `selectorsForHost`'s existing behavior for free.

> **Note:** `@adguard/extended-css` (GPL-3.0) is an alternative drop-in matcher with a richer pseudo
> set (`:xpath`, `:nth-ancestor`, `:remove`, `:matches-property`). We **don't need it** — YoshTool's
> engine already covers the high-value ops, and pulling in GPL code would relicense the extension.
> finder stays MIT and optional; the procedural engine is ours.

---

## 4. Live preview (reuse the engine, don't rewrite it)

The preview loop, on every keystroke / slider move (debounced) and on a MutationObserver tick:

1. Parse the draft into plain-prefix + ordered procedural ops (the engine's `parseProcedural`).
2. Run the engine's matcher against the live DOM → the current result set.
3. Show **"N elemen akan diblokir"** and **highlight all matches** (same overlay as the picker).
4. Highlight the **final** element — if `:upward(n)` is present, the hidden node differs from the
   hovered one, and the preview must show what actually gets hidden.

For the highlight itself, the simplest robust choice is a **single `position:fixed` box per match from
`getBoundingClientRect()`** (no scroll math, because fixed + rect are both viewport-relative; redraw
on `scroll`/`resize`). uBO's SVG ocean-islands is prettier but optional polish.

---

## 5. Persisting + applying user rules in MV3

### Storage schema (new)

```jsonc
// chrome.storage.local
"userCosmetics": {
  "example.com": ["div.ad-slot:has-text(Sponsored):upward(2)", "#promo-xyz"],
  "*":           ["[id^=gpt-ad]"]          // "all sites"
}
```

### The merge hook (one line in the engine)

`adblock-cosmetic.js` already calls `selectorsForHost(data, host)`. Add the user rules to the same set:

```js
// after loading cosmetics.json → data, and reading userCosmetics for this host:
const selectors = selectorsForHost(data, host)
  .concat(userCosmetics[registrableDomain] || [], userCosmetics["*"] || []);
```

Plain ones flow into the `<style>`, procedural ones into the evaluator — **no engine changes**, just a
wider input list. The byte-identical core↔inline rule still holds (the merge is in the content script,
not the pure core).

### Beating the flash + page `!important`

Two honest MV3 constraints, with the standard mitigations:

1. **First-load flash.** `chrome.storage.local.get` is async and resolves *after* first paint, so a
   user-blocked element can flicker once on initial load. Mitigation (the uBO Lite approach):
   **pre-register per-domain user CSS via `chrome.scripting.registerContentScripts({css:[…]})` at
   `document_start`** from the SW whenever `userCosmetics` changes. Chrome then injects it
   declaratively with no in-page async read → no flash for *plain* rules. Procedural rules still need
   JS and may flash briefly (acceptable, and what every blocker does for late-loaded lists).
2. **Specificity / `!important` wars.** An in-page `<style>` can lose to a page's own
   `!important`. The reliable fix is **USER-origin CSS** — `chrome.scripting.insertCSS({origin:"USER",
   css})` from the SW — which outranks author `!important`. Use an in-page `<style>` for *preview*
   (instant, no SW round-trip) and USER-origin insertCSS for the *persisted* apply.

### The zapper (ship this first)

One-shot, **no storage**: pick → `elem.remove()` (or `display:none`) → done; nothing re-applies on
reload. Add uBO's **scroll-unlock heuristic**: if the removed node (or an ancestor) was
`position:fixed` / `z-index>=1000`, force `overflow:auto` on `<body>`/`<html>` so removing a modal
doesn't leave the page scroll-locked. This is the smallest useful slice and the best "try before you
commit" mode.

### Block-by-URL (optional, separate path)

If the user picks an element with a blockable `src` (e.g. an `<iframe>`/`<img>` ad from a CDN), offer a
**network** rule. In MV3 that is a `declarativeNetRequest` **dynamic** rule (cap 5,000; 1,000 regex) —
a different subsystem from cosmetics, and YoshTool already manages DNR rulesets in `adblock-core.js`.
Keep this out of v1; cosmetic hiding covers the stated use case (visible judol banners).

---

## 6. Proposed YoshTool implementation (phased)

No new permissions. New files mirror existing conventions (pure core + byte-identical inline copy;
namespaced overlay + guard + teardown).

### Phase A — Zapper (smallest, no storage) → `1.5.0`
- `zapper.js` (classic content script, on-demand via `executeScript({files})` from the popup Page/Protect
  tab or a `commands` shortcut): namespaced fixed overlay, clickblind hover highlight, Esc to quit,
  click = `elem.remove()` + scroll-unlock heuristic. Guard + idempotent teardown like
  `fontinspector.js`.
- Popup: a **"Zap elemen"** button in the ad-block card. Toast "Elemen dihapus" via `toast.js`.
- No core changes, no storage. Immediately useful for one-off judol overlays.

### Phase B — Picker + per-domain block → `1.6.0`
- `picker-core.js` (pure, Node-tested): selector generation — vendored `finder` wrapper + our
  anti-hash config + procedural-refinement serializers (`addHasText`, `addUpward`, `addMatchesAttr`).
  Unit tests: hashed class dropped, `:has-text` escaping, `:upward` serialization round-trips through
  `parseProcedural`.
- `picker.js` (classic content script): picker UI (hover highlight, **ancestor slider** à la AdGuard,
  editable rule box, **live preview via the engine's matcher**, match count). Contains the
  byte-identical inline copy of `picker-core.js` + the inline procedural matcher (reuse
  `adblock-cosmetic.js`'s evaluator — factor the matcher so both share one copy).
- `allowlist.js`: `getUserCosmetics` / `addUserRule(domain, selector)` / `removeUserRule` /
  `listUserRulesForHost`, on the `userCosmetics` key. (Independent of cookie/sensor lists.)
- `background.js`: on `userCosmetics` change, **re-register per-domain plain user CSS** at
  `document_start` (flash-free) and apply via USER-origin `insertCSS` to open matching tabs. Message
  handlers `picker-commit` / `picker-preview-count` if any SW round-trip is needed.
- `adblock-cosmetic.js`: the one-line merge (§5) + read `userCosmetics` for the host.
- Popup: a **"Blokir elemen…"** button + a per-domain **"Aturan saya"** list (chip + remove) in the
  Sites or Protect tab, matching the existing matrix UI.
- Docs: README + CHANGELOG; update `CONTRIBUTING.md` with the new byte-identical pair
  (`picker-core.js` ↔ `picker.js`) and the shared procedural matcher.

### Phase C — Polish (optional) → `1.6.x`
- SVG ocean-islands highlight; `:matches-css` refinement toggle; import/export of user rules;
  "unpicker" (undo last) like uBO Lite; optional block-by-URL via a DNR dynamic rule.

---

## 7. Licensing

- **`@medv/finder`** — MIT. Vendor one file (strip `export`). Safe to ship.
- **`CSS.escape`** — native in Chrome; no dependency.
- **uBlock Origin `epicker.js` / zapper** — **GPLv3**. Reimplement the *ideas* (clickblind toggle,
  ocean-islands, `:nth-of-type` disambiguation, scroll-unlock) — **do not paste the code**.
- **AdGuard Assistant / ExtendedCss / tsurlfilter** — **GPL-3.0**. Reference only; linking relicenses.
  YoshTool's own engine makes them unnecessary.
- **YoshTool's existing procedural engine** — ours; reuse unchanged for preview *and* apply.

---

## 8. Honest expectations

- **Covers the stated case well:** visible judol/ad banners, sticky overlays, text-labeled promo
  blocks, and randomized-class ad slots — via `finder` + `:has-text`/`:matches-attr`/`:upward`.
- **Brief flash** possible on first load before procedural user rules apply (mitigated for plain rules
  by `document_start` registration; unavoidable in general for JS-evaluated rules).
- **Can't** beat SSAI video ads, CNAME-cloaked requests, or rewrite response bodies — same MV3 limits
  as the rest of YoshTool's ad-block (see `docs/hard-to-block-ads-research.md`). The picker is about
  *cosmetic* removal of what's on the page, which is exactly the judol-banner case.
- **Shadow DOM:** `elementFromPoint` returns the host; descending needs `shadowRoot.elementFromPoint`
  recursively (open roots only), and a selector generated inside a shadow root only matches within it
  — the apply step must pierce shadow roots. Defer to Phase C unless a target site needs it.

---

## Sources

- uBO element picker/zapper: `github.com/gorhill/uBlock` `src/js/scriptlets/epicker.js`, `epicker-ui.js`;
  wiki Element-picker & Procedural-cosmetic-filters.
- uBO Lite (MV3 picker/zapper/unpicker): `github.com/uBlockOrigin/uBOL-home`.
- AdGuard Assistant: `github.com/AdguardTeam/AdguardAssistant` (`adguard-rules-constructor.js`,
  `adguard-selector.js`, `slider-widget.js`, controllers); `@adguard/assistant`.
- AdGuard ExtendedCss: `github.com/AdguardTeam/ExtendedCss`; `@adguard/extended-css`.
- AdBlocker Ultimate: `github.com/adblockultimate/adblocker-ultimate-for-browsers` (bundles
  `@adguard/assistant`).
- `@medv/finder`: `github.com/antonmedv/finder` (MIT); jsr.io/@medv/finder.
- Chrome DevTools `cssPath`: `ChromeDevTools/devtools-frontend` `front_end/panels/elements/DOMPath.ts`.
- `CSS.escape`: `github.com/mathiasbynens/CSS.escape`; MDN CSS/escape.
- MV3 content scripts / `document_start` / `storage.get` async race:
  `developer.chrome.com/docs/extensions/develop/concepts/content-scripts`;
  chromium-extensions thread FK-DRPyYI10.
