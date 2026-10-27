import { test } from "node:test";
import assert from "node:assert/strict";
import {
  randomBytes,
  toB64,
  fromB64,
  deriveKey,
  encryptJSON,
  decryptJSON,
  makeEncMeta,
  unlockKey,
} from "../sessioncrypto.js";

test("base64 round-trips arbitrary bytes", () => {
  const bytes = randomBytes(40);
  assert.deepEqual([...fromB64(toB64(bytes))], [...bytes]);
});

test("encrypt then decrypt returns the original value", async () => {
  const key = await deriveKey("correct horse", fromB64(toB64(randomBytes(16))), 50000);
  const value = { cookies: [{ name: "sb-token", value: "abc.def" }], storage: { local: { a: "1" } } };
  const blob = await encryptJSON(key, value);
  assert.ok(blob.iv && blob.ct);
  assert.deepEqual(await decryptJSON(key, blob), value);
});

test("decrypt with a different key fails (GCM auth)", async () => {
  const salt = randomBytes(16);
  const k1 = await deriveKey("passphrase-one", salt, 50000);
  const k2 = await deriveKey("passphrase-two", salt, 50000);
  const blob = await encryptJSON(k1, { secret: 42 });
  await assert.rejects(() => decryptJSON(k2, blob));
});

test("unlockKey accepts the right passphrase and rejects the wrong one", async () => {
  const { meta, key } = await makeEncMeta("master-pass");
  assert.equal(meta.enabled, true);
  assert.ok(meta.salt && meta.verifier);
  // right passphrase → a working key (can decrypt what the original key encrypted)
  const blob = await encryptJSON(key, { x: 1 });
  const unlocked = await unlockKey("master-pass", meta);
  assert.deepEqual(await decryptJSON(unlocked, blob), { x: 1 });
  // wrong passphrase → rejects
  await assert.rejects(() => unlockKey("not-the-pass", meta), /Wrong passphrase/);
});
