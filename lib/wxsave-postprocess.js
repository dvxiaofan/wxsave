#!/usr/bin/env node
// wxsave-postprocess.js
// After single-file saves the HTML:
//   0. Repair known corruption (orphan SVG values glued to src="...").
//   1. Replace any remaining <img data-src="https://mmbiz..."> by fetching the
//      real image in Node.js and inlining as base64.
//   2. Extract the article's publish date (<em id=publish_time>YYYY年MM月DD日 HH:MM</em>)
//      and the WeChat Official Account nickname (<strong id=js_name>...</strong>).
//   3. Move the file into <OUT_DIR>/<nickname>/ (creating the subdir on demand)
//      and rename to <publish-date>_<title>.html. Nickname extraction failure
//      falls back to _unknown/.

const fs = require("node:fs");
const path = require("node:path");

const TAG = "[wxsave-post]";

const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.error(`${TAG} usage: wxsave-postprocess.js <html-file>`);
  process.exit(1);
}

const urlToDataUri = async (url) => {
  const resp = await fetch(url, {
    headers: {
      Referer: "https://mp.weixin.qq.com/",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const ct = resp.headers.get("content-type") || "image/jpeg";
  const buf = Buffer.from(await resp.arrayBuffer());
  return `data:${ct};base64,${buf.toString("base64")}`;
};

const decodeHtmlEntities = (s) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

// Matches: src="..."'data:image/svg+xml,<svg ...>...</svg>'
// where the SVG value is glued right after src (no whitespace, no attribute
// name). The unquoted `>` inside the SVG would otherwise prematurely close the
// <img> tag and leak trailing attributes as visible text.
const ORPHAN_SVG_RE =
  /(\bsrc=(["'])[^"']*\2)(['"])data:image\/svg\+xml,[\s\S]*?<\/svg>\3/g;

const fixOrphanSvgValues = (html) => {
  let count = 0;
  const out = html.replace(ORPHAN_SVG_RE, (_m, srcAttr) => {
    count++;
    return srcAttr;
  });
  return { html: out, count };
};

const extractPublishDate = (html) => {
  // Pattern 1: <em id=publish_time>2026年1月14日 21:03</em> (most common)
  const m1 = html.match(
    /<[a-z]+\b[^>]*\bid=["']?publish_time["']?[^>]*>([^<]+)</i
  );
  if (m1) {
    const text = m1[1].trim();
    const m = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
    if (m) {
      const [, y, mo, d] = m;
      return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }
    const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }
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

const extractNickname = (html) => {
  const m1 = html.match(/<[a-z]+\b[^>]*\bid=["']?js_name["']?[^>]*>([\s\S]*?)</i);
  if (m1) {
    const text = decodeHtmlEntities(m1[1])
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (text) return text;
  }
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
  const m3 = html.match(
    /<meta[^>]*(?:og:site_name|property=["']og:site_name["']|name=["']author["'])[^>]*content=["']([^"']+)/i
  );
  if (m3) {
    const text = decodeHtmlEntities(m3[1]).trim();
    if (text) return text;
  }
  return null;
};

const sanitizeDirName = (raw) => {
  if (!raw) return "_unknown";
  let s = raw.replace(/[\x00-\x1f\x7f]/g, "");
  s = s.replace(/[\/\\:*?"<>|]/g, "_");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/^\.+/, "");
  if (s.length > 64) s = s.slice(0, 64).trim();
  return s || "_unknown";
};

const renameAndMove = (currentFile, publishDate, subdirName) => {
  const dir = path.dirname(currentFile);
  const base = path.basename(currentFile);
  const targetDir = path.join(dir, subdirName);
  fs.mkdirSync(targetDir, { recursive: true });

  let newBase;
  if (publishDate) {
    if (/^\d{4}-\d{2}-\d{2}_/.test(base)) {
      newBase = publishDate + "_" + base.replace(/^\d{4}-\d{2}-\d{2}_/, "");
    } else {
      newBase = publishDate + "_" + base;
    }
  } else {
    newBase = base;
  }

  let target = path.join(targetDir, newBase);
  if (target !== currentFile && fs.existsSync(target)) {
    const ext = path.extname(newBase);
    const stem = newBase.slice(0, -ext.length);
    let i = 2;
    while (fs.existsSync(path.join(targetDir, `${stem} (${i})${ext}`))) i++;
    target = path.join(targetDir, `${stem} (${i})${ext}`);
  }
  if (target !== currentFile) {
    fs.renameSync(currentFile, target);
    return target;
  }
  return currentFile;
};

(async () => {
  const originalHtml = fs.readFileSync(file, "utf8");
  let html = originalHtml;

  // --- 0. repair orphan SVG placeholder values ---
  const { html: repaired, count: repairCount } = fixOrphanSvgValues(html);
  html = repaired;
  if (repairCount > 0) {
    console.log(`${TAG} repaired ${repairCount} orphan SVG fragment(s) glued to src=`);
  }

  // --- 1. inline remaining lazy images ---
  const imgTagRe = /<img\b[^>]*\bdata-src=(["'])(https:\/\/mmbiz\.qpic\.cn\/[^"']+)\1[^>]*>/gi;

  const tasks = [];
  const seen = new Map();
  let match;
  while ((match = imgTagRe.exec(html)) !== null) {
    const [fullTag, , rawUrl] = match;
    const url = decodeHtmlEntities(rawUrl);
    if (!seen.has(url)) {
      seen.set(url, tasks.length);
      tasks.push({ url, rawUrl, origTag: fullTag });
    }
  }

  let fetchedOk = 0;
  if (tasks.length > 0) {
    console.log(`${TAG} fetching ${tasks.length} lazy-load images...`);
    const results = await Promise.all(
      tasks.map(async (t) => {
        try {
          const uri = await urlToDataUri(t.url);
          return { ...t, uri, ok: true };
        } catch (e) {
          console.warn(`${TAG}   failed ${t.url}: ${e.message}`);
          return { ...t, ok: false };
        }
      })
    );

    const byRawUrl = new Map();
    for (const r of results) if (r.ok) byRawUrl.set(r.rawUrl, r.uri);
    fetchedOk = byRawUrl.size;

    html = html.replace(imgTagRe, (fullTag, quote, rawUrl) => {
      const uri = byRawUrl.get(rawUrl);
      if (!uri) return fullTag;
      let next = fullTag;
      next = next.replace(
        /\ssrc=(["']?)[^"'>\s]*\1/i,
        ` src=${quote}${uri}${quote}`
      );
      if (!/\ssrc=/i.test(next)) {
        next = next.replace(/<img\b/i, `<img src=${quote}${uri}${quote}`);
      }
      next = next.replace(/\sdata-src=(["'])[^"']*\1/i, "");
      return next;
    });
  }

  // persist whatever was changed (repair and/or inline)
  if (html !== originalHtml) {
    fs.writeFileSync(file, html, "utf8");
  }

  // --- 2. rename + move into <OUT_DIR>/<nickname>/ ---
  const publishDate = extractPublishDate(html);
  const rawNickname = extractNickname(html);
  const subdir = sanitizeDirName(rawNickname);

  if (rawNickname) {
    const sanMsg = subdir !== rawNickname ? ` → ${subdir}` : "";
    console.log(`${TAG} nickname: ${rawNickname}${sanMsg}`);
  } else {
    console.log(`${TAG} nickname not found, using ${subdir}/`);
  }
  if (publishDate) {
    console.log(`${TAG} publish date: ${publishDate}`);
  } else {
    console.log(`${TAG} publish date not found, keeping filename as-is`);
  }

  const finalFile = renameAndMove(file, publishDate, subdir);
  console.log(
    `${TAG} done: ${fetchedOk}/${tasks.length} images inlined, saved to ${subdir}/${path.basename(finalFile)}`
  );
  console.log(`${TAG} final: ${finalFile}`);
})().catch((e) => {
  console.error(`${TAG} error:`, e);
  process.exit(1);
});
