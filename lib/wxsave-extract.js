// wxsave-extract.js
// Shared pure helpers for pulling structured bits out of an archived WeChat
// Official Account HTML file:
//   - nickname (公众号名字, used as subdir)
//   - publish date (YYYY-MM-DD, used as filename prefix)
//   - sanitized directory name (filesystem-safe)
//   - orphan SVG placeholder repair (see docs.local/design.md for root-cause notes)
//
// Previously these lived as copy-pasted duplicates in postprocess.js,
// migrate.js, and repair.js. This module is the single source of truth; all
// three call into it.
//
// Covered by test/extract.test.js.

const decodeHtmlEntities = (s) =>
  String(s)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

const extractNickname = (html) => {
  if (!html) return null;

  // 1. DOM element with id=js_name (most common in WeChat article pages)
  const m1 = html.match(/<[a-z]+\b[^>]*\bid=["']?js_name["']?[^>]*>([\s\S]*?)</i);
  if (m1) {
    const text = decodeHtmlEntities(m1[1])
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (text) return text;
  }

  // 2. Inline JS "var nickname = '...'" / "nickname: '...'" — handle both quote styles
  const m2dq = html.match(/\bnickname\s*[:=]\s*"((?:\\.|[^"\\])+)"/i);
  if (m2dq) {
    const text = decodeHtmlEntities(m2dq[1]).trim();
    if (text) return text;
  }
  const m2sq = html.match(/\bnickname\s*[:=]\s*'((?:\\.|[^'\\])+)'/i);
  if (m2sq) {
    const text = decodeHtmlEntities(m2sq[1]).trim();
    if (text) return text;
  }

  // 3. <meta og:site_name | author>
  const m3 = html.match(
    /<meta[^>]*(?:og:site_name|property=["']og:site_name["']|name=["']author["'])[^>]*content=["']([^"']+)/i
  );
  if (m3) {
    const text = decodeHtmlEntities(m3[1]).trim();
    if (text) return text;
  }

  return null;
};

const extractPublishDate = (html) => {
  if (!html) return null;

  // 1. <em id=publish_time>2026年4月14日 21:03</em>  (most common)
  const m1 = html.match(
    /<[a-z]+\b[^>]*\bid=["']?publish_time["']?[^>]*>([^<]+)</i
  );
  if (m1) {
    const text = m1[1].trim();
    const cn = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
    if (cn) {
      const [, y, mo, d] = cn;
      return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }
    const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }

  // 2. <meta article:published_time | og:article:published_time | pubdate>
  const m2 = html.match(
    /<meta[^>]*(?:article:published_time|og:article:published_time|pubdate)[^>]*content=["']([^"']+)/i
  );
  if (m2) {
    const d = new Date(m2[1]);
    if (!isNaN(d)) {
      const y = d.getFullYear();
      const mo = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${y}-${mo}-${dd}`;
    }
  }

  // 3. JS var (unix seconds)
  const m3 = html.match(
    /var\s+(?:ct|create_time|createtime|publish_time)\s*=\s*["']?(\d{10})/i
  );
  if (m3) {
    const d = new Date(Number(m3[1]) * 1000);
    if (!isNaN(d)) {
      const y = d.getFullYear();
      const mo = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${y}-${mo}-${dd}`;
    }
  }

  return null;
};

// Returns a filesystem-safe directory name or null if the input is empty or
// sanitizes to nothing. The callers decide their own fallback:
//   postprocess.js  : `sanitizeDirName(raw) || "_unknown"` (archive pipeline
//                     must always land somewhere)
//   migrate.js      : bail on null with a warning (manual action, surfacing
//                     problem files is desirable)
const sanitizeDirName = (raw) => {
  if (!raw) return null;
  let s = String(raw).replace(/[\x00-\x1f\x7f]/g, "");
  s = s.replace(/[\/\\:*?"<>|]/g, "_");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/^\.+/, "");
  if (s.length > 64) s = s.slice(0, 64).trim();
  return s || null;
};

// Matches: src="..."'data:image/svg+xml,<svg ...>...</svg>'
// where the SVG value is glued right after src with no whitespace or attribute
// name. The unquoted `>` inside the SVG would otherwise prematurely close the
// <img> tag and leak trailing attributes as visible text. Group 2 = src quote,
// group 3 = SVG-value quote, independent since the whole point is the two
// values are wedged together.
const ORPHAN_SVG_RE =
  /(\bsrc=(["'])[^"']*\2)(['"])data:image\/svg\+xml,[\s\S]*?<\/svg>\3/g;

const fixOrphanSvgValues = (html) => {
  if (!html) return { html: "", count: 0 };
  let count = 0;
  const out = html.replace(ORPHAN_SVG_RE, (_m, srcAttr) => {
    count++;
    return srcAttr;
  });
  return { html: out, count };
};

module.exports = {
  decodeHtmlEntities,
  extractNickname,
  extractPublishDate,
  sanitizeDirName,
  fixOrphanSvgValues,
  ORPHAN_SVG_RE,
};
