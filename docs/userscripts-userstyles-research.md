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
- **Tampermonkey / Violentmonkey**: a **userscript** manager — see §2a for Tampermonkey in detail.

### 2a. Tampermonkey, concretely (the reference the user named)

Tampermonkey (tampermonkey.net; Chrome Web Store id `dhdgffkkebhmkfjojejmpbldmpobfkfo`) is the dominant
userscript manager. Its MV3 build runs user JS through Chrome's **`chrome.userScripts`** API and, like
all MV3 userscript managers, requires the user to **enable user scripts** (Developer Mode / the "Allow
user scripts" toggle) — the same gate a YoshTool version would sit behind. Its model:

- **Metadata block** (`// ==UserScript== … // ==/UserScript==`) headers, the important ones:
  - `@name @namespace @version @description @author @icon`
  - `@match` / `@include` / `@exclude` — where it runs (URL match patterns / globs).
  - `@run-at` — `document-start` | `document-end` | `document-idle` (and TM extras like
    `document-body`, `context-menu`).
  - `@grant` — which `GM_*` APIs the script may use (`none` = run in the page world with no GM API).
  - `@inject-into` — `page` | `content` | `auto` (which world the script runs in).
  - `@require` — load an external JS library before the script; `@resource` — named bundled resource.
  - `@connect` — cross-origin hosts `GM_xmlhttpRequest` may reach; `@noframes` — top frame only.
  - `@updateURL` / `@downloadURL` — remote auto-update of the script (runs changing remote code).
- **GM API** (`GM_*` legacy + promise-based `GM.*`): `GM_addStyle`, `GM_setValue`/`GM_getValue`/
  `GM_deleteValue`/`GM_listValues` (+ `GM_addValueChangeListener`), `GM_xmlhttpRequest`
  (cross-origin), `GM_getResourceText`/`GM_getResourceURL`, `GM_registerMenuCommand`,
  `GM_notification`, `GM_setClipboard`, `GM_openInTab`, `GM_download`, `GM_info`, `unsafeWindow`.
- **Dashboard**: a code editor (syntax highlight, metadata validation), per-script enable/disable,
  import/export, cloud **sync**, and **update checks** against `@updateURL`/`@downloadURL`.

**What a YoshTool-lite would adopt vs skip:**

| Tampermonkey | YoshTool-lite |
|---|---|
| `chrome.userScripts` + user-scripts gate | **adopt** (the only MV3-sanctioned way) |
| `@match`/`@run-at`/`@grant`/`@inject-into` | **adopt** (map to `userScripts.register`) |
| `GM_addStyle`, `GM_setValue/getValue/deleteValue` | **adopt** (→ `chrome.storage`) |
| `GM_xmlhttpRequest` (+ `@connect`) | **adopt, minimal** (→ background `fetch`) |
| `GM_registerMenuCommand` | adopt (→ context menu) — stretch |
| `@require` / `@resource` from a CDN | **skip** (fetches remote code) |
| `@updateURL`/`@downloadURL` auto-update | **skip** (silently runs changing remote code) |
| cloud sync, full `GM_*` surface, marketplace | **skip** |

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

## 8. References

- Tampermonkey — https://www.tampermonkey.net/ and Chrome Web Store
  (`https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo`) — the
  userscript manager this feature is modelled on (metadata block, `GM_*` API, dashboard).
- Violentmonkey — an open-source userscript manager (useful to read for an MIT-licensed `GM_*`
  implementation and MV3 `chrome.userScripts` usage).
- Stylus / "Custom Style Script" — per-site **CSS** managers (the userstyle half, Phase 1).
- `chrome.userScripts` API (MV3) — Chrome for Developers docs; the sanctioned way to run user JS.
