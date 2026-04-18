#!/usr/bin/env node
// wxsave-migrate.js
// Scan <out_dir>/*.html (top-level only), extract each file's WeChat Official
// Account nickname, and move the file into <out_dir>/<nickname>/.
// Files where nickname extraction fails are left in place with a warning.
//
// Usage:
//   node wxsave-migrate.js <out_dir> [--dry-run]

const fs = require("node:fs");
const path = require("node:path");

const TAG = "[wxsave-migrate]";
const args = process.argv.slice(2);
const outDir = args.find((a) => !a.startsWith("--"));
const dryRun = args.includes("--dry-run");

if (!outDir || !fs.existsSync(outDir) || !fs.statSync(outDir).isDirectory()) {
  console.error(`${TAG} usage: wxsave-migrate.js <out_dir> [--dry-run]`);
  process.exit(1);
}

const decodeHtmlEntities = (s) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

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
    const t = decodeHtmlEntities(m2dq[1]).trim();
    if (t) return t;
  }
  const m2sq = html.match(/\bnickname\s*[:=]\s*'((?:\\.|[^'\\])+)'/i);
  if (m2sq) {
    const t = decodeHtmlEntities(m2sq[1]).trim();
    if (t) return t;
  }
  const m3 = html.match(
    /<meta[^>]*(?:og:site_name|property=["']og:site_name["']|name=["']author["'])[^>]*content=["']([^"']+)/i
  );
  if (m3) {
    const t = decodeHtmlEntities(m3[1]).trim();
    if (t) return t;
  }
  return null;
};

const sanitizeDirName = (raw) => {
  if (!raw) return null;
  let s = raw.replace(/[\x00-\x1f\x7f]/g, "");
  s = s.replace(/[\/\\:*?"<>|]/g, "_");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/^\.+/, "");
  if (s.length > 64) s = s.slice(0, 64).trim();
  return s || null;
};

const uniquePath = (targetDir, base) => {
  let target = path.join(targetDir, base);
  if (!fs.existsSync(target)) return target;
  const ext = path.extname(base);
  const stem = base.slice(0, -ext.length);
  let i = 2;
  while (fs.existsSync(path.join(targetDir, `${stem} (${i})${ext}`))) i++;
  return path.join(targetDir, `${stem} (${i})${ext}`);
};

const entries = fs
  .readdirSync(outDir, { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".html"));

if (entries.length === 0) {
  console.log(`${TAG} no top-level .html files in ${outDir}; nothing to migrate.`);
  process.exit(0);
}

console.log(`${TAG} scanning ${entries.length} file(s)${dryRun ? " (dry-run)" : ""}`);

let moved = 0;
let skipped = 0;
for (const e of entries) {
  const src = path.join(outDir, e.name);
  try {
    const html = fs.readFileSync(src, "utf8");
    const raw = extractNickname(html);
    const subdir = sanitizeDirName(raw);
    if (!subdir) {
      console.warn(`${TAG}   SKIP ${e.name}: nickname not found`);
      skipped++;
      continue;
    }
    const targetDir = path.join(outDir, subdir);
    const target = uniquePath(targetDir, e.name);
    if (dryRun) {
      console.log(`${TAG}   DRY  ${e.name}  →  ${subdir}/${path.basename(target)}`);
    } else {
      fs.mkdirSync(targetDir, { recursive: true });
      fs.renameSync(src, target);
      console.log(`${TAG}   MOVE ${e.name}  →  ${subdir}/${path.basename(target)}`);
    }
    moved++;
  } catch (err) {
    console.warn(`${TAG}   ERROR ${e.name}: ${err.message}`);
    skipped++;
  }
}

console.log(`${TAG} ${dryRun ? "would move" : "moved"}: ${moved}, skipped: ${skipped}`);
