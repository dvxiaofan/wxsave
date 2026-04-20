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
const { extractSourceUrl } = require("./wxsave-url");
const { recordArchived } = require("./wxsave-archived");
const { extractNickname, sanitizeDirName } = require("./wxsave-extract");

const TAG = "[wxsave-migrate]";
const args = process.argv.slice(2);
const outDir = args.find((a) => !a.startsWith("--"));
const dryRun = args.includes("--dry-run");

if (!outDir || !fs.existsSync(outDir) || !fs.statSync(outDir).isDirectory()) {
  console.error(`${TAG} usage: wxsave-migrate.js <out_dir> [--dry-run]`);
  process.exit(1);
}

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
      // Record URL → archived-path mapping so manual wxsave won't re-archive.
      try {
        const sourceUrl = extractSourceUrl(html);
        if (sourceUrl) {
          recordArchived(sourceUrl, target, { title: e.name.replace(/\.html$/i, "") }, { outDir });
        }
      } catch (e) {
        // non-fatal
      }
    }
    moved++;
  } catch (err) {
    console.warn(`${TAG}   ERROR ${e.name}: ${err.message}`);
    skipped++;
  }
}

console.log(`${TAG} ${dryRun ? "would move" : "moved"}: ${moved}, skipped: ${skipped}`);

if (!dryRun && moved > 0) {
  try {
    require("./wxsave-index").rebuildIndex(outDir, { quiet: true });
  } catch (e) {
    console.warn(`${TAG} index refresh failed: ${e.message}`);
  }
}
