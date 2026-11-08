# Edit page (quick inspect-element) & Show/hide password — research + MV3 plan

Research for two YoshTool features the user asked for before merge:

1. **Edit page / quick inspect-element** — a lightweight in-page tool to edit page content and
   inspect/tweak an element (text, attributes, inline style, remove, duplicate) without opening
   DevTools.
2. **Show/hide password** — add a reveal (eye) toggle to `<input type="password">` on pages that
   don't offer one, like Microsoft Edge's built-in reveal button (which Chrome lacks).

Built on a reading of the actual source of VisBug (`GoogleChromeLabs/ProjectVisBug`), four real
"show password" extensions, the HTML/contenteditable spec, Chrome DevTools docs, and YoshTool's own
code. YoshTool is a **vanilla MV3** extension with **no build step**; injected content scripts are
classic (no `import`) and overlays render inside an open **Shadow DOM** host.

_Compiled 2026-11-08 from two primary-source research passes. Some reference hosts
(`developer.mozilla.org`, `developer.chrome.com`, `learn.microsoft.com`, `caniuse.com`) were
network-blocked during research and were corroborated via search summaries + cloned source; their
canonical URLs are cited for verification._

---

## TL;DR

- **Both are fully feasible in MV3 with ZERO new permissions** (`scripting` + `activeTab` already
  cover the on-demand versions) and slot straight into YoshTool's existing one-shot injection model
  (`zapper.js`/`picker.js`/`fontinspector.js`) and Shadow-DOM overlay pattern.
- **Edit page →** ship a **pick-then-edit** popover (reuse the picker's hover+`elementFromPoint`, the
  fontinspector's pinned card, the zapper's remove): edit text (per-element
  `contenteditable="plaintext-only"`, VisBug-style — *not* global `designMode`), delete, duplicate,
  copy text/selector/outerHTML; plus a secondary "Edit all text" `designMode` toggle. **Ephemeral**
  (lost on reload, like DevTools) — persistent element *removal* already exists via the picker/zapper.
- **Show/hide password →** ship an **on-demand type-swap toggle**: a popup button (and optional
  hotkey/context-menu) injects a one-shot that flips every visible `input[type=password]` →
  `type=text` and back (re-inject toggles), `allFrames:true`, pierces open shadow roots, re-masks on
  submit/pagehide, never logs the value. An "Edge-like" always-on eye button is a clean v2 that reuses
  `selection-helper.js`'s `placeFieldPill()` + `sensor.js`'s observer, behind the all-sites grant.
- Chrome has **no native password reveal** on page fields (only in its saved-password manager UI), so
  this genuinely fills a gap — Edge's `::-ms-reveal` is Edge-only and a site hiding it is a no-op in
  Chrome.

---

## Part 1 — Edit page / quick inspect-element

### 1.1 The two primitives

**`document.designMode = "on"`** makes the *entire document* editable at once (the classic "edit any
page" bookmarklet). Per-`Document` (same-origin iframes need their own), defaults to `"off"`, and in
Chrome page scripts keep running while it's on. **Downsides:** the caret can land anywhere, and links
/ buttons / forms behave oddly because the whole document is an editing host — so it's best as a
quick, clearly-labelled "edit all text" switch, not the primary mode.

**Per-element `contenteditable`** is what VisBug actually uses — it sets `contenteditable` on **one
targeted element** and removes it on blur, leaving the rest of the page's handlers/forms intact. The
under-used value **`contenteditable="plaintext-only"`** lets the user retype text without the browser
injecting `<div>`/`<br>`/`<span style>` soup or pasted rich markup — ideal for "fix a label/typo".
`contenteditable` fires **`input`**, not `change`. `HTMLElement.isContentEditable` is the reliable
read-only test.

**Honest limits of both:** text edits work and really mutate the in-memory DOM, but they're
**structure-blind** (no reparenting/attribute edits through them) and **ephemeral** (gone on reload,
same as DevTools). Structural/attribute edits need direct DOM scripting (below).

### 1.2 Direct-DOM inspect/edit (the real substance), all vanilla

Once an element `el` is picked (reuse the picker's `elementFromPoint`):

| Capability | Vanilla implementation |
|---|---|
| Show tag / id / classes | `el.tagName.toLowerCase()`, `el.id`, `[...el.classList]` |
| Show attributes | iterate `el.attributes` → `{name, value}` |
| Edit text | per-element `contenteditable="plaintext-only"` → focus → commit on blur (or `el.textContent = v`) |
| Edit / add / remove attribute | `el.setAttribute(k,v)` / `el.removeAttribute(k)` |
| Toggle / edit class | `el.classList.toggle(c)` / set `el.className` |
| Edit inline style | `el.setAttribute("style", v)` / `el.style.setProperty(p, v)` |
| Delete | `el.remove()` (reuse `zapper.js` + its `unlockScroll`) |
| Duplicate | `el.parentNode.insertBefore(el.cloneNode(true), el.nextSibling)` |
| Copy text / selector / HTML | `navigator.clipboard.writeText(...)`, reuse `selectorFor(el)`, `el.outerHTML` |
| "Edit as HTML" | `<textarea>` seeded with `el.outerHTML`; apply = `el.outerHTML = value` (try/catch) |

DevTools' "Edit as HTML" is conceptually `el.outerHTML = editedString`; Duplicate/Delete/Hide map 1:1
to the table. All are live in-memory changes that reset on reload.

### 1.3 VisBug (Apache-2.0) — what to borrow

`GoogleChromeLabs/ProjectVisBug` (archived Sep 2026, Apache-2.0) is the gold standard for in-page
visual editing. Its toolbar is one custom element with a **closed** shadow root; feature overlays are
separate elements on `document.body`; it has an `isOffBounds(node)` guard = YoshTool's `inOwnUi()`.
Key patterns to copy (reimplement — don't lift GPL... it's Apache, so attribution-only, but we'll
reimplement the ideas in vanilla anyway):

- **Text edit = per-element `contenteditable`** (not designMode): set `contenteditable` + focus;
  `keydown` **`stopPropagation` for every key except Escape** so typing doesn't trigger tool shortcuts;
  remove editability + `window.getSelection().empty()` on blur/Esc.
- **Delete** = `el.remove()`; **Duplicate** = `cloneNode(true)` + `insertBefore`; **Copy** =
  `outerHTML`; **Inspect tooltip** = computed styles with color swatches, flagging inline overrides
  (richer cousin of `fontinspector.js`).

**Light (adopt):** text edit, inspect, remove, duplicate, copy outerHTML/selector/text, edit
attrs/classes/inline-style, "Edit as HTML". **Heavy (skip for v1):** drag-move, margin/padding
box-model editors, font/color/shadow design tools, guides/measurements, multi-select.

### 1.4 Persistence — v1 is ephemeral (recommended)

Edits vanish on reload, matching DevTools / designMode / VisBug and the user's mental model.
Persisting *content* edits is brittle: selectors drift, SPA re-renders clobber replays, per-URL keys
explode. YoshTool already has the **correct** persistence path for the one case that matters — "hide
this element forever" — via the picker's `userCosmetics` (CSS, robust). So: **remove permanently →
picker/block (persistent)**; **remove once → zapper**; **edit/inspect now → ephemeral Edit-page
tool**. A persistent "pin this edit" could be a clearly-experimental v2.

### 1.5 MV3 feasibility + security

Pure client-side DOM manipulation in a content script injected via `executeScript({files})` — **no new
permissions**, **no CSP concern** (CSP restricts external/inline resources the page loads, not a
content script writing the DOM). It changes **only the local view**, never the server. The obvious
misuse (editing a bank/receipt page for a fake screenshot) is **inherent to the platform** — anyone
can do it with DevTools/F12 or a bookmarklet with no extension; the tool grants no new capability.
Mitigations: it's ephemeral, user-initiated, and we won't add any "export as official-looking
document" affordance. Call it "edit your view of the page," not "edit websites."

### 1.6 Concrete YoshTool v1 plan (Edit page)

New classic content script **`editpage.js`**, injected on demand from a popup button (copy the
`btn-zap` handler), idempotent toggle, rendered in the **open Shadow-DOM host** pattern from
`picker.js`. Reuse verbatim: guard/teardown (`zapper.js`), shadow host + reset style (`picker.js`),
hover-highlight box + bottom toolbar (`zapper.js`), `elementFromPoint` + `inOwnUi` guard, Esc + rAF
scroll reposition, `selectorFor()` (inline copy), remove + `unlockScroll` (`zapper.js`), clipboard
(`fontinspector.js`).

**Flow (pick-then-edit, Model B + a Model A toggle):**
1. Inject → hover-highlight; toolbar: *"Click an element to inspect & edit · Esc to exit"* + a
   secondary *"Edit all text"* button.
2. Click an element → pin a popover (fontinspector card layout) showing `tag#id.class…` and:
   - **Text** (inline-editable → `textContent`, or per-element `contenteditable="plaintext-only"`),
   - **Attributes** list (edit / add / remove),
   - **Inline style** field,
   - Actions: **Copy text / Copy selector / Copy HTML / Duplicate / Delete**.
3. "Edit all text" → `document.designMode="on"` + toolbar switches to *"Editing all text — Done · Esc"*.
4. Esc/Done → teardown: remove host, `designMode="off"`, strip leftover `contenteditable`, clear flag.

**Ship-first v1:** pick → tag/id/classes; edit text (per-element `plaintext-only`); delete;
duplicate; copy text/selector/outerHTML; "Edit all text" designMode toggle.
**Fast-follow (same popover):** edit/add/remove attributes, edit inline style, toggle class, "Edit as
HTML" textarea. **Deferred:** VisBug's heavy visual tools, persistence of content edits.

**State in UI/docs:** edits are your local view only, not saved, gone on reload; SPAs may overwrite
them; only the top document by default (same-origin iframes need per-frame injection); not a DevTools
replacement.

---

## Part 2 — Show/hide password

### 2.1 Why Chrome needs it

Edge's reveal "eye" lives in the input's internal shadow tree and is exposed via the **non-standard,
Edge/IE-only** pseudo-element `::-ms-reveal`; it appears only when the field is focused and has a
value. **Blink (Chrome/Chromium/Firefox/Safari) ship no native reveal** on page password fields —
Chrome's eye icon only exists inside its *saved-password manager* UI, not on arbitrary `<input
type=password>`. Sites suppress Edge's with `input[type=password]::-ms-reveal{display:none}`, which is
a **no-op in Chrome** (nothing to hide). So an extension adding a toggle is filling a real gap, and
the "site removed the reveal" case the user describes is best handled by *offering our own toggle*
rather than trying to detect the site's (there's no reliable DOM signal for a site's own toggle).

### 2.2 Technique: type-swap vs injected eye

Four real extensions were source-read. The robust core in all of them is **type-swap**: toggle
`input.type` between `"password"` and `"text"`.

- **Type-swap** is simple and SPA-safe: `.type` is a DOM property React doesn't control via `value`,
  so a manual flip persists until the component remounts; a `type=text` field still **submits its
  value** fine. Downsides: password managers/frameworks may react; screen readers read a `type=text`
  value aloud (mitigate by re-masking on submit).
- **Injected eye button**: add a small toggle near each field. Best done as an **absolutely/fixed
  overlay that never reparents the field** — one extension (`viewpass`) wraps/reparents the input,
  which breaks React and layout; avoid that. Positioning must survive scroll/resize and dodge
  password-manager icons (Bitwarden/1Password inject at the right edge — YoshTool already solved this
  with `selection-helper.js`'s `placeFieldPill()`, which sits *outside* the field top-right).

**Recommendation:** type-swap is the reveal mechanism in both modes; the eye overlay (v2) is just a
trigger that never touches the field's DOM.

### 2.3 Finding fields (incl. hard cases)

`document.querySelectorAll('input[type=password]')` for the baseline; **MutationObserver** (reuse
`sensor.js`'s debounced + disconnect-during-write + settle-scan `[400,900,1800,3000,5000,8000]ms` +
`focusout` pattern) for dynamic/async fields; **recurse open `shadowRoot`s**; **`allFrames:true`** for
iframes (each frame scans its own doc). **Closed shadow roots** need a MAIN-world `attachShadow` hook
— out of scope for v1 (document as a limitation). Skip hidden/zero-size fields; don't toggle
`type=text` "semantic password" fields (nothing to unmask).

### 2.4 Security defaults

Reveal is a **local view change** — no network, no storage, **never log/store `input.value`**.
Default hidden; reveal only on explicit action; **re-mask on `submit` (capture) and `pagehide`**
(a `type=text` password is read aloud by screen readers and shifts autocomplete/save heuristics — the
GOV.UK Design System documents both). Use a `type="button"` for any injected control (can't submit),
and announce "shown/hidden" via a visually-hidden `aria-live` region **without** the password text.
Optional auto-remask timer (5s) like one of the studied extensions.

### 2.5 Concrete YoshTool v1 plan (Show/hide password)

**Mode A — on-demand type-swap (recommended v1). No new permissions.** New classic content script
**`password-reveal.js`**, injected from a popup button (and optionally a `commands` hotkey +
`contextMenus` item with `contexts:["editable"]`) via
`executeScript({target:{tabId, allFrames:true}, files:["password-reveal.js"]})` on `activeTab`:

1. Guard `window.__yoshtoolPwReveal`; **second injection toggles back** (reveal ↔ mask), like
   `zapper.js`.
2. `deepScan(document)` recursing into open shadow roots; collect **visible** `input[type=password]`.
3. Reveal: mark each with `dataset.yoshtoolPwReveal="1"` and set `type="text"`. Mask: restore
   `type="password"`, clear the marker.
4. Re-mask on `submit` (capture) + `pagehide`; never read/log `.value`; small toast via `toast.js`
   ("Passwords shown — click again to hide").

```js
(() => {
  const MARK = "yoshtoolPwReveal";
  if (window.__yoshtoolPwReveal) { window.__yoshtoolPwReveal.toggle(); return; }
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1 && el.offsetParent !== null; };
  function fields(root, out = []) {
    root.querySelectorAll("input[type=password]").forEach((f) => { if (visible(f)) out.push(f); });
    root.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) fields(el.shadowRoot, out); });
    return out;
  }
  let shown = false;
  const reveal = () => { fields(document).forEach((f) => { f.dataset[MARK] = "1"; f.type = "text"; }); shown = true; };
  const mask = () => { document.querySelectorAll("input[data-yoshtool-pw-reveal]").forEach((f) => { f.type = "password"; delete f.dataset[MARK]; }); shown = false; };
  const onLeave = () => { if (shown) mask(); };
  document.addEventListener("submit", onLeave, true);
  window.addEventListener("pagehide", onLeave, true);
  window.__yoshtoolPwReveal = { toggle() { shown ? mask() : reveal(); } };
  reveal();
})();
```

Popup wiring mirrors the Zap button (`btn-reveal-pw` → `executeScript` on `activeTab`).

**Mode B — always-on Edge-like eye (optional v2).** Behind a `pwRevealEnabled` toggle + the all-sites
grant: a registered content script (copy `syncSelectionHelper` in `background.js`) that puts a
**Shadow-DOM-hosted eye button** next to each visible field, positioned with `placeFieldPill()`
(outside, top-right; clears PM icons), kept fresh via the `sensor.js` observer + rAF scroll/resize
reposition, deduped with the dataset marker, **never reparenting the field**. Default hidden; reveal
on click; re-mask on blur/submit.

**Honest limits:** closed shadow roots / cross-origin frames are out of reach (would need a MAIN-world
hook); some SPAs remount fields (on-demand mode is immune — just re-click); always-on mode may show a
second eye on the few sites with a native toggle (no reliable detection); screen-reader exposure while
revealed is inherent to type-swap (mitigated by submit/pagehide re-mask + aria-live).

---

## Recommended build order

1. **Password reveal (Mode A)** — smallest, zero new permissions, directly answers the user's need;
   ~1 small content script + 1 popup button.
2. **Edit page v1 (pick-then-edit)** — reuses the most existing code (picker + fontinspector + zapper
   + shadow host); ship text-edit/delete/duplicate/copy + "Edit all text" first.
3. Fast-follows: Edit-page attribute/style/class editing + "Edit as HTML"; password-reveal Mode B
   (always-on eye).

Both are vanilla, no-build, no new permissions, and consistent with YoshTool's established overlay +
one-shot-injection conventions.

---

## Sources

- VisBug (Apache-2.0): `github.com/GoogleChromeLabs/ProjectVisBug` — `app/features/{text,selectable,metatip}.js`,
  `app/components/vis-bug/vis-bug.element.js`, `app/utilities/common.js`.
- contenteditable / designMode: `w3.org/TR/content-editable/`; MDN `Document/designMode`,
  `HTMLElement/contentEditable` (canonical; network-blocked in session).
- DevTools DOM editing: `developer.chrome.com/docs/devtools/dom/` (canonical);
  Chromium feature spec "Edit HTML in Elements tree".
- `::-ms-reveal` (Edge/IE-only, non-standard): MDN `Web/CSS/::-ms-reveal`;
  `learn.microsoft.com/.../web-platform/password-reveal` (network-blocked; via search).
- Show-password extensions (source read via raw.githubusercontent.com): `tdenottelander/ShowPassword-ChromeExtension`,
  `AppifyDevs/viewpass`, `qoomon/chrome-show-password-extension`, `karannakra2/show-password-extension`.
- Show/hide a11y + submit re-mask: GOV.UK Design System "Simple things are complicated: making a show
  password option" (`technology.blog.gov.uk`, 2021; via search).
- YoshTool patterns reused: `picker.js` (pick + `selectorFor` + shadow host), `zapper.js` (remove +
  teardown), `fontinspector.js` (pinned card + clipboard), `selection-helper.js` (`placeFieldPill`,
  rAF reposition, `contextAlive`, `inOwnUi`), `sensor.js` (debounced observer + settle scans),
  `background.js` (`syncSelectionHelper`/`syncSensorContentScripts`).
