import { test } from "node:test";
import assert from "node:assert/strict";
import { registrableDomain, makeSession } from "../sessions.js";

test("registrableDomain: ordinary domains", () => {
  assert.equal(registrableDomain("www.google.com"), "google.com");
  assert.equal(registrableDomain("example.com"), "example.com");
  assert.equal(registrableDomain("sub.example.com"), "example.com");
  assert.equal(registrableDomain("a.b.c.example.com"), "example.com");
});

test("registrableDomain: multi-part eTLD (ID & common)", () => {
  assert.equal(registrableDomain("fly.web.id"), "fly.web.id");
  assert.equal(registrableDomain("dashboard.tripay.co.id"), "tripay.co.id");
  assert.equal(registrableDomain("panel.konsultanedu.com"), "konsultanedu.com");
  assert.equal(registrableDomain("a.b.co.uk"), "b.co.uk");
  assert.equal(registrableDomain("shop.example.com.au"), "example.com.au");
});

test("registrableDomain: normalization & edge cases", () => {
  assert.equal(registrableDomain("Panel.Konsultanedu.COM"), "konsultanedu.com");
  assert.equal(registrableDomain("example.com."), "example.com");
  assert.equal(registrableDomain("localhost"), "localhost");
  assert.equal(registrableDomain("192.168.1.1"), "192.168.1.1");
  assert.equal(registrableDomain("web.id"), "web.id"); // suffix only → returned as-is
  assert.equal(registrableDomain(""), "");
});

test("makeSession: data shape", () => {
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
  // storage (localStorage/sessionStorage) is persisted too
  assert.equal(s.storage.local["sb-auth-token"], "abc");
  assert.deepEqual(s.storage.session, {});
  // safe defaults
  const e = makeSession("", null, null);
  assert.equal(e.count, 0);
  assert.deepEqual(e.cookies, []);
  assert.deepEqual(e.storage, { local: {}, session: {}, idb: [] });
});

test("storageItemCount counts local + session + IndexedDB records", async () => {
  const { storageItemCount, normStorage } = await import("../sessions.js");
  assert.equal(storageItemCount({ local: { a: "1", b: "2" }, session: { c: "3" } }), 3);
  const withIdb = {
    local: { a: "1" },
    session: {},
    idb: [{ name: "db", stores: [{ name: "s", records: [{ value: 1 }, { value: 2 }] }] }],
  };
  assert.equal(storageItemCount(withIdb), 3); // 1 local + 2 idb records
  // makeSession records scount and normalizes idb to an array
  const s = makeSession("A", [], withIdb);
  assert.equal(s.scount, 3);
  assert.ok(Array.isArray(s.storage.idb));
  assert.deepEqual(normStorage(null), { local: {}, session: {}, idb: [] });
});
