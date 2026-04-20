// test/url.test.js
// Unit tests for lib/wxsave-url.js (node:test, zero deps).
// Run with: npm test

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { normalizeUrl, extractSourceUrl } = require("../lib/wxsave-url");

const fixture = (name) =>
  fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");

// ---------------- normalizeUrl ----------------
// IMPORTANT: the outputs here must stay in lockstep with bin/wxwatch's
// normalize_link(). See scripts/verify-normalize-parity.sh.

test("normalizeUrl: /s/<token> short-link keeps the token", () => {
  assert.equal(
    normalizeUrl("https://mp.weixin.qq.com/s/QEyGMz4Hc8T39xVYlynhTQ"),
    "mp.weixin.qq.com/s/QEyGMz4Hc8T39xVYlynhTQ"
  );
});

test("normalizeUrl: /s/<token> with trailing query + fragment collapses to same key", () => {
  assert.equal(
    normalizeUrl(
      "https://mp.weixin.qq.com/s/QEyGMz4Hc8T39xVYlynhTQ?chksm=abc&sn=xyz#wechat_redirect"
    ),
    "mp.weixin.qq.com/s/QEyGMz4Hc8T39xVYlynhTQ"
  );
});

test("normalizeUrl: long-form __biz + mid + idx keeps only those 3 params", () => {
  assert.equal(
    normalizeUrl(
      "https://mp.weixin.qq.com/s?__biz=MjM5ODAzNTc2NA==&mid=2653458123&idx=1&chksm=xyz&sn=abc"
    ),
    "mp.weixin.qq.com/?__biz=MjM5ODAzNTc2NA==&mid=2653458123&idx=1"
  );
});

test("normalizeUrl: non-WeChat URL strips fragment only", () => {
  assert.equal(
    normalizeUrl("https://example.com/foo?bar=1#baz"),
    "https://example.com/foo?bar=1"
  );
});

test("normalizeUrl: empty input returns empty string", () => {
  assert.equal(normalizeUrl(""), "");
});

test("normalizeUrl: non-string input returns empty string (defensive)", () => {
  assert.equal(normalizeUrl(null), "");
  assert.equal(normalizeUrl(undefined), "");
});

test("normalizeUrl: WeChat URL missing __biz/mid/idx falls back to stripped url", () => {
  // Not a /s/<token>, not a complete __biz triple → falls through
  assert.equal(
    normalizeUrl("https://mp.weixin.qq.com/other?foo=1#bar"),
    "https://mp.weixin.qq.com/other"
  );
});

// ---------------- extractSourceUrl ----------------

test("extractSourceUrl: og:url meta (primary, unquoted like single-file emits)", () => {
  assert.equal(
    extractSourceUrl(fixture("source-url-head.html")),
    "https://mp.weixin.qq.com/s/AbCdEfGhIjKlMnOpQrSt"
  );
});

test("extractSourceUrl: og:url with double-quoted attributes also works", () => {
  const html =
    '<meta property="og:url" content="https://mp.weixin.qq.com/s/Zzz123" />';
  assert.equal(
    extractSourceUrl(html),
    "https://mp.weixin.qq.com/s/Zzz123"
  );
});

test("extractSourceUrl: canonical link fallback when no og:url", () => {
  const html =
    '<link rel=canonical href=https://mp.weixin.qq.com/s/OnlyCanonical>';
  assert.equal(
    extractSourceUrl(html),
    "https://mp.weixin.qq.com/s/OnlyCanonical"
  );
});

test("extractSourceUrl: msg_link JS var fallback (legacy templates)", () => {
  const html = '<script>var msg_link = "https://mp.weixin.qq.com/s/JsVar";</script>';
  assert.equal(extractSourceUrl(html), "https://mp.weixin.qq.com/s/JsVar");
});

test("extractSourceUrl: no URL anywhere → null", () => {
  assert.equal(
    extractSourceUrl("<html><body>content only</body></html>"),
    null
  );
});

test("extractSourceUrl: null / empty html → null", () => {
  assert.equal(extractSourceUrl(null), null);
  assert.equal(extractSourceUrl(""), null);
});
