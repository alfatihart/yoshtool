import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseRdap, parseDohAnswers, summarizeSecurityHeaders, parseTranco, parseOpenPageRank, fmtDate, ageString,
} from "../domain-core.js";

test("parseRdap: registrar (vcard), dates, nameservers", () => {
  const rdap = {
    ldhName: "GITHUB.COM",
    status: ["client delete prohibited"],
    events: [
      { eventAction: "registration", eventDate: "2007-10-09T18:20:50Z" },
      { eventAction: "expiration", eventDate: "2027-10-09T18:20:50Z" },
      { eventAction: "last changed", eventDate: "2024-09-07T09:16:33Z" },
    ],
    entities: [{ roles: ["registrar"], vcardArray: ["vcard", [["version", {}, "text", "4.0"], ["fn", {}, "text", "MarkMonitor Inc."]]] }],
    nameservers: [{ ldhName: "DNS1.P08.NSONE.NET" }, { ldhName: "DNS2.P08.NSONE.NET" }],
  };
  const r = parseRdap(rdap);
  assert.equal(r.domain, "GITHUB.COM");
  assert.equal(r.registrar, "MarkMonitor Inc.");
  assert.equal(r.created, "2007-10-09T18:20:50Z");
  assert.equal(r.expires, "2027-10-09T18:20:50Z");
  assert.deepEqual(r.nameservers, ["DNS1.P08.NSONE.NET", "DNS2.P08.NSONE.NET"]);
  assert.equal(parseRdap(null), null);
  // registrar nested in sub-entities
  const nested = parseRdap({ entities: [{ roles: ["other"], entities: [{ roles: ["registrar"], handle: "123-RReg" }] }] });
  assert.equal(nested.registrar, "123-RReg");
});

test("parseDohAnswers: maps type numbers + strips quotes", () => {
  const a = parseDohAnswers({ Answer: [{ name: "x.com", type: 1, TTL: 300, data: "1.2.3.4" }, { type: 15, TTL: 60, data: "10 mail.x.com" }, { type: 16, TTL: 60, data: '"v=spf1 -all"' }] });
  assert.deepEqual(a[0], { type: "A", data: "1.2.3.4", ttl: 300 });
  assert.equal(a[1].type, "MX");
  assert.equal(a[2].data, "v=spf1 -all"); // quotes stripped
  assert.deepEqual(parseDohAnswers({}), []);
});

test("summarizeSecurityHeaders: grade by count", () => {
  const s = summarizeSecurityHeaders({
    "strict-transport-security": ["max-age=31536000"],
    "x-content-type-options": ["nosniff"],
    "x-frame-options": "DENY",
  });
  assert.equal(s.present, 3);
  assert.equal(s.total, 6);
  assert.equal(s.grade, "C"); // index 3
  assert.equal(s.items.find((i) => i.label === "HSTS").present, true);
  assert.equal(s.items.find((i) => i.label === "Content-Security-Policy").present, false);
  assert.equal(summarizeSecurityHeaders({}).grade, "F");
  // all six → A+
  const all = {};
  for (const k of ["strict-transport-security", "content-security-policy", "x-frame-options", "x-content-type-options", "referrer-policy", "permissions-policy"]) all[k] = ["x"];
  assert.equal(summarizeSecurityHeaders(all).grade, "A+");
});

test("parseTranco / parseOpenPageRank", () => {
  assert.equal(parseTranco({ ranks: [{ date: "2026-01-01", rank: 59 }, { date: "2026-01-02", rank: 61 }] }), 61);
  assert.equal(parseTranco({ rank: 42 }), 42);
  assert.equal(parseTranco({}), null);
  assert.deepEqual(parseOpenPageRank({ response: [{ status_code: 200, page_rank_integer: 7, rank: "1234" }] }), { score: 7, rank: 1234 });
  assert.equal(parseOpenPageRank({ response: [{ status_code: 404 }] }), null);
});

test("fmtDate / ageString", () => {
  assert.equal(fmtDate("2007-10-09T18:20:50Z"), "2007-10-09");
  assert.equal(fmtDate(null), "—");
  const now = Date.parse("2025-10-09T00:00:00Z");
  assert.equal(ageString("2007-10-09T00:00:00Z", now), "18y ago");
  assert.match(ageString("2025-09-09T00:00:00Z", now), /^1mo ago$/);
  assert.match(ageString("2026-10-09T00:00:00Z", now), /^in 1y/); // future (expiry)
  assert.equal(ageString(null), "");
});
