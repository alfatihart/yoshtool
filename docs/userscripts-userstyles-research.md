# Site tweaks — custom CSS & JS per site (userstyles / userscripts) — research

Status: **research only** (not built). How YoshTool could offer persistent per-site **custom CSS** and
**custom JS**, like *Custom Style Script* / *Stylus* (CSS) and *Tampermonkey* / *Violentmonkey* (JS).

## 1. Motivating case

Editing the ChatGPT **project-instructions** textarea with YoshTool's **Inspect & edit** (e.g. changing
`rows`) doesn't stick: ChatGPT is a **React** app, the textarea is a *controlled component*, and
Inspect & edit is **local-view-only** (resets on reload / re-render). So a React re-render or reopening
the modal reverts it. The user wants a tweak that **persists across reloads** — i.e. injected on every
page load, not a one-off DOM edit.

For that specific case, a taller box is pure **CSS** and needs no JS:

```css
textarea[name="project-instructions"] { min-height: 320px !important; }
```

## 2. What the reference tools do

- **Custom Style Script / Stylus**: a per-site **CSS** manager — you write CSS, scoped by URL/domain,
  injected on every matching page. Simple, robust.
- **Tampermonkey / Violentmonkey**: a **userscript** manager — user-authored **JS** with a metadata
  block (`// ==UserScript== … ==/UserScript==`): `@match`/`@include` (where it runs), `@run-at`
  (document-start/idle/end), `@grant` (which `GM_*` APIs it may use), `@require` (load a library),
  `@resource`. It runs the JS in the page and exposes a `GM_*` API: `GM_addStyle`, `GM_setValue` /
  `GM_getValue` (persistent storage), `GM_xmlhttpRequest` (cross-origin fetch), `GM_registerMenuCommand`,
  `GM_notification`, etc. Plus a dashboard/editor, enable/disable, import/export, and (Tampermonkey)
  remote auto-update via `@updateURL`.

## 3. MV3 feasibility

### Custom CSS (userstyles) — easy & robust
- Persist CSS per site in `chrome.storage`; inject on every load. Best: `chrome.scripting.registerContentScripts([{ id, css:[…], matches, runAt:"document_start" }])` so it applies **before paint** (no flash of unstyled content).
- **No special permission** beyond the host permission YoshTool already requests per site. Reuses the
  element-blocker's CSS-injection pattern, the per-site model, and dynamic script registration.

### Custom JS (userscripts) — doable, but gated
- MV3 **forbids running arbitrary code strings** in the extension's own context (`eval`/`new Function`
  are CSP-blocked), and injecting an inline `<script>` is **blocked by strict site CSP** (ChatGPT's
  CSP would block it). The sanctioned path is the **`chrome.userScripts` API** (Chrome **120+**),
  which is built exactly for userscript managers:
  - Needs the **`"userScripts"`** manifest permission.
  - Needs the **user to allow user scripts** — a per-extension toggle "Allow user scripts" on the
    extension's details page (Chrome ~138+), or **Developer Mode** on in earlier versions. This is a
    deliberate safety gate (user JS = arbitrary code). *(Exact gating varies by Chrome version /
    Chromium fork — confirm at implementation time.)*
  - `chrome.userScripts.register([{ id, matches, js:[{ code }|{ file }], world, runAt }])` — the one
    place MV3 lets you run **user-provided code strings**, in the `USER_SCRIPT` world (isolated, with a
    CSP you set via `userScripts.configureWorld({ csp })`) or `MAIN`. It runs **even on CSP-strict
    sites**, which is the whole point.
- **`GM_*` API**: a YoshTool-lite would ship a **subset**, bridged to the background: `GM_addStyle`
  (inject CSS), `GM_setValue`/`GM_getValue`/`GM_deleteValue` (→ `chrome.storage`), `GM_xmlhttpRequest`
  (→ background `fetch`, to bypass page CORS), `GM_log`, maybe `GM_registerMenuCommand` (→ context
  menu). Full Tampermonkey GM compatibility is huge — document the subset, don't promise parity.
- **Metadata block**: parse `@match`/`@include` → userScripts `matches`/`includeGlobs`; `@run-at` →
  `runAt`; `@grant` → which GM APIs to expose.

## 4. Architecture sketch in YoshTool

- A **"Site tweaks"** manager (a tab/section in the popup or an options page): create per-site **CSS**
  snippets and **JS** userscripts, each with a match pattern (default: the current host). Stored in
  `chrome.storage`.
- **Background** registers them on install / change:
  - CSS → `chrome.scripting.registerContentScripts({ css, runAt:"document_start" })`.
  - JS → `chrome.userScripts.register({ js:[{ code }], world:"USER_SCRIPT", runAt })` (only when the
    user has allowed user scripts; otherwise show how to enable it).
- **Reuse**: Inspect & edit's **"Copy selector"** to target elements for a tweak; the element-blocker's
  CSS injection; the per-site allowlist/permission model; the dynamic-registration machinery
  (`syncRail`/`syncSelectionHelper`-style).
- A minimal **GM bridge** content module for the `USER_SCRIPT` world.

## 5. Constraints & risks (document in the UI)

- **Security**: running arbitrary JS is powerful and dangerous. The user opts in via Chrome's gate, and
  the UI must warn — especially about **pasting third-party userscripts** (that's running untrusted
  code). Keep the GM surface small and explicit.
- **Availability**: `chrome.userScripts` is Chrome **120+**; the enable mechanism (toggle vs Developer
  Mode) changed across versions and may differ on Edge/Brave/etc. CSS has no such gate.
- **No remote code for the extension itself**: userscripts are **locally stored** (user-authored or
  pasted). Tampermonkey's `@updateURL`/`@require`-from-CDN auto-fetches remote code; for YoshTool,
  auto-updating from a URL is a policy call — probably **skip** (or make it an explicit, per-script opt
  in) to avoid silently running changing remote code.
- **FOUC**: inject CSS at `document_start`.
- **Not a full Tampermonkey**: no complete `GM_*` surface, no sync, no CDN `@require`, no script
  marketplace. Position it as "persistent per-site CSS + small userscripts", not a TM replacement.

## 6. Phasing

1. **Phase 1 — Custom CSS per site.** Editor + per-domain list + `document_start` injection. Robust,
   no new permission, and it already solves the motivating case (a taller instructions box). Ship first.
2. **Phase 2 — Custom JS via `chrome.userScripts`.** `userScripts` permission + the "allow user scripts"
   onboarding, `USER_SCRIPT` world, metadata-block parsing, and a minimal `GM_*` subset
   (`GM_addStyle`, `GM_setValue/getValue`, `GM_xmlhttpRequest`).
3. **Phase 3 (stretch)** — match-pattern UI, per-tweak enable/disable, import/export, menu commands.

## 7. Relationship to existing features

Builds directly on **Inspect & edit** (Copy selector), the **element blocker** (CSS injection), the
**per-site model** (allowlist/sensor), and the **dynamic content-script registration** YoshTool already
uses for the rail / selection helper / popup blocker. Phase 1 is a natural, low-risk extension of what's
already here; Phase 2 adds the one genuinely new capability (sanctioned arbitrary JS) behind Chrome's
own safety gate.
