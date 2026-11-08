// tech-core.js
// Technology-fingerprint matching engine for the Tech profiler. Pure (no chrome.*/DOM) → Node-tested
// and imported by the background service worker (an ES module). An independent reimplementation of
// Wappalyzer's open-source matching algorithm, run against the GPL-3.0 webappanalyzer dataset in
// tech-data/ (see tech-data/NOTICE.md). The page signals (url, scriptSrc, inline scripts, meta,
// cookies, js globals, dom) are collected by a MAIN-world probe; this module does the matching.
//
// Pattern syntax (from the dataset): "regex\;version:\1\;confidence:50" — a regex plus optional
// version (with \1 back-references) and confidence. parsePattern / resolveVersion mirror Wappalyzer.

function toArray(value) {
  return Array.isArray(value) ? value : [value];
}
function hasValues(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && value.constructor === Object) return Object.keys(value).length > 0;
  return !!value;
}

const versionPattern = /^[A-Za-z0-9._-]+$/;
export function normalizeVersion(version = "") {
  version = String(version || "").trim();
  return version && versionPattern.test(version) ? version : "";
}
export function slugify(string) {
  return String(string)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/--+/g, "-")
    .replace(/(?:^-|-$)/g, "");
}

// Build a case-insensitive RegExp from a dataset pattern, applying Wappalyzer's quantifier caps so a
// hostile pattern can't hang the matcher. Returns a never-match regex on a bad pattern.
function buildRegex(src, isRegex) {
  if (!isRegex) return new RegExp("", "i");
  try {
    return new RegExp(
      String(src)
        .replace(/\//g, "\\/")
        .replace(/\\\+/g, "__escapedPlus__")
        .replace(/\+/g, "{1,250}")
        .replace(/\*/g, "{0,250}")
        .replace(/__escapedPlus__/g, "\\+"),
      "i",
    );
  } catch (e) {
    return /(?!)/; // never matches
  }
}

// Parse one pattern (string/number) → { value, regex, confidence, version }, or recurse over an
// object (used for nested dom specs). Mirrors Wappalyzer.parsePattern.
export function parsePattern(pattern, isRegex = true) {
  if (pattern && typeof pattern === "object" && !Array.isArray(pattern)) {
    return Object.keys(pattern).reduce((parsed, key) => {
      parsed[key] = parsePattern(pattern[key]); // nested leaves default to isRegex=true
      return parsed;
    }, {});
  }
  const attrs = String(pattern)
    .split("\\;")
    .reduce((attrs, attr, i) => {
      if (i) {
        const parts = attr.split(":");
        if (parts.length > 1) attrs[parts.shift()] = parts.join(":");
      } else {
        attrs.value = typeof pattern === "number" ? pattern : attr;
        attrs.regex = buildRegex(attr, isRegex);
      }
      return attrs;
    }, {});
  return {
    value: attrs.value,
    regex: attrs.regex,
    confidence: parseInt(attrs.confidence || 100, 10),
    version: attrs.version || "",
  };
}

// Normalize a field's patterns into { key: [parsed] } (object fields) or [parsed] (scalar/array).
export function transformPatterns(patterns, caseSensitive = false, isRegex = true) {
  if (!patterns) return [];
  if (typeof patterns === "string" || typeof patterns === "number" || Array.isArray(patterns)) {
    patterns = { main: patterns };
  }
  const parsed = Object.keys(patterns).reduce((parsed, key) => {
    parsed[caseSensitive ? key : key.toLowerCase()] = toArray(patterns[key]).map((p) => parsePattern(p, isRegex));
    return parsed;
  }, {});
  return "main" in parsed ? parsed.main : parsed;
}

// Resolve a version string from a pattern's \1 back-references against a matched value.
export function resolveVersion({ version, regex }, match) {
  let resolved = version;
  if (version) {
    const matches = regex.exec(match);
    if (matches) {
      matches.forEach((m, index) => {
        if (String(m).length > 10) return;
        const ternary = new RegExp(`\\\\${index}\\?([^:]+):(.*)$`).exec(version);
        if (ternary && ternary.length === 3) {
          resolved = version.replace(ternary[0], m ? ternary[1] : ternary[2]);
        }
        resolved = resolved.trim().replace(new RegExp(`\\\\${index}`, "g"), m || "");
      });
      resolved = resolved.replace(/\\\d/, "");
    }
  }
  return normalizeVersion(resolved);
}

// ---- dataset preparation ----------------------------------------------------

export function setCategories(data) {
  return Object.keys(data)
    .map((id) => ({ id: parseInt(id, 10), slug: slugify(data[id].name), ...data[id] }))
    .sort((a, b) => (a.priority > b.priority ? -1 : 0));
}

// Parse the raw technologies dataset into matcher-ready objects. Techs gated behind `requires` /
// `requiresCategory` (conditional on another detection — e.g. Radix UI requires a UI framework) go
// into `conditional`; detect() evaluates them only once their prerequisite is present.
export function prepareTechnologies(data) {
  const technologies = [];
  const conditional = [];
  const byName = new Map();
  for (const name of Object.keys(data)) {
    const d = data[name];
    const normalizedDom =
      typeof d.dom === "string" || Array.isArray(d.dom)
        ? toArray(d.dom).reduce((dom, selector) => ({ ...dom, [selector]: { exists: "" } }), {})
        : d.dom;
    const tech = {
      name,
      categories: d.cats || [],
      icon: d.icon || "default.svg",
      website: d.website || null,
      description: d.description || null,
      url: transformPatterns(d.url),
      scriptSrc: transformPatterns(d.scriptSrc),
      scripts: transformPatterns(d.scripts),
      css: transformPatterns(d.css),
      headers: transformPatterns(d.headers),
      meta: transformPatterns(d.meta),
      cookies: transformPatterns(d.cookies),
      js: transformPatterns(d.js, true),
      dom: transformPatterns(normalizedDom, true, false),
      implies: transformPatterns(d.implies).map(({ value, confidence, version }) => ({
        name: value, confidence: confidence == null ? 100 : parseInt(confidence, 10), version: version || "",
      })),
      excludes: transformPatterns(d.excludes).map(({ value }) => ({ name: value })),
    };
    tech.requires = d.requires ? toArray(d.requires).map(String) : [];
    tech.requiresCategory = d.requiresCategory ? toArray(d.requiresCategory).map((x) => parseInt(x, 10)) : [];
    // Which signal types this tech can match on (for cheap relevance filtering).
    tech.types = [];
    for (const t of ["url", "scriptSrc", "scripts", "css", "headers", "meta", "cookies", "js", "dom"]) {
      if (hasValues(tech[t])) tech.types.push(t);
    }
    byName.set(name, tech);
    if (tech.requires.length || tech.requiresCategory.length) conditional.push(tech);
    else technologies.push(tech);
  }
  return { technologies, conditional, byName };
}

// Full detection: match the unconditional technologies, then bring in conditional ones whose
// prerequisite technology/category is now present (to a small fixpoint), and resolve the lot.
export function detect(items, prepared, categories, seed = []) {
  const { technologies, conditional, byName } = prepared;
  let detections = (seed || []).concat(analyze(items, technologies));
  const added = new Set();
  for (let pass = 0; pass < 3 && conditional.length; pass++) {
    const resolvedNow = resolve(detections, byName, categories);
    const names = new Set(resolvedNow.map((r) => r.name));
    const catIds = new Set();
    for (const r of resolvedNow) for (const c of r.categories) catIds.add(c.id);
    const satisfied = conditional.filter(
      (t) => !added.has(t.name) && t.requires.every((n) => names.has(n)) && t.requiresCategory.every((id) => catIds.has(id)),
    );
    if (!satisfied.length) break;
    for (const t of satisfied) added.add(t.name);
    detections = detections.concat(analyze(items, satisfied));
  }
  return resolve(detections, byName, categories);
}

// Unique js chains + per-selector dom spec the MAIN-world probe must evaluate.
export function collectProbePlan(technologies) {
  const jsChains = new Set();
  const domSpec = {}; // selector -> { attrs:Set, props:Set, needText, needExists }
  for (const tech of technologies) {
    for (const chain of Object.keys(tech.js || {})) jsChains.add(chain);
    for (const selector of Object.keys(tech.dom || {})) {
      const spec = (domSpec[selector] = domSpec[selector] || { attrs: new Set(), props: new Set(), needText: false, needExists: false });
      for (const s of tech.dom[selector]) {
        if (s.exists !== undefined) spec.needExists = true;
        if (s.text !== undefined) spec.needText = true;
        if (s.attributes) for (const a of Object.keys(s.attributes)) spec.attrs.add(a.toLowerCase());
        if (s.properties) for (const p of Object.keys(s.properties)) spec.props.add(p);
      }
    }
  }
  return {
    jsChains: [...jsChains],
    domSpec: Object.keys(domSpec).reduce((o, sel) => {
      o[sel] = { attrs: [...domSpec[sel].attrs], props: [...domSpec[sel].props], needText: domSpec[sel].needText, needExists: domSpec[sel].needExists };
      return o;
    }, {}),
  };
}

// ---- matchers ---------------------------------------------------------------

function matchPatterns(technology, type, patterns, value) {
  const out = [];
  for (const pattern of patterns) {
    if (pattern.regex.exec(value)) {
      out.push({ technology, pattern: { ...pattern, type }, version: resolveVersion(pattern, value) });
    }
  }
  return out;
}
function analyzeOneToOne(technology, type, value) {
  return matchPatterns(technology, type, technology[type], String(value == null ? "" : value));
}
function analyzeOneToMany(technology, type, items) {
  const out = [];
  for (const value of items) out.push(...matchPatterns(technology, type, technology[type], String(value == null ? "" : value)));
  return out;
}
function analyzeManyToMany(technology, type, items) {
  const out = [];
  const field = technology[type];
  for (const key of Object.keys(field)) {
    const values = items[key.toLowerCase()] || items[key] || [];
    for (const value of toArray(values)) out.push(...matchPatterns(technology, type, field[key], String(value == null ? "" : value)));
  }
  return out;
}
// js globals: jsValues = { chain: resolvedValue }. Existence patterns ("") match any value; version
// patterns match version strings (a boolean true stringifies to "true" and won't match a version).
function analyzeJs(technology, jsValues) {
  const out = [];
  for (const chain of Object.keys(technology.js)) {
    if (!Object.prototype.hasOwnProperty.call(jsValues, chain)) continue;
    out.push(...matchPatterns(technology, "js", technology.js[chain], String(jsValues[chain])));
  }
  return out;
}
// dom: domObs = { selector: [ { exists, text, attrs:{}, props:{} }, … ] } — ALL matching nodes (capped
// by the probe), so a pattern on a generic selector (e.g. [class*='fa'] → the real <i class="fa-user">
// is rarely the first match) is tested against every node, not just the first.
function analyzeDom(technology, domObs) {
  const out = [];
  for (const selector of Object.keys(technology.dom)) {
    const nodes = domObs[selector];
    if (!nodes || !nodes.length) continue;
    for (const spec of technology.dom[selector]) {
      if (spec.exists !== undefined) {
        out.push({ technology, pattern: { ...spec.exists, type: "dom" }, version: "" });
      }
      if (spec.text !== undefined) {
        for (const n of nodes) {
          if (n.text != null && spec.text.regex.exec(String(n.text))) {
            out.push({ technology, pattern: { ...spec.text, type: "dom" }, version: resolveVersion(spec.text, String(n.text)) });
            break;
          }
        }
      }
      if (spec.attributes) {
        for (const attr of Object.keys(spec.attributes)) {
          for (const n of nodes) {
            const v = n.attrs ? n.attrs[attr.toLowerCase()] : undefined;
            if (v != null && spec.attributes[attr].regex.exec(String(v))) {
              out.push({ technology, pattern: { ...spec.attributes[attr], type: "dom" }, version: resolveVersion(spec.attributes[attr], String(v)) });
              break;
            }
          }
        }
      }
      if (spec.properties) {
        for (const prop of Object.keys(spec.properties)) {
          for (const n of nodes) {
            const v = n.props ? n.props[prop] : undefined;
            if (v != null && spec.properties[prop].regex.exec(String(v))) {
              out.push({ technology, pattern: { ...spec.properties[prop], type: "dom" }, version: resolveVersion(spec.properties[prop], String(v)) });
              break;
            }
          }
        }
      }
    }
  }
  return out;
}

// Run all matchers for the collected signals. items = { url, scriptSrc:[], scripts, meta:{}, cookies:{}, js:{}, dom:{} }.
export function analyze(items, technologies) {
  const present = new Set(Object.keys(items).filter((t) => hasValues(items[t])));
  const detections = [];
  for (const tech of technologies) {
    if (!tech.types.some((t) => present.has(t))) continue;
    if (present.has("url") && hasValues(tech.url)) detections.push(...analyzeOneToOne(tech, "url", items.url));
    if (present.has("scripts") && hasValues(tech.scripts)) detections.push(...analyzeOneToOne(tech, "scripts", items.scripts));
    if (present.has("scriptSrc") && hasValues(tech.scriptSrc)) detections.push(...analyzeOneToMany(tech, "scriptSrc", items.scriptSrc));
    if (present.has("css") && hasValues(tech.css)) detections.push(...analyzeOneToOne(tech, "css", items.css));
    if (present.has("headers") && hasValues(tech.headers)) detections.push(...analyzeManyToMany(tech, "headers", items.headers));
    if (present.has("meta") && hasValues(tech.meta)) detections.push(...analyzeManyToMany(tech, "meta", items.meta));
    if (present.has("cookies") && hasValues(tech.cookies)) detections.push(...analyzeManyToMany(tech, "cookies", items.cookies));
    if (present.has("js") && hasValues(tech.js)) detections.push(...analyzeJs(tech, items.js));
    if (present.has("dom") && hasValues(tech.dom)) detections.push(...analyzeDom(tech, items.dom));
  }
  return detections;
}

// Dedupe detections by technology, sum confidence (cap 100), pick the best version, add implied
// technologies, drop excluded ones, attach categories, and sort by category priority.
export function resolve(detections, byName, categories) {
  const catById = new Map(categories.map((c) => [c.id, c]));
  const resolved = [];
  const index = new Map(); // name -> resolved entry

  for (const det of detections) {
    const name = det.technology.name;
    let entry = index.get(name);
    if (!entry) {
      entry = { technology: det.technology, confidence: 0, version: "" };
      index.set(name, entry);
      resolved.push(entry);
    }
    entry.confidence = Math.min(100, entry.confidence + (det.pattern.confidence || 0));
    const nv = normalizeVersion(det.version);
    if (nv.length > entry.version.length && nv.length <= 15 && (parseInt(nv, 10) || 0) < 10000) entry.version = nv;
  }

  // Excludes: a detected tech can remove others.
  for (const entry of [...resolved]) {
    for (const { name } of entry.technology.excludes || []) {
      const i = resolved.findIndex((e) => e.technology.name === name);
      if (i !== -1) { resolved.splice(i, 1); index.delete(name); }
    }
  }

  // Implies: add inferred technologies (iterate to a fixpoint).
  let done = false;
  while (resolved.length && !done) {
    done = true;
    for (const entry of [...resolved]) {
      for (const imp of entry.technology.implies || []) {
        if (index.has(imp.name)) continue;
        const tech = byName.get(imp.name);
        if (!tech) continue;
        const e = { technology: tech, confidence: Math.min(entry.confidence, imp.confidence == null ? 100 : imp.confidence), version: imp.version || "" };
        index.set(imp.name, e);
        resolved.push(e);
        done = false;
      }
    }
  }

  const priority = (entry) => (entry.technology.categories || []).reduce((max, id) => Math.max(max, catById.get(id)?.priority || 0), 0);
  const seenSlug = new Set();
  return resolved
    .sort((a, b) => (priority(a) < priority(b) ? 1 : -1))
    .map((e) => ({
      name: e.technology.name,
      slug: slugify(e.technology.name),
      confidence: e.confidence,
      version: e.version,
      icon: e.technology.icon,
      website: e.technology.website,
      description: e.technology.description,
      categories: (e.technology.categories || []).map((id) => catById.get(id)).filter(Boolean).map((c) => ({ id: c.id, name: c.name, slug: c.slug, priority: c.priority })),
    }))
    // Collapse dataset naming variants that slugify the same (e.g. "LiteSpeed Cache" / "Litespeed Cache").
    .filter((r) => { if (seenSlug.has(r.slug)) return false; seenSlug.add(r.slug); return true; });
}
