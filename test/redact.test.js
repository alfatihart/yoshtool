import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findMatches,
  luhnValid,
  DETECTOR_KINDS,
  shannonEntropy,
  looksLikeSecret,
  SECRET_FIELD_RE,
  PII_FIELD_RE,
} from "../redact.js";

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
  for (const k of ["email", "phone", "credit_card", "api_key", "jwt", "iban", "address"]) {
    assert.ok(DETECTOR_KINDS.includes(k), `harus ada kategori ${k}`);
  }
});

test("deteksi alamat Indonesia (dengan sinyal angka)", () => {
  assert.deepEqual(kindsOf("Jl. Sudirman No. 10, Jakarta 12190"), ["address"]);
  assert.deepEqual(kindsOf("Perumahan Griya Indah Blok C2 No. 5"), ["address"]);
  assert.deepEqual(kindsOf("tinggal di RT 01/RW 02 Kelurahan Merdeka"), ["address"]);
});

test("kalimat ber-kata 'jalan' tanpa sinyal alamat tidak tertandai", () => {
  assert.deepEqual(kindsOf("Jalan menuju kesuksesan tidaklah mudah"), []);
  assert.deepEqual(kindsOf("Blok ini sedang dibangun tahun depan"), []);
});

test("PII_FIELD_RE cocok untuk label field data pribadi", () => {
  for (const s of ["Alamat", "Email", "E-mail", "No. Telepon", "Nomor HP", "WhatsApp", "Kode Pos"]) {
    assert.ok(PII_FIELD_RE.test(s), `harus cocok: ${s}`);
  }
  assert.equal(PII_FIELD_RE.test("Nama Merchant"), false);
  assert.equal(PII_FIELD_RE.test("Jumlah"), false);
});

test("PII_FIELD_RE cocok untuk field lokasi/finansial/endpoint", () => {
  for (const s of [
    "Province", "Provinsi", "City / Regency", "Kabupaten", "Subdistrict", "Kecamatan",
    "Kelurahan", "Account Number", "No Rekening", "Card Number", "No. Kartu", "CVV",
    "Callback URL", "Webhook URL", "Virtual Account",
  ]) {
    assert.ok(PII_FIELD_RE.test(s), `harus cocok: ${s}`);
  }
});

test("PII_FIELD_RE TIDAK cocok untuk label non-sensitif / pemilik / pencarian", () => {
  for (const s of [
    "Merchant Name", "Account Owner", "Reference No / Merchant / Customer", "Bank Name",
    "Full Name", "Merchant Code", "Withdrawal Fee", "Account Notes",
  ]) {
    assert.equal(PII_FIELD_RE.test(s), false, `tidak boleh cocok: ${s}`);
  }
});

test("looksLikeSecret menandai token custom high-entropy (gaya TriPay)", () => {
  assert.equal(looksLikeSecret("DEV-OmbQ9aZ3kFnP2sR7tVwXyZ1bGzupKZYSunyFY"), true);
  assert.equal(looksLikeSecret("NXoNL-wQ8mKpLzCvBnM1nr-qAjP3xYtReWq"), true);
});

test("looksLikeSecret tidak menandai hal yang bukan secret", () => {
  assert.equal(looksLikeSecret("Merchant Sandbox"), false); // ada spasi
  assert.equal(looksLikeSecret("T21851"), false); // terlalu pendek
  assert.equal(looksLikeSecret("https://ewako.konsultanedu.com/functions/v1/x"), false); // URL
  assert.equal(looksLikeSecret("aaaaaaaaaaaaaaaaaaaaaaaa"), false); // entropi rendah / satu kelas
});

test("shannonEntropy: string acak > string berulang", () => {
  assert.ok(shannonEntropy("aB3$xK9pQ") > shannonEntropy("aaaaaaaaa"));
});

test("SECRET_FIELD_RE cocok untuk label field rahasia", () => {
  for (const s of ["API Key", "Private Key", "Client Secret", "access_token", "Password"]) {
    assert.ok(SECRET_FIELD_RE.test(s), `harus cocok: ${s}`);
  }
  assert.equal(SECRET_FIELD_RE.test("Merchant Name"), false);
  assert.equal(SECRET_FIELD_RE.test("Callback URL"), false);
});
