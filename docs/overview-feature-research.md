# Overview feature — research & design

Goal: a **protection/status Overview** for YoshTool, like the panels in AdGuard, AdBlock
Ultimate, and Ghostery — a glanceable summary of what YoshTool is doing (ads/trackers blocked,
page health, active protections), building on today's ping hover tooltip.

This document (1) inventories every shipped YoshTool feature and the data it already produces,
(2) recommends what belongs in an Overview, and (3) models **where** to put it.

---

## 1. What the reference extensions show (and where)

The common pattern across AdGuard / AdBlock / Ghostery / uBO:

| Surface | What it shows |
|---|---|
| **Toolbar badge** | one live number — blocked count on this tab |
| **Icon panel** (click the toolbar icon) | the hero view: **big "blocked on this page"** number + **today / all-time** totals, a **per-category or per-source breakdown** (ads vs trackers; or Advertising / Analytics / Essential…), on/off toggle for this site, and often an estimated **data saved / time saved** |
| **Full dashboard / stats page** | history over time, per-site ranking, charts |

Two invariants worth copying:

1. **This-site vs global.** Every one of them separates "on this page" from "today / since
   install". YoshTool today has only the per-page number, and it even **resets on navigation**.
2. **The number is cumulative and persistent.** The hero value survives reloads and restarts.
   This is the single biggest gap in YoshTool (see §3).

Honesty note for MV3: uBO's *rich* logger/dashboard depends on the blocking webRequest API that
MV3 removed. YoshTool is MV3 (DNR), so exact per-request accounting isn't available — our net
(ads+trackers) count is **best-effort** (see §3). cos/pop are exact.

---

## 2. Full YoshTool feature inventory

Grouped by whether each feature produces **status/metrics** (candidate for an Overview) or is an
**action** (belongs in the rail / popup, not the Overview).

### A. Protection engines → produce metrics (Overview candidates)

| Feature | Metric it can expose | Data today |
|---|---|---|
| Ad blocker (DNR `ads`) | requests blocked | **net** count, best-effort, active tab only, resets on nav |
| Tracker blocker (DNR `trackers`) | requests blocked | folded into **net** (DNR can't split ads vs trackers in packed rules) |
| Cosmetic filter / "hide ad elements" | elements hidden | **cos** count, **exact per-tab**, pushed via `cosmetic-count` |
| Element blocker (zap / pick) | elements removed | counted into cos / ad-hoc |
| Popup blocker | popups blocked | **pop** count, **exact per-tab**, counted live (`pb-blocked`) |
| Strip tracking params (DNR `paramstrip`) | URLs cleaned | **not counted** (DNR, no callback) |
| Anti-adblock scriptlets (incl. YouTube nag) | sites un-nagged | not counted |
| Auto-sensor / privacy blur | fields/areas masked | **not reported** — sensor.js knows the count, just doesn't send it (easy win) |

### B. Page health → already in the overview (YoshTool's differentiator)

| Feature | Metric | Data today |
|---|---|---|
| Perf vitals | TTFB / FCP / LCP / CLS / Load | live via `PerformanceObserver` + navigation entry |
| Page weight | request count + transfer bytes | live from resource entries |
| Ping (latency) | RTT to this origin or the Ping tool's host | live per-second buffer in the SW, pushed to the rail |
| Connection | effective type + downlink | `navigator.connection` estimate |

### C. Actions → NOT Overview material (keep as rail/popup buttons)

Screenshots (area/screen/full) + redaction · Translate (selection / full page) · Dark mode ·
Unlock copy & selection · Inspect & edit element · Reveal passwords · Fill form (Faker) · Color
picker / eyedropper · Font inspector · Custom CSS · Cookie export/import · Clear cache / cookies /
site-data. These are *things you do*, not *status you read* — they don't belong in a glanceable
summary.

---

## 3. The core gap: no persistent stats

Everything blocked today lives in `tabCounts` (an in-memory `Map`, `{net,cos,pop}` per tab) and is
**wiped on navigation and on SW restart**. There is **no** `storage` key for daily or lifetime
totals, no per-site history. So YoshTool can answer "blocked on this page right now" but not
"blocked today" or "since install" — the exact numbers AdGuard/Ghostery lead with.

**Required new engine (the real work):** a small stats store in the service worker.

- On every block signal already flowing through `background.js` — `cosmetic-count` (cos),
  `pb-blocked` (pop), and `updateNetCount` (net) — increment persistent counters.
- Shape (in `chrome.storage.local`, debounced writes):
  ```
  ytStats = {
    day:   "2026-11-18",                 // rolls over at local midnight
    today: { net, cos, pop, sensor },
    total: { net, cos, pop, sensor },    // lifetime
    perSite: { "youtube.com": { net, cos, pop, sensor, lastSeen } }  // capped / LRU
  }
  ```
- A pure, Node-tested `stats-core.js` (roll-over, increment, per-site merge, top-sites) mirrored
  inline where a content script needs it — same pattern as `perf-core.js` ↔ `rail.js`.

**Honesty constraints to bake into the UI (don't oversell):**

- **net is approximate.** `getMatchedRules` is rate-limited (~20 calls / 10 min) and only polled for
  the active tab, so cumulative ads+trackers will *undercount*. Label it "ads + trackers (approx)".
- **cos / pop / sensor are exact.**
- **"Data saved" / "time saved" cannot be measured** in MV3 (DNR gives no blocked-response size).
  Either omit it, or show it clearly as a rough estimate (blocked × an average size constant) with a
  `~` and a tooltip. Recommendation: **omit in v1** — a made-up MB number is exactly the kind of
  thing that reads as untrustworthy. Revisit only if we can tie it to real sizes.

**Small companion win:** have `sensor.js` report a `sensor-count` message (mirror of
`cosmetic-count`) so "fields protected" becomes a real metric.

---

## 4. What to put in the Overview (recommended content)

Three tiers, most important first.

**Tier 1 — Protection (the AdGuard/Ghostery hero).**
- **Blocked on this page**: one combined number + a 3-line breakdown — ads+trackers (approx),
  elements, popups. (Have it per-page already.)
- **Today / All-time** totals (NEW, from §3). This is the headline upgrade.
- Optional: **on this site (all-time)** — per-site total.
- **Protection status row** for the current site: compact on/off chips — Ads, Trackers, Cosmetics,
  Popups, Params, Auto-sensor, Scriptlets. (Ghostery-style "what's active here".)

**Tier 2 — Page health (YoshTool's edge, already built).**
- Speed: TTFB / FCP / LCP / CLS / Load, colour-coded.
- Weight: requests + bytes.
- Ping + connection.
  Adblockers don't show this — it's a real differentiator, keep it.

**Tier 3 — Privacy.**
- Fields protected by auto-sensor on this page (NEW, small).
- (Optional) cookies set for this site.

Leave every item in §2.C out of the Overview.

---

## 5. Where to put it — placement models

The ask listed: side chip/pill, popup, hover badge/chip, or a best-practice recommendation. Modelled:

### Model A — Enhance the existing rail hover/pin overview  ★ recommended (quick glance)
The "page at a glance" card already exists (`rail.js` `fillOverview`), already live-synced, already
themed, already positioned next to the chip. Add the Tier-1 cumulative block + protection-status row
to it. Make it **click-to-pin** (not hover-only) so it stays open and works on touch.
- **Pros:** zero new surface; discoverable; no popup needed; already live. Mirrors Ghostery's
  "icon → panel".
- **Cons:** needs the rail enabled; hover alone is awkward on touch → fixed by click-to-pin.

### Model B — "Overview" as the popup's default landing view  ★ recommended (dashboard)
Add an **Overview** panel and make it the popup's first screen (like AdGuard's main screen): hero
"blocked on this page", today / all-time, protection status, Tier-2 vitals, Tier-3 privacy, plus a
small **sparkline of blocks over the last N days**. The popup is the canonical, clickable, input-
agnostic surface with room for history.
- **Pros:** canonical; works everywhere; room for detail/charts; this is where AdGuard/Ghostery put
  their main stats.
- **Cons:** one click to open the icon.

### Model C — Badge-title tooltip  ✗ not as the Overview
`chrome.action.setTitle` is text-only and **re-shows/flickers on every update** — we already hit
this and reverted the ping title for that reason. Use it for at most a **one-line** summary
("YoshTool — 42 blocked here · 1.2k today"), never the card.

### Model D — In-page HUD panel  ○ optional
A larger pinned panel from the rail. This is just Model A made persistent — folded into A via
click-to-pin.

### Recommended: **A + B sharing one data source.**
Exactly how Ghostery/AdGuard ship it — an **icon/rail panel for the quick glance** and a **fuller
dashboard in the popup** — both reading the **same persisted `ytStats`** from the service worker, so
they never disagree. The badge stays the live number; its title gets an optional one-liner.

```
                ┌─────────────────────────────────────────┐
  service       │  ytStats store  (storage.local, SW)      │
  worker  ──────►  today / total / perSite / protections   │
                └───────────────┬──────────────┬───────────┘
                                │ push/pull     │ pull
                     ┌──────────▼───────┐  ┌────▼─────────────┐
                     │ Rail overview    │  │ Popup "Overview" │
                     │ (glance, pin)    │  │ (dashboard)      │
                     │  Model A         │  │  Model B         │
                     └──────────────────┘  └──────────────────┘
       badge = live number · badge title = optional one-liner (Model C)
```

---

## 6. Suggested build order (if approved)

1. **`stats-core.js`** (pure, Node-tested): day roll-over, increment, per-site merge, top-sites.
2. **Background wiring**: persist on `cosmetic-count` / `pb-blocked` / `updateNetCount`; add
   `sensor-count`; a `overview-stats` message returning `{page, today, total, perSite, protections}`.
3. **Model A**: extend `rail.js` `fillOverview` with the cumulative block + protection row +
   click-to-pin.
4. **Model B**: Overview panel as the popup's default view + a blocks sparkline.
5. Optional Model C one-liner title.
6. Verify loop: `node --test`, `node --check`, the forbidden-string grep, popup-ID cross-check, render
   harness; bump minor (new feature → `1.40.0`), CHANGELOG + README.

Each as its own branch, merged only on explicit request.

---

## 7. Open questions for the user

- **Scope v1:** both surfaces (A+B), or start with one? (Recommend A first — smallest, builds on the
  existing card — then B.)
- **"Data saved":** omit (recommended) or show as a clearly-estimated `~` value?
- **Per-site history:** keep lifetime per-site totals (enables a "top blocked sites" list) or only
  this-site + global to stay lean?
