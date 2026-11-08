# Desktop auto-redaction — screenshot tool + live screen-share redaction (research + plan)

The strongest reason to take YoshTool to the desktop: the extension's auto-redact only works **inside
the browser**, but when you share your whole screen in Zoom everything leaks. Two desktop features
address that:

1. **Screenshot capture + auto-redact** — a Lightshot/ShareX-class tool that **automatically** covers
   sensitive data on the captured image (no manual scribbling), reusing YoshTool's existing `redact.js`.
2. **Live screen-share auto-redact** — cover sensitive data in what the *remote viewer* sees during a
   screen share, across any app.

Built on two primary-source research passes (screenshot/OCR; live-share pipeline), grounded in
YoshTool's code. Shell is assumed **Tauri 2** per `docs/desktop-port-research.md`.

_Compiled 2026-11-08. Some vendor docs were network-blocked and corroborated via mirrors/search;
canonical URLs cited._

---

## TL;DR — my recommendation

- **Feature 1 (screenshot auto-redact) is the flagship desktop v1 — low risk, high value, ship it.**
  YoshTool's `redact.js` is a **pure DOM-free module**, so it runs *unchanged* on OCR'd text. The only
  new work is: OCR the captured bitmap (OS-native: **Apple Vision** on macOS, **Windows.Media.Ocr** on
  Windows; **bundle Tesseract `ind+eng`** because Indonesian isn't guaranteed in the OS engines), map
  matches to pixel boxes, and draw **solid, destructive** redaction boxes in YoshTool's existing
  "detect → propose → toggle" UI. No competitor (Lightshot/ShareX/Flameshot) does automatic PII
  redaction — this is a genuine differentiator.
- **Feature 2 (live screen-share redaction) is the compelling vision but technically hard — treat it
  as an ambitious v2, framed honestly.** You **cannot** promise "automatic, everywhere, guaranteed."
  Two hard walls: (a) a simple overlay only reaches the viewer when sharing the *whole screen*, not a
  single window (the privacy-recommended mode); (b) OCR→cover is reactive, so data flashes briefly
  unless you hold the stream in a **fail-closed delay buffer**. The honest, buildable design is a
  **"Secure Share Window"**: YoshTool shows a *redacted mirror* of a monitor/region in its own window,
  and you share **that window** — redaction is baked into the shared surface, so it works in both share
  modes. Plus a **panic blackout hotkey** and **pre-marked masks**. Prior art (Censr, obs-sensitive-guard)
  proves it's buildable and independently reached the same honest limits.
- **Order:** screenshot auto-redact first (weeks, low risk) → then the Secure Share Window on one OS →
  then second OS / virtual-display upgrades. Reuse `redact.js` throughout.

---

## Part 1 — Screenshot tool with automatic redaction (the clear win)

### 1.1 Why it's low-risk: `redact.js` ports as-is
`/home/user/yoshtool/redact.js` has **zero `chrome.*` calls** (built to run under `node --test`), so it
runs unchanged in a Tauri WebView. Two detector classes map onto an image via OCR geometry:
- **Free-text detectors** (`findMatches`: email, JWT, API keys, credit_card+Luhn, IBAN, phone,
  Indonesian address) → run **directly** on OCR line text.
- **Field-context detectors** (`SECRET_FIELD_RE`/`PII_FIELD_RE`/`SENSITIVE_COL_RE` + `looksLikeSecret`
  / `looksLikeIp` / `looksLikeAccountNumber`) → the DOM "label→value" adjacency becomes **spatial
  adjacency**: a label token on a line → test the span to its right; a sensitive column header → redact
  OCR boxes whose x-center falls in that column. A faithful re-expression of YoshTool's existing model.

### 1.2 OCR strategy (the enabler)
Job is favorable (crisp screen text, not photos). Need **word/line bounding boxes**.

| Engine | OS | Free/on-device | Indonesian | Sub-word box | Notes |
|---|---|---|---|---|---|
| **Apple Vision** (`VNRecognizeText`) | macOS | yes (OS) | **unconfirmed** (runtime check) | **yes — `boundingBox(for:range)`** | fastest, best macOS path |
| **Windows.Media.Ocr** | Win10/11 | yes (OS) | **unconfirmed** (language pack) | no (interpolate) | **no per-word confidence** → gate on validators |
| **Tesseract** (`ind.traineddata`) | all | yes (bundle model) | **yes (`ind`)** | symbol-level | reliable Indonesian; heavier/slower |
| RapidOCR / ocrs (ONNX/RTen) | all | yes (bundle) | Latin | no | lighter cross-platform option; maturity varies |

**Recommended:** OS-native first (Vision/macOS, Windows.Media.Ocr/Windows, Tesseract/Linux) behind one
engine-agnostic Rust command `ocr_image(bytes) -> [{text,bbox,conf}]`; **route Indonesian to bundled
Tesseract `ind+eng`** when the OS engine lacks `id` (verify at runtime — this is why Tesseract is
mandatory in the bundle given YoshTool's Indonesian focus). Favor the accurate path + low confidence
floor: for redaction, **recall > precision** (a miss leaks; a false box is one toggle away).

### 1.3 OCR → redaction (the algorithm + the security rule)
Per capture: OCR → group words into lines (keep each word's char-range→bbox) → run `redact.js` → map
each match's char range to pixels (exact on Vision via `boundingBox(for:)`; union symbol/word boxes
elsewhere, **redact the whole word when the sub-word map is uncertain** — over-covering is the safe
failure) → draw boxes, grouped by kind, each toggleable.

**Security (non-negotiable):** **solid opaque fill, composited destructively into the exported bitmap.**
Blur/pixelate on text is **recoverable** (Depix, Unredacter; even Flameshot 13 had to sample pixels
from *outside* the box to mitigate) — offer blur/pixelate only as a manual, clearly-labeled
"not secure for text" tool (fine for faces). Export must **flatten** (no layered original, no embedded
OCR text). Consider snapping box widths to avoid leaking exact string length. Require **human review
before copy/save** (detect-then-propose, not silent).

### 1.4 Capture + UI (what to adopt / improve)
Lightshot/ShareX/Flameshot are all GPL or proprietary — **adopt the UX patterns, don't vendor code.**
Adopt: hotkey → dim screen → drag region → edge-docked floating toolbar (Lightshot speed); the full
annotation set incl. the pixelate-from-outside trick. **Improve:** auto-redact — none of them do it;
Lightshot forces manual scribbling. Build: `xcap` (Rust, Apache-2.0) for capture,
`tauri-plugin-global-shortcut` for the hotkey, a transparent multi-monitor region overlay (Flameshot's
`CaptureWidget` pattern re-expressed in web tech), annotation on a `<canvas>` reusing YoshTool's vanilla
UI + `redact-overlay.js`'s detect-then-propose, clipboard/save via Tauri plugins (export flattened).

### 1.5 Stretch (later): names & faces
Person-name NER is hard (Presidio is heavy Python) — best via **Apple NaturalLanguage `NLTagger`**
(macOS, on-device) as a macOS-first, suggest-only option; no built-in Windows NER. **Face detection**
(Apple Vision `VNDetectFaceRectangles` / Windows `FaceDetector`) is easy, native, and good demo value.
Both feed the same renderer. Keep as post-MVP.

---

## Part 2 — Live screen-share auto-redaction (the hard vision, told honestly)

### 2.1 Honest verdict
**"Automatic redaction everywhere, any app, guaranteed" is not achievable.** Two walls:

**Wall 1 — the capture path.** How your redaction reaches the remote viewer depends on which share
mode the user picks:
- **Full-screen / monitor / "portion of screen" share** = desktop-composition capture → a separate
  **overlay window IS in the frame** → overlay redaction works.
- **Single-window / application share** = per-window capture (WGC on Windows / ScreenCaptureKit on
  macOS read the *target window's own surface*, even when occluded) → a separate overlay window is
  **NOT captured** → overlay redaction is invisible to the viewer. And single-window is exactly the
  mode privacy guides recommend. There is **no OS primitive** to inject pixels into another app's
  window-capture.

**Wall 2 — latency / flash.** OCR→detect→cover is reactive. Whole-screen OCR is expensive (~100 ms
warm on GPU, ~600 ms CPU per 1080p pass), so you sample at ~5 Hz → anything on screen < ~200 ms can
slip between samples. The **only** way to approach "zero-leak" is a **delay buffer that holds the
stream ~0.5–2 s and fails closed to black** when OCR is behind (exactly what Censr and
obs-sensitive-guard do). That costs visible lag + black flicker on fast scrolling.

### 2.2 Approaches, ranked

| Approach | Reaches viewer: desktop share | Reaches viewer: single-window share | Effort | Verdict |
|---|---|---|---|---|
| **(a) Always-on-top overlay** | ✅ | ❌ (separate window) | Low | Secondary "desktop-share only" mode, with a clear warning |
| **(b′) Secure Share Window** — redact a mirror in YoshTool's own window; share that window | ✅ | ✅ | **Medium** | **Recommended** |
| **(b) Virtual display** (redacted mirror as a real extra monitor) | ✅ | ✅ | High (Win driver signing; mac private API) | Upgrade; macOS via DeskPad-style `CGVirtualDisplay` tractable, Windows IddCx heavy |
| **(c) Virtual camera** | — (Zoom treats as *camera*, ~360p) | — | Med | Wrong UX, not recommended |
| **(d) OBS filter** | ✅ (OBS is the capture layer) | ✅ | Low (reuse) | Best for OBS users — recommend existing Censr / obs-sensitive-guard |

### 2.3 Recommended: the "Secure Share Window"
1. User picks a monitor/region (optionally a window) in YoshTool.
2. YoshTool captures it (WGC / ScreenCaptureKit / PipeWire), **OCRs at ~5 Hz** with dirty-rect caching,
   runs `redact.js`, and **composites opaque covers** onto a GPU-rendered mirror **inside its own
   window**.
3. The user shares **that YoshTool window** — redaction is baked into the shared surface, so it reaches
   the viewer in **both** window- and desktop-share modes (sidesteps Wall 1 entirely).
4. Ship with: **fail-closed delay buffer** (user slider 0–2 s; black when OCR behind), a **global panic
   blackout/freeze hotkey**, **static masks** for fixed sensitive UI, **pre-marked sensitive apps**
   (blank when foregrounded), **opaque covers only**, and `WDA_EXCLUDEFROMCAPTURE`(Win) / SCK
   self-exclusion(mac) so YoshTool's control UI doesn't double-composite.

This is "Region-to-Share + DeskPad's mirror-in-window + Censr's fail-closed OCR," each proven
separately. Optional upgrades: macOS private `CGVirtualDisplay` (real extra monitor; no App Store),
Windows IddCx virtual display (if you can sign a driver), an OBS filter for OBS users, and overlay mode
(a) as a labeled desktop-share-only secondary.

### 2.4 OS capture-exclusion primitives (useful complement, not the feature)
`SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` (Windows 10 2004+) makes a whole window invisible to
DWM-based capture (but **not** a security guarantee — `PrintWindow`/raw framebuffer can bypass; Microsoft
says so). macOS `NSWindow.sharingType=.none` is now unreliable; ScreenCaptureKit exclusion is the
*capturer's* choice, so you can't force your own window out of Zoom's capture on macOS. Good for "never
show my password manager" (hide a designated window) and for hiding your own overlay from your own
capture — **not** for redacting content inside the app you're deliberately sharing.

### 2.5 What to NOT promise
- ❌ "Automatic in any app, any share mode" (overlay fails in single-window share).
- ❌ "Guaranteed nothing leaks" (only with fail-closed delay, and only for content on screen ≥ ~200 ms).
- ❌ "Zero lag" ("zero-leak" mode costs 0.5–2 s + black flicker).
- ❌ "Protects against a recorder/photographer" — this is anti-accident, not anti-exfiltration.

**Honest user-facing line:** *"Covers detected sensitive data in the window you share, with a short
delay you control. Brief flashes can still appear during fast scrolling or for very short-lived/odd
text. Use the panic key to black out instantly. This reduces accidental exposure; it is not a guarantee
against a determined viewer."*

### 2.6 Prior art (proves it's buildable + confirms the limits)
- **Censr** (OBS filter): opaque covers, PP-OCRv4/ONNX+DirectML GPU OCR (Windows.Media.Ocr fallback;
  Apple Vision on macOS), **~1.5 s fail-closed "zero-leak" buffer**, ~160 ms first cover, 5 Hz.
- **obs-sensitive-guard** (GPL-2.0, Windows): local GPU OCR, **delay line + fail-closed**, static masks,
  ROI, hotkeys; explicitly warns "OCR cannot guarantee 100% detection," recommends a 15–20 s stream
  delay backstop.
Both independently concluded: fail-closed delay buffer is the only path to "near-zero-leak," and OCR
can't guarantee full detection. Meeting apps have **no native content redaction** (background blur is
camera-only; Teams Premium only *warns* about sensitive content).

---

## Part 3 — Recommended plan & effort

**Phase 1 — Screenshot auto-redact tool (flagship v1).** Tauri shell; `xcap` capture + region overlay +
global hotkey; annotation canvas reusing YoshTool's UI; OS-native OCR + bundled Tesseract `ind+eng`;
`redact.js` over OCR text → solid destructive boxes in detect-then-propose; copy/save flattened.
*Effort: low–moderate; this is the realistic, high-value desktop launch.*

**Phase 2 — Secure Share Window (live redaction MVP) on one OS (macOS *or* Windows).** Capture → GPU
mirror in own window → 5 Hz OCR + `redact.js` → opaque covers → fail-closed delay slider + panic hotkey
+ static masks. *Effort: ~6–8 weeks for the honest core on one OS.*

**Phase 3 — second OS; overlay mode (a) as labeled secondary; pre-marked sensitive apps; tuning.**

**Phase 4 — upgrades:** macOS virtual display (`CGVirtualDisplay`); face detection; name NER (macOS);
OBS filter (or just recommend Censr/obs-sensitive-guard). Windows IddCx virtual display only if driver
signing is feasible.

**Honest effort/risk:** Phase 1 is low risk and the clear win. Phase 2 is real engineering (GPU present
pipeline, OCR cadence, fail-closed correctness) and must be marketed carefully (no guarantees). The PII
detection — usually the hard part — is already done (`redact.js`) and carries across both features
unchanged.

**My verdict:** build the **screenshot auto-redact tool first** — it directly fixes your Lightshot pain
(auto instead of manual), reuses everything, and ships fast. Pursue **live screen-share redaction as an
ambitious, honestly-framed v2** (Secure Share Window, one OS first); it's genuinely useful as
*accident reduction* for Zoom shares, but don't let it be sold — or built — as a guarantee.

---

## Sources (selected)
- Screenshot tools: ShareX `github.com/ShareX/ShareX` (GPL-3.0), Flameshot `github.com/flameshot-org/flameshot` (GPL-3.0+, pixelate-from-outside in 13.0), Lightshot (proprietary, manual redaction only).
- OCR: Apple Vision `VNRecognizeText` (`developer.apple.com/documentation/vision`), Windows.Media.Ocr, Tesseract data `github.com/tesseract-ocr/tesseract/wiki/Data-Files` (`ind`), RapidOCR/ONNX, ocrs `github.com/robertknight/ocrs`.
- Redaction reversibility: Depix (`labs.jumpsec.com`), Unredacter / "use black bars" (`portswigger.net/daily-swig`, `bleepingcomputer.com`), Flameshot 13 (`news.itsfoss.com`).
- Capture mechanics: Windows.Graphics.Capture (per-window, occluded) `nuget.org/packages/WgcSharp`, `github.com/SerpentAI/D3DShot/issues/22`; Desktop Duplication `docs.rs/crate/win_desktop_duplication`; ScreenCaptureKit `developer.apple.com/documentation/screencapturekit/sccontentfilter`, forum threads 786301/761155; PipeWire `phoronix.com/news/Wayland-Share-HowTo-Pipe-XDG`.
- Share modes: FAU/Caltech/Cornell/Zapier guides; `obsproject.com` Zoom virtual-cam thread.
- Exclusion: `SetWindowDisplayAffinity` (`github.com/MicrosoftDocs/sdk-api`), `NSWindow.sharingType` (`developer.apple.com`).
- Virtual display: DeskPad `github.com/Stengo/DeskPad`, Windows VDD `github.com/VirtualDrivers/Virtual-Display-Driver`, Region to Share (softpedia).
- Live-redaction prior art: Censr `github.com/toddkedwards/censr-obs`, obs-sensitive-guard `github.com/CodeBhaukaal/obs-sensitive-guard`.
- YoshTool: `redact.js`, `redact-overlay.js`, `sensor.js`, `docs/desktop-port-research.md` (unmodified).
