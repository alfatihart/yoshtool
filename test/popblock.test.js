import { test } from "node:test";
import assert from "node:assert/strict";
import {
  shouldBlockPopup,
  hostMatches,
  hostnameOf,
  parseUrl,
} from "../popblock-core.js";

test("window.open programatik diblok secara default", () => {
  const r = shouldBlockPopup({ type: "window.open", href: "https://ads.evil.example/x" }, {});
  assert.equal(r.block, true);
  assert.equal(r.sameContext, true);
  assert.equal(r.hostname, "ads.evil.example");
});

test("window.open tanpa href (about:blank) tetap diblok", () => {
  const r = shouldBlockPopup({ type: "window.open", href: "" }, {});
  assert.equal(r.block, true);
});

test("window.open ke host whitelist dilepas", () => {
  const cfg = { whitelist: ["accounts.google.com", "paypal.com"] };
  assert.equal(shouldBlockPopup({ type: "window.open", href: "https://accounts.google.com/o/oauth2" }, cfg).block, false);
  // subdomain dari entri whitelist juga lolos
  assert.equal(shouldBlockPopup({ type: "window.open", href: "https://www.paypal.com/checkout" }, cfg).block, false);
});

test("window.open same-registrable dilepas hanya bila allowSameOrigin", () => {
  const href = "https://app.example.com/popup";
  assert.equal(shouldBlockPopup({ type: "window.open", href }, { allowSameOrigin: true, topHost: "example.com" }).block, false);
  // tanpa allowSameOrigin → tetap blok
  assert.equal(shouldBlockPopup({ type: "window.open", href }, { topHost: "example.com" }).block, true);
});

test("protokol yang diizinkan (magnet:) dilepas", () => {
  const cfg = { protocols: ["magnet:"] };
  assert.equal(shouldBlockPopup({ type: "window.open", href: "magnet:?xt=urn:btih:abc" }, cfg).block, false);
});

test("klik target=_blank: default (non-strict) TIDAK diblok", () => {
  const r = shouldBlockPopup(
    { type: "element.click", hasAnchor: true, hasBase: true, href: "https://x.example/" },
    {},
  );
  assert.equal(r.block, false);
});

test("klik target=_blank: pada mode strict diblok", () => {
  const r = shouldBlockPopup(
    { type: "element.click", hasAnchor: true, hasBase: true, href: "https://x.example/" },
    { strict: true },
  );
  assert.equal(r.block, true);
});

test("strict: ctrl/cmd-klik ASLI (trusted) dilepas", () => {
  const r = shouldBlockPopup(
    { type: "element.click", hasAnchor: true, hasBase: true, metaKey: true, isTrusted: true },
    { strict: true },
  );
  assert.equal(r.block, false);
});

test("strict: metaKey sintetis (untrusted) tetap diblok", () => {
  const r = shouldBlockPopup(
    { type: "element.click", hasAnchor: true, hasBase: true, metaKey: true, isTrusted: false },
    { strict: true },
  );
  assert.equal(r.block, true);
});

test("strict: defaultPrevented dilepas", () => {
  const r = shouldBlockPopup(
    { type: "element.click", hasAnchor: true, hasBase: true, defaultPrevented: true },
    { strict: true },
  );
  assert.equal(r.block, false);
});

test("strict: A[download] dilepas", () => {
  const r = shouldBlockPopup(
    { type: "element.click", tag: "A", download: "file.zip", hasAnchor: true, hasBase: true },
    { strict: true },
  );
  assert.equal(r.block, false);
});

test("strict: klik tanpa base target (hasBase=false) dilepas", () => {
  const r = shouldBlockPopup(
    { type: "element.click", hasAnchor: true, hasBase: false, href: "https://x.example/" },
    { strict: true },
  );
  assert.equal(r.block, false);
});

test("hostMatches dua-arah", () => {
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
