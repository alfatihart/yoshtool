# Research: Re-enabling copy / selection / right-click on sites that block them — and fitting it into YoshTool

How websites block text selection and copy-paste, how the "enable copy" extension class defeats
that, and how such a feature would fit **YoshTool** (personal MV3 extension, vanilla JS, no build
step, on-demand injected overlays). Prompted by a page whose preview was "protected from
copy-paste" — the exact case this feature targets.

> Method note: this is a **lighter-weight** research than the prior docs (targeted web searches +
> one reference extension read verbatim from source), not the full 100-agent adversarial harness —
> the topic is narrow and well-trodden. Mechanism marked **(source-confirmed)** was read from the
> extension's own code. If you want the heavy verified treatment, it can be re-run via
> `/deep-research`.

---

## 1. How sites block copy / selection / right-click (the threat model)

All of these are **client-side and weak** — the content is already in the DOM; blocking only
inconveniences honest users. The common techniques:

1. **CSS** — `user-select: none` (+ `-webkit-/-moz-/-ms-` prefixes) on `body`/elements, and
   `-webkit-touch-callout: none` on mobile. Sometimes `::selection { background: transparent }`
   (selection still works, it's just invisible).
2. **Event handlers that cancel the action** — `oncontextmenu`, `oncopy`, `oncut`, `onpaste`,
   `onselectstart`, `ondragstart`, `onmousedown` set to `return false` / `preventDefault()`, on
   `document`/`body` or per element.
3. **Keyboard blocking** — `onkeydown` that cancels Ctrl/⌘+C, +A, +X, +S, and F12/DevTools combos.
4. **JS that clears the selection** — a `selectionchange` handler calling
   `getSelection().removeAllRanges()`.
5. **Invisible overlay** — a transparent `div` layered over the text to swallow the pointer.
6. **Scare dialogs** — `alert("Copying is disabled")` on copy/right-click.
7. **The hard one: no selectable text at all** — text rendered as **images / `<canvas>` / SVG**, or
   background-image. There is nothing to select; only OCR recovers it.

Sources agree these are trivially bypassed (disable JS, DevTools, reader mode, screenshot) and
hurt UX; they "only stop honest users."

## 2. How "enable copy" extensions defeat it

The reference class: **Absolute Enable Right Click & Copy**, **CopyUnlock**, **Enable Copy**,
**Don't F\*\*\* With Paste** (paste-in-fields specifically). The toolkit:

- **Force selection via CSS** — inject `* { user-select: text !important; -webkit-user-select: text !important; }`
  (+ `-webkit-touch-callout: default`) to override the site's `user-select: none`.
- **Neutralise the blocking events — the key trick (source-confirmed).** Don't F\*\*\* With Paste's
  entire content script is a **capture-phase `stopImmediatePropagation`** on `document`:
  ```js
  const forceBrowserDefault = (e) => { e.stopImmediatePropagation(); return true; };
  document.addEventListener('copy',  forceBrowserDefault, true);   // true = CAPTURE
  document.addEventListener('cut',   forceBrowserDefault, true);
  document.addEventListener('paste', forceBrowserDefault, true);
  ```
  The subtlety: it calls **`stopImmediatePropagation()`, NOT `preventDefault()`**. By stopping the
  event in the capture phase on `document`, the site's own listener (the one that *would* call
  `preventDefault()`) never runs — so the **browser's default** copy/cut/paste proceeds normally.
  The same one-liner as a bookmarklet works too. A broader "unlock everything" build extends the
  same pattern to `contextmenu`, `selectstart`, `dragstart`, and clipboard-shortcut `keydown`.
- **Null the inline handlers** — belt-and-suspenders: `document.oncontextmenu = document.oncopy =
  document.onselectstart = null` (and on `body`).
- **Aggressive "Absolute Mode"** — patch `EventTarget.prototype.addEventListener` to drop
  registration of the blocked event types, and/or patch `Event.prototype.preventDefault`. Most
  powerful, most likely to break sites — and requires running **before the page's scripts**.

## 3. The MV3 world / timing question (what actually needs MAIN world)

This is where it differs from YoshTool's harder research items (dark-mode FOUC, subtitle
interception) — **the common case does NOT need the main world or `document_start`.**

- **Isolated world, `document_idle` is enough for most sites (source-confirmed).** Don't F\*\*\* With
  Paste runs in the **default isolated world** at the **default `document_idle`**, statically
  registered, permissions just `storage`/`tabs` — and it works. A capture-phase listener added to
  `document` *later* than the page still pre-empts the page's handlers, because document-capture
  fires early in the event path (before the target/bubble handlers most protections use).
- **The ordering caveat (honest limit).** Same-phase listeners fire in registration order, so a
  site that registered its **own capture-phase listener on `document` (or on `window`) at
  `document_start`** fires *before* a later-added isolated-world listener and can `stop`/`preventDefault`
  first. Defeating *those* needs a **MAIN-world script at `document_start`** (to register earlier)
  or the `addEventListener` patch — the recurring "MAIN world + document_start" theme, here only for
  the stubborn minority.
- **Image/canvas text** is unreachable by any of this → OCR territory (see the translator research;
  out of scope for v1).

## 4. Fit into YoshTool — ★ strongest, lowest-effort fit of the researched features

A near-perfect match for YoshTool's on-demand injection model, and uniquely, the **core needs no
new permission, no MAIN world, and no `document_start`.**

**Design sketch (v1 — isolated world, on demand):**
1. Trigger: a popup button **"Unlock copy & selection"** and/or a **right-click context-menu item**
   (YoshTool already has `contextMenus`) → `executeScript({files:["copyunlock.js"]})` on the active
   tab. Classic script, no imports — fits the no-build rule.
2. `copyunlock.js` (isolated world, ~40 lines):
   - Inject a `<style>` forcing `user-select: text !important` (+ prefixes, `-webkit-touch-callout`,
     and a visible `::selection`) — reuse the namespaced-overlay CSS pattern.
   - Add **capture-phase `stopImmediatePropagation`** listeners on `document` for `copy`, `cut`,
     `paste`, `contextmenu`, `selectstart`, `dragstart`, and a `keydown` filter that only releases
     clipboard/select shortcuts (don't blanket-stop keydown — that breaks the page).
   - Null `document`/`body` inline `on*` handlers for those events.
   - A re-run guard + teardown (same pattern as `redact-overlay.js`/`fontinspector.js`), and a
     **toast** "Copy & selection unlocked."
3. Optional **"Force mode" hardening** for stubborn sites: a MAIN-world `document_start` script
   (via `executeScript world:'MAIN'` or `registerContentScripts`) that patches
   `EventTarget.prototype.addEventListener` to drop the blocked event types before page scripts run.
   Ship it off by default with an honest "may break some sites" label — mirrors the popup-blocker's
   MAIN/ISOLATED split YoshTool already has.

**Bonus sub-feature:** re-enable **paste in input/password fields** (banks that block paste) — the
same capture-phase trick on `paste`, scoped to focused fields.

**Why it fits so well:** it's literally YoshTool's existing on-demand-overlay + toast pattern with
a tiny event handler; no server, no new permission, no build step, and the common case avoids the
timing problems that make dark mode and subtitles hard. Effort: **low** (~40 lines + a context-menu
entry + optional MAIN-world hardening).

## 5. Limitations (state them honestly in the UI)
- **Image/canvas/SVG-rendered text can't be selected** — nothing to copy; needs OCR (future, ties to
  the translator research's tesseract.js).
- **Keyboard-shortcut and `contextmenu` interference** aren't fully covered by the minimal `copy/cut/
  paste` version (the reference extension says so explicitly) — the fuller event list above closes
  most of that, but a site that registers capture-phase handlers at `document_start` still wins until
  "Force mode" (MAIN world) is used.
- **Over-broad unlocking can break sites** (drag-and-drop UIs, editors, games) — hence per-tab,
  on-demand, with a teardown, rather than always-on.
- **Ethics/ToS:** copying content you legitimately have access to is generally fine; paywalled or
  licensed content may breach a site's terms — worth a one-line disclaimer.

## 6. Recommendation & where it ranks

**Build it — it's the cheapest, most on-brand of all the recently-researched features.** Ship the
isolated-world v1 (CSS override + capture-phase `stopImmediatePropagation` + inline-handler nulling,
triggered from the popup and a right-click menu item), with an optional off-by-default MAIN-world
"Force mode" for stubborn sites. It reuses YoshTool's injection, context-menu, and toast
infrastructure, needs no new permission, and has no server or build step.

Updated priority across the open research items:
1. **Copy/select unlock** — lowest effort, best fit (this doc).
2. Google Maps review-photo downloader (client-side, `=s0`).
3. Hover-translate tooltip.
4. Dark-mode Filter toggle.
5. (stretch) CDP device mode / dual subtitles / social downloader.

---

_Sources: [Absolute Enable Right Click & Copy](https://chromewebstore.google.com/detail/okaeekdeohehbdanbbohcfhhlblcmjkm),
[CopyUnlock](https://chromewebstore.google.com/detail/copyunlock/jckbfcbokilhjbagbfgappckiobkaogl),
[Enable Copy](https://chrome.google.com/webstore/detail/enable-copy/imblndhbdddibjabnddopiehagbkipkj),
[jswanner/DontFuckWithPaste (source read verbatim — capture-phase `stopImmediatePropagation`, isolated world, document_idle, MV3)](https://github.com/jswanner/DontFuckWithPaste),
[besthub.dev — bypassing copy-paste restrictions](https://www.besthub.dev/articles/preventing-and-bypassing-web-copy-paste-restrictions-css-javascript-techniques-7f0bf1cf6df3),
[techiedelight — disabling selection/cut/copy/right-click](https://techiedelight.com/disabling-text-selection-cut-copy-right-click/),
[w3docs — disable selection/copy/paste/right-click](https://www.w3docs.com/snippets/javascript/how-to-disable-text-selection-copy-cut-paste-and-right-click-on-a-web-page),
[scrappey — why content scripts can't hook page JS (isolated world)](https://scrappey.com/qa/reverse-engineering/why-content-scripts-cant-hook-page-javascript).
Targeted research (searches + one source read in full), not the full adversarial harness._
