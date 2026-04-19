// wxsave-url.js
// Pure helpers for WeChat Official Account URL normalization (dedup key) and
// extracting the original source URL from an already-archived HTML file.
//
// normalizeUrl() must stay in lockstep with bin/wxwatch's Python
// normalize_link() — same input must produce the same key, otherwise the two
// dedup stores (wxwatch seen + wxsave archived.json) will diverge.

const normalizeUrl = (url) => {
  if (!url || typeof url !== "string") return "";
  if (!url.includes("mp.weixin.qq.com")) {
    return url.split("#")[0];
  }
  // 1. /s/<token> short-link form — most common + stable
  const m = url.match(/mp\.weixin\.qq\.com\/s\/([A-Za-z0-9_-]+)/);
  if (m) return `mp.weixin.qq.com/s/${m[1]}`;

  // 2. long form with __biz + mid + idx
  let u;
  try {
    u = new URL(url);
  } catch {
    return url.split("#")[0].split("?")[0];
  }
  const biz = u.searchParams.get("__biz") || "";
  const mid = u.searchParams.get("mid") || "";
  const idx = u.searchParams.get("idx") || "";
  if (biz && mid && idx) {
    return `mp.weixin.qq.com/?__biz=${biz}&mid=${mid}&idx=${idx}`;
  }

  // 3. fallback: bare url, stripped of fragment + query
  return url.split("#")[0].split("?")[0];
};

// single-file strips quotes off meta/link attribute values, so regex must
// tolerate unquoted forms.
const extractSourceUrl = (html) => {
  if (!html) return null;

  // 1. <meta property=og:url content=https://...>
  let m = html.match(
    /<meta\b[^>]*\bproperty=["']?og:url["']?[^>]*\bcontent=["']?([^"'\s>]+)/i
  );
  if (m) return m[1];

  // 2. <link rel=canonical href=https://...>
  m = html.match(
    /<link\b[^>]*\brel=["']?canonical["']?[^>]*\bhref=["']?([^"'\s>]+)/i
  );
  if (m) return m[1];

  // 3. msg_link JS var (historically seen on some WeChat templates)
  m = html.match(/\bmsg_link\s*=\s*["']([^"']+)/);
  if (m) return m[1];

  return null;
};

module.exports = { normalizeUrl, extractSourceUrl };
