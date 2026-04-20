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
const { extractSourceUrl } = require("./wxsave-url");
const { recordArchived } = require("./wxsave-archived");
const {
  decodeHtmlEntities,
  extractNickname,
  extractPublishDate,
  sanitizeDirName,
  fixOrphanSvgValues,
} = require("./wxsave-extract");

const TAG = "[wxsave-post]";

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const positional = args.filter((a) => !a.startsWith("--"));
const file = positional[0];
const sourceUrlArg = positional[1] || null;
const overwriteExisting = flags.has("--overwrite-existing");

if (!file || !fs.existsSync(file)) {
  console.error(`${TAG} usage: wxsave-postprocess.js <html-file> [<source-url>] [--overwrite-existing]`);
  process.exit(1);
}

// outDir must be captured BEFORE the file gets moved into a nickname subdir.
const outDir = path.dirname(file);

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

const renameAndMove = (currentFile, publishDate, subdirName, { overwrite = false } = {}) => {
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
    if (overwrite) {
      fs.rmSync(target, { force: true });
    } else {
      const ext = path.extname(newBase);
      const stem = newBase.slice(0, -ext.length);
      let i = 2;
      while (fs.existsSync(path.join(targetDir, `${stem} (${i})${ext}`))) i++;
      target = path.join(targetDir, `${stem} (${i})${ext}`);
    }
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
  const subdir = sanitizeDirName(rawNickname) || "_unknown";

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

  const finalFile = renameAndMove(file, publishDate, subdir, { overwrite: overwriteExisting });
  console.log(
    `${TAG} done: ${fetchedOk}/${tasks.length} images inlined, saved to ${subdir}/${path.basename(finalFile)}`
  );

  // Record the archived URL in ~/.local/share/wxsave/archived.json so the
  // next manual `wxsave <same-url>` will be a fast JSON lookup instead of a
  // full headless-Chrome re-archive. Non-fatal.
  const sourceUrl = sourceUrlArg || extractSourceUrl(html);
  if (sourceUrl) {
    try {
      const baseName = path.basename(finalFile);
      const titleMatch = baseName.match(/^(?:\d{4}-\d{2}-\d{2}_)?(.+)\.html$/i);
      const title = titleMatch ? titleMatch[1] : baseName;
      recordArchived(sourceUrl, finalFile, { title }, { outDir });
    } catch (e) {
      console.warn(`${TAG} archived.json update failed: ${e.message}`);
    }
  } else {
    console.warn(`${TAG} source URL not found; skipping archived.json update`);
  }

  console.log(`${TAG} final: ${finalFile}`);
})().catch((e) => {
  console.error(`${TAG} error:`, e);
  process.exit(1);
});
