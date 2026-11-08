import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parsePattern,
  transformPatterns,
  resolveVersion,
  normalizeVersion,
  slugify,
  setCategories,
  prepareTechnologies,
  collectProbePlan,
  analyze,
  resolve,
} from "../tech-core.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test("slugify / normalizeVersion", () => {
  assert.equal(slugify("Google Analytics"), "google-analytics");
  assert.equal(slugify("Node.js"), "node-js");
  assert.equal(normalizeVersion("3.6.0"), "3.6.0");
  assert.equal(normalizeVersion("  1.2 "), "1.2");
  assert.equal(normalizeVersion("<script>"), ""); // rejects junk
});

test("parsePattern: value/regex/confidence/version + quantifier caps", () => {
  const p = parsePattern("jquery-([\\d.]+)\\.js\\;version:\\1\\;confidence:50");
  assert.equal(p.confidence, 50);
  assert.equal(p.version, "\\1");
  assert.ok(p.regex instanceof RegExp);
  assert.ok(p.regex.test("jquery-3.6.0.js"));
  // unbounded + / * are capped so they can't hang
  const q = parsePattern("a+b*");
  assert.match(q.regex.source, /\{1,250\}/);
  assert.match(q.regex.source, /\{0,250\}/);
  // default confidence 100, no version
  assert.equal(parsePattern("foo").confidence, 100);
  assert.equal(parsePattern("foo").version, "");
});

test("resolveVersion: back-reference extraction", () => {
  const p = parsePattern("jquery-([\\d.]+)\\.min\\.js\\;version:\\1");
  assert.equal(resolveVersion(p, "jquery-3.6.0.min.js"), "3.6.0");
  const none = parsePattern("jquery\\;version:\\1");
  assert.equal(resolveVersion(none, "jquery"), ""); // no capture → empty
});

test("transformPatterns: scalar vs object fields", () => {
  assert.ok(Array.isArray(transformPatterns("x")));
  const meta = transformPatterns({ generator: "WordPress" });
  assert.ok(meta.generator && Array.isArray(meta.generator));
});

test("analyze + resolve on a hand-built tech set", () => {
  const cats = setCategories({ "1": { name: "CMS", priority: 1, groups: [] }, "59": { name: "JavaScript libraries", priority: 9, groups: [] }, "27": { name: "Programming languages", priority: 5, groups: [] } });
  const { technologies, byName } = prepareTechnologies({
    jQuery: { cats: [59], scriptSrc: ["jquery-([\\d.]+)(?:\\.min)?\\.js\\;version:\\1"], icon: "jQuery.svg", website: "https://jquery.com" },
    WordPress: { cats: [1], meta: { generator: "WordPress ?([\\d.]+)?\\;version:\\1" }, implies: ["PHP"], icon: "WordPress.svg" },
    PHP: { cats: [27], icon: "PHP.svg" },
    MyApp: { cats: [59], js: { "MyApp.version": "^([\\d.]+)$\\;version:\\1" } },
    Reactish: { cats: [59], dom: { "div[id='root']": { properties: { _reactRootContainer: "" } } } },
  });

  const items = {
    url: "https://example.com/",
    scriptSrc: ["https://code.jquery.com/jquery-3.6.0.min.js"],
    scripts: "",
    meta: { generator: ["WordPress 6.4.2"] },
    cookies: {},
    js: { "MyApp.version": "2.1.0" },
    dom: { "div[id='root']": { exists: true, attrs: {}, props: { _reactRootContainer: true } } },
  };

  const detections = analyze(items, technologies);
  const result = resolve(detections, byName, cats);
  const names = result.map((r) => r.name);

  assert.ok(names.includes("jQuery"), "jQuery detected via scriptSrc");
  assert.equal(result.find((r) => r.name === "jQuery").version, "3.6.0", "jQuery version");
  assert.ok(names.includes("WordPress"), "WordPress detected via meta");
  assert.equal(result.find((r) => r.name === "WordPress").version, "6.4.2", "WordPress version");
  assert.ok(names.includes("PHP"), "PHP added via implies");
  assert.ok(names.includes("MyApp"), "MyApp detected via js global");
  assert.equal(result.find((r) => r.name === "MyApp").version, "2.1.0", "js version");
  assert.ok(names.includes("Reactish"), "Reactish detected via dom property");
  // categories attached
  assert.equal(result.find((r) => r.name === "WordPress").categories[0].name, "CMS");
});

test("collectProbePlan: gathers js chains + dom spec", () => {
  const { technologies } = prepareTechnologies({
    A: { js: { "foo.bar": "" } },
    B: { dom: { ".x": { properties: { _p: "" }, attributes: { href: "y" } } } },
  });
  const plan = collectProbePlan(technologies);
  assert.ok(plan.jsChains.includes("foo.bar"));
  assert.ok(plan.domSpec[".x"]);
  assert.ok(plan.domSpec[".x"].props.includes("_p"));
  assert.ok(plan.domSpec[".x"].attrs.includes("href"));
});

// Integration: parse the REAL bundled dataset and detect against synthetic signals.
test("real dataset parses and detects jQuery + WordPress", () => {
  const techDir = path.join(ROOT, "tech-data", "technologies");
  const data = {};
  for (const f of fs.readdirSync(techDir)) Object.assign(data, JSON.parse(fs.readFileSync(path.join(techDir, f), "utf8")));
  const cats = setCategories(JSON.parse(fs.readFileSync(path.join(ROOT, "tech-data", "categories.json"), "utf8")));
  const { technologies, byName } = prepareTechnologies(data);
  assert.ok(technologies.length > 5000, `expected thousands of technologies, got ${technologies.length}`);

  const items = {
    url: "https://example.com/",
    scriptSrc: ["https://code.jquery.com/jquery-3.6.0.min.js"],
    scripts: "",
    meta: { generator: ["WordPress 6.4.2"] },
    cookies: {},
    js: {},
    dom: {},
  };
  const result = resolve(analyze(items, technologies), byName, cats);
  const names = result.map((r) => r.name);
  assert.ok(names.includes("jQuery"), "jQuery detected from real dataset");
  assert.ok(names.includes("WordPress"), "WordPress detected from real dataset");
  // WordPress implies PHP + MySQL in the real data
  assert.ok(names.includes("PHP"), "PHP implied from WordPress");
});
