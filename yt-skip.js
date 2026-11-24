// yt-skip.js — DOM-only YouTube ad auto-skipper.
// Registered on youtube.com only when the "Auto-skip YouTube ads" toggle is on AND the all-sites
// permission is granted (see background.syncYtSkip). It NEVER touches the player response — pruning
// that is detected by YouTube's anti-adblock enforcement, which then refuses to serve the stream
// (videoplayback -> 403 / ERR_NAME_NOT_RESOLVED / black video). This only does what a viewer would:
// click "Skip"/"Lewati" the instant it appears, and fast-forward an unskippable ad to its end so the
// real video resumes right away. Safe by construction — it can't break playback.
(() => {
  if (window.__yoshtoolYtSkip) return;
  window.__yoshtoolYtSkip = true;

  // Skip buttons across YouTube's player variants (classic + "modern").
  const SKIP = [
    ".ytp-ad-skip-button-modern",
    ".ytp-ad-skip-button",
    ".ytp-skip-ad-button",
    ".ytp-ad-skip-button-container button",
  ];
  // Close buttons for banner / overlay ads on top of the video.
  const CLOSE = [
    ".ytp-ad-overlay-close-button",
    ".ytp-ad-overlay-close-container",
    ".ytp-ad-overlay-close-button div",
  ];
  const clickable = (el) => el && el.offsetParent !== null;

  function tick() {
    // 1) Click a visible Skip button (skippable ads).
    for (const sel of SKIP) {
      const b = document.querySelector(sel);
      if (clickable(b)) { try { b.click(); } catch (e) {} }
    }
    // 2) Close banner / overlay ads.
    for (const sel of CLOSE) {
      const b = document.querySelector(sel);
      if (clickable(b)) { try { b.click(); } catch (e) {} }
    }
    // 3) An ad video is playing -> jump it to the end so the real video resumes immediately. We only
    //    seek while the player explicitly marks an ad (.ad-showing); normal content is never seeked.
    const player = document.querySelector(".html5-video-player, #movie_player");
    if (player && player.classList.contains("ad-showing")) {
      const v =
        player.querySelector("video.html5-main-video") ||
        player.querySelector("video") ||
        document.querySelector("video");
      if (v) {
        const d = v.duration;
        if (typeof d === "number" && isFinite(d) && d > 0 && v.currentTime < d - 0.2) {
          try { v.currentTime = d; } catch (e) {}
        }
      }
    }
  }

  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    (window.requestAnimationFrame || window.setTimeout)(() => { scheduled = false; try { tick(); } catch (e) {} }, 0);
  };
  const start = () => {
    tick();
    try {
      new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) {}
    // Fallback poll: the .ad-showing class can flip without a childList mutation we catch. Half a
    // second is unnoticeable and cheap (a couple of querySelectors).
    setInterval(() => { try { tick(); } catch (e) {} }, 500);
  };
  if (document.documentElement) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
})();
