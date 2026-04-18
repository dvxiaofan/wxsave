#!/usr/bin/env node
// wxsave-postprocess.js
// After single-file saves the HTML:
//   1. Replace any remaining <img data-src="https://mmbiz..."> by fetching the
//      real image in Node.js and inlining as base64.
//   2. Rename the file to use the article's actual publish date (extracted
//      from <em id=publish_time>YYYY年MM月DD日 HH:MM</em>).

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

const extractPublishDate = (html) => {
  // Pattern 1: <em id=publish_time>2026年1月14日 21:03</em> (most common)
  const m1 = html.match(
    /<[a-z]+\b[^>]*\bid=["']?publish_time["']?[^>]*>([^<]+)</i
  );
  if (m1) {
    const text = m1[1].trim();
    // 2026年1月14日  or  2026年01月14日
    const m = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
    if (m) {
      const [, y, mo, d] = m;
      return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }
    // ISO form
    const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }
  // Pattern 2: meta property=article:published_time
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
  // Pattern 3: var ct="..."   (unix timestamp in seconds)
  const m3 = html.match(/var\s+(?:ct|create_time|createtime|publish_time)\s*=\s*["']?(\d{10})/i);
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

const renameWithPublishDate = (currentFile, publishDate) => {
  const dir = path.dirname(currentFile);
  const base = path.basename(currentFile);
  // Current format: YYYY-MM-DD_title.html  (applied by single-file template)
  // Replace leading YYYY-MM-DD with the real publish date.
  let newBase;
  if (/^\d{4}-\d{2}-\d{2}_/.test(base)) {
    newBase = publishDate + "_" + base.replace(/^\d{4}-\d{2}-\d{2}_/, "");
  } else {
    newBase = publishDate + "_" + base;
  }
  let target = path.join(dir, newBase);
  // Avoid collisions
  if (target !== currentFile && fs.existsSync(target)) {
    const ext = path.extname(newBase);
    const stem = newBase.slice(0, -ext.length);
    let i = 2;
    while (fs.existsSync(path.join(dir, `${stem} (${i})${ext}`))) i++;
    target = path.join(dir, `${stem} (${i})${ext}`);
  }
  if (target !== currentFile) {
    fs.renameSync(currentFile, target);
    return target;
  }
  return currentFile;
};

(async () => {
  let html = fs.readFileSync(file, "utf8");

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

    fs.writeFileSync(file, html, "utf8");
  }

  // --- 2. rename file to use publish date ---
  const publishDate = extractPublishDate(html);
  let finalFile = file;
  if (publishDate) {
    finalFile = renameWithPublishDate(file, publishDate);
    console.log(
      `${TAG} publish date: ${publishDate} → ${path.basename(finalFile)}`
    );
  } else {
    console.log(`${TAG} publish date not found, keeping filename as-is`);
  }

  console.log(
    `${TAG} done: ${fetchedOk}/${tasks.length} images inlined` +
      (publishDate ? `, renamed to ${path.basename(finalFile)}` : "")
  );
})().catch((e) => {
  console.error(`${TAG} error:`, e);
  process.exit(1);
});
