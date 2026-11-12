# Performance overlay (record & reload, filmstrip, CPU/Network throttling) — research

Status: **built** (shipped v1.36.2) for Phases 1–2 below. Captures how to bring a DevTools-Performance-
style load profiler into YoshTool as an **on-page overlay** instead of the docked DevTools panel.

> **Follow-up:** for the full DevTools-parity map (Insights, Summary donut, Performance Monitor, the
> trace route via `@paulirish/trace_engine`, and the roadmap beyond Phase 2) see
> [`performance-devtools-parity-research.md`](performance-devtools-parity-research.md). It supersedes
> §5's "not realistic" verdict below — DevTools' Insights are **trace-derived and embeddable**, not
> Lighthouse.

## 1. Why an overlay (the point)

Opening the DevTools **Performance** tab **docks a panel** (bottom/right) and **reflows/resizes the
page under test** — which changes the very layout, viewport and vitals you're trying to measure. The
ask: a floating **overlay** (Shadow DOM, like the rail / redact-overlay) that profiles the page
**without resizing it**.

Honest caveat: using `chrome.debugger` still shows the yellow **"YoshTool started debugging this
browser"** infobar at the top while attached. That banner nudges the page down a few pixels but does
**not** dock a panel or change the page width, and it disappears when we detach. It can't be hidden
(browser security UI) — same as today's Screenshot (full page) and Device mode.

## 2. What YoshTool already has (the base to extend)

The **Perf lab test** (`background.js` `handlePerfTest` + `perf.js`) already drives this over CDP:

- `Emulation.setCPUThrottlingRate({ rate: 4 })` (restored to `1`).
- `Network.emulateNetworkConditions(PERF_SLOW_4G)` where
  `PERF_SLOW_4G = { offline:false, latency:150, downloadThroughput:(1.6*1024*1024)/8, uploadThroughput:(750*1024)/8 }`
  (Lighthouse "Slow 4G"), restored to `downloadThroughput:-1`.
- Device emulation for the Mobile profile, cold `Page.reload`, then Core Web Vitals (FCP/LCP/CLS/INP/
  TTFB) + timing phases + slowest/heaviest resources, shown in the popup.

So the hard parts (debugger session, throttling, cold reload, vitals) exist. This research = make it
**interactive** (throttle pickers), add a **filmstrip** and a **request waterfall**, and render it in
an **overlay**.

## 3. CDP building blocks (all via `chrome.debugger` — already a permission)

| Need | CDP |
|---|---|
| CPU throttle | `Emulation.setCPUThrottlingRate({ rate })` (1 / 4 / 6 / 20) |
| Network throttle | `Network.emulateNetworkConditions({ offline, latency, downloadThroughput, uploadThroughput })` (bytes/s) |
| Record & reload | `Page.reload({ ignoreCache: true })` after enabling capture |
| **Screenshots / filmstrip** | `Page.startScreencast({ format:"jpeg", quality, everyNthFrame, maxWidth, maxHeight })` → `Page.screencastFrame` events (base64 + `metadata.timestamp`) → ack each with `Page.screencastFrameAck` → `Page.stopScreencast` |
| Request **waterfall** | `Network.enable` → `Network.requestWillBeSent` / `responseReceived` / `loadingFinished` / `loadingFailed` (name, type, size, timing) |
| Device emulation | `Emulation.setDeviceMetricsOverride` / `setUserAgentOverride` / `setTouchEmulationEnabled` (already used) |
| Full trace (flame chart source) | `Tracing.start` / `Tracing.end` / `Tracing.dataCollected` / `Tracing.tracingComplete` → **raw** trace events |
| Long tasks / vitals | in-page Performance API + `PerformanceObserver('longtask')` |

## 4. Throttle presets to offer

**CPU** (`setCPUThrottlingRate` rate = slowdown factor): No throttle (1×), **4×** (mid mobile,
Lighthouse default), **6×** (low-end), **20×** (extreme). Plus a custom number.

**Network** (`emulateNetworkConditions`, values = down / up / RTT; bytes/s = `Mbps*1024*1024/8`):

| Preset | Down | Up | Latency |
|---|---|---|---|
| Offline | `offline:true` | — | — |
| Slow 3G | 400 Kbps | 400 Kbps | 2000 ms |
| Fast 3G | 1.6 Mbps | 750 Kbps | 562.5 ms |
| **Slow 4G** (Lighthouse, in code) | 1.6 Mbps | 750 Kbps | 150 ms |
| Fast 4G | ~4 Mbps | ~3 Mbps | ~20 ms |
| No throttle | `downloadThroughput:-1` | `-1` | 0 |
| Custom | user down | user up | user RTT |

> Chrome has **renamed its named presets across versions** (the old "Slow/Fast 3G" became "Slow/Fast
> 4G" defaults). Treat the non-Lighthouse rows as approximate and pull the current exact values from
> DevTools' throttling source when implementing. The one we already ship (Lighthouse Slow 4G) is
> authoritative.

## 5. What's realistic to build — and what isn't

**Realistic** (CDP + light parsing):
- CPU + Network profile pickers (presets + custom), reusing the existing Mobile/Desktop profiles.
- **Record & reload** (cold).
- **Filmstrip** — screencast frames with timestamps, scrub through page-load frames (this is exactly
  how DevTools builds its filmstrip). Cap count + downscale to stay light.
- **Core Web Vitals** + DNS/TCP/TLS phases (already) + a scrub-synced "first paint / LCP" marker.
- **Request waterfall** from `Network.*` events; biggest / slowest resources (already partly).
- A few **heuristic insights**: render-blocking resources, large resources, long tasks
  (`PerformanceObserver('longtask')`), request count, total transfer.
- All rendered in a **Shadow-DOM overlay**; page is not resized.

**Not realistic** (DevTools / Lighthouse engine territory — out of scope):
- A full **main-thread flame chart / call tree / bottom-up** from a trace. `Tracing.*` gives the raw
  events, but turning them into DevTools' timeline means reimplementing its trace model — huge.
- Lighthouse-grade audits: "Est savings", **LCP element breakdown**, **layout-shift culprit** element
  attribution, "Network dependency tree", "Forced reflow", "Legacy JavaScript", etc. These are
  Lighthouse audits over the trace; Lighthouse is a large Node engine, not embeddable in an overlay.
- So position this as a **lightweight load profiler** (throttle + reload + filmstrip + vitals +
  waterfall), **not** a DevTools/Lighthouse replacement.

## 6. Architecture sketch

- **`background.js`** owns the `chrome.debugger` session (extend `handlePerfTest`): accept a profile
  `{ cpuRate, net, device }`, enable `Network` + start screencast, cold-reload, collect frames +
  network events + vitals, detach, and return a result bundle (vitals, phases, resources, waterfall,
  filmstrip frames as data URLs).
- **`perf-overlay.js`** — a content-script **Shadow-DOM overlay** (same pattern as `rail.js` /
  `editpage.js`): shows the controls (profile pickers, **Record & reload**) and renders the result
  (vitals cards, filmstrip strip, waterfall). Floats over the page; never resizes it. Triggered from
  the popup or the floating rail.
- Reuse **`perf-core.js`** for thresholds/formatting; keep all pure logic Node-tested.

## 7. Constraints (must surface in the UI)

- **One debugger client per tab.** Can't run while **DevTools is open** on that tab (and vice versa)
  — CDP returns "Another debugger is already attached". The overlay is an **alternative** to DevTools;
  if DevTools is open, prompt the user to close it. Also guard against running alongside **Device
  mode** / **full-page screenshot** on the same tab (reuse the existing `simAttached`-style guard so
  the debugger isn't double-claimed).
- **Yellow debugger infobar** appears while attached (small top banner; unavoidable; not a panel).
- **Screencast cost**: JPEG frames at a cadence add overhead and memory (frames × data URLs) — cap
  resolution/quality/frame-count.
- Blocked on `chrome://`, the Web Store, and other restricted pages.
- **One lab run** — numbers vary run-to-run; it's not field data (same disclaimer as today's test).

## 8. Phasing

1. **Phase 1** — add interactive **CPU + Network throttle pickers** (presets + custom) to the existing
   Perf lab test. Low effort; reuses `handlePerfTest`.
2. **Phase 2** — build the **Shadow-DOM perf overlay**: controls + vitals + **filmstrip** (screencast)
   + **waterfall**, triggered from popup / rail. This is the "DevTools-like, but overlay" deliverable.
3. **Phase 3 (stretch)** — capture a trace (`Tracing.*`) and expose a **minimal** long-tasks /
   main-thread-busy summary (totals + a simple bar), explicitly **not** a full flame chart.

## 9. Relationship to existing features

Extends the **Perf lab test**, and shares `chrome.debugger` with **Device mode** and **full-page
screenshot** — same single-client constraint, so the perf overlay must coordinate with the existing
`simAttached` guard (only one debugger-using feature active per tab at a time).
