# Clipboard manager & file drag-to-upload — research + desktop-port plan

Status: **research only** (not built into the extension). Captured as the plan for a future
**desktop companion** that can reach OS APIs the browser sandbox forbids.

## 1. What we want

- A **clipboard manager**: history of what you copied (text, images, and ideally **files**).
- **Drag files onto a web page to upload** them — including files you **copied in the OS file
  manager** (Explorer / Finder / Nautilus), not just files dragged from the desktop.

## 2. What a pure MV3 extension can and can't do (findings)

### Clipboard
- **Text & images: yes.** `navigator.clipboard.readText()` / `read()` (Async Clipboard API) can read
  text and images in a secure context, with a user gesture + permission. Copy/paste **events on a
  page** (`copy`, `paste`) are observable by a content script.
- **Files copied in the OS file manager: NO.** The clipboard API only exposes text and a small set of
  web MIME types (mostly `text/*` and `image/png`). When you "Copy" a file in Explorer/Finder the OS
  puts a *file reference* on the clipboard (Windows `CF_HDROP`, macOS `NSFilenamesPboardType` / file
  URLs). The browser **does not surface these to web/extension code**. Hard limit.
- **OS-wide clipboard history: NO.** An extension sees clipboard activity only inside the pages it
  runs on, and only on explicit copy/paste/read. It cannot mirror the OS clipboard or Win+V.

### Drag-to-upload
- **From an on-page tray: yes (partial).** A content-script element can be a drag **source**: on
  `dragstart` you attach a real `File` to `event.dataTransfer` (`DataTransfer.items.add(file)`).
  Dropping it onto a site's **drag-and-drop dropzone** (a site that reads `dataTransfer.files`) works
  and uploads the file.
- **Onto a click-only `<input type="file">`: NO.** A file input's `.files` is read-only for security;
  script can't set it, and a synthetic drop onto a bare `<input>` doesn't populate it. Only works
  where the site wires an actual drop target.
- The tray can only hold files the extension already has (dragged in from the desktop, pasted as an
  image, or a YoshTool screenshot) — **not** OS-clipboard files (see above).
- The drag source must be **on the page** (content script / Shadow DOM), not the popup — the popup is
  a separate window and can't drag onto a page.

### Storage
- Files can be held in the extension's **IndexedDB** (per browser profile). Fine for a session shelf;
  mind the size (don't hoard large files).

### Summary

| Capability | Pure MV3 extension |
|---|---|
| Read copied **text/images** | ✅ (gesture + permission) |
| Read **files copied in the OS file manager** | ❌ not exposed to the browser |
| Global OS clipboard **history** (Win+V style) | ❌ out of sandbox |
| On-page **file tray** (drag in / paste image / stash screenshot) | ✅ |
| Drag tray file **onto a web dropzone** to upload | ✅ (dropzones only) |
| Drag onto a click-only `<input type=file>` | ❌ can't set `.files` |
| Inject a file into the browser's **native file-picker dialog** | ❌ out of sandbox |

**Conclusion:** a browser-only version can offer a *file tray* (drag-in → drag-out to dropzones) and a
*text/image copy history*, but **cannot** read OS-copied files, watch the OS clipboard, or feed native
file dialogs. The headline ask — "copy a file, then drag it onto any page to upload" — needs OS access.

## 3. Why it needs a desktop component

Everything in the ❌ column requires talking to the operating system:

- Read/write **files on the clipboard** → Win32 clipboard (`CF_HDROP`), macOS `NSPasteboard` file
  URLs, Linux X11/Wayland clipboard + `text/uri-list`.
- **Global clipboard history** → an OS clipboard listener / polling + a store + a hotkey + a tray UI.
- A **real OS drag with files** that can drop onto *anything* (web dropzone **or** native file input
  **or** another app) → OS drag-and-drop source (Windows OLE `IDataObject`/`DoDragDrop`, macOS
  `NSDraggingSource`, Linux DnD). A real OS drag is what lets you drop a file into a `<input type=file>`
  the browser treats as a genuine user drop.

## 4. Port options (smallest → fullest)

### Option 1 — Native Messaging host (keep the extension, add a native helper)
- Extension ↔ a small native binary (Node / Go / Rust) via `chrome.runtime.connectNative`.
- The helper reads the OS clipboard (incl. file paths) and maintains history; the extension shows it
  and offers files in the on-page tray for drag-to-upload.
- **Permission:** `nativeMessaging`; the host manifest must be registered per-OS (manual install).
- **Still can't:** real OS drag-out (the drag source is still the web page, so still dropzones-only),
  nor feed native file dialogs. Gives you clipboard *reading* + history, not full drag parity.
- **Effort:** medium. Shares the same "native helper" shape as the **ICMP ping** idea (see below) —
  one helper could serve both.

### Option 2 — Full desktop app (Tauri or Electron) + companion extension — RECOMMENDED for the full ask
- The **desktop app** owns the clipboard manager: full OS clipboard incl. files, global history,
  global hotkey, system-tray / floating window, settings.
- It is also a **real OS drag source**: drag a file from the app's floating window and drop it onto a
  browser page — because it's a genuine OS drag, it works on web dropzones **and** native file inputs
  **and** other apps. This is the only path that fully delivers "copy/stash a file → drag onto any
  page to upload."
- Bridges to the browser (optional, for in-page affordances) via native messaging or a localhost
  WebSocket to a thin companion extension.
- **Tauri (Rust)** is the lean choice for a small clipboard utility (tiny binary, uses the OS
  webview); **Electron** is heavier but simpler if the team already knows web stack.
- **Effort:** large (a new app + packaging/signing per OS + auto-update).

### Option 3 — Companion app, no browser integration
- Just a standalone clipboard/file manager (like Ditto/CopyQ/Maccy) with global drag-out. The browser
  isn't involved at all; you drag from the app onto the page. Simplest mental model; loses the
  in-page YoshTool tray/UX.

## 5. Recommended phasing

1. **Phase 0 (done — this doc):** record the browser limits and the desktop rationale.
2. **Phase 1 — native helper (Option 1):** ship a native-messaging host that exposes OS clipboard
   read + history to the existing extension; add the on-page file tray (drag-in / paste-image /
   stash-screenshot → drag onto web dropzones). Reuse the same helper for **ICMP ping**.
3. **Phase 2 — desktop app (Option 2):** if real OS drag-out / native-input upload is wanted, build a
   Tauri app that is a true OS drag source + global clipboard history, bridged to the extension.

## 6. OS APIs by platform (for Phase 1/2 implementers)

| Need | Windows | macOS | Linux |
|---|---|---|---|
| Clipboard files | `CF_HDROP` via Win32 clipboard | `NSPasteboard` file URLs | X11/Wayland + `text/uri-list` |
| Clipboard text/image | Win32 clipboard | `NSPasteboard` | X11/Wayland |
| Clipboard-change events | `AddClipboardFormatListener` | `NSPasteboard.changeCount` poll | X11 selection owner / Wayland |
| OS drag source w/ files | OLE `IDataObject` + `DoDragDrop` | `NSDraggingSource` | XDND / Wayland DnD |
| Global hotkey + tray | `RegisterHotKey` + shell tray | `NSStatusItem` + global monitor | DE-dependent |

Rust crates that cover much of this: `arboard` (clipboard text/image, some file support), `clipboard-*`
for file lists, Tauri's drag-drop + tray APIs. Node options: `clipboard-event`, `electron` clipboard
(text/image only — files need native addons).

## 7. How existing clipboard managers work (why they're native)

Ditto (Windows), CopyQ (cross-platform, Qt), Maccy / Paste (macOS), and Windows Win+V are all **native
apps** with an OS clipboard hook, a local DB of history, a global hotkey, and (for the ones that do
drag-out) a native drag source. None of this is reachable from a browser extension — which is exactly
why the file/clipboard ask belongs in a desktop companion.

## 8. Relationship to the ICMP-ping idea

The **ICMP ping** feature has the same shape: impossible in a pure extension (no raw sockets), solvable
with a **native messaging host** that runs the OS `ping`. If we build a native helper, design it as a
**shared YoshTool companion** that can serve multiple OS-bound features (ICMP ping, clipboard/file
access) behind one install, rather than a one-off per feature.

## 9. Open questions

- Install friction: native host registration is manual per-OS; a desktop app needs code-signing +
  notarization (macOS) / SmartScreen (Windows). Acceptable for a personal tool?
- Scope of clipboard history (retention, size caps, encryption of sensitive clips — reuse the
  Sessions `sessioncrypto` approach?).
- Security: a native helper is powerful (local execution); keep its message surface tiny and
  allow-listed to the extension ID.
