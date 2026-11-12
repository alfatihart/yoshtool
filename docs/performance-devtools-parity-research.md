# Performance overlay — full DevTools-Performance parity (research)

Status: **research only** (not built). Extends [`performance-overlay-research.md`](performance-overlay-research.md)
and the shipped **Performance overlay** (v1.36.2: throttle pickers, Record & reload, filmstrip +
zoom, Core Web Vitals, request waterfall). Goal: map **every** DevTools **Performance** capability to a
data source + a concrete way to accommodate it in YoshTool, and lay out a phased road to parity.

> Research caveat: this session's network allowlist blocked `developer.chrome.com` and
> `www.debugbear.com`, so the exact current Insights list and LCP-phase target percentages below are
> taken from the user's own DevTools screenshot + established Google/web.dev guidance and should be
> re-verified against the live docs when implementing. The `trace_engine` / CDP facts are confirmed
> from sources linked at the bottom.

---

## 0. The big realization (why parity is now actually feasible)

The modern DevTools **Performance** panel is **one-artifact, trace-driven**. The flame chart, the
Summary donut, the filmstrip, the Network track **and** the whole **Insights** sidebar are all computed
**in the DevTools frontend, client-side, from a single Chromium trace** captured over CDP `Tracing.*`.

Crucially: the **Insights are _not_ Lighthouse**. They are produced by DevTools' own **trace model**,
which is published to npm as **`@paulirish/trace_engine`** and driven by the open
**`ChromeDevTools/trace-engine-cli`**. That engine ships **~19 insight models** (LCP discovery, DOM
size, forced reflow, document latency, image delivery, font display, render-blocking, third parties,
…) and a non-overlapping **main-thread category breakdown** (Scripting / Layout / Rendering / GC /
System / Idle).

This supersedes the old doc's verdict ("Lighthouse-grade audits are out of scope"). The audits are
**trace-derived and embeddable**. YoshTool already owns the hard half (a `chrome.debugger`/CDP session
with throttle + cold reload + screencast + Network events + CWV). The highest-leverage next move is to
**capture a trace** and process it — either by **hand-rolling a subset** (keeps the vanilla, no-build
ethos) or by **vendoring the zero-dependency `trace_engine` bundle** (full fidelity, but a large
prebuilt third-party blob). See §8 and §10.

---

## 1. Full inventory: DevTools Performance → data source → YoshTool status

Legend: ✅ shipped (v1.36.2) · 🟡 partial · ⬜ not yet · 🔵 needs a trace · 🧩 needs `trace_engine` for full fidelity

### 1a. Controls / recording
| DevTools control | CDP / API | YoshTool |
|---|---|---|
| CPU throttle (none/4×/6×/20× + custom) | `Emulation.setCPUThrottlingRate({rate})` | ✅ none/4×/6× (add 20× + custom — trivial) |
| Network throttle (presets + custom) | `Network.emulateNetworkConditions` | ✅ none/Slow 4G/Fast 4G/Slow 3G (add Offline + custom down/up/RTT) |
| Record & reload (cold) | `Page.reload({ignoreCache:true})` | ✅ |
| Device emulation (mobile) | `Emulation.setDeviceMetricsOverride` + UA + touch | ✅ Desktop/Mobile |
| Screenshots toggle (filmstrip) | trace `disabled-by-default-devtools.screenshot` **or** `Page.startScreencast` | ✅ (screencast today; trace route in §2) |
| Hardware-concurrency override | `Emulation.setHardwareConcurrencyOverride({hardwareConcurrency})` | ⬜ easy add |
| Memory toggle | trace `disabled-by-default-memory-infra` / `Memory.*` | ⬜ |
| Web-Vitals lane toggle | trace markers / PerformanceObserver | ✅ (vitals shown) |
| Import / export trace (`.json`/`.json.gz`) | save the raw `Tracing` events; load a DevTools trace | ⬜ 🔵 high value (shareable + re-analysable; DevTools-compatible) |

### 1b. Timeline tracks
| Track | Source | YoshTool |
|---|---|---|
| **Timings** (FCP, LCP, DCL, Load) | trace markers / `PerformanceObserver` | ✅ values; ⬜ as a lane on a time-axis |
| **User timing** (`performance.mark`/`measure`) | trace `blink.user_timing` | ⬜ |
| **Frames / filmstrip** | trace `…devtools.screenshot` or screencast | ✅ (screencast; clickable zoom + step) |
| **Interactions / INP** | trace `EventTiming` / `PerformanceObserver('event')` | 🟡 worst-interaction only |
| **Layout Shifts (CLS)** | trace `LayoutShift` events (with impacted nodes) | 🟡 CLS value only (no culprits) |
| **Main thread** (flame chart, tasks) | trace `RunTask` + `v8.cpu_profiler` (`Profile`/`ProfileChunk`) | ⬜ 🔵🧩 |
| **Long tasks + Total Blocking Time** | trace tasks >50ms / `PerformanceObserver('longtask')` | ⬜ 🔵 (easy subset) |
| Raster / GPU / Compositor / Worker lanes | trace (per-thread) | ⬜ 🧩 (low priority) |
| **Network track** (bars + priority + render-blocking) | `Network.*` + trace | 🟡 simple bars today → §7 |
| Animations / Server-Timing | trace / response headers | ⬜ low priority |

### 1c. Bottom tabs (after selecting a range)
| Tab | Source | YoshTool |
|---|---|---|
| **Summary** (category donut: Scripting/Rendering/Painting/Loading/System/Idle) | trace main-thread self-time by category | ⬜ 🔵 (`mainThreadBreakdown` shape, §5) |
| **Bottom-Up** / **Call Tree** / **Event Log** | CPU profile + trace | ⬜ 🧩 |

### 1d. Insights sidebar — the ~19 models (the "fully accommodate" target)
These are exactly the cards in the user's DevTools screenshot plus the rest of the engine's set. Source
= the trace via `trace_engine`; most have a **hand-roll recipe** (§3). Difficulty is for hand-rolling.

| Insight | What it reports | Hand-roll difficulty |
|---|---|---|
| **LCP breakdown** (by phase) | TTFB → load delay → load duration → render delay (§4) | 🟡 medium |
| **LCP request discovery** | Is the LCP image discoverable early / preloaded / not lazy | 🟡 medium |
| **Render-blocking requests** | CSS/JS in `<head>` that block first paint + est. savings | 🟢 easy (Network + trace) |
| **Document request latency** | Server response time, compression, redirects for the doc | 🟢 easy (Network timing) |
| **Network dependency tree** | Longest chain of dependent requests (critical path) | 🟡 medium (initiator chain) |
| **3rd parties** | Time/bytes grouped by third-party origin | 🟢 easy (group Network by eTLD+1) |
| **Duplicated JavaScript** | Same module shipped in multiple bundles | 🔴 hard (needs source maps) |
| **Legacy JavaScript** | Transpiled/polyfilled code shippable as modern | 🔴 hard (byte-pattern scan) |
| **Font display** | `@font-face` without `font-display:swap` (FOIT/FOUT) | 🟡 medium |
| **Image delivery** | Oversized/uncompressed/wrong-format images + savings | 🟡 medium (Network + dims) |
| **Optimize DOM size** | Total nodes, depth, max children | 🟢 easy (`Performance.getMetrics.Nodes` / DOM walk) |
| **Layout shift culprits** | Which element/insertion caused each CLS window | 🟡 medium (`LayoutShift` impacted nodes) |
| **Forced reflow** | JS that reads layout after a write (sync reflow) + stack | 🔴 hard (trace `Layout` under `FunctionCall`) |
| **Use efficient cache lifetimes** | Static assets with short/missing `Cache-Control` | 🟢 easy (response headers) |
| **Modern HTTP** | Assets still on HTTP/1.1 vs h2/h3 | 🟢 easy (`response.protocol`) |
| (others in the engine) | INP breakdown, viewport/mobile, slow CSS selectors, cache, … | mixed |

### 1e. Performance **Monitor** (separate real-time view)
| Metric | Source | YoshTool |
|---|---|---|
| CPU usage, JS heap, DOM nodes, JS listeners, documents, frames, layouts/sec, style recalcs/sec | `Performance.enable` + poll `Performance.getMetrics` (flat `{name,value}[]`) | ⬜ 🟢 **easy, no trace** — see §6 |

---

## 2. The trace route in detail (the core enabler)

**Capture.** `Tracing.start` with the DevTools category set, then collect:
- `transferMode:"ReportEvents"` → many `Tracing.dataCollected` batches → `Tracing.tracingComplete`; **or**
- `transferMode:"ReturnAsStream"` → `tracingComplete{stream}` → drain via `IO.read` (better for big traces).

Category set DevTools/Lighthouse use (include these):
`devtools.timeline`, `disabled-by-default-devtools.timeline`,
`disabled-by-default-devtools.timeline.frame`, `disabled-by-default-devtools.timeline.stack`,
`disabled-by-default-devtools.screenshot` (filmstrip), `disabled-by-default-v8.cpu_profiler`
(flame chart), `blink.user_timing`, `loading`, `latencyInfo`, `v8.execute`. Screenshots default to
**500×500** (override with `screenshotMaxSize`) and Lighthouse notes a trace can carry **up to ~450**
JPGs — so screenshots dominate trace size; cap them.

**Volume / memory.** A complex page is tens of MB and hundreds of thousands of events. In an MV3
service worker this must be **streamed** (`IO.read` in chunks) and bounded; don't hold the whole thing
as one string if avoidable. Consider dropping the screenshot category from the trace and keeping the
existing screencast for the filmstrip (lighter), using the trace only for timeline/insights.

**Representative `devtools.timeline` event names** (for hand-rolling; **verify against the
`trace_engine` TraceEvents types when implementing** — the names below are from the trace-event
references, not re-confirmed this session):
`RunTask`, `FunctionCall`, `EvaluateScript`, `v8.compile`, `ParseHTML`, `ParseAuthorStyleSheet`,
`UpdateLayoutTree` (recalc style), `Layout`, `PrePaint`, `Paint`, `Layerize`, `CompositeLayers`,
`CommitLoad`, `ResourceSendRequest` / `ResourceReceiveResponse` / `ResourceReceivedData` /
`ResourceFinish`, `EventTiming` (INP), `LayoutShift`, the paint markers
`firstPaint` / `firstContentfulPaint` / `largestContentfulPaint::Candidate`, `Screenshot`, and
`Profile` / `ProfileChunk` (CPU sampler → flame chart).

---

## 3. The 9 insights from the user's DevTools screenshot — recipes

The user's Chrome showed exactly these cards. How YoshTool can reproduce each **without** the full
engine:

1. **LCP breakdown** — §4. Needs the LCP element/resource + nav timing. Medium.
2. **Render-blocking requests** — from `Network.*`: requests with `renderBlocking:"blocking"` (CDP
   exposes `renderBlockingStatus`) or `<head>` CSS/sync-`<script>` that finish before FCP. Est. savings
   ≈ how much FCP could move if removed. **Easy.**
3. **Use efficient cache lifetimes** — read each static asset's `Cache-Control`/`Expires` from
   `response.headers`; flag short/missing TTLs; savings = repeat-visit bytes. **Easy.**
4. **Legacy JavaScript** — scan JS bodies for transpiled patterns/polyfills (`Array.prototype` shims,
   regenerator). Needs body bytes (`Network.getResponseBody`) + heuristics. **Hard** — defer.
5. **Layout shift culprits** — from trace `LayoutShift` events: each carries `impacted_nodes`
   (backendNodeIds) and score; resolve nodes via `DOM.pushNodesByBackendIdsToFrontend`. Group into
   session windows (we already compute CLS this way) and name the top contributor. **Medium.**
6. **Network dependency tree** — build the initiator chain from `Network.requestWillBeSent.initiator`;
   surface the **longest dependent chain** (critical request chain). **Medium.**
7. **Optimize DOM size** — `Performance.getMetrics` → `Nodes`, or one DOM walk for total/ depth/ max
   children. Flag > ~800 nodes / depth > ~32 / > ~60 children. **Easy.**
8. **3rd parties** — group all requests by registrable domain (eTLD+1) ≠ the page's; sum bytes + main-
   thread time attributable to each. **Easy.**
9. **Forced reflow** — in the trace, a `Layout`/`UpdateLayoutTree` nested **inside** a `FunctionCall`
   (JS reads layout mid-task) → report the offending stack frame. Needs the CPU-profiler stacks.
   **Hard** — defer to the trace_engine route.

So **6 of the 9** (render-blocking, cache lifetimes, layout-shift culprits, dependency tree, DOM size,
3rd parties) + **LCP breakdown** are hand-rollable at easy/medium effort. Legacy-JS and forced-reflow
are the two that really want the full engine.

---

## 4. LCP breakdown (most actionable for konsultanedu.id, LCP ≈ 33 s)

Google splits LCP into **four consecutive phases** (names per web.dev — re-verify exact wording):

1. **Time to First Byte (TTFB)** — navigation start → first byte of the document.
2. **Resource load delay** — TTFB → when the browser *starts* fetching the LCP resource (image). Big
   here = the LCP image is discovered late (not preloaded, injected by JS, lazy-loaded).
3. **Resource load duration** — the LCP resource's own download time (size ÷ throttled bandwidth).
4. **Element render delay** — resource finished → LCP actually painted. Big here = main thread busy /
   render-blocking CSS/JS, or the element is gated behind hydration.

Compute from what we already capture: nav start + `response.timing` for the document (TTFB) and for the
LCP resource (request start/finish), plus the LCP time from the trace marker / PerformanceObserver. For
an image LCP we can identify the resource; for a text LCP, phases 2–3 collapse to ~0 and it's mostly
render delay. On this site a 33 s LCP under Slow-4G almost certainly points to **load delay** (late-
discovered hero image) and/or **render delay** (render-blocking head), which the Insight would name.
(DevTools in the screenshot already flagged *render-blocking est. savings ~46.77 s* and *cache
lifetimes ~3.5 MB*.)

---

## 5. Summary donut (main-thread category breakdown)

`trace_engine`'s `overview.mainThreadBreakdown` returns non-overlapping ms per category:
`scriptingMs, layoutMs, renderingMs, gcMs, systemMs, idleMs, totalMs` (DevTools labels: **Scripting,
Rendering, Painting, Loading, System, Idle**; map carefully — the engine groups Layout+Style and uses
GC/System). Hand-roll: sum **self-time** of top-level `RunTask` children, bucketed by event name
(EvaluateScript/FunctionCall → Scripting; UpdateLayoutTree/Layout → Rendering; Paint/Composite →
Painting; ResourceReceiveData/ParseHTML → Loading; GC → System). Render as a donut + a stacked bar.
Also yields **Total Blocking Time** (Σ of (task−50ms) for tasks >50ms between FCP and TTI).

---

## 6. Performance **Monitor** — cheapest high-value win (no trace)

Independent of the lab run: `Performance.enable`, then poll `Performance.getMetrics` ~1×/s. Returns a
flat `{name,value}[]`; useful fields: `Documents`, `Nodes`, `JSEventListeners`, `LayoutCount`,
`RecalcStyleCount`, `LayoutDuration`, `RecalcStyleDuration`, `ScriptDuration`, `TaskDuration`,
`JSHeapUsedSize`, `JSHeapTotalSize` (derive per-second rates from deltas; CPU% ≈ Δ(Task+Script+
Layout+RecalcStyle)/Δt). Render as live sparklines: **CPU, JS heap, DOM nodes, JS listeners,
layouts/s, style recalcs/s**. This is a self-contained second tab in the overlay — small effort, and it
monitors the live page (no reload), unlike everything else here.

---

## 7. Request waterfall parity (upgrade the current simple bars)

We already listen to `Network.*`. DevTools' waterfall adds, all available without a trace:
- **Timing phase breakdown** per request from `response.timing`: queued/stalled, DNS, connect, SSL,
  request sent, **waiting (TTFB)**, content download — draw as colored segments in each bar.
- **Priority** (`Highest…Low`), **protocol** (h2/h3/http1.1), **render-blocking status**, **initiator**
  (what requested it), **transfer vs resource (decoded) size**, status, MIME.
- **Click a row → detail panel** (headers, timing, initiator chain).
- Mark the **document**, **render-blocking**, and **LCP** requests.

Mid effort, no trace, and it turns the current bars into a genuine network analyzer.

---

## 8. Architecture options

**Current (v1.36.2):** background owns the `chrome.debugger` session; it collects screencast + Network
events + runs `perf.js` for CWV; stores the result; re-injects `perf-overlay.js` which renders. Pure
shaping lives in `perf-core.js` (Node-tested).

**To add trace processing, two routes:**

- **(A) Hand-rolled subset (keeps the no-build, no-dep ethos).** Background captures the trace (stream
  via `IO.read`), and a new pure module `perf-trace-core.js` parses the subset of events we need →
  Summary categories, long tasks/TBT, layout-shift culprits, DOM size, and the Network-derived
  insights. All Node-testable with fixture traces. Covers ~6–10 insights. **No new dependency, no
  offscreen doc.** Recommended default.

- **(B) Vendor `trace_engine` (full fidelity: all ~19 insights + real flame chart).** `trace_engine` is
  ESM and the CLI can emit a **zero-dependency single-file bundle** (`trace_engine.js`). A content
  script can't `import`, and the service worker is a module but shouldn't host a huge engine, so run it
  in an **offscreen document** (`perf-engine.html` + `<script type="module">`): background streams the
  trace → offscreen runs the engine → returns `{insights, summary, cwv, frames}` → background stores →
  overlay renders. **Trade-off:** a large prebuilt third-party blob (pre-1.0, pins to a version,
  Apache-2.0) — a real departure from YoshTool's hand-rolled ethos, and browser-usability of the bundle
  is **unverified** (it's DevTools' own code, which runs in a browser, so likely fine, but must be
  proven). This is the only route to **Forced reflow / Legacy JS / Duplicated JS** and a faithful flame
  chart.

**Overlay UX for either:** add tabs — **Load** (today), **Insights** (cards w/ est. savings),
**Main-thread/Summary** (donut + long tasks), **Network** (rich waterfall), **Monitor** (live). Reuse
the `simAttached` guard, the storage handoff, and the re-inject-after-reload pattern already in place.

---

## 9. Constraints & honest limits

- **One debugger client per tab** — can't coexist with open DevTools or Device mode / full-page
  screenshot on the same tab (existing `simAttached` guard applies). The overlay is an *alternative* to
  DevTools.
- **Yellow "started debugging" infobar** while attached (unavoidable; not a panel; doesn't resize the
  page).
- **Trace volume** — stream + bound; dropping the screenshot category keeps it light (reuse screencast
  for the filmstrip).
- **`trace_engine` is pre-1.0** (`0.0.x`) — API churns; pin a version; browser-usability unproven.
- **Flame chart** is a sizeable canvas UI; the 80/20 is the **Summary donut + top long tasks**, not a
  full interactive flame chart.
- **Source-mapped names / Legacy-JS / Duplicated-JS / Forced-reflow** need response bodies, `.map`
  fetches, or CPU-profiler stacks — defer or require route (B).
- **One lab run ≠ field data** (same disclaimer as today).
- `chrome://`, Web Store, and other restricted pages are off-limits.

---

## 10. Phased roadmap to "full accommodation"

- **Phase 3 — no trace, high value (recommended next).** Richer **request waterfall** (§7: timing
  phases, priority, protocol, render-blocking, initiator, click-detail) + **Performance Monitor** live
  tab (§6) + Network/DOM-derived **insight cards**: render-blocking, document latency, 3rd parties,
  cache lifetimes, modern HTTP, DOM size + **LCP phase breakdown** (§4). Hand-rolled, vanilla, Node-
  tested. Lands **~7 of the 9** insights the user saw.
- **Phase 4 — trace, hand-rolled (route A).** Capture `Tracing.*`; add **Summary donut**, **long
  tasks + TBT**, **layout-shift culprits**, and **trace import/export** (DevTools-compatible `.json`).
- **Phase 5 — full parity (route B).** Vendor the zero-dep `trace_engine` in an offscreen doc → all
  ~19 insights (incl. forced reflow, legacy/duplicated JS) + a real flame chart. Biggest effort + the
  dependency decision.

Each phase bumps the version (patch for refinements, minor for a new tab/tool) with CHANGELOG + README,
on its own branch, merged only on request — per the project's workflow.

---

## 11. Decision needed before building

1. **Insights engine route:** **(A)** hand-rolled subset — vanilla, no dependency, ~7–10 insights
   (recommended, fits YoshTool's ethos) — vs **(B)** vendor `trace_engine` — all ~19 + flame chart, but
   a large prebuilt dependency + an offscreen document.
2. **Phase-3 priority order:** rich **waterfall**, live **Monitor**, and **insight cards** — which
   first? (The konsultanedu.id case — LCP 33 s, big render-blocking savings — argues for **LCP
   breakdown + render-blocking + waterfall** first.)

---

## Sources

- Insights are trace-derived (DevTools trace model, not Lighthouse): `@paulirish/trace_engine` +
  [ChromeDevTools/trace-engine-cli](https://github.com/ChromeDevTools/trace-engine-cli) and its
  [issue #9](https://github.com/ChromeDevTools/trace-engine-cli/issues/9) (19 insight models; CLI
  exposes 5; `mainThreadBreakdown` = Scripting/Layout/Rendering/GC/System/Idle; zero-dep engine bundle).
- Trace model entry point:
  [devtools-frontend `models/trace/trace.ts`](https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/models/trace/trace.ts),
  [`types/TraceEvents.ts`](https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/models/trace/types/TraceEvents.ts).
- CDP Tracing (categories, `dataCollected`/`tracingComplete`, `screenshotMaxSize`):
  [Chromium `tracing_handler.cc`](https://chromium.googlesource.com/chromium/src/+/main/content/browser/devtools/protocol/tracing_handler.cc),
  [Tracing.pdl](https://chromium.googlesource.com/devtools/devtools-frontend/+/HEAD/node_modules/devtools-protocol/pdl/domains/Tracing.pdl);
  screenshot category + "up to ~450 JPGs" from
  [Lighthouse trace gatherer](https://app.unpkg.com/lighthouse@13.4.1/files/core/gather/gatherers/trace.js)
  and [DevTools TimelineController](https://app.unpkg.com/chrome-devtools-frontend@1.0.1669021/files/front_end/panels/timeline/TimelineController.ts).
- CDP Performance (Monitor fields):
  [Performance.pdl](https://chromium.googlesource.com/devtools/devtools-frontend/+/HEAD/node_modules/devtools-protocol/pdl/domains/Performance.pdl),
  [Puppeteer `page.metrics()`](https://pptr.dev/api/puppeteer.metrics).
- Trace event name reference (unofficial, verify):
  [The Unofficial Chrome Trace Event Manual](https://www.corewebvitals.io/chrome-trace/events).
- Insights sidebar overview (blog — **blocked in this session, re-verify**):
  `https://developer.chrome.com/blog/devtools-insights-sidebar`;
  LCP by phase (**blocked, re-verify**): `https://www.debugbear.com/docs/lcp-by-phase`.
