import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findMatches,
  luhnValid,
  DETECTOR_KINDS,
  shannonEntropy,
  looksLikeSecret,
  looksLikeIp,
  looksLikeAccountNumber,
  SECRET_FIELD_RE,
  PII_FIELD_RE,
  SENSITIVE_COL_RE,
} from "../redact.js";

function kindsOf(text) {
  return findMatches(text).map((m) => m.kind);
}

test("luhnValid is true for test cards and false for random numbers", () => {
  assert.equal(luhnValid("4242 4242 4242 4242"), true); // Stripe test card
  assert.equal(luhnValid("4242-4242-4242-4241"), false);
  assert.equal(luhnValid("1234567812345678"), false);
});

test("detects email", () => {
  const m = findMatches("hubungi saya di restu@konsultanedu.id ya");
  assert.equal(m.length, 1);
  assert.equal(m[0].kind, "email");
  assert.equal(m[0].value, "restu@konsultanedu.id");
});

test("detects only credit cards that pass Luhn", () => {
  assert.deepEqual(kindsOf("kartu 4242 4242 4242 4242"), ["credit_card"]);
  assert.deepEqual(kindsOf("nomor 4242 4242 4242 4241"), []); // fails Luhn
});

test("detects JWT", () => {
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.abc123_DEF-xyz";
  assert.deepEqual(kindsOf(`token: ${jwt}`), ["jwt"]);
});

test("detects API keys from various providers", () => {
  assert.deepEqual(kindsOf("AKIAIOSFODNN7EXAMPLE"), ["api_key"]); // AWS
  assert.deepEqual(kindsOf("sk_live_abcdef0123456789ABCDEF"), ["api_key"]); // Stripe
  assert.deepEqual(kindsOf("ghp_" + "a".repeat(36)), ["api_key"]); // GitHub
});

test("detects Indonesian phone numbers", () => {
  assert.deepEqual(kindsOf("WA 0812-3456-7890"), ["phone"]);
  assert.deepEqual(kindsOf("telp +62 812 3456 7890"), ["phone"]);
});

test("plain text does not trigger false positives", () => {
  assert.deepEqual(kindsOf("Halo dunia, ini kalimat biasa tanpa data sensitif."), []);
  assert.deepEqual(kindsOf("tahun 2026 dan angka 42"), []);
});

test("no overlapping ranges", () => {
  const m = findMatches("email a@b.co dan kartu 4242 4242 4242 4242");
  for (let i = 1; i < m.length; i++) {
    assert.ok(m[i].start >= m[i - 1].end, "rentang tidak boleh tumpang tindih");
  }
});

test("DETECTOR_KINDS contains the core categories", () => {
  for (const k of ["email", "phone", "credit_card", "api_key", "jwt", "iban", "address"]) {
    assert.ok(DETECTOR_KINDS.includes(k), `harus ada kategori ${k}`);
  }
});

test("detects Indonesian addresses (with numeric signals)", () => {
  assert.deepEqual(kindsOf("Jl. Sudirman No. 10, Jakarta 12190"), ["address"]);
  assert.deepEqual(kindsOf("Perumahan Griya Indah Blok C2 No. 5"), ["address"]);
  assert.deepEqual(kindsOf("tinggal di RT 01/RW 02 Kelurahan Merdeka"), ["address"]);
});

test("sentences with the word 'jalan' but no address signal are not flagged", () => {
  assert.deepEqual(kindsOf("Jalan menuju kesuksesan tidaklah mudah"), []);
  assert.deepEqual(kindsOf("Blok ini sedang dibangun tahun depan"), []);
});

test("alphanumeric transaction codes are not flagged as numbers", () => {
  assert.deepEqual(kindsOf("Reference No T3008621783083XR3Z4"), []);
  assert.deepEqual(kindsOf("Merchant Ref INV2502000024799S"), []);
});

test("PII_FIELD_RE matches personal-data field labels", () => {
  for (const s of ["Alamat", "Email", "E-mail", "No. Telepon", "Nomor HP", "WhatsApp", "Kode Pos"]) {
    assert.ok(PII_FIELD_RE.test(s), `harus cocok: ${s}`);
  }
  assert.equal(PII_FIELD_RE.test("Nama Merchant"), false);
  assert.equal(PII_FIELD_RE.test("Jumlah"), false);
});

test("PII_FIELD_RE matches location/financial/endpoint fields", () => {
  for (const s of [
    "Province", "Provinsi", "City / Regency", "Kabupaten", "Subdistrict", "Kecamatan",
    "Kelurahan", "Account Number", "No Rekening", "Card Number", "No. Kartu", "CVV",
    "Callback URL", "Webhook URL", "Virtual Account", "Whitelist IP",
  ]) {
    assert.ok(PII_FIELD_RE.test(s), `harus cocok: ${s}`);
  }
});

test("PII_FIELD_RE does NOT match non-sensitive / owner / lookup labels", () => {
  for (const s of [
    "Merchant Name", "Account Owner", "Reference No / Merchant / Customer", "Bank Name",
    "Full Name", "Merchant Code", "Withdrawal Fee", "Account Notes",
  ]) {
    assert.equal(PII_FIELD_RE.test(s), false, `tidak boleh cocok: ${s}`);
  }
});

test("looksLikeIp recognizes IPv4/IPv6 in field values", () => {
  assert.equal(looksLikeIp("103.10.20.30"), true);
  assert.equal(looksLikeIp("192.168.1.1,10.0.0.1"), true); // comma-separated list
  assert.equal(looksLikeIp("2001:db8::1"), true); // IPv6
  assert.equal(looksLikeIp("1.2.3"), false); // missing an octet
  assert.equal(looksLikeIp("999.1.1.1"), false); // octet > 255
  assert.equal(looksLikeIp("T3008621783083XR3Z4"), false); // transaction code
});

test("looksLikeAccountNumber only for pure 10-19 digit sequences (field values)", () => {
  assert.equal(looksLikeAccountNumber("8712345682"), true); // 10 digits (BCA account)
  assert.equal(looksLikeAccountNumber("6017 0000 1234 5678"), true); // has spaces → stripped
  assert.equal(looksLikeAccountNumber("3173010101010001"), true); // 16 digits (NIK)
  assert.equal(looksLikeAccountNumber("90245"), false); // postal code, < 10
  assert.equal(looksLikeAccountNumber("T3008621783083XR3Z4"), false); // contains letters
  assert.equal(looksLikeAccountNumber("Rp 7.500"), false); // contains letters/dots
  assert.equal(looksLikeAccountNumber(""), false);
});

test("SENSITIVE_COL_RE matches sensitive column headers, not transaction columns", () => {
  for (const s of ["Destination Account", "Whitelist IP", "Account Number", "No Rekening"]) {
    assert.ok(SENSITIVE_COL_RE.test(s), `harus cocok: ${s}`);
  }
  for (const s of ["Reference No", "Description", "Amount", "Status", "Date", "Channel"]) {
    assert.equal(SENSITIVE_COL_RE.test(s), false, `tidak boleh cocok: ${s}`);
  }
});

test("looksLikeSecret flags high-entropy custom tokens (TriPay style)", () => {
  assert.equal(looksLikeSecret("DEV-OmbQ9aZ3kFnP2sR7tVwXyZ1bGzupKZYSunyFY"), true);
  assert.equal(looksLikeSecret("NXoNL-wQ8mKpLzCvBnM1nr-qAjP3xYtReWq"), true);
});

test("looksLikeSecret does not flag non-secrets", () => {
  assert.equal(looksLikeSecret("Merchant Sandbox"), false); // has spaces
  assert.equal(looksLikeSecret("T21851"), false); // too short
  assert.equal(looksLikeSecret("https://ewako.konsultanedu.com/functions/v1/x"), false); // URL
  assert.equal(looksLikeSecret("aaaaaaaaaaaaaaaaaaaaaaaa"), false); // low entropy / single character class
});

test("shannonEntropy: random string > repeated string", () => {
  assert.ok(shannonEntropy("aB3$xK9pQ") > shannonEntropy("aaaaaaaaa"));
});

test("SECRET_FIELD_RE matches secret field labels", () => {
  for (const s of ["API Key", "Private Key", "Client Secret", "access_token", "Password"]) {
    assert.ok(SECRET_FIELD_RE.test(s), `harus cocok: ${s}`);
  }
  assert.equal(SECRET_FIELD_RE.test("Merchant Name"), false);
  assert.equal(SECRET_FIELD_RE.test("Callback URL"), false);
});
