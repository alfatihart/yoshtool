import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEVICES,
  getDevice,
  getLiveChromeMajor,
  patchChromeVersion,
  orientDimensions,
  buildMetricsOverride,
  buildUserAgentMetadata,
  buildUserAgentOverride,
  buildTouchOverride,
} from "../device-presets.js";

test("DEVICES: every preset has valid, complete fields", () => {
  assert.ok(DEVICES.length >= 12, "expected a curated list of at least 12 devices");
  const ids = new Set();
  for (const d of DEVICES) {
    assert.ok(d.id && typeof d.id === "string", `id missing: ${JSON.stringify(d)}`);
    assert.ok(!ids.has(d.id), `duplicate id: ${d.id}`);
    ids.add(d.id);
    assert.ok(d.label && typeof d.label === "string", `label missing on ${d.id}`);
    assert.ok(["phone", "tablet"].includes(d.group), `bad group on ${d.id}`);
    assert.ok(["ios", "android"].includes(d.os), `bad os on ${d.id}`);
    assert.ok(Number.isInteger(d.width) && d.width > 0, `bad width on ${d.id}`);
    assert.ok(Number.isInteger(d.height) && d.height > 0, `bad height on ${d.id}`);
    assert.ok(d.deviceScaleFactor > 0, `bad dpr on ${d.id}`);
    assert.ok(typeof d.ua === "string" && d.ua.length > 20, `bad ua on ${d.id}`);
    assert.equal(typeof d.mobile, "boolean", `mobile must be boolean on ${d.id}`);
    assert.ok(Number.isInteger(d.maxTouchPoints) && d.maxTouchPoints > 0, `bad touch on ${d.id}`);
  }
});

test("UA shape matches os: iOS→Safari no Chrome token; Android→Chrome token", () => {
  for (const d of DEVICES) {
    if (d.os === "ios") {
      assert.match(d.ua, /Safari\/604\.1/, `iOS ua should be Safari: ${d.id}`);
      assert.doesNotMatch(d.ua, /Chrome\//, `iOS ua should have no Chrome token: ${d.id}`);
    } else {
      assert.match(d.ua, /Chrome\/\d+/, `Android ua should have a Chrome token: ${d.id}`);
      assert.match(d.ua, /Android/, `Android ua should say Android: ${d.id}`);
    }
  }
  // Android tablet (Galaxy Tab) has no "Mobile" token; Android phones do.
  assert.doesNotMatch(getDevice("galaxy-tab-s9").ua, /Mobile/, "Android tablet UA has no Mobile token");
  assert.match(getDevice("pixel-7").ua, /Mobile Safari/, "Android phone UA has Mobile token");
});

test("getDevice", () => {
  assert.equal(getDevice("pixel-7").label, "Pixel 7");
  assert.equal(getDevice("nope"), undefined);
});

test("getLiveChromeMajor", () => {
  assert.equal(
    getLiveChromeMajor(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    ),
    140,
  );
  assert.equal(getLiveChromeMajor("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5) Safari/604.1"), null);
  assert.equal(getLiveChromeMajor(""), null);
});

test("patchChromeVersion: rewrites Android Chrome token, leaves iOS UA untouched", () => {
  const android = getDevice("pixel-7").ua;
  const patched = patchChromeVersion(android, 140);
  assert.match(patched, /Chrome\/140\.0\.0\.0 Mobile Safari/);
  assert.doesNotMatch(patched, /Chrome\/131/);

  const ios = getDevice("iphone-15-pro").ua;
  assert.equal(patchChromeVersion(ios, 140), ios, "iOS UA has no Chrome token to patch");

  // Invalid/missing major → unchanged.
  assert.equal(patchChromeVersion(android, null), android);
  assert.equal(patchChromeVersion(android, 0), android);
  assert.equal(patchChromeVersion(android, "abc"), android);
});

test("orientDimensions: swaps only when landscape", () => {
  assert.deepEqual(orientDimensions(390, 844, false), { width: 390, height: 844 });
  assert.deepEqual(orientDimensions(390, 844, true), { width: 844, height: 390 });
});

test("buildMetricsOverride: portrait + landscape + dpr/mobile", () => {
  const d = getDevice("iphone-15-pro");
  const p = buildMetricsOverride(d, false);
  assert.deepEqual(p, {
    width: 393,
    height: 852,
    deviceScaleFactor: 3,
    mobile: true,
    screenOrientation: { type: "portraitPrimary", angle: 0 },
  });
  const l = buildMetricsOverride(d, true);
  assert.equal(l.width, 852);
  assert.equal(l.height, 393);
  assert.equal(l.screenOrientation.type, "landscapePrimary");
  assert.equal(l.screenOrientation.angle, 90);

  // Works on a plain custom-size object too.
  const custom = buildMetricsOverride({ width: 300, height: 500, deviceScaleFactor: 1, mobile: true }, false);
  assert.equal(custom.width, 300);
  assert.equal(custom.deviceScaleFactor, 1);
});

test("buildUserAgentMetadata: Android gets Chromium brands; iOS gets empty", () => {
  const android = buildUserAgentMetadata(getDevice("pixel-7"), 140);
  assert.equal(android.platform, "Android");
  assert.equal(android.model, "Pixel 7");
  assert.equal(android.mobile, true);
  assert.ok(android.brands.some((b) => b.brand === "Google Chrome" && b.version === "140"));
  assert.ok(android.fullVersionList.some((b) => b.brand === "Chromium" && b.version === "140.0.0.0"));

  const ios = buildUserAgentMetadata(getDevice("iphone-15-pro"), 140);
  assert.deepEqual(ios.brands, [], "iOS exposes no Chromium brands");
  assert.equal(ios.platform, "");
  assert.equal(ios.model, "");
  assert.equal(ios.mobile, true);

  // Android tablet is not "mobile".
  assert.equal(buildUserAgentMetadata(getDevice("galaxy-tab-s9"), 140).mobile, true);
});

test("buildUserAgentOverride: UA patched + metadata attached", () => {
  const o = buildUserAgentOverride(getDevice("galaxy-s23"), 140);
  assert.match(o.userAgent, /Chrome\/140\.0\.0\.0 Mobile Safari/);
  assert.equal(o.userAgentMetadata.platform, "Android");
  assert.equal(o.userAgentMetadata.model, "SM-S911B");
});

test("buildTouchOverride", () => {
  assert.deepEqual(buildTouchOverride(getDevice("pixel-7")), { enabled: true, maxTouchPoints: 5 });
  assert.deepEqual(buildTouchOverride({ maxTouchPoints: 1 }), { enabled: true, maxTouchPoints: 1 });
});
