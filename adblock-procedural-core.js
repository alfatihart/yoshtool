// adblock-procedural-core.js
// Pure helpers for PROCEDURAL cosmetic selectors (uBO/AdGuard "#?#"-style) — NO chrome.*/DOM, so
// they run under `node --test`. The content script adblock-cosmetic.js keeps a BYTE-IDENTICAL inline
// copy of isProcedural / splitList / parseProcedural / parseValueArg (see CONTRIBUTING).
//
// Plain CSS selectors are applied as one <style> (fast, by the browser). Procedural selectors need
// JS evaluation (text / attribute / computed-style / ancestor matching) to survive randomized class
// names — the browser's CSS engine can't express them (except native :has(), which stays plain).
//
// Supported operators (a subset of uBO's, the high-value ones):
//   :has-text("literal" | /regex/i)      element whose textContent matches
//   :min-text-length(N)                  element with textContent length >= N
//   :matches-css(prop: "literal" | /re/) element whose computed style[prop] matches
//   :matches-attr("name"="val" | /re/)   element with an attribute name/value matching
//   :upward(N | "selector")              climb to the Nth ancestor / closest(selector)
// A leading plain-CSS "subject" narrows the candidate set, e.g. `div.box:has-text(/sponsor/i)`.

export const PROCEDURAL_OPS = ["has-text", "min-text-length", "matches-css", "matches-attr", "upward"];

// True if the selector uses any procedural operator (so it can't be a plain CSS rule).
export function isProcedural(selector) {
  const s = String(selector || "");
  for (const op of PROCEDURAL_OPS) if (s.includes(":" + op + "(")) return true;
  return false;
}

// Partition a selector list into { plain, procedural } so plain ones go to <style> and procedural
// ones go to the JS evaluator. (A single invalid/procedural selector in a comma-joined CSS rule
// would break the whole rule, so this split matters.)
export function splitList(selectors) {
  const plain = [];
  const procedural = [];
  for (const s of selectors || []) (isProcedural(s) ? procedural : plain).push(s);
  return { plain, procedural };
}

// Parse "subject:op(arg):op(arg)…" → { subject, ops:[{op,arg}] } or null if malformed/unbalanced.
// Respects quotes and nested parentheses/brackets so args may contain `:` `(` `)` `[` `]`.
export function parseProcedural(selector) {
  const s = String(selector || "").trim();
  if (!s) return null;
  const ops = [];
  let firstOp = -1;
  let i = 0;
  const n = s.length;
  while (i < n) {
    if (s[i] === ":") {
      let matched = null;
      for (const op of PROCEDURAL_OPS) {
        if (s.startsWith(op + "(", i + 1)) { matched = op; break; }
      }
      if (matched) {
        if (firstOp < 0) firstOp = i;
        const open = i + 1 + matched.length; // index of "("
        let depth = 0;
        let q = null;
        let k = open;
        for (; k < n; k++) {
          const c = s[k];
          if (q) { if (c === q && s[k - 1] !== "\\") q = null; continue; }
          if (c === '"' || c === "'") { q = c; continue; }
          if (c === "(") depth++;
          else if (c === ")") { depth--; if (depth === 0) break; }
        }
        if (k >= n) return null; // unbalanced parentheses
        ops.push({ op: matched, arg: s.slice(open + 1, k) });
        i = k + 1;
        continue;
      }
    }
    i++;
  }
  if (!ops.length) return null;
  const subject = (firstOp < 0 ? s : s.slice(0, firstOp)).trim();
  return { subject, ops };
}

// Normalize an op argument into either { re: {source, flags} } (for /regex/flags) or
// { text } (a string literal, with surrounding quotes stripped).
export function parseValueArg(arg) {
  let a = String(arg == null ? "" : arg).trim();
  const m = a.match(/^\/(.*)\/([a-z]*)$/is);
  if (m) return { re: { source: m[1], flags: m[2] || "" } };
  if ((a.startsWith('"') && a.endsWith('"')) || (a.startsWith("'") && a.endsWith("'"))) {
    a = a.slice(1, -1);
  }
  return { text: a };
}
