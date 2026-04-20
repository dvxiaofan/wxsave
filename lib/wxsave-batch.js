#!/usr/bin/env node
// wxsave-batch.js
// Batch archive: read URLs from a file, invoke wxsave on each sequentially
// with rate-limit sleep between successful archives. Failed URLs accumulate
// into <input>.failed for easy retry. Already-archived URLs are skipped
// instantly via the dedup state.
//
// Usage (invoked by bin/wxsave --batch):
//   node wxsave-batch.js <urls-file> <out_dir> <wxsave-bin> [--dry-run] [--force]

const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const { lookupArchived } = require("./wxsave-archived");

const TAG = "[wxsave-batch]";
const SLEEP_MS = 3000;

// --- parse args ---
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const positional = args.filter((a) => !a.startsWith("--"));
const [urlsFile, outDir, wxsaveBin] = positional;
const dryRun = flags.has("--dry-run");
const force = flags.has("--force");

if (!urlsFile || !outDir || !wxsaveBin) {
  console.error(
    `${TAG} usage: wxsave-batch.js <urls-file> <out_dir> <wxsave-bin> [--dry-run] [--force]`
  );
  process.exit(1);
}

// --- read + parse input ---
let raw;
try {
  raw = fs.readFileSync(urlsFile, "utf8");
} catch (e) {
  console.error(`${TAG} cannot read ${urlsFile}: ${e.message}`);
  process.exit(1);
}

const urls = [];
let commentCount = 0;
let blankCount = 0;
for (const line of raw.split(/\r?\n/)) {
  const t = line.trim();
  if (!t) {
    blankCount++;
    continue;
  }
  if (t.startsWith("#")) {
    commentCount++;
    continue;
  }
  urls.push(t);
}

console.log(
  `${TAG} ${urls.length} URLs parsed from ${urlsFile} ` +
    `(${commentCount} comments, ${blankCount} blank lines skipped)` +
    `${dryRun ? " [dry-run]" : ""}${force ? " [force]" : ""}`
);
if (urls.length === 0) process.exit(0);

// --- dry-run: preflight via lookupArchived only, no subprocess ---
if (dryRun) {
  let wouldSkip = 0;
  let wouldArchive = 0;
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const label = `[${i + 1}/${urls.length}]`;
    const hit = force ? null : lookupArchived(url, { outDir });
    if (hit) {
      console.log(`${label} SKIP     ${url}\n           → ${hit.absPath}`);
      wouldSkip++;
    } else {
      console.log(`${label} ARCHIVE  ${url}`);
      wouldArchive++;
    }
  }
  console.log(
    `${TAG} dry-run summary: ${wouldSkip} would skip, ${wouldArchive} would archive`
  );
  process.exit(0);
}

// --- real run ---
const failedPath = urlsFile + ".failed";
// Truncate at start — we want the latest run's failures, not accumulated
// cross-run noise.
fs.writeFileSync(failedPath, "");

let archived = 0;
let skipped = 0;
let failed = 0;
let interrupted = false;

process.on("SIGINT", () => {
  if (!interrupted) {
    interrupted = true;
    console.log(`\n${TAG} interrupted — finishing current URL, then summary...`);
  }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  for (let i = 0; i < urls.length; i++) {
    if (interrupted) break;

    const url = urls[i];
    const label = `[${i + 1}/${urls.length}]`;
    console.log(`${label} ${url}`);

    const wxArgs = force ? ["--force", url] : [url];
    const result = spawnSync(wxsaveBin, wxArgs, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      // Strip the post-sync hook from the child env: we'll run it once at the
      // end of the batch instead of N times mid-loop on overlapping filesets.
      env: { ...process.env, WXSAVE_SYNC_AFTER: "" },
    });

    const stdout = (result.stdout || "").trim();
    const stderr = (result.stderr || "").trim();

    if (result.status !== 0) {
      failed++;
      fs.appendFileSync(failedPath, url + "\n");
      const errSummary = (
        stderr.split("\n").slice(-2).join(" | ") || "non-zero exit"
      ).slice(0, 200);
      console.log(`${label} FAILED   exit=${result.status}: ${errSummary}`);
      continue;
    }

    if (stdout.includes("[wxsave] already archived:")) {
      skipped++;
      const m = stdout.match(/\[wxsave\] already archived: (.+)/);
      console.log(
        `${label} SKIP     already archived${m ? `\n           → ${m[1]}` : ""}`
      );
      continue;
    }

    const savedMatch = stdout.match(/\[wxsave\] saved: (.+)/);
    if (savedMatch) {
      archived++;
      console.log(`${label} ARCHIVED → ${savedMatch[1]}`);
      // Rate-limit only after actual archive (skipped entries made zero
      // network requests, no anti-scrape heuristic to feed).
      if (i < urls.length - 1 && !interrupted) {
        await sleep(SLEEP_MS);
      }
      continue;
    }

    // wxsave exit 0 but no recognizable sentinel — treat as failure so the
    // URL ends up in .failed rather than silently disappearing.
    failed++;
    fs.appendFileSync(failedPath, url + "\n");
    const tail = stdout.split("\n").slice(-3).join("\n");
    console.log(`${label} FAILED   could not parse wxsave output\n${tail}`);
  }

  // --- summary ---
  const total = archived + skipped + failed;
  console.log(
    `${TAG} summary: ${archived} archived, ${skipped} skipped, ${failed} failed ` +
      `(${total}/${urls.length}${interrupted ? ", interrupted" : ""})`
  );
  if (failed > 0) {
    console.log(
      `${TAG} failed URLs written to ${failedPath}; retry with:\n` +
        `  wxsave --batch ${failedPath}`
    );
  } else {
    try {
      fs.unlinkSync(failedPath);
    } catch {}
  }

  if (archived > 0) {
    try {
      require("./wxsave-index").rebuildIndex(outDir, { quiet: true });
      console.log(`${TAG} index refreshed`);
    } catch (e) {
      console.warn(`${TAG} index refresh failed: ${e.message}`);
    }

    // Single post-sync at the end of the batch (not per archive) so a long
    // run doesn't fire rsync N times on overlapping file sets. See the
    // matching hook in bin/wxsave for the per-URL path.
    const syncCmd = process.env.WXSAVE_SYNC_AFTER;
    if (syncCmd) {
      console.log(`${TAG} sync: ${syncCmd}`);
      const r = spawnSync("bash", ["-c", syncCmd], { stdio: "inherit" });
      if (r.status !== 0) {
        console.warn(`${TAG} sync failed (non-fatal), exit=${r.status}`);
      }
    }
  }

  process.exit(interrupted ? 130 : 0);
})();
