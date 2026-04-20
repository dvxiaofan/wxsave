# wxsave

把微信公众号文章完整归档为单个离线 HTML 文件，即使原文被删也能原样查看。按**公众号名字自动分子目录**存放，易于长期维护。配套 `wxwatch` 可以配合 Wechat2RSS 做**新文章自动监控 + 归档**。

解决的问题：
- 公众号图片防盗链（需要 `Referer`）
- 懒加载图片 `data-src` → `src` 的替换
- 发布时间自动提取，用作文件名前缀
- 公众号名字自动提取，用作子目录名
- SingleFile 序列化偶发的 `<img>` 结构破损（orphan SVG 占位值把后续属性文本挤出标签外）自动修复
- 排版 100% 还原（不做 Markdown 转换这种有损操作）
- 定时监控指定公众号的新文章，自动归档到本地
- 归档后自动生成按公众号分组、按日期倒序的索引页，直接浏览器翻阅
- 同一篇文章重复归档自动跳过（跨 URL 形态去重，支持 `--force` 强制重抓）

## 安装

```bash
# 1) 依赖
npm install -g single-file-cli

# 2) 克隆本仓库后
cd wxsave
./install.sh
```

`install.sh` 会把 `bin/wxsave` 和 `bin/wxwatch` 都软链到 `~/.local/bin/`。确认 `~/.local/bin` 在你的 `PATH` 里即可。

## 使用

### 归档单篇文章

```bash
wxsave https://mp.weixin.qq.com/s/XXXXXXXXXXXXXXXXXX
```

- 默认保存到 `~/Documents/wechat-archive/<公众号名字>/`
- 文件名格式：`YYYY-MM-DD_文章标题.html`（日期取自文章实际发布时间，取不到时回退到今天）
- 公众号名字提取失败时落到 `_unknown/` 子目录，便于事后手动归类
- 典型耗时 15–40 秒/篇（headless Chrome + 懒加载图片抓取）

### 把旧文件按公众号归类（`--migrate`）

对升级前保存在根目录的老文件一次性搬到 `<公众号名字>/` 子目录：

```bash
wxsave --migrate --dry-run   # 预览
wxsave --migrate             # 实际移动
```

提取不到公众号名字的文件留在原地并打 warning，便于你手动处理。

### 修复历史坏文件（`--repair`）

部分早期保存的文件里，`<img src="...占位 GIF..."` 后被挤入了孤立的 SVG 占位值（形如 `'data:image/svg+xml,<svg ...><rect fill-opacity="0"/></svg>'`）。SVG 里的 `>` 会提前闭合 `<img>`，导致浏览器把后面的属性当文本显示出来（典型症状：页面里出现裸露的 `_width=16px data-order=1 data-report-img-idx=2 data-fail=0>`）。

一键扫描并修复整个归档目录（递归）：

```bash
wxsave --repair --dry-run    # 预览：命中多少文件、多少片段
wxsave --repair              # 原地重写
```

同样的修复已经内置到 `lib/wxsave-postprocess.js` 的 step 0，新保存的文章会自动走一遍 —— 所以 `--repair` 只需要对老文件跑一次。

### 归档索引页（`--reindex`）

每次 `wxsave <url>` 归档成功后会**自动**刷新两级索引：

- `<OUT_DIR>/index.html` — 全部公众号的卡片列表（文章数 + 最新日期），点击进号内页
- `<OUT_DIR>/<公众号名字>/index.html` — 该号所有文章，按发布日期倒序

直接浏览器打开 `<OUT_DIR>/index.html` 就能翻阅，手机 / 暗色模式自适应；搭配静态文件服务器（如 Caddy `file_server`）也是默认优先 serve `index.html`，远程访问零额外配置。

需要手动重建（比如外部工具往 `OUT_DIR` 里拷了文件）：

```bash
wxsave --reindex
```

`--migrate` 和 `--repair` 跑完有实际变更时也会自动跑一次重建。

### 去重（避免重复归档）

默认情况下，`wxsave <url>` 会先查 `~/.local/share/wxsave/archived.json`（URL → 归档文件的映射）：**命中就直接跳过**，不跑 headless Chrome。

```bash
$ wxsave https://mp.weixin.qq.com/s/QEyGMz4Hc8T39xVYlynhTQ
[wxsave] already archived: ~/Documents/wechat-archive/呦呦鹿鸣/2026-01-03_...html
[wxsave] (use --force to re-archive)
```

去重 key 是规范化 URL，所以同一篇文章的不同链接形态都会命中同一条：

- `https://mp.weixin.qq.com/s/<token>` ← 短链
- `https://mp.weixin.qq.com/s?__biz=...&mid=...&idx=...&chksm=...&sn=...` ← 长链
- 任意带 `#wechat_redirect` 或额外 query 的变体

强制重抓（比如上一次归档时图没抓全、想覆盖旧版）：

```bash
wxsave --force <url>
```

文件会原地覆盖，state 记录更新。

首次升级到带去重的 wxsave 后，对已有归档**跑一次**回填：

```bash
wxsave --reindex-urls
```

它 walk `OUT_DIR`，从每个 HTML 的 `<meta property=og:url>` 抽出源 URL，写入 state。后续归档会自动维护，不用再手跑。

**文件被删的场景自动处理**：如果 state 里的记录指向已被 `rm` 的文件，`wxsave` 查询时会自动清理该条目并把 URL 当作未归档处理，下次跑会重新归档。

### 批量归档（`--batch`）

一次性跑一个 URL 列表（比如历史文章回收、别人推荐的一批文章）：

```bash
wxsave --batch urls.txt              # 逐行跑；已归档自动跳过（复用 dedup）
wxsave --batch urls.txt --dry-run    # 只打印每条的 SKIP/ARCHIVE 状态，不归档
wxsave --batch urls.txt --force      # 全部重抓，跳过 dedup
```

**输入文件格式**：每行一个 URL，`#` 开头和空行忽略：

```
# 呦呦鹿鸣历史文章
https://mp.weixin.qq.com/s/QEyGMz4Hc8T...
https://mp.weixin.qq.com/s/Hsbj4GuObkg...

# 武志红
https://mp.weixin.qq.com/s/abc123def456...
```

**运行时行为**：
- 逐条串行跑（微信反爬不能并发）
- 已归档立刻 SKIP（~200ms），不计入 sleep
- 新归档成功后 sleep 3s 再跑下一条（防反爬）
- 失败 URL 累积到 `<input>.failed`，重试只需 `wxsave --batch urls.txt.failed`
- Ctrl-C 随时可打断，已处理的保留在 dedup state
- 末尾刷新索引页一次

典型输出：

```
[wxsave-batch] 42 URLs parsed from urls.txt (0 comments, 2 blank lines skipped)
[1/42] https://mp.weixin.qq.com/s/...
[1/42] SKIP     already archived → 呦呦鹿鸣/2026-01-03_...html
[2/42] https://mp.weixin.qq.com/s/...
[2/42] ARCHIVED → 呦呦鹿鸣/2026-04-20_...html
...
[wxsave-batch] summary: 10 archived, 32 skipped, 0 failed (42/42)
[wxsave-batch] index refreshed
```

### 自动监控新文章（`wxwatch`）

`wxwatch` 配合 [Wechat2RSS](https://wechat2rss.xlab.app/)（免费的微信公众号 RSS 服务）做**定时拉 feed → 去重 → 自动调 `wxsave` 归档新文章**。

**一次性注册**：

1. 到 [wechat2rss.xlab.app/list/](https://wechat2rss.xlab.app/list/) 找到目标公众号，记录 feed URL 里末尾的 40-char hex id
2. `wxwatch --add <公众号名字> <feed_id>`

`--add` 默认会 **seed**：把 feed 里当前所有 item 标记为"已看过"，首次运行只抓注册之后**真正新发布**的文章，避免一次把历史 20 条全 pull 下来。想反向（首跑把历史全抓）加 `--no-seed`。

**日常命令**：

```bash
wxwatch --list                  # 已注册的公众号和状态
wxwatch <名字>                  # 手动触发一次（一般由 cron 跑）
wxwatch <名字> --dry-run        # 只打印会抓什么，不归档
```

**挂 cron 每 20 分钟跑一次**（Wechat2RSS 自身延迟约 6 小时，跑更快没意义）：

```bash
(crontab -l 2>/dev/null | grep -v 'wxwatch <名字>'; \
 echo '*/20 * * * * ~/.local/bin/wxwatch <名字> >> ~/Documents/wechat-archive/.wxwatch.log 2>&1') | crontab -
```

**文件位置**：

- Feed 配置：`~/.local/share/wxwatch/feeds.json`
- 每个公众号的 seen 状态：`~/.local/share/wxwatch/<名字>.state.json`
- 日志：`~/Documents/wechat-archive/.wxwatch.log`

## 配置

### 保存目录

默认路径定义在 [`bin/wxsave`](bin/wxsave) 里：

```zsh
OUT_DIR="${WXSAVE_OUTPUT_DIR:-$HOME/Documents/wechat-archive}"
```

三种改法（按推荐度）：

1. **单次调用**：`WXSAVE_OUTPUT_DIR=~/Dropbox/wechat wxsave <url>`
2. **永久生效（推荐）**：在 `~/.zshrc` / `~/.bashrc` 里
   ```bash
   export WXSAVE_OUTPUT_DIR="$HOME/Dropbox/wechat"
   ```
3. **改源文件**：直接把 `bin/wxsave` 里的 `$HOME/Documents/wechat-archive` 改掉 —— 不推荐，后续 `git pull` 会冲突。

`wxwatch` 也读同一个 `WXSAVE_OUTPUT_DIR`（用于定位日志文件），所以一处设置两处生效。

## 工作原理

1. **SingleFile CLI** 驱动 headless Chrome，加 `Referer=https://mp.weixin.qq.com/` 解决防盗链，把页面打包成自包含单文件 HTML（CSS/字体全内联）。
2. **浏览器内脚本** (`lib/wxsave-helper.js`) 先滚动到底触发懒加载，再把所有 `img[data-src]` 替换为真实 URL，尽可能让 SingleFile 把图片抓下来。
3. **Node 后处理** (`lib/wxsave-postprocess.js`) 分 3 步：
   - **step 0**：修复 orphan SVG 占位值（见 `--repair` 那一节）
   - **step 1**：对仍有 `data-src` 但没有真实 `src` 的图片，直接在 Node 里 `fetch` 下来转 base64 内联（没有 CORS 限制）
   - **step 2**：提取发布日期（`<em id=publish_time>` → `<meta article:published_time>` → JS 变量 `var ct=...`）和公众号名字（DOM 的 `id=js_name` → 内联 `var nickname=...` → `<meta og:site_name|author>`），把文件移动到 `<OUT_DIR>/<公众号名字>/<YYYY-MM-DD>_<title>.html`
4. **`wxwatch`**（python3）：拉 Wechat2RSS 的 feed XML → 按 `__biz+mid+idx` 或 `/s/<token>` 做 dedup key → 对未见 item `subprocess.run(["wxsave", url])`，归档完才写 state，失败下次自动重试。
5. **`lib/wxsave-index.js`**：归档结束（以及 `--migrate` / `--repair` 批量操作结束）后自动跑一次，walk `OUT_DIR` → 按公众号分组、按日期倒序 → 生成 `index.html` + `<公众号>/index.html`。纯静态产物，零 runtime 依赖。
6. **`lib/wxsave-archived.js`** + **`lib/wxsave-url.js`**：维护 `~/.local/share/wxsave/archived.json`（规范化 URL → 归档文件的相对路径）。`wxsave <url>` 开头查一次，命中就跳过；postprocess 成功时追加。

## 项目结构

```
wxsave/
├── bin/
│   ├── wxsave                  # zsh 入口脚本；分发 --migrate / --repair / --reindex / --reindex-urls / --batch
│   └── wxwatch                 # python3 监控脚本；调 wxsave 自动归档
├── lib/
│   ├── wxsave-helper.js        # 浏览器内注入脚本（懒加载处理）
│   ├── wxsave-postprocess.js   # Node 后处理（orphan SVG 修复 + 图片 fetch + 按公众号归档 + 写去重 state）
│   ├── wxsave-migrate.js       # 旧文件一次性搬到 <公众号名字>/ 子目录
│   ├── wxsave-repair.js        # 递归扫描 archive 修复 orphan SVG 片段
│   ├── wxsave-index.js         # 生成两级 index.html，归档后自动调一次
│   ├── wxsave-url.js           # URL 规范化 + 从归档 HTML 抽源 URL
│   ├── wxsave-archived.js      # 维护 ~/.local/share/wxsave/archived.json（URL 去重 state）
│   ├── wxsave-reindex-urls.js  # 一次性回填 archived.json（wxsave --reindex-urls 调）
│   ├── wxsave-batch.js         # 批量归档：wxsave --batch urls.txt
│   └── wxsave-extract.js       # 纯函数：extractNickname / extractPublishDate / sanitizeDirName / fixOrphanSvgValues
├── test/                       # node:test 单测 + 最小 HTML fixtures
├── scripts/
│   └── verify-normalize-parity.sh   # Node/Python normalize_link 对齐 smoke
├── install.sh                  # 软链 wxsave + wxwatch 到 ~/.local/bin
├── package.json                # npm test / test:parity 入口（零 runtime deps）
└── README.md
```

## 依赖

- Node.js 18+（需要内置 `fetch`）
- Python 3.9+（`wxwatch` 使用，macOS 自带）
- [single-file-cli](https://github.com/gildas-lormeau/single-file-cli) 2.x
- Google Chrome 或 Chromium

## 开发 / 测试

零外部 deps，`node:test` 内置：

```bash
npm test            # 单元测试（test/*.test.js, 46 cases）
npm run test:parity # Node/Python normalize_link 算法对齐 smoke
```

`scripts/verify-normalize-parity.sh` 确保 `lib/wxsave-url.js` 的 `normalizeUrl`（Node）和 `bin/wxwatch` 的 `normalize_link`（Python）对同一 URL 产出相同的 dedup key。改任一侧都要跑一遍。

## License

MIT
