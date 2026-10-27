import { test } from "node:test";
import assert from "node:assert/strict";
import { registrableDomain, makeSession } from "../sessions.js";

test("registrableDomain: domain biasa", () => {
  assert.equal(registrableDomain("www.google.com"), "google.com");
  assert.equal(registrableDomain("example.com"), "example.com");
  assert.equal(registrableDomain("sub.example.com"), "example.com");
  assert.equal(registrableDomain("a.b.c.example.com"), "example.com");
});

test("registrableDomain: eTLD majemuk (ID & umum)", () => {
  assert.equal(registrableDomain("fly.web.id"), "fly.web.id");
  assert.equal(registrableDomain("dashboard.tripay.co.id"), "tripay.co.id");
  assert.equal(registrableDomain("panel.konsultanedu.com"), "konsultanedu.com");
  assert.equal(registrableDomain("a.b.co.uk"), "b.co.uk");
  assert.equal(registrableDomain("shop.example.com.au"), "example.com.au");
});

test("registrableDomain: normalisasi & kasus tepi", () => {
  assert.equal(registrableDomain("Panel.Konsultanedu.COM"), "konsultanedu.com");
  assert.equal(registrableDomain("example.com."), "example.com");
  assert.equal(registrableDomain("localhost"), "localhost");
  assert.equal(registrableDomain("192.168.1.1"), "192.168.1.1");
  assert.equal(registrableDomain("web.id"), "web.id"); // hanya suffix → apa adanya
  assert.equal(registrableDomain(""), "");
});

test("makeSession: bentuk data", () => {
  const s = makeSession(
    "Akun A",
    [{ name: "x", value: "1" }, { name: "y", value: "2" }],
    { local: { "sb-auth-token": "abc" }, session: {} },
  );
  assert.equal(s.name, "Akun A");
  assert.equal(s.count, 2);
  assert.equal(s.cookies.length, 2);
  assert.ok(typeof s.id === "string" && s.id.startsWith("s_"));
  assert.ok(s.createdAt > 0 && s.updatedAt > 0);
  // storage (localStorage/sessionStorage) ikut tersimpan
  assert.equal(s.storage.local["sb-auth-token"], "abc");
  assert.deepEqual(s.storage.session, {});
  // default aman
  const e = makeSession("", null, null);
  assert.equal(e.count, 0);
  assert.deepEqual(e.cookies, []);
  assert.deepEqual(e.storage, { local: {}, session: {} });
});
