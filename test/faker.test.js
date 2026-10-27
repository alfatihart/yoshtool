import { test } from "node:test";
import assert from "node:assert/strict";
import {
  genNIK, genPhoneID, genNPWP, genRekening, genKodePos, genEmail, genAddressID,
  genDate, genNumber, matchField, generateFor, PROVINCE_CODES, PHONE_PREFIXES,
} from "../faker-data.js";

// Jalankan generator acak berkali-kali agar struktur diverifikasi lintas seed.
function repeat(fn, n = 200) { for (let i = 0; i < n; i++) fn(); }

test("genNIK: 16 digit, kode provinsi valid, hari 1-31 atau 41-71 (perempuan +40)", () => {
  repeat(() => {
    const nik = genNIK();
    assert.match(nik, /^\d{16}$/);
    assert.ok(PROVINCE_CODES.includes(nik.slice(0, 2)), `provinsi ${nik.slice(0, 2)}`);
    const dd = Number(nik.slice(6, 8));
    assert.ok((dd >= 1 && dd <= 31) || (dd >= 41 && dd <= 71), `dd ${dd}`);
    const mm = Number(nik.slice(8, 10));
    assert.ok(mm >= 1 && mm <= 12, `mm ${mm}`);
  });
  assert.match(genNIK(true), /^\d{16}$/); // perempuan
});

test("genPhoneID: prefix operator valid, mulai 08, panjang 10-13", () => {
  repeat(() => {
    const p = genPhoneID();
    assert.match(p, /^08\d{8,11}$/);
    assert.ok(PHONE_PREFIXES.includes(p.slice(0, 4)), `prefix ${p.slice(0, 4)}`);
    assert.ok(p.length >= 10 && p.length <= 13, `len ${p.length}`);
  });
});

test("genNPWP: format legacy 15 digit", () => {
  repeat(() => assert.match(genNPWP(), /^\d{2}\.\d{3}\.\d{3}\.\d-\d{3}\.\d{3}$/));
});

test("genRekening: panjang per bank", () => {
  repeat(() => {
    const r = genRekening();
    assert.match(r, /^\d+$/);
    assert.ok([10, 11, 13, 15].includes(r.length), `len ${r.length}`);
  });
});

test("genKodePos 5 digit; genEmail ber-@ dan domain; genDate YYYY-MM-DD", () => {
  repeat(() => {
    assert.match(genKodePos(), /^\d{5}$/);
    assert.match(genEmail(), /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/);
    assert.match(genDate(), /^\d{4}-\d{2}-\d{2}$/);
  }, 50);
});

test("genNumber dalam rentang", () => {
  repeat(() => {
    const n = Number(genNumber(5, 10));
    assert.ok(n >= 5 && n <= 10, `n ${n}`);
  });
});

test("genAddressID memuat penanda alamat Indonesia", () => {
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

test("matchField: konteks field (keyword)", () => {
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

test("matchField: spesifik menang atas generik (firstName bukan name)", () => {
  assert.equal(matchField("firstName", "text"), "first-name");
  assert.equal(matchField("lastName", "text"), "last-name");
  assert.equal(matchField("fullName", "text"), "full-name");
});

test("generateFor menghasilkan string non-kosong untuk tiap type", () => {
  for (const t of ["email", "full-name", "telephone", "nik", "npwp", "account", "address", "zip", "date", "number", "password", "url", "card"]) {
    const v = generateFor(t);
    assert.equal(typeof v, "string");
    assert.ok(v.length > 0, `type ${t} kosong`);
  }
});
