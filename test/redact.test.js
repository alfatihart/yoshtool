import { test } from "node:test";
import assert from "node:assert/strict";
import { findMatches, luhnValid, DETECTOR_KINDS } from "../redact.js";

function kindsOf(text) {
  return findMatches(text).map((m) => m.kind);
}

test("luhnValid benar untuk kartu uji dan salah untuk angka acak", () => {
  assert.equal(luhnValid("4242 4242 4242 4242"), true); // kartu uji Stripe
  assert.equal(luhnValid("4242-4242-4242-4241"), false);
  assert.equal(luhnValid("1234567812345678"), false);
});

test("deteksi email", () => {
  const m = findMatches("hubungi saya di restu@konsultanedu.id ya");
  assert.equal(m.length, 1);
  assert.equal(m[0].kind, "email");
  assert.equal(m[0].value, "restu@konsultanedu.id");
});

test("deteksi kartu kredit hanya yang lolos Luhn", () => {
  assert.deepEqual(kindsOf("kartu 4242 4242 4242 4242"), ["credit_card"]);
  assert.deepEqual(kindsOf("nomor 4242 4242 4242 4241"), []); // gagal Luhn
});

test("deteksi JWT", () => {
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.abc123_DEF-xyz";
  assert.deepEqual(kindsOf(`token: ${jwt}`), ["jwt"]);
});

test("deteksi API key berbagai penyedia", () => {
  assert.deepEqual(kindsOf("AKIAIOSFODNN7EXAMPLE"), ["api_key"]); // AWS
  assert.deepEqual(kindsOf("sk_live_abcdef0123456789ABCDEF"), ["api_key"]); // Stripe
  assert.deepEqual(kindsOf("ghp_" + "a".repeat(36)), ["api_key"]); // GitHub
});

test("deteksi telepon Indonesia", () => {
  assert.deepEqual(kindsOf("WA 0812-3456-7890"), ["phone"]);
  assert.deepEqual(kindsOf("telp +62 812 3456 7890"), ["phone"]);
});

test("teks biasa tidak memicu false positive", () => {
  assert.deepEqual(kindsOf("Halo dunia, ini kalimat biasa tanpa data sensitif."), []);
  assert.deepEqual(kindsOf("tahun 2026 dan angka 42"), []);
});

test("tidak ada rentang yang tumpang tindih", () => {
  const m = findMatches("email a@b.co dan kartu 4242 4242 4242 4242");
  for (let i = 1; i < m.length; i++) {
    assert.ok(m[i].start >= m[i - 1].end, "rentang tidak boleh tumpang tindih");
  }
});

test("DETECTOR_KINDS memuat kategori inti", () => {
  for (const k of ["email", "phone", "credit_card", "api_key", "jwt", "iban"]) {
    assert.ok(DETECTOR_KINDS.includes(k), `harus ada kategori ${k}`);
  }
});
