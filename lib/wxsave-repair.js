#!/usr/bin/env node
// wxsave-repair.js
// Scan <out_dir> recursively and repair known HTML corruption in archived
// WeChat articles.
//
// Currently handles:
//   * Orphan SVG placeholder values glued onto src="..."
//     (shows up as visible text like
//        _width=16px data-order=1 data-report-img-idx=2 data-fail=0>
//     because a > inside the SVG prematurely closes the <img> tag.)
//
// Usage:
//   node wxsave-repair.js <out_dir> [--dry-run]

const fs = require("node:fs");
const path = require("node:path");
const { fixOrphanSvgValues } = require("./wxsave-extract");

const TAG = "[wxsave-repair]";
const args = process.argv.slice(2);
const outDir = args.find((a) => !a.startsWith("--"));
const dryRun = args.includes("--dry-run");

if (!outDir || !fs.existsSync(outDir) || !fs.statSync(outDir).isDirectory()) {
  console.error(`${TAG} usage: wxsave-repair.js <out_dir> [--dry-run]`);
  process.exit(1);
}

const walk = (dir) => {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "." || e.name === "..") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...walk(p));
    } else if (e.isFile() && e.name.toLowerCase().endsWith(".html")) {
      out.push(p);
    }
  }
  return out;
};

const files = walk(outDir);
if (files.length === 0) {
  console.log(`${TAG} no .html files under ${outDir}; nothing to do.`);
  process.exit(0);
}

console.log(
  `${TAG} scanning ${files.length} file(s)${dryRun ? " (dry-run)" : ""}`
);

let repaired = 0;
let untouched = 0;
let errored = 0;
let totalHits = 0;

for (const p of files) {
  try {
    const html = fs.readFileSync(p, "utf8");
    const { html: fixed, count } = fixOrphanSvgValues(html);
    if (count === 0) {
      untouched++;
      continue;
    }
    totalHits += count;
    const rel = path.relative(outDir, p);
    const plural = count > 1 ? "s" : "";
    if (dryRun) {
      console.log(`${TAG}   DRY   ${rel}  (${count} orphan SVG fragment${plural})`);
    } else {
      fs.writeFileSync(p, fixed, "utf8");
      console.log(`${TAG}   FIXED ${rel}  (${count} orphan SVG fragment${plural})`);
    }
    repaired++;
  } catch (err) {
    console.warn(`${TAG}   ERROR ${p}: ${err.message}`);
    errored++;
  }
}

console.log(
  `${TAG} ${dryRun ? "would fix" : "fixed"}: ${repaired} file(s) / ${totalHits} fragment(s); untouched: ${untouched}; errored: ${errored}`
);

if (!dryRun && repaired > 0) {
  try {
    require("./wxsave-index").rebuildIndex(outDir, { quiet: true });
  } catch (e) {
    console.warn(`${TAG} index refresh failed: ${e.message}`);
  }
}
