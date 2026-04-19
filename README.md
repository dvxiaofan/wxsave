# wxsave

把微信公众号文章完整归档为单个离线 HTML 文件，即使原文被删也能原样查看。按**公众号名字自动分子目录**存放，易于长期维护。

解决的问题：
- 公众号图片防盗链（需要 `Referer`）
- 懒加载图片 `data-src` → `src` 的替换
- 发布时间自动提取，用作文件名前缀
- 公众号名字自动提取，用作子目录名
- SingleFile 序列化偶发的 `<img>` 结构破损（orphan SVG 占位值把后续属性文本挤出标签外）自动修复
- 排版 100% 还原（不做 Markdown 转换这种有损操作）

## 安装

```bash
# 1) 依赖
npm install -g single-file-cli

# 2) 克隆本仓库后
cd wxsave
./install.sh
```

`install.sh` 会把 `bin/wxsave` 软链到 `~/.local/bin/wxsave`。确认 `~/.local/bin` 在你的 `PATH` 里即可。

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

### 修复历史坏文件（`--repair`)

部分早期保存的文件里，`<img src="...占位 GIF..."` 后被挤入了孤立的 SVG 占位值（形如 `'data:image/svg+xml,<svg ...><rect fill-opacity="0"/></svg>'`）。SVG 里的 `>` 会提前闭合 `<img>`，导致浏览器把后面的属性当文本显示出来（典型症状：页面里出现裸露的 `_width=16px data-order=1 data-report-img-idx=2 data-fail=0>`）。

一键扫描并修复整个归档目录（递归）：

```bash
wxsave --repair --dry-run    # 预览：命中多少文件、多少片段
wxsave --repair              # 原地重写
```

同样的修复已经内置到 `lib/wxsave-postprocess.js` 的 step 0，新保存的文章会自动走一遍 —— 所以 `--repair` 只需要对老文件跑一次。

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

## 工作原理

1. **SingleFile CLI** 驱动 headless Chrome，加 `Referer=https://mp.weixin.qq.com/` 解决防盗链，把页面打包成自包含单文件 HTML（CSS/字体全内联）。
2. **浏览器内脚本** (`lib/wxsave-helper.js`) 先滚动到底触发懒加载，再把所有 `img[data-src]` 替换为真实 URL，尽可能让 SingleFile 把图片抓下来。
3. **Node 后处理** (`lib/wxsave-postprocess.js`) 分 3 步：
   - **step 0**：修复 orphan SVG 占位值（见 `--repair` 那一节）
   - **step 1**：对仍有 `data-src` 但没有真实 `src` 的图片，直接在 Node 里 `fetch` 下来转 base64 内联（没有 CORS 限制）
   - **step 2**：提取发布日期（`<em id=publish_time>` → `<meta article:published_time>` → JS 变量 `var ct=...`）和公众号名字（DOM 的 `id=js_name` → 内联 `var nickname=...` → `<meta og:site_name|author>`），把文件移动到 `<OUT_DIR>/<公众号名字>/<YYYY-MM-DD>_<title>.html`

## 项目结构

```
wxsave/
├── bin/
│   └── wxsave                  # zsh 入口脚本；分发 --migrate / --repair
├── lib/
│   ├── wxsave-helper.js        # 浏览器内注入脚本（懒加载处理）
│   ├── wxsave-postprocess.js   # Node 后处理（orphan SVG 修复 + 图片 fetch + 按公众号归档）
│   ├── wxsave-migrate.js       # 旧文件一次性搬到 <公众号名字>/ 子目录
│   └── wxsave-repair.js        # 递归扫描 archive 修复 orphan SVG 片段
├── install.sh                  # 软链到 ~/.local/bin
└── README.md
```

## 依赖

- Node.js 18+（需要内置 `fetch`）
- [single-file-cli](https://github.com/gildas-lormeau/single-file-cli) 2.x
- Google Chrome 或 Chromium

## License

MIT
