// ping-core.js
// Pure helpers for the "Ping" (latency) tool. No chrome.*/DOM → Node-tested, imported by popup.js.
// The ping loop + fetch timing run in the service worker (background.js) so they survive the popup
// closing; the popup uses these helpers to render the buffer it reads from chrome.storage.session.
//
// Honest limit: a browser cannot send ICMP, and MV3 has no raw sockets — so this measures
// application-layer RTT (TCP+TLS+HTTP round-trip), which reads HIGHER than cmd `ping` and only works
// against hosts that answer on HTTPS. It's good for RELATIVE/trend latency, not for matching `ping`.

// Normalize a user target ("8.8.8.8", "google.com", "https://x.com/path") → an https origin URL to
// ping, falling back to the current tab's URL. Returns null if nothing usable.
export function normalizeTarget(input, fallbackUrl) {
  let s = String(input == null ? "" : input).trim();
  if (!s) s = String(fallbackUrl || "").trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = "https://" + s.replace(/^\/+/, "");
  try {
    const u = new URL(s);
    if (!/^https?:$/.test(u.protocol)) return null;
    return u.origin + "/";
  } catch (e) {
    return null;
  }
}

// Stats over a samples array where each entry is a number (RTT ms) or null (failed/timed-out).
// Returns { count, ok, loss (%), min, avg, max, jitter } — jitter = mean |Δ| of consecutive OK samples.
export function pingStats(samples) {
  const arr = Array.isArray(samples) ? samples : [];
  const ok = arr.filter((s) => typeof s === "number" && isFinite(s) && s >= 0);
  const count = arr.length;
  const loss = count ? Math.round(((count - ok.length) / count) * 100) : 0;
  if (!ok.length) return { count, ok: 0, loss, min: null, avg: null, max: null, jitter: null };
  let min = Infinity, max = -Infinity, sum = 0;
  for (const v of ok) { if (v < min) min = v; if (v > max) max = v; sum += v; }
  let jsum = 0, jn = 0;
  for (let i = 1; i < ok.length; i++) { jsum += Math.abs(ok[i] - ok[i - 1]); jn++; }
  return { count, ok: ok.length, loss, min, avg: sum / ok.length, max, jitter: jn ? jsum / jn : 0 };
}

// Badge text for the toolbar icon from one RTT sample (ms). Kept ≤4 chars. null/NaN/failed → "!".
export function pingBadgeText(rtt) {
  if (rtt == null || Number.isNaN(rtt) || rtt < 0) return "!";
  const ms = Math.round(rtt);
  return ms >= 10000 ? "9k+" : String(ms);
}

// Badge TEXT colour by RTT (bright, for a neutral-dark badge background so it never clashes with the
// teal logo): green < 100ms, amber < 300ms, else red (and red for a failed ping).
export function pingBadgeColor(rtt) {
  if (rtt == null || Number.isNaN(rtt) || rtt < 0) return "#f87171";
  const ms = Math.round(rtt);
  return ms < 100 ? "#4ade80" : ms < 300 ? "#fbbf24" : "#f87171";
}

// Neutral-dark badge background (distinct from the teal/green logo) used behind the coloured text.
export const PING_BADGE_BG = "#1f2937";
