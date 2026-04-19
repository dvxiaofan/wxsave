#!/usr/bin/env node
// wxsave-archived.js
// Maintain a URL → archived-file index so that manually invoking
// `wxsave <url>` on an already-archived article is cheap (a JSON lookup)
// instead of a 15–40s headless-Chrome round trip.
//
// State file: ~/.local/share/wxsave/archived.json
//   {
//     "<normalizedUrl>": {
//       "path":       "<relative to OUT_DIR>",
//       "archivedAt": "<ISO-8601 local>",
//       "title":      "<optional>"
//     },
//     ...
//   }
//
// The lookup verifies the file still exists under <outDir>/<path>; if the
// archive was hand-edited (rm'd), the entry is treated as absent so the next
// `wxsave <url>` re-archives.
//
// CLI:
//   node wxsave-archived.js lookup <url> <out_dir>
//        → exit 0 + prints <out_dir>/<path> on stdout if archived
//        → exit 0 + no output if not archived
//        → exit 1 on error
//   node wxsave-archived.js record <url> <abs_path> <out_dir> [title]

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { normalizeUrl } = require("./wxsave-url");

const TAG = "[wxsave-archived]";
const STATE_DIR = path.join(os.homedir(), ".local/share/wxsave");
const STATE_FILE = path.join(STATE_DIR, "archived.json");

const ensureStateDir = () => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
};

const loadArchived = () => {
  if (!fs.existsSync(STATE_FILE)) return {};
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object" && !Array.isArray(obj)) return obj;
    console.warn(`${TAG} archived.json is not an object; treating as empty`);
    return {};
  } catch (e) {
    console.warn(`${TAG} archived.json parse failed (${e.message}); treating as empty`);
    return {};
  }
};

const saveArchived = (map) => {
  ensureStateDir();
  const tmp = STATE_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(map, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, STATE_FILE);
};

// Returns { key, entry, absPath } or null.
// If the entry points at a file that no longer exists, the stale entry is
// dropped from the state and null is returned.
const lookupArchived = (url, { outDir }) => {
  const key = normalizeUrl(url);
  if (!key) return null;
  const map = loadArchived();
  const entry = map[key];
  if (!entry || !entry.path) return null;

  const absPath = path.join(outDir, entry.path);
  if (!fs.existsSync(absPath)) {
    // clean up stale entry so future runs don't keep tripping this branch
    delete map[key];
    try {
      saveArchived(map);
    } catch (e) {
      console.warn(`${TAG} failed to prune stale entry: ${e.message}`);
    }
    return null;
  }
  return { key, entry, absPath };
};

const recordArchived = (url, absPath, meta, { outDir }) => {
  const key = normalizeUrl(url);
  if (!key) return false;
  if (!absPath || !outDir) return false;

  const relPath = path.relative(outDir, absPath);
  const map = loadArchived();
  map[key] = {
    path: relPath,
    archivedAt: new Date().toISOString(),
    ...(meta && meta.title ? { title: meta.title } : {}),
  };
  saveArchived(map);
  return true;
};

module.exports = {
  STATE_FILE,
  loadArchived,
  saveArchived,
  lookupArchived,
  recordArchived,
};

// ---------------- CLI ----------------

if (require.main === module) {
  const [sub, ...rest] = process.argv.slice(2);

  try {
    if (sub === "lookup") {
      const [url, outDir] = rest;
      if (!url || !outDir) {
        console.error(`${TAG} usage: lookup <url> <out_dir>`);
        process.exit(1);
      }
      const hit = lookupArchived(url, { outDir });
      if (hit) process.stdout.write(hit.absPath);
      process.exit(0);
    }

    if (sub === "record") {
      const [url, absPath, outDir, ...titleParts] = rest;
      if (!url || !absPath || !outDir) {
        console.error(`${TAG} usage: record <url> <abs_path> <out_dir> [title]`);
        process.exit(1);
      }
      const title = titleParts.join(" ") || undefined;
      recordArchived(url, absPath, { title }, { outDir });
      process.exit(0);
    }

    console.error(`${TAG} usage: lookup|record ...`);
    process.exit(1);
  } catch (e) {
    console.error(`${TAG} error: ${e.message}`);
    process.exit(1);
  }
}
