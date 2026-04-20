// test/extract.test.js
// Unit tests for lib/wxsave-extract.js (node:test, zero deps).
// Run with: npm test   (or: node --test test/)

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  decodeHtmlEntities,
  extractNickname,
  extractPublishDate,
  sanitizeDirName,
  fixOrphanSvgValues,
  ORPHAN_SVG_RE,
} = require("../lib/wxsave-extract");

const fixture = (name) =>
  fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");

// ---------------- decodeHtmlEntities ----------------

test("decodeHtmlEntities: &amp; → &", () => {
  assert.equal(decodeHtmlEntities("A &amp; B"), "A & B");
});

test("decodeHtmlEntities: &lt; / &gt;", () => {
  assert.equal(decodeHtmlEntities("&lt;tag&gt;"), "<tag>");
});

test("decodeHtmlEntities: &quot;", () => {
  assert.equal(decodeHtmlEntities('say &quot;hi&quot;'), 'say "hi"');
});

test("decodeHtmlEntities: &#39;", () => {
  assert.equal(decodeHtmlEntities("it&#39;s"), "it's");
});

test("decodeHtmlEntities: mixed", () => {
  assert.equal(
    decodeHtmlEntities("A &amp; B &lt;&gt; &quot;&#39;"),
    'A & B <> "\''
  );
});

test("decodeHtmlEntities: empty string passes through", () => {
  assert.equal(decodeHtmlEntities(""), "");
});

test("decodeHtmlEntities: no entities unchanged", () => {
  assert.equal(decodeHtmlEntities("plain text 中文"), "plain text 中文");
});

// ---------------- extractNickname ----------------

test("extractNickname: id=js_name DOM element (primary)", () => {
  assert.equal(extractNickname(fixture("nickname-dom.html")), "呦呦鹿鸣");
});

test("extractNickname: var nickname= JS (fallback 2)", () => {
  assert.equal(extractNickname(fixture("nickname-var.html")), "武志红");
});

test("extractNickname: og:site_name meta (fallback 3)", () => {
  assert.equal(extractNickname(fixture("nickname-meta.html")), "阿里云开发者");
});

test("extractNickname: no signal → null", () => {
  assert.equal(extractNickname("<html><body>nothing</body></html>"), null);
});

test("extractNickname: null input → null", () => {
  assert.equal(extractNickname(null), null);
});

// ---------------- extractPublishDate ----------------

test("extractPublishDate: Chinese em#publish_time (primary)", () => {
  assert.equal(extractPublishDate(fixture("publish-em-chinese.html")), "2026-04-14");
});

test("extractPublishDate: em with single-digit month/day pads correctly", () => {
  const html =
    '<em id="publish_time">2026年1月3日 08:00</em>';
  assert.equal(extractPublishDate(html), "2026-01-03");
});

test("extractPublishDate: article:published_time meta (fallback 2)", () => {
  assert.equal(extractPublishDate(fixture("publish-meta.html")), "2026-04-14");
});

test("extractPublishDate: JS var ct=<unix> (fallback 3)", () => {
  // 1744627380 = 2025-04-14 in local time (but test only asserts shape, not TZ)
  const result = extractPublishDate(fixture("publish-jsvar.html"));
  assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
});

test("extractPublishDate: no signal → null", () => {
  assert.equal(extractPublishDate("<html><body>no date</body></html>"), null);
});

// ---------------- sanitizeDirName ----------------

test("sanitizeDirName: ordinary name unchanged", () => {
  assert.equal(sanitizeDirName("呦呦鹿鸣"), "呦呦鹿鸣");
});

test("sanitizeDirName: path separator replaced with _", () => {
  assert.equal(sanitizeDirName("A/B\\C"), "A_B_C");
});

test("sanitizeDirName: filesystem-forbidden chars replaced", () => {
  assert.equal(sanitizeDirName('a:b*c?d"e<f>g|h'), "a_b_c_d_e_f_g_h");
});

test("sanitizeDirName: control chars stripped", () => {
  assert.equal(sanitizeDirName("abc\x01\x02def"), "abcdef");
});

test("sanitizeDirName: leading dots trimmed (no hidden dirs)", () => {
  assert.equal(sanitizeDirName("...hidden"), "hidden");
});

test("sanitizeDirName: 65-char input truncated to ≤64", () => {
  const input = "a".repeat(65);
  const got = sanitizeDirName(input);
  assert.ok(got.length <= 64, `expected ≤64, got ${got.length}`);
});

test("sanitizeDirName: null → null", () => {
  assert.equal(sanitizeDirName(null), null);
});

test("sanitizeDirName: empty string → null", () => {
  assert.equal(sanitizeDirName(""), null);
});

test("sanitizeDirName: whitespace-only collapses to null", () => {
  assert.equal(sanitizeDirName("   "), null);
});

test("sanitizeDirName: all-forbidden input → null (no valid chars survive)", () => {
  assert.equal(sanitizeDirName("\x00\x01\x02"), null);
});

// ---------------- fixOrphanSvgValues ----------------

test("fixOrphanSvgValues: clean html untouched, count=0", () => {
  const html = '<img src="ok.jpg"><p>hi</p>';
  const r = fixOrphanSvgValues(html);
  assert.equal(r.html, html);
  assert.equal(r.count, 0);
});

test("fixOrphanSvgValues: orphan SVG after double-quoted src", () => {
  const html = `<img src="data:image/gif;base64,AAA"'data:image/svg+xml,<svg></svg>' _width="1">`;
  const r = fixOrphanSvgValues(html);
  assert.equal(r.count, 1);
  assert.equal(r.html, `<img src="data:image/gif;base64,AAA" _width="1">`);
});

test("fixOrphanSvgValues: orphan SVG after single-quoted src", () => {
  const html = `<img src='data:image/gif;base64,BBB'"data:image/svg+xml,<svg></svg>" attr=x>`;
  const r = fixOrphanSvgValues(html);
  assert.equal(r.count, 1);
  assert.equal(r.html, `<img src='data:image/gif;base64,BBB' attr=x>`);
});

test("fixOrphanSvgValues: multiple in one document", () => {
  const r = fixOrphanSvgValues(fixture("orphan-svg.html"));
  assert.equal(r.count, 2);
  assert.ok(!r.html.includes("data:image/svg+xml"), "svg residue should be gone");
  assert.ok(r.html.includes("mmbiz.qpic.cn/good.jpg"), "clean img must be preserved");
});

test("fixOrphanSvgValues: empty / falsy input safely returns count=0", () => {
  assert.deepEqual(fixOrphanSvgValues(""), { html: "", count: 0 });
  assert.deepEqual(fixOrphanSvgValues(null), { html: "", count: 0 });
});

test("ORPHAN_SVG_RE: has the global flag so replace hits all matches", () => {
  assert.ok(ORPHAN_SVG_RE.global, "regex must be /g for .replace() to find all");
});
