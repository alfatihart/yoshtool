import { test } from "node:test";
import assert from "node:assert/strict";
import {
  shouldBlockPopup,
  hostMatches,
  hostnameOf,
  parseUrl,
} from "../popblock-core.js";

test("programmatic window.open is blocked by default", () => {
  const r = shouldBlockPopup({ type: "window.open", href: "https://ads.evil.example/x" }, {});
  assert.equal(r.block, true);
  assert.equal(r.sameContext, true);
  assert.equal(r.hostname, "ads.evil.example");
});

test("window.open with no href (about:blank) is still blocked", () => {
  const r = shouldBlockPopup({ type: "window.open", href: "" }, {});
  assert.equal(r.block, true);
});

test("window.open from a user click (userActive) is NOT blocked in default mode", () => {
  // e.g. aaPanel Download button → window.open(url) during a gesture activation.
  const r = shouldBlockPopup(
    { type: "window.open", href: "https://panel.example/file.log", userActive: true },
    {},
  );
  assert.equal(r.block, false);
});

test("window.open from a user click IS still blocked in Strict mode", () => {
  const r = shouldBlockPopup(
    { type: "window.open", href: "https://panel.example/file.log", userActive: true },
    { strict: true },
  );
  assert.equal(r.block, true);
});

test("programmatic window.open (no activation) is still blocked in default mode", () => {
  const r = shouldBlockPopup(
    { type: "window.open", href: "https://ads.evil.example/pop", userActive: false },
    {},
  );
  assert.equal(r.block, true);
});

test("window.open to a whitelisted host is allowed", () => {
  const cfg = { whitelist: ["accounts.google.com", "paypal.com"] };
  assert.equal(shouldBlockPopup({ type: "window.open", href: "https://accounts.google.com/o/oauth2" }, cfg).block, false);
  // subdomains of a whitelist entry also pass
  assert.equal(shouldBlockPopup({ type: "window.open", href: "https://www.paypal.com/checkout" }, cfg).block, false);
});

test("window.open same-registrable is allowed only when allowSameOrigin", () => {
  const href = "https://app.example.com/popup";
  assert.equal(shouldBlockPopup({ type: "window.open", href }, { allowSameOrigin: true, topHost: "example.com" }).block, false);
  // without allowSameOrigin → still blocked
  assert.equal(shouldBlockPopup({ type: "window.open", href }, { topHost: "example.com" }).block, true);
});

test("allowed protocols (magnet:) are let through", () => {
  const cfg = { protocols: ["magnet:"] };
  assert.equal(shouldBlockPopup({ type: "window.open", href: "magnet:?xt=urn:btih:abc" }, cfg).block, false);
});

test("target=_blank click: default (non-strict) is NOT blocked", () => {
  const r = shouldBlockPopup(
    { type: "element.click", hasAnchor: true, hasBase: true, href: "https://x.example/" },
    {},
  );
  assert.equal(r.block, false);
});

test("target=_blank click: blocked in strict mode", () => {
  const r = shouldBlockPopup(
    { type: "element.click", hasAnchor: true, hasBase: true, href: "https://x.example/" },
    { strict: true },
  );
  assert.equal(r.block, true);
});

test("strict: genuine ctrl/cmd-click (trusted) is allowed", () => {
  const r = shouldBlockPopup(
    { type: "element.click", hasAnchor: true, hasBase: true, metaKey: true, isTrusted: true },
    { strict: true },
  );
  assert.equal(r.block, false);
});

test("strict: synthetic metaKey (untrusted) is still blocked", () => {
  const r = shouldBlockPopup(
    { type: "element.click", hasAnchor: true, hasBase: true, metaKey: true, isTrusted: false },
    { strict: true },
  );
  assert.equal(r.block, true);
});

test("strict: defaultPrevented is allowed", () => {
  const r = shouldBlockPopup(
    { type: "element.click", hasAnchor: true, hasBase: true, defaultPrevented: true },
    { strict: true },
  );
  assert.equal(r.block, false);
});

test("strict: A[download] is allowed", () => {
  const r = shouldBlockPopup(
    { type: "element.click", tag: "A", download: "file.zip", hasAnchor: true, hasBase: true },
    { strict: true },
  );
  assert.equal(r.block, false);
});

test("strict: click without a base target (hasBase=false) is allowed", () => {
  const r = shouldBlockPopup(
    { type: "element.click", hasAnchor: true, hasBase: false, href: "https://x.example/" },
    { strict: true },
  );
  assert.equal(r.block, false);
});

test("hostMatches is bidirectional", () => {
  assert.equal(hostMatches("www.paypal.com", "paypal.com"), true);
  assert.equal(hostMatches("paypal.com", "www.paypal.com"), true);
  assert.equal(hostMatches("paypal.com", "paypal.com"), true);
  assert.equal(hostMatches("evil-paypal.com", "paypal.com"), false);
  assert.equal(hostMatches("", "paypal.com"), false);
});

test("hostnameOf & parseUrl", () => {
  assert.equal(hostnameOf("https://a.b.com/x?y=1"), "a.b.com");
  assert.equal(hostnameOf("not a url"), "");
  assert.equal(parseUrl("magnet:?xt=1").protocol, "magnet:");
  assert.equal(parseUrl("relative/path"), null);
});
