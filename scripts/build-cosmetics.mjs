// Offline build helper (NOT part of the extension — it has no build step). Merges ABPindo's
// cosmetic (element-hiding) rules into rule_resources/cosmetics.json. Plain selectors are validated
// with a headless browser (so an invalid one can never break the runtime <style>); procedural
// selectors are kept only if adblock-procedural-core can parse them. Only ADDS (union) — never
// drops existing curated selectors.
//
// Run from the repo root:  node scripts/build-cosmetics.mjs   (needs `playwright` available)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { isProcedural, parseProcedural } from "../adblock-procedural-core.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COSMETICS = path.join(ROOT, "rule_resources/cosmetics.json");
const SOURCES = [
  "https://raw.githubusercontent.com/ABPindo/indonesianadblockrules/master/subscriptions/abpindo.txt",
];

// Normalize common uBO/AdGuard aliases to the operators our engine supports.
function normalize(sel) {
  return sel
    .replace(/:-abp-contains\(/g, ":has-text(")
    .replace(/:contains\(/g, ":has-text(")
    .replace(/:-abp-has\(/g, ":has(")
    .replace(/:nth-ancestor\(/g, ":upward(");
}
// Extended/uBO tokens our engine does NOT support → drop the rule (can't render safely).
const UNSUPPORTED = /:(xpath|style|remove|matches-path|watch-attr|matches-property|if|if-not)\(/;

function parseCosmeticLine(line) {
  const ln = line.trim();
  if (!ln || ln.startsWith("!") || ln.startsWith("[")) return null;
  if (/#@\$?\??#/.test(ln)) return null; // exceptions: #@#, #@?#, #@$#
  if (ln.includes("#%#")) return null; // scriptlet
  if (/#\$\??#/.test(ln)) return null; // CSS injection / style: #$#, #$?#
  let sep, idx;
  if ((idx = ln.indexOf("#?#")) >= 0) sep = "#?#";
  else if ((idx = ln.indexOf("##")) >= 0) sep = "##";
  else return null;
  const domainsRaw = ln.slice(0, idx);
  let selector = ln.slice(idx + sep.length).trim();
  if (!selector) return null;
  if (selector.startsWith("+js(") || selector.startsWith("^")) return null; // scriptlet / HTML filter
  if (domainsRaw.includes("~")) return null; // negated-domain rules: skip for v1
  selector = normalize(selector);
  if (UNSUPPORTED.test(selector)) return null;
  const domains = domainsRaw ? domainsRaw.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean) : [];
  return { domains, selector };
}

async function main() {
  const base = JSON.parse(fs.readFileSync(COSMETICS, "utf8"));
  const generic = new Set(Array.isArray(base.generic) ? base.generic : []);
  const specific = {};
  for (const [d, arr] of Object.entries(base.specific || {})) specific[d] = new Set(Array.isArray(arr) ? arr : []);
  const before = { generic: generic.size, specificDomains: Object.keys(specific).length };

  const candGeneric = new Set();
  const candSpecific = new Map(); // domain -> Set
  const proceduralKeep = new Set();
  let parsed = 0;
  for (const url of SOURCES) {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) { console.error("fetch failed", url, r.status); continue; }
    for (const line of (await r.text()).split(/\r?\n/)) {
      const c = parseCosmeticLine(line);
      if (!c) continue;
      parsed++;
      const sel = c.selector;
      if (isProcedural(sel)) { if (!parseProcedural(sel)) continue; proceduralKeep.add(sel); }
      if (c.domains.length === 0) candGeneric.add(sel);
      else for (const d of c.domains) { if (!candSpecific.has(d)) candSpecific.set(d, new Set()); candSpecific.get(d).add(sel); }
    }
  }

  const plainToValidate = new Set();
  const consider = (sel, present) => { if (!proceduralKeep.has(sel) && !present.has(sel)) plainToValidate.add(sel); };
  for (const sel of candGeneric) consider(sel, generic);
  for (const [d, set] of candSpecific) for (const sel of set) consider(sel, specific[d] || new Set());

  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  const validSet = new Set(await page.evaluate((arr) => {
    const ok = [];
    for (const s of arr) { try { document.querySelector(s); ok.push(s); } catch (e) {} }
    return ok;
  }, [...plainToValidate]));
  await browser.close();

  const isKept = (sel) => proceduralKeep.has(sel) || validSet.has(sel);
  let addedGeneric = 0, addedSpecific = 0;
  for (const sel of candGeneric) if (isKept(sel) && !generic.has(sel)) { generic.add(sel); addedGeneric++; }
  for (const [d, set] of candSpecific) for (const sel of set) {
    if (!isKept(sel)) continue;
    if (!specific[d]) specific[d] = new Set();
    if (!specific[d].has(sel)) { specific[d].add(sel); addedSpecific++; }
  }

  const out = { generic: [...generic].sort(), specific: {} };
  for (const d of Object.keys(specific).sort()) out.specific[d] = [...specific[d]].sort();
  fs.writeFileSync(COSMETICS, JSON.stringify(out));
  console.log(JSON.stringify({
    parsed, added: { generic: addedGeneric, specific: addedSpecific }, procedural: proceduralKeep.size,
    before, after: { generic: out.generic.length, specificDomains: Object.keys(out.specific).length },
    bytes: fs.statSync(COSMETICS).size,
  }, null, 1));
}
main();
