#!/usr/bin/env node
// wxsave-index.js
// Walk <out_dir>, group archived .html files by 公众号 subdir, and generate:
//   <out_dir>/index.html                 — list of all 公众号 (card grid)
//   <out_dir>/<nickname>/index.html      — per-公众号 article list (date-desc)
//
// Usage (CLI):
//   node wxsave-index.js <out_dir> [--quiet]
//
// Usage (programmatic):
//   const { rebuildIndex } = require("./wxsave-index");
//   rebuildIndex(outDir, { quiet: true });

const fs = require("node:fs");
const path = require("node:path");

const TAG = "[wxsave-index]";
const INDEX_FILE = "index.html";
const DATE_RE = /^(\d{4}-\d{2}-\d{2})_(.+)\.html$/i;

const escapeHtml = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const encodePathSegment = (s) => encodeURIComponent(s).replace(/'/g, "%27");

const parseArticleFile = (name) => {
  const m = name.match(DATE_RE);
  if (m) return { date: m[1], title: m[2] };
  return { date: null, title: name.replace(/\.html$/i, "") };
};

const listAccountDirs = (outDir) =>
  fs
    .readdirSync(outDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name);

const listAccountArticles = (accountDir) =>
  fs
    .readdirSync(accountDir, { withFileTypes: true })
    .filter(
      (e) =>
        e.isFile() &&
        !e.name.startsWith(".") &&
        e.name.toLowerCase().endsWith(".html") &&
        e.name.toLowerCase() !== INDEX_FILE
    )
    .map((e) => {
      const { date, title } = parseArticleFile(e.name);
      return { file: e.name, date, title };
    });

const sortArticles = (articles) =>
  articles.sort((a, b) => {
    if (a.date && b.date) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    } else if (a.date) return -1;
    else if (b.date) return 1;
    return a.title.localeCompare(b.title, "zh-Hans-CN");
  });

const sortAccounts = (accounts) =>
  accounts.sort((a, b) => {
    if (a.latestDate && b.latestDate) {
      if (a.latestDate !== b.latestDate) return a.latestDate < b.latestDate ? 1 : -1;
    } else if (a.latestDate) return -1;
    else if (b.latestDate) return 1;
    return a.name.localeCompare(b.name, "zh-Hans-CN");
  });

const CSS = `:root {
  --bg: #fafafa;
  --fg: #1a1a1a;
  --muted: #888;
  --card-bg: #fff;
  --card-border: #e6e6e6;
  --card-hover-border: #b8b8b8;
  --accent: #0f766e;
  --shadow: 0 1px 2px rgba(0,0,0,0.04);
  --shadow-hover: 0 4px 12px rgba(0,0,0,0.08);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #111;
    --fg: #e6e6e6;
    --muted: #888;
    --card-bg: #1a1a1a;
    --card-border: #2a2a2a;
    --card-hover-border: #3f3f3f;
    --accent: #2dd4bf;
    --shadow: 0 1px 2px rgba(0,0,0,0.3);
    --shadow-hover: 0 4px 12px rgba(0,0,0,0.5);
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB",
    "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif;
  background: var(--bg);
  color: var(--fg);
  line-height: 1.5;
  padding: 24px 20px 60px;
  max-width: 1100px;
  margin: 0 auto;
}
header { margin-bottom: 28px; }
header h1 {
  font-size: 22px;
  margin: 0 0 4px;
  font-weight: 600;
}
header .sub {
  color: var(--muted);
  font-size: 13px;
}
header .sub a { color: var(--accent); text-decoration: none; }
header .sub a:hover { text-decoration: underline; }
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 14px;
}
.card {
  display: block;
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: 10px;
  padding: 16px 16px 14px;
  text-decoration: none;
  color: inherit;
  box-shadow: var(--shadow);
  transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
}
.card:hover {
  border-color: var(--card-hover-border);
  box-shadow: var(--shadow-hover);
  transform: translateY(-1px);
}
.card .name {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.card .meta {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  color: var(--muted);
  font-size: 12px;
}
.card .count { color: var(--accent); font-weight: 500; font-variant-numeric: tabular-nums; }
ul.articles { list-style: none; padding: 0; margin: 0; }
ul.articles li {
  border-bottom: 1px solid var(--card-border);
}
ul.articles li:last-child { border-bottom: none; }
ul.articles a {
  display: flex;
  gap: 14px;
  padding: 12px 2px;
  text-decoration: none;
  color: inherit;
  align-items: baseline;
}
ul.articles a:hover { color: var(--accent); }
ul.articles .date {
  flex: 0 0 auto;
  color: var(--muted);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  width: 90px;
}
ul.articles .title {
  flex: 1 1 auto;
  font-size: 15px;
  overflow-wrap: anywhere;
}
footer {
  margin-top: 32px;
  color: var(--muted);
  font-size: 12px;
  text-align: center;
}
@media (max-width: 640px) {
  body { padding: 18px 14px 40px; }
  .grid { grid-template-columns: repeat(auto-fill, minmax(46%, 1fr)); gap: 10px; }
  .card { padding: 12px; }
  .card .name { font-size: 14px; }
  ul.articles .date { width: 78px; font-size: 12px; }
  ul.articles .title { font-size: 14px; }
}`;

const renderPage = ({ title, bodyHtml, breadcrumb }) => `<!doctype html>
<html lang="zh-Hans">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${escapeHtml(title)}</title>
<style>${CSS}</style>
</head>
<body>
<header>
  <h1>${escapeHtml(title)}</h1>
  <div class="sub">${breadcrumb}</div>
</header>
${bodyHtml}
<footer>由 <code>wxsave --reindex</code> 生成</footer>
</body>
</html>
`;

const renderRoot = (accounts, outDir) => {
  const totalArticles = accounts.reduce((n, a) => n + a.articles.length, 0);
  const generated = new Date().toLocaleString("zh-CN", { hour12: false });
  const breadcrumb = `${accounts.length} 个公众号 · ${totalArticles} 篇归档 · 生成于 ${escapeHtml(generated)}`;
  const cards = accounts
    .map((a) => {
      const latest = a.latestDate || "—";
      return `  <a class="card" href="${encodePathSegment(a.name)}/${INDEX_FILE}">
    <div class="name">${escapeHtml(a.name)}</div>
    <div class="meta"><span class="count">${a.articles.length} 篇</span><span>最新 ${escapeHtml(latest)}</span></div>
  </a>`;
    })
    .join("\n");
  const body = accounts.length
    ? `<section class="grid">\n${cards}\n</section>`
    : `<p style="color:var(--muted)">暂无归档。跑一次 <code>wxsave &lt;url&gt;</code> 后再回来。</p>`;
  return renderPage({
    title: "微信公众号归档",
    bodyHtml: body,
    breadcrumb,
  });
};

const renderAccount = (account) => {
  const breadcrumb = `<a href="../${INDEX_FILE}">← 全部公众号</a> · ${account.articles.length} 篇`;
  const items = account.articles
    .map((art) => {
      const href = encodePathSegment(art.file);
      const dateLabel = art.date || "—";
      return `  <li><a href="${href}"><span class="date">${escapeHtml(dateLabel)}</span><span class="title">${escapeHtml(art.title)}</span></a></li>`;
    })
    .join("\n");
  const body = account.articles.length
    ? `<ul class="articles">\n${items}\n</ul>`
    : `<p style="color:var(--muted)">该公众号暂无归档。</p>`;
  return renderPage({
    title: account.name,
    bodyHtml: body,
    breadcrumb,
  });
};

const rebuildIndex = (outDir, opts = {}) => {
  const { quiet = false } = opts;
  const log = quiet ? () => {} : (...a) => console.log(TAG, ...a);

  if (!fs.existsSync(outDir) || !fs.statSync(outDir).isDirectory()) {
    throw new Error(`out_dir not found or not a directory: ${outDir}`);
  }

  const accountNames = listAccountDirs(outDir);
  const accounts = accountNames.map((name) => {
    const accountDir = path.join(outDir, name);
    const articles = sortArticles(listAccountArticles(accountDir));
    const latestDate = articles.find((a) => a.date)?.date || null;
    return { name, dir: accountDir, articles, latestDate };
  });
  sortAccounts(accounts);

  for (const account of accounts) {
    const html = renderAccount(account);
    const outPath = path.join(account.dir, INDEX_FILE);
    fs.writeFileSync(outPath, html, "utf8");
  }

  const rootHtml = renderRoot(accounts, outDir);
  fs.writeFileSync(path.join(outDir, INDEX_FILE), rootHtml, "utf8");

  const totalArticles = accounts.reduce((n, a) => n + a.articles.length, 0);
  log(
    `rebuilt: ${accounts.length} account(s), ${totalArticles} article(s) → ${path.join(outDir, INDEX_FILE)}`
  );
  return { accounts: accounts.length, articles: totalArticles };
};

module.exports = { rebuildIndex };

if (require.main === module) {
  const args = process.argv.slice(2);
  const outDir = args.find((a) => !a.startsWith("--"));
  const quiet = args.includes("--quiet");
  if (!outDir) {
    console.error(`${TAG} usage: wxsave-index.js <out_dir> [--quiet]`);
    process.exit(1);
  }
  try {
    rebuildIndex(outDir, { quiet });
  } catch (e) {
    console.error(`${TAG} error: ${e.message}`);
    process.exit(1);
  }
}
