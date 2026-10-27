import { test } from "node:test";
import assert from "node:assert/strict";
import {
  genNIK, genPhoneID, genNPWP, genRekening, genKodePos, genEmail, genAddressID,
  genDate, genNumber, matchField, generateFor, PROVINCE_CODES, PHONE_PREFIXES,
} from "../faker-data.js";

// Run the random generators many times so structure is verified across seeds.
function repeat(fn, n = 200) { for (let i = 0; i < n; i++) fn(); }

test("genNIK: 16 digits, valid province code, day 1-31 or 41-71 (female +40)", () => {
  repeat(() => {
    const nik = genNIK();
    assert.match(nik, /^\d{16}$/);
    assert.ok(PROVINCE_CODES.includes(nik.slice(0, 2)), `provinsi ${nik.slice(0, 2)}`);
    const dd = Number(nik.slice(6, 8));
    assert.ok((dd >= 1 && dd <= 31) || (dd >= 41 && dd <= 71), `dd ${dd}`);
    const mm = Number(nik.slice(8, 10));
    assert.ok(mm >= 1 && mm <= 12, `mm ${mm}`);
  });
  assert.match(genNIK(true), /^\d{16}$/); // female
});

test("genPhoneID: valid operator prefix, starts with 08, length 10-13", () => {
  repeat(() => {
    const p = genPhoneID();
    assert.match(p, /^08\d{8,11}$/);
    assert.ok(PHONE_PREFIXES.includes(p.slice(0, 4)), `prefix ${p.slice(0, 4)}`);
    assert.ok(p.length >= 10 && p.length <= 13, `len ${p.length}`);
  });
});

test("genNPWP: legacy 15-digit format", () => {
  repeat(() => assert.match(genNPWP(), /^\d{2}\.\d{3}\.\d{3}\.\d-\d{3}\.\d{3}$/));
});

test("genRekening: length per bank", () => {
  repeat(() => {
    const r = genRekening();
    assert.match(r, /^\d+$/);
    assert.ok([10, 11, 13, 15].includes(r.length), `len ${r.length}`);
  });
});

test("genKodePos 5 digits; genEmail has @ and domain; genDate YYYY-MM-DD", () => {
  repeat(() => {
    assert.match(genKodePos(), /^\d{5}$/);
    assert.match(genEmail(), /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/);
    assert.match(genDate(), /^\d{4}-\d{2}-\d{2}$/);
  }, 50);
});

test("genNumber within range", () => {
  repeat(() => {
    const n = Number(genNumber(5, 10));
    assert.ok(n >= 5 && n <= 10, `n ${n}`);
  });
});

test("genAddressID contains Indonesian address markers", () => {
  const a = genAddressID();
  assert.match(a, /^Jl\. /);
  assert.match(a, /Kec\. /);
  assert.match(a, /\d{5}$/);
});

test("matchField: input type override", () => {
  assert.equal(matchField("apa saja", "email"), "email");
  assert.equal(matchField("apa saja", "tel"), "telephone");
  assert.equal(matchField("apa saja", "date"), "date");
  assert.equal(matchField("apa saja", "password"), "password");
});

test("matchField: field context (keyword)", () => {
  assert.equal(matchField("Email Address", "text"), "email");
  assert.equal(matchField("firstName", "text"), "first-name");
  assert.equal(matchField("Nama Lengkap", "text"), "full-name");
  assert.equal(matchField("No. Telepon", "text"), "telephone");
  assert.equal(matchField("NIK", "text"), "nik");
  assert.equal(matchField("Nomor Rekening", "text"), "account");
  assert.equal(matchField("Alamat", "text"), "address");
  assert.equal(matchField("Kode Pos", "text"), "zip");
  assert.equal(matchField("NPWP", "text"), "npwp");
  assert.equal(matchField("xyz tidak dikenal", "text"), null);
});

test("matchField: specific wins over generic (firstName not name)", () => {
  assert.equal(matchField("firstName", "text"), "first-name");
  assert.equal(matchField("lastName", "text"), "last-name");
  assert.equal(matchField("fullName", "text"), "full-name");
});

test("generateFor returns a non-empty string for each type", () => {
  for (const t of ["email", "full-name", "telephone", "nik", "npwp", "account", "address", "zip", "date", "number", "password", "url", "card"]) {
    const v = generateFor(t);
    assert.equal(typeof v, "string");
    assert.ok(v.length > 0, `type ${t} kosong`);
  }
});
