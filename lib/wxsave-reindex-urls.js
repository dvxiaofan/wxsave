#!/usr/bin/env node
// wxsave-reindex-urls.js
// Walk <out_dir> recursively, extract each archived article's original URL
// (from <meta og:url> / <link canonical> / msg_link JS var), normalize it,
// and rebuild ~/.local/share/wxsave/archived.json from scratch.
//
// Use this once after upgrading to the dedup-aware wxsave, or whenever the
// state file gets lost / you migrate the OUT_DIR to a new location.
//
// Usage:
//   node wxsave-reindex-urls.js <out_dir> [--dry-run]

const fs = require("node:fs");
const path = require("node:path");
const { normalizeUrl, extractSourceUrl } = require("./wxsave-url");
const { saveArchived, STATE_FILE } = require("./wxsave-archived");

const TAG = "[wxsave-reindex-urls]";
const args = process.argv.slice(2);
const outDir = args.find((a) => !a.startsWith("--"));
const dryRun = args.includes("--dry-run");

if (!outDir || !fs.existsSync(outDir) || !fs.statSync(outDir).isDirectory()) {
  console.error(`${TAG} usage: wxsave-reindex-urls.js <out_dir> [--dry-run]`);
  process.exit(1);
}

const walk = (dir) => {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...walk(p));
    } else if (
      e.isFile() &&
      e.name.toLowerCase().endsWith(".html") &&
      e.name.toLowerCase() !== "index.html"
    ) {
      out.push(p);
    }
  }
  return out;
};

const DATE_RE = /^(\d{4}-\d{2}-\d{2})_(.+)\.html$/i;

const files = walk(outDir);
if (files.length === 0) {
  console.log(`${TAG} no .html files under ${outDir}; nothing to do.`);
  process.exit(0);
}

console.log(`${TAG} scanning ${files.length} file(s)${dryRun ? " (dry-run)" : ""}`);

const map = {};
let indexed = 0;
let skipped = 0;
let collisions = 0;

for (const p of files) {
  try {
    const html = fs.readFileSync(p, "utf8");
    const src = extractSourceUrl(html);
    if (!src) {
      console.warn(`${TAG}   SKIP no URL found in ${path.relative(outDir, p)}`);
      skipped++;
      continue;
    }
    const key = normalizeUrl(src);
    if (!key) {
      skipped++;
      continue;
    }
    const rel = path.relative(outDir, p);
    const base = path.basename(p);
    const m = base.match(DATE_RE);
    const title = m ? m[2] : base.replace(/\.html$/i, "");

    if (map[key] && map[key].path !== rel) {
      // duplicate URL landing on different files — warn but keep the last one
      // (newest mtime wins, since walk order is unstable but typically
      // latest-modified is most desirable)
      collisions++;
      console.warn(
        `${TAG}   DUP  ${key}\n         old: ${map[key].path}\n         new: ${rel} (keeping new)`
      );
    }

    map[key] = {
      path: rel,
      archivedAt: new Date().toISOString(),
      title,
    };
    indexed++;
  } catch (e) {
    console.warn(`${TAG}   ERROR ${p}: ${e.message}`);
    skipped++;
  }
}

if (!dryRun) {
  saveArchived(map);
  console.log(
    `${TAG} wrote ${Object.keys(map).length} entries → ${STATE_FILE}`
  );
} else {
  console.log(`${TAG} would write ${Object.keys(map).length} entries → ${STATE_FILE}`);
}
console.log(
  `${TAG} indexed: ${indexed}, skipped: ${skipped}, duplicate keys: ${collisions}`
);
