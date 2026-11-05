# Contributing to YoshTool

A personal Manifest V3 browser extension — **vanilla JavaScript, no build step**. Load it unpacked
(`chrome://extensions` → Developer mode → **Load unpacked** → the repo folder).

## Versioning (semver) — bump on every change

Every change to the **extension** bumps `version` in `manifest.json` **and** adds a `CHANGELOG.md`
entry. Do this **per change** — including fixes made while a feature is still in an open, unmerged
PR. Don't let the version sit still across a run of fixes (e.g. the selection-helper work shipped
one feature + five follow-up fixes but stayed on a single version — that's the mistake this rule
exists to prevent).

- **patch** (`1.12.0 → 1.12.1`) — bug fixes, refinements, revisions, UI tweaks.
- **minor** (`1.12.x → 1.13.0`) — a new tool / feature.
- The version tag in the popup header (`popup.html`) must mirror the manifest version.
- Give **each** bump its own CHANGELOG heading — don't fold several fixes under one version.
- **Docs-only** changes (README, the `docs/` research notes, this file) do **not** bump the version.

## Checks to run before committing

- `node --test ./test/*.test.js` — unit tests for the pure modules.
- `node --check <file>.js` — syntax-check every changed `.js`.
- **Banned strings:** the codebase was scrubbed of two legacy brand strings — the old translation
  vendor and the old workspace name — and must never contain either again, **anywhere**, including
  as a substring inside another word (that bites more often than you'd think). Verify with a
  case-insensitive recursive grep for those two tokens (excluding `.git`); it must return nothing.

## Content-script inline copies must stay identical

Content scripts injected via `chrome.scripting.executeScript({files})` are **classic** scripts —
they can't `import`. When one needs a pure helper, the helper lives in a Node-tested `*-core.js`
module **and** as an inline copy inside the content script. Keep the two **byte-identical** (compare
the function bodies after any edit):

- `popblock-core.js` ↔ inline copy in `popblock-isolated.js`
- `darkmode-core.js` ↔ inline copy in `darkmode.js`
- `adblock-cosmetic-core.js` ↔ inline copy in `adblock-cosmetic.js`

(`translate-core.js` is `import`ed by the background service worker, so it has no inline copy.)

## Permissions

Prefer the on-demand / opt-in model over broad install-time warnings: inject on the active tab with
`activeTab`, or register all-sites content scripts only **after** the user grants `*://*/*` through a
button (the `pendingGrant` + `registerContentScripts` pattern used by the popup blocker, auto-redact,
and the selection helper). The only static host permission is the translation endpoint.

## Git workflow

Branch from `main` → commit → push → open a PR → merge (stack dependent PRs on each other and merge
in order). Keep extension code and docs/research in separate PRs where practical.
